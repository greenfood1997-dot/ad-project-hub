import { readDb, mutateDb, dbMode } from "./db.mjs";
import { getCurrentUser, readBody, requireRole, sendJson } from "./http-utils.mjs";
import {
  addComment,
  actOnApproval,
  createApproval,
  advanceParseJob,
  createProject,
  clientLibrary,
  collectionLibrary,
  deleteProject,
  feishuProjectBindings,
  feishuPendingFiles,
  handleFeishuPendingFile,
  handleFeishuEvent,
  previewProjectUpload,
  recordProjectPayment,
  recordFiles,
  rateSupplier,
  reparseProject,
  refreshInterestRate,
  saveSetting,
  saveClientProfile,
  saveCollectionOutcome,
  saveFeishuProjectBinding,
  sendSystemNotificationToFeishu,
  supplierCsv,
  supplierLibrary,
  suggestCollectionScript,
  scanSystemNotifications,
  testAiSettings,
  updateAlert,
  updateSystemNotification,
  updateProject,
  upsertProjectTask,
  uploadProjectCostSheet,
  uploadProjectQuoteSheet,
  uploadProjectVerificationSheet
} from "./services.mjs";

const OWNER_ROLES = ["shareholder"];
const ADMIN_ROLES = ["shareholder", "admin"];
const DIRECTOR_ROLES = ["shareholder", "admin", "director"];
const MANAGEMENT_ROLES = ["shareholder", "admin", "director", "finance"];
const PROJECT_WRITE_ROLES = ["shareholder", "admin", "director", "pm", "sales"];
const ROLE_LABELS = {
  shareholder: "股东",
  admin: "管理员",
  director: "总监",
  pm: "项目经理",
  sales: "销售",
  finance: "财务",
  member: "普通成员",
  viewer: "只读成员"
};
const DEFAULT_EMAILS = {
  "u-shareholder": "owner@company.local",
  "u-admin": "admin@company.local",
  "u-director": "director@company.local",
  "u-pm": "pm@company.local",
  "u-sales": "sales@company.local",
  "u-finance": "finance@company.local",
  "u-member": "member@company.local"
};

