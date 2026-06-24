import { readDb, mutateDb, dbMode } from "./db.mjs";
import { getCurrentUser, readBody, requireRole, sendJson } from "./http-utils.mjs";
import {
  addComment,
  actOnApproval,
  createApproval,
  advanceParseJob,
  createProject,
  deleteProject,
  previewProjectUpload,
  recordFiles,
  reparseProject,
  refreshInterestRate,
  saveSetting,
  supplierCsv,
  testAiSettings,
  updateAlert,
  updateProject,
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
  if (ADMIN_ROLES.includes(user.role)) return db.projects || [];
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
    suppliers: (db.suppliers || []).filter((item) => projectNames.has(item.project)),
    approvals: (db.approvals || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
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
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    sendJson(res, 200, {
      ok: true,
      data: publicState(scoped, ensureMemberFields(user)),
      currentUser: publicUser(ensureMemberFields(user)),
      dbMode: dbMode()
    });
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

  sendJson(res, 404, { ok: false, error: "API not found" });
}