function publicUser(user) {
  if (!user) return null;
  const { pin, ...safeUser } = user;
  return safeUser;
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function nextUserId(db) {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureMemberFields(user) {
  return {
    status: "active",
    pin: "123456",
    ...user,
    email: user.email || DEFAULT_EMAILS[user.id] || `${user.id}@company.local`,
    status: user.status || "active",
    pin: user.pin || "123456"
  };
}

function saveMember(db, body, actor) {
  const role = body.role || "member";
  if (!ROLE_LABELS[role]) throw new Error("不支持的成员角色");
  const email = normalizeEmail(body.email);
  if (!email) throw new Error("请填写成员邮箱");
  if (!body.name?.trim()) throw new Error("请填写成员姓名");
  const existing = db.users.find((item) => item.id === body.id);
  const duplicate = db.users.find((item) => normalizeEmail(item.email) === email && item.id !== body.id);
  if (duplicate) throw new Error("该邮箱已经存在");

  const member = {
    id: existing?.id || nextUserId(db),
    name: body.name.trim(),
    email,
    role,
    department: body.department?.trim() || "",
    feishuOpenId: String(body.feishuOpenId || existing?.feishuOpenId || "").trim(),
    feishuUserId: String(body.feishuUserId || existing?.feishuUserId || "").trim(),
    feishuName: String(body.feishuName || existing?.feishuName || body.name || "").trim(),
    status: body.status || "active",
    pin: body.pin || existing?.pin || "123456",
    createdAt: existing?.createdAt || new Date().toISOString()
  };

  if (existing) Object.assign(existing, member);
  else db.users.push(member);

  db.auditLogs.unshift({
    type: "member",
    target: member.email,
    action: existing ? "update" : "create",
    user: actor.name,
    at: new Date().toISOString()
  });
  return publicUser(member);
}

function setMemberStatus(db, body, actor) {
  const member = db.users.find((item) => item.id === body.id);
  if (!member) throw new Error("成员不存在");
  if (member.id === actor.id && body.status === "disabled") throw new Error("不能停用当前登录账号");
  member.status = body.status === "disabled" ? "disabled" : "active";
  db.auditLogs.unshift({
    type: "member",
    target: member.email || member.name,
    action: member.status,
    user: actor.name,
    at: new Date().toISOString()
  });
  return publicUser(member);
}

function settingMembers(db) {
  return Array.isArray(db.settings?.members?.items) ? db.settings.members.items : [];
}

function memberDisplayName(user = {}) {
  return user.name || user.email || user.id || "";
}

function assignmentBindingsForProject(db, project) {
  return settingMembers(db).filter((member) => projectMatchesMember(project, member));
}

function projectAssignments(db) {
  return (db.projects || []).map((project) => ({
    id: project.id,
    name: project.name,
    client: project.client || "",
    status: project.status || "",
    department: projectDepartment(project),
    owner: project.owner || "",
    pm: project.pm || project.extractedFields?.pm || "",
    sales: project.sales || project.extractedFields?.sales || "",
    members: assignmentBindingsForProject(db, project)
      .map((member) => member.contact || member.name)
      .filter(Boolean)
  }));
}

function saveProjectAssignment(db, body, actor) {
  const project = (db.projects || []).find((item) => item.id === body.projectId);
  if (!project) throw new Error("项目不存在");

  const users = (db.users || []).map(ensureMemberFields);
  const userById = new Map(users.map((item) => [item.id, item]));
  const findUser = (id) => userById.get(id) || null;
  const pm = findUser(body.pmId);
  const sales = findUser(body.salesId);
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
  const assignedUsers = memberIds.map(findUser).filter(Boolean);
  const now = new Date().toISOString();

  project.pm = pm ? memberDisplayName(pm) : "";
  project.sales = sales ? memberDisplayName(sales) : "";
  project.department = body.department || project.department || pm?.department || "";
  project.extractedFields = {
    ...(project.extractedFields || {}),
    pm: project.pm || "待分派",
    sales: project.sales || "待确认",
    assignedMemberIds: memberIds,
    assignedMembers: assignedUsers.map((member) => ({
      id: member.id,
    name: member.name,
    role: member.role,
    email: member.email,
    department: member.department,
    feishuOpenId: member.feishuOpenId || "",
    feishuUserId: member.feishuUserId || "",
    feishuName: member.feishuName || member.name
    }))
  };
  project.updatedAt = now;

  db.settings = db.settings || {};
  const currentMembers = settingMembers(db);
  const scopedOut = currentMembers.filter((member) => !projectMatchesMember(project, member));
  const assignmentRows = assignedUsers.map((member) => ({
    id: `assign-${project.id}-${member.id}`,
    userId: member.id,
    name: member.name,
    role: member.role === "pm" ? "PM" : member.role === "sales" ? "销售" : member.role === "finance" ? "财务" : "执行",
    department: member.department || "",
    project: project.name,
    projectId: project.id,
    feishuName: member.feishuName || member.name,
    contact: member.email,
    assignedAt: now,
    assignedBy: actor.id
  }));
  db.settings.members = {
    ...(db.settings.members || {}),
    items: [...scopedOut, ...assignmentRows],
    savedAt: now,
    savedBy: actor.id
  };

  db.auditLogs.unshift({
    type: "project",
    target: project.name,
    action: "assign",
    user: actor.name,
    meta: {
      pm: project.pm,
      sales: project.sales,
      members: assignedUsers.map((member) => member.name)
    },
    at: now
  });
  return { project, assignments: projectAssignments(db), members: db.settings.members.items };
}

function textMatches(a = "", b = "") {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function memberMatchesUser(member, user) {
  return textMatches(member.contact, user.email) || textMatches(member.name, user.name);
}

function projectMatchesMember(project, member) {
  if (!member.project) return true;
  return textMatches(project.name, member.project);
}

function projectHasUserRole(project, user) {
  return [project.owner, project.pm, project.sales].some((name) => textMatches(name, user.name));
}

function memberDepartmentsForUser(db, user) {
  return settingMembers(db)
    .filter((member) => memberMatchesUser(member, user))
    .map((member) => member.department || member["部门"] || member.dept || "")
    .filter(Boolean);
}

function projectDepartment(project) {
  return project.department || project["department"] || project.extractedFields?.department || project.extractedFields?.["所属部门"] || "";
}

function visibleProjectsForUser(db, user) {
  if ([...ADMIN_ROLES, "finance"].includes(user.role)) return db.projects || [];
  if (user.role === "director") {
    const departments = new Set([user.department, ...memberDepartmentsForUser(db, user)].filter(Boolean));
    return (db.projects || []).filter((project) => {
      const dept = projectDepartment(project);
      if (dept && departments.has(dept)) return true;
      if (!dept && departments.has(project.ownerDepartment || project.pmDepartment || "")) return true;
      return projectHasUserRole(project, user) || settingMembers(db).some((member) => memberMatchesUser(member, user) && projectMatchesMember(project, member));
    });
  }
  const bindings = settingMembers(db).filter((member) => memberMatchesUser(member, user));
  return (db.projects || []).filter((project) => projectHasUserRole(project, user) || bindings.some((member) => projectMatchesMember(project, member)));
}

function scopedSnapshot(db, user) {
  if (user.role === "admin") return db;
  const projects = visibleProjectsForUser(db, user);
  const projectIds = new Set(projects.map((project) => project.id));
  const projectNames = new Set(projects.map((project) => project.name));
  return {
    ...db,
    projects,
    clientProfiles: clientLibrary({ ...db, projects }),
    suppliers: (db.suppliers || []).filter((item) => projectNames.has(item.project)),
    supplierProfiles: supplierLibrary({
      ...db,
      suppliers: (db.suppliers || []).filter((item) => projectNames.has(item.project))
    }),
    approvals: (db.approvals || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    payments: (db.payments || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    collectionScripts: (db.collectionScripts || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    feishuProjectBindings: (db.feishuProjectBindings || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    feishuEvents: (db.feishuEvents || []).filter((item) => !item.projectId || projectIds.has(item.projectId) || projectNames.has(item.projectName)).slice(0, 50),
    feishuPendingFiles: (db.feishuPendingFiles || []).filter((item) => !item.projectId || projectIds.has(item.projectId) || projectNames.has(item.projectName)).slice(0, 50),
    systemNotifications: visibleSystemNotificationsFor(db, user),
    files: (db.files || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    parseJobs: (db.parseJobs || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    comments: (db.comments || []).filter((item) => projectNames.has(item.project)),
    alertUpdates: (db.alertUpdates || []).filter((item) => projectNames.has(item.project)),
    auditLogs: []
  };
}

function canAccessProject(db, user, projectId) {
  return visibleProjectsForUser(db, ensureMemberFields(user)).some((project) => project.id === projectId);
}

function visibleSystemNotificationsFor(db, user) {
  const actor = ensureMemberFields(user);
  const projects = visibleProjectsForUser(db, actor);
  const projectIds = new Set(projects.map((project) => project.id));
  const projectNames = new Set(projects.map((project) => project.name));
  const adminLike = ADMIN_ROLES.includes(actor.role);
  const managementLike = MANAGEMENT_ROLES.includes(actor.role);
  return (db.systemNotifications || [])
    .filter((item) => {
      if (item.status !== "待处理") return false;
      if (adminLike) return true;
      const hasProjectAccess = item.projectId ? projectIds.has(item.projectId) : projectNames.has(item.projectName);
      if (hasProjectAccess) return true;
      if (managementLike && Array.isArray(item.recipients) && item.recipients.includes(actor.role)) return true;
      return false;
    })
    .slice(0, 50);
}

function scopedSettings(settings = {}, user) {
  const result = {
    product: settings.product || {},
    interestRate: settings.interestRate || {},
    feishu: settings.feishu ? { configured: Boolean(settings.feishu.appId && settings.feishu.appSecret) } : null,
    wechat: settings.wechat ? { configured: Boolean(settings.wechat.webhookUrl || settings.wechat.corpId) } : null,
    storage: settings.storage ? { configured: Boolean(settings.storage.bucket || settings.storage.publicBaseUrl), provider: settings.storage.provider } : null,
    approvalRules: settings.approvalRules || null
  };
  if (settings.aiService) {
    result.aiService = {
      "服务商": settings.aiService["服务商"],
      "Base URL": settings.aiService["Base URL"],
      "模型名称": settings.aiService["模型名称"],
      connection: settings.aiService.connection,
      savedAt: settings.aiService.savedAt,
      configured: Boolean(settings.aiService["API Key"])
    };
  }
  if (MANAGEMENT_ROLES.includes(user.role)) {
    result.companyFinance = settings.companyFinance || settings.product?.companyFinance || {};
  }
  if (ADMIN_ROLES.includes(user.role)) {
    result.feishu = settings.feishu || null;
    result.wechat = settings.wechat || null;
    result.storage = settings.storage || null;
  }
  return result;
}

function publicState(db, user) {
  return {
    ...db,
    clientProfiles: clientLibrary(db),
    supplierProfiles: supplierLibrary(db),
    collectionScripts: collectionLibrary(db),
    feishuProjectBindings: ADMIN_ROLES.includes(user.role) ? feishuProjectBindings(db) : db.feishuProjectBindings || [],
    feishuEvents: ADMIN_ROLES.includes(user.role) ? (db.feishuEvents || []).slice(0, 50) : (db.feishuEvents || []).slice(0, 20),
    feishuPendingFiles: ADMIN_ROLES.includes(user.role) ? feishuPendingFiles(db).slice(0, 50) : (db.feishuPendingFiles || []).slice(0, 20),
    systemNotifications: visibleSystemNotificationsFor(db, user),
    settings: scopedSettings(db.settings || {}, user),
    users: ADMIN_ROLES.includes(user.role)
      ? (db.users || []).map((item) => publicUser(ensureMemberFields(item)))
      : []
  };
}

export async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const snapshot = await readDb();
  const user = getCurrentUser(req, snapshot);

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const pin = String(body.pin || "");
    const account = snapshot.users.map(ensureMemberFields).find((item) => normalizeEmail(item.email) === email && item.pin === pin);
    if (!account || account.status === "disabled") {
      sendJson(res, 401, { ok: false, error: "账号或 PIN 不正确，或账号已停用" });
      return;
    }
    sendJson(res, 200, { ok: true, data: publicUser(account) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    await mutateDb((db) => scanSystemNotifications(db, { id: "system", name: "系统扫描" }));
    const fresh = await readDb();
    const scoped = scopedSnapshot(fresh, ensureMemberFields(user));
    sendJson(res, 200, {
      ok: true,
      data: publicState(scoped, ensureMemberFields(user)),
      currentUser: publicUser(ensureMemberFields(user)),
      dbMode: dbMode()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/action") {
    const body = await readBody(req);
    const notice = (snapshot.systemNotifications || []).find((item) => item.id === body.id);
    if (!notice) {
      sendJson(res, 404, { ok: false, error: "系统通知不存在" });
      return;
    }
    const visible = visibleSystemNotificationsFor(snapshot, ensureMemberFields(user)).some((item) => item.id === notice.id);
    if (!visible) {
      sendJson(res, 403, { ok: false, error: "无权限处理该通知" });
      return;
    }
    const data = await mutateDb((db) => updateSystemNotification(db, body, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/feishu/send") {
    const body = await readBody(req);
    const notice = (snapshot.systemNotifications || []).find((item) => item.id === body.id);
    if (!notice) {
      sendJson(res, 404, { ok: false, error: "系统通知不存在" });
      return;
    }
    const visible = visibleSystemNotificationsFor(snapshot, ensureMemberFields(user)).some((item) => item.id === notice.id);
    if (!visible || !["shareholder", "admin", "director", "pm", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限发送该飞书通知" });
      return;
    }
    const data = await mutateDb((db) => sendSystemNotificationToFeishu(db, body, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/members") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    sendJson(res, 200, { ok: true, data: snapshot.users.map((item) => publicUser(ensureMemberFields(item))) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/members") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveMember(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/members/status") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => setMemberStatus(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project-assignments") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    sendJson(res, 200, { ok: true, data: projectAssignments(snapshot) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project-assignments") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveProjectAssignment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveSetting(db, body.type, body.values, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai/test") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await testAiSettings(body.values);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/interest-rate/refresh") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const data = await mutateDb((db) => refreshInterestRate(db, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/feishu/bindings") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    sendJson(res, 200, { ok: true, data: feishuProjectBindings(snapshot) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/bindings") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveFeishuProjectBinding(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/events") {
    const body = await readBody(req);
    const data = await mutateDb(async (db) => handleFeishuEvent(db, body, { id: "feishu-bot", name: "飞书机器人", role: "bot" }));
    if (data.challenge) sendJson(res, 200, { challenge: data.challenge });
    else sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/pending-files/action") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const pending = (snapshot.feishuPendingFiles || []).find((item) => item.id === body.id);
    if (!pending) {
      sendJson(res, 404, { ok: false, error: "飞书待确认文件不存在" });
      return;
    }
    if (pending.projectId && !canAccessProject(snapshot, user, pending.projectId) && !ADMIN_ROLES.includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限处理该飞书文件" });
      return;
    }
    const data = await mutateDb(async (db) => handleFeishuPendingFile(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => createProject(db, body.values, body.files || [], user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/upload-preview") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    if (body.type !== "create-project" && !canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传文件" });
      return;
    }
    const data = await previewProjectUpload(snapshot, body, user);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/update") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => updateProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/delete") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => deleteProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/reparse") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => reparseProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/cost-sheet") {
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传执行成本表" });
      return;
    }
    const data = await mutateDb((db) => uploadProjectCostSheet(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/quote-sheet") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传报价表" });
      return;
    }
    const data = await mutateDb((db) => uploadProjectQuoteSheet(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/verification-sheet") {
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传核销表" });
      return;
    }
    const data = await mutateDb((db) => uploadProjectVerificationSheet(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId || body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限为该项目记录回款" });
      return;
    }
    const data = await mutateDb((db) => recordProjectPayment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project-tasks") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId || body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限更新该项目任务" });
      return;
    }
    const data = await mutateDb((db) => upsertProjectTask(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/files/record") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => recordFiles(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/parse-jobs/progress") {
    const body = await readBody(req);
    const data = await mutateDb((db) => advanceParseJob(db, body.id || body.projectId));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/alerts/update") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => updateAlert(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/comments") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => addComment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限为该项目提交审批" });
      return;
    }
    const data = await mutateDb((db) => createApproval(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals/action") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "finance"], res)) return;
    const body = await readBody(req);
    const target = (snapshot.approvals || []).find((item) => item.id === body.id);
    if (!target) {
      sendJson(res, 404, { ok: false, error: "审批不存在" });
      return;
    }
    const data = await mutateDb((db) => actOnApproval(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suppliers/export") {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=supplier-settlements.csv"
    });
    res.end(supplierCsv(snapshot));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suppliers") {
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    sendJson(res, 200, { ok: true, data: supplierLibrary(scoped) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/suppliers/rate") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    const visibleNames = new Set((scoped.suppliers || []).map((item) => item.supplier));
    if (!visibleNames.has(body.supplier) && !["shareholder", "admin", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限评价该供应商" });
      return;
    }
    const data = await mutateDb((db) => rateSupplier(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/clients") {
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    sendJson(res, 200, { ok: true, data: publicState(scoped, ensureMemberFields(user)).clientProfiles });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/clients/profile") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    const visibleClients = new Set((scoped.projects || []).map((project) => String(project.client || project.brand || project.name || "").trim()));
    if (!visibleClients.has(String(body.client || "").trim()) && !["shareholder", "admin", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限维护该客户档案" });
      return;
    }
    const data = await mutateDb((db) => saveClientProfile(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/collections") {
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    sendJson(res, 200, { ok: true, data: collectionLibrary(scoped) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/collections/suggest") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId || body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限为该项目生成催收话术" });
      return;
    }
    const data = await mutateDb((db) => suggestCollectionScript(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/collections/outcome") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const record = (snapshot.collectionScripts || []).find((item) => item.id === body.id);
    if (!record) {
      sendJson(res, 404, { ok: false, error: "催收记录不存在" });
      return;
    }
    if (!canAccessProject(snapshot, user, record.projectId) && !["shareholder", "admin", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限更新该催收记录" });
      return;
    }
    const data = await mutateDb((db) => saveCollectionOutcome(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  sendJson(res, 404, { ok: false, error: "API not found" });
}
