import { readDb, mutateDb, dbMode } from "./db.mjs";
import { getCurrentUser, readBody, requireRole, sendJson } from "./http-utils.mjs";
import { clearLoginFailures, hashPin, isLoginLimited, issueAuthToken, issuePasswordChangeToken, loginLimitKey, recordLoginFailure, verifyPasswordChangeToken, verifyPin } from "./auth.mjs";
import { getSchedulerStatus, reloadSystemScheduler } from "./scheduler.mjs";
import { objectStorageReady, resolveStorageSettings } from "./storage-settings.mjs";
import { compensationOverview, generateLaborAllocation, saveCompensationMember, saveProjectDividend } from "./compensation-service.mjs";
import {
  addComment,
  actOnApproval,
  archiveComment,
  createApproval,
  advanceParseJob,
  answerAiAssistant,
  archiveFileRecord,
  createProject,
  confirmProjectUpload,
  archiveProjectTask,
  clientLibrary,
  collectionLibrary,
  deleteProject,
  exportBackupSnapshot,
  feishuProjectBindings,
  feishuPendingFiles,
  getFeishuTenantAccessToken,
  handleFeishuPendingFile,
  handleFeishuEvent,
  previewProjectUpload,
  recordProjectPayment,
  recordFiles,
  rateSupplier,
  reparseProject,
  refreshInterestRate,
  restoreBackupSnapshot,
  saveSetting,
  saveClientProfile,
  saveCollectionOutcome,
  saveCompanyFinance,
  saveFeishuProjectBinding,
  sendSystemNotificationToFeishu,
  sendSystemNotificationToWechat,
  supplierCsv,
  supplierLibrary,
  suggestCollectionScript,
  scanSystemNotifications,
  testAiSettings,
  testObjectStorage,
  updateAlert,
  updateSupplierSettlement,
  updateSystemNotification,
  updateProject,
  upsertProjectTask,
  validateBackupSnapshot,
  voidProjectPayment,
  withdrawApproval,
  uploadProjectCostSheet,
  uploadProjectQuoteSheet,
  uploadProjectVerificationSheet
} from "./services.mjs";

const OWNER_ROLES = ["shareholder"];
const ADMIN_ROLES = ["shareholder", "admin"];
const DIRECTOR_ROLES = ["shareholder", "admin", "director"];
const MANAGEMENT_ROLES = ["shareholder", "admin", "director", "finance"];
const COMPENSATION_ROLES = ["shareholder", "admin", "finance"];
const PROJECT_WRITE_ROLES = ["shareholder", "admin", "director", "pm", "sales"];
const PROJECT_UPLOAD_ROLES = ["shareholder", "admin", "director", "pm", "sales", "member"];
const BUILD_VERSION = "2026-07-08-ai-task-command-pass";
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
const DEFAULT_ACCOUNT_IDS = new Set(Object.keys(DEFAULT_EMAILS));

function envConfigured(...names) {
  return names.some((name) => Boolean(String(process.env[name] || "").trim()));
}

async function deployHealthPayload() {
  const db = await readDb();
  const storageMode = dbMode();
  const storage = resolveStorageSettings(db.settings?.storage || {});
  const objectStorageConfigured = objectStorageReady(storage);
  const insecureDefaultAccountCount = (db.users || []).filter((item) => item.status !== "disabled" && item.pin === "123456").length;
  return {
    app: "ad-project-hub",
    version: BUILD_VERSION,
    deployedCommit: process.env.RENDER_GIT_COMMIT || process.env.RENDER_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT_ID || "",
    uploadProgress: true,
    renderBuildCommand: true,
    startOpensPortOnly: true,
    noPrestartBuild: true,
    rootDirectory: "ad-project-hub-github-upload",
    buildCommand: "npm install && npm run build",
    startCommand: "npm start",
    checkedAt: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || "development",
    storageMode,
    databaseUrl: envConfigured("DATABASE_URL"),
    bootstrapAdminPinConfigured: envConfigured("OA_BOOTSTRAP_ADMIN_PIN"),
    insecureDefaultAccountCount,
    authenticationReady: insecureDefaultAccountCount === 0,
    productionPersistenceReady: storageMode === "postgres" && envConfigured("DATABASE_URL"),
    objectStorageConfigured,
    filePersistenceReady: process.env.NODE_ENV !== "production" || objectStorageConfigured,
    scheduler: getSchedulerStatus(),
    aiEnv: {
      apiKey: envConfigured("AI_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "MOONSHOT_API_KEY"),
      baseUrl: envConfigured("AI_BASE_URL", "OPENAI_BASE_URL"),
      model: envConfigured("AI_MODEL", "OPENAI_MODEL"),
      databaseConfigured: Boolean(db.settings?.aiService?.["API Key"])
    },
    ocrEnv: {
      secretId: envConfigured("TENCENT_SECRET_ID"),
      secretKey: envConfigured("TENCENT_SECRET_KEY"),
      region: process.env.TENCENT_OCR_REGION || process.env.TENCENT_REGION || ""
    }
  };
}

function publicUser(user) {
  if (!user) return null;
  const { pin, pinHash, ...safeUser } = user;
  return safeUser;
}

function applyIdempotencyKey(req, body = {}) {
  const header = String(req.headers["idempotency-key"] || "").trim();
  if (!body.idempotencyKey && header) body.idempotencyKey = header.slice(0, 160);
  return body;
}

function assignmentUser(user) {
  const safe = publicUser(ensureMemberFields(user));
  return {
    id: safe.id,
    name: safe.name,
    email: safe.email,
    role: safe.role,
    department: safe.department || "",
    status: safe.status || "active",
    feishuOpenId: safe.feishuOpenId || "",
    feishuUserId: safe.feishuUserId || "",
    feishuName: safe.feishuName || ""
  };
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
    ...user,
    email: user.email || DEFAULT_EMAILS[user.id] || `${user.id}@company.local`,
    status: user.status || "active"
  };
}

function saveMember(db, body, actor) {
  const role = body.role || "member";
  if (!ROLE_LABELS[role]) throw new Error("不支持的成员角色");
  const email = normalizeEmail(body.email);
  if (!email) throw new Error("请填写成员邮箱");
  if (!body.name?.trim()) throw new Error("请填写成员姓名");
  const existing = db.users.find((item) => item.id === body.id);
  const temporaryPin = String(body.pin || "").trim();
  if (!existing && !temporaryPin) throw new Error("新成员必须设置临时 PIN");
  if (temporaryPin && (!/^\d{6,12}$/.test(temporaryPin) || temporaryPin === "123456")) {
    throw new Error("临时 PIN 需为 6-12 位数字，且不能使用 123456");
  }
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
    pinHash: temporaryPin ? hashPin(temporaryPin) : existing?.pinHash,
    pin: temporaryPin ? undefined : existing?.pin,
    mustChangePin: temporaryPin ? true : Boolean(existing?.mustChangePin),
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

function disableInsecureDefaultAccounts(db, actor) {
  const current = db.users.find((item) => item.id === actor.id);
  if (!current || current.pin === "123456" || !current.pinHash) {
    throw new Error("请先在员工端修改自己的 PIN，再清理默认账号");
  }
  const disabled = [];
  for (const account of db.users || []) {
    if (account.id === actor.id || !DEFAULT_ACCOUNT_IDS.has(account.id) || account.pin !== "123456") continue;
    account.status = "disabled";
    delete account.pin;
    delete account.pinHash;
    account.mustChangePin = true;
    disabled.push(publicUser(account));
  }
  db.auditLogs.unshift({
    type: "account-security",
    target: disabled.map((item) => item.email || item.name).join("、") || "none",
    action: "disable-insecure-default-accounts",
    user: actor.name,
    at: new Date().toISOString()
  });
  return { disabled, disabledCount: disabled.length };
}

function normalizeFeishuContactUser(raw = {}, departmentName = "") {
  const email = normalizeEmail(raw.email || raw.enterprise_email || raw.user_email || "");
  const name = raw.name || raw.en_name || raw.nickname || raw.feishuName || raw.user_id || raw.open_id || "";
  return {
    name: String(name || "").trim(),
    email,
    department: raw.department || raw.departmentName || departmentName || "",
    feishuOpenId: String(raw.open_id || raw.openId || raw.feishuOpenId || "").trim(),
    feishuUserId: String(raw.user_id || raw.userId || raw.feishuUserId || "").trim(),
    feishuName: String(raw.name || raw.feishuName || name || "").trim(),
    status: raw.status?.is_activated === false || raw.status?.is_resigned ? "disabled" : "active"
  };
}

async function fetchFeishuJson(path, token) {
  const res = await fetch(`https://open.feishu.cn${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) throw new Error(`飞书通讯录接口失败：${payload.msg || res.status}`);
  return payload.data || {};
}

async function loadFeishuContacts(settings = {}) {
  if (settings.mockContactsJson) {
    const parsed = typeof settings.mockContactsJson === "string" ? JSON.parse(settings.mockContactsJson) : settings.mockContactsJson;
    return Array.isArray(parsed) ? parsed.map((item) => normalizeFeishuContactUser(item)) : (parsed.users || []).map((item) => normalizeFeishuContactUser(item, parsed.department || ""));
  }
  const token = await getFeishuTenantAccessToken(settings);
  const departments = [];
  const users = [];
  async function walkDepartment(departmentId = "0", departmentName = "飞书组织") {
    const deptData = await fetchFeishuJson(`/open-apis/contact/v3/departments/${encodeURIComponent(departmentId)}/children?fetch_child=true&page_size=50`, token);
    const children = deptData.items || deptData.departments || [];
    for (const dept of children) {
      const id = dept.open_department_id || dept.department_id || dept.id;
      const name = dept.name || dept.i18n_name?.zh_cn || departmentName;
      if (!id) continue;
      departments.push({ id, name, parentId: departmentId });
      const userData = await fetchFeishuJson(`/open-apis/contact/v3/users/find_by_department?department_id=${encodeURIComponent(id)}&department_id_type=open_department_id&page_size=50`, token);
      for (const rawUser of userData.items || []) users.push(normalizeFeishuContactUser(rawUser, name));
      await walkDepartment(id, name);
    }
  }
  await walkDepartment("0", "飞书组织");
  if (!users.length) {
    const rootUsers = await fetchFeishuJson("/open-apis/contact/v3/users/find_by_department?department_id=0&page_size=50", token).catch(() => ({ items: [] }));
    for (const rawUser of rootUsers.items || []) users.push(normalizeFeishuContactUser(rawUser, "飞书组织"));
  }
  return users;
}

async function syncFeishuContacts(db, body, actor) {
  const contacts = await loadFeishuContacts({ ...(db.settings?.feishu || {}), ...(body?.settings || {}) });
  if (!contacts.length) throw new Error("飞书通讯录没有返回成员，请检查通讯录权限或 mockContactsJson。");
  const at = new Date().toISOString();
  const result = { created: 0, updated: 0, skipped: 0, members: [] };
  db.users = db.users || [];
  for (const contact of contacts) {
    if (!contact.name && !contact.email && !contact.feishuOpenId && !contact.feishuUserId) {
      result.skipped += 1;
      continue;
    }
    const existing = db.users.find((user) =>
      (contact.email && normalizeEmail(user.email) === contact.email)
      || (contact.feishuOpenId && user.feishuOpenId === contact.feishuOpenId)
      || (contact.feishuUserId && user.feishuUserId === contact.feishuUserId)
    );
    const member = {
      id: existing?.id || nextUserId(db),
      name: contact.name || existing?.name || contact.email || contact.feishuOpenId,
      email: contact.email || existing?.email || `${contact.feishuUserId || contact.feishuOpenId || Date.now()}@feishu.local`,
      role: existing?.role || "member",
      department: contact.department || existing?.department || "",
      feishuOpenId: contact.feishuOpenId || existing?.feishuOpenId || "",
      feishuUserId: contact.feishuUserId || existing?.feishuUserId || "",
      feishuName: contact.feishuName || contact.name || existing?.feishuName || "",
      status: contact.status || existing?.status || "active",
      pin: existing?.pin || "123456",
      createdAt: existing?.createdAt || at,
      syncedFromFeishuAt: at
    };
    if (existing) {
      Object.assign(existing, member);
      result.updated += 1;
    } else {
      db.users.push(member);
      result.created += 1;
    }
    result.members.push(publicUser(member));
  }
  db.settings = db.settings || {};
  db.settings.feishu = {
    ...(db.settings.feishu || {}),
    lastContactSyncAt: at,
    lastContactSyncResult: { created: result.created, updated: result.updated, skipped: result.skipped }
  };
  db.auditLogs.unshift({
    type: "feishu",
    target: "contacts",
    action: "sync-contacts",
    user: actor.name,
    meta: { created: result.created, updated: result.updated, skipped: result.skipped },
    at
  });
  return result;
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

function projectAssignmentSuggestions(db, projectId) {
  const project = (db.projects || []).find((item) => item.id === projectId);
  if (!project) throw new Error("项目不存在");
  const users = (db.users || []).map(ensureMemberFields).filter((user) => user.status !== "disabled");
  const assignments = projectAssignments(db);
  const loadByUserId = new Map(users.map((user) => [user.id, 0]));
  const lowerUserKeys = new Map();
  users.forEach((user) => {
    [user.name, user.email, user.feishuName].filter(Boolean).forEach((key) => lowerUserKeys.set(String(key).toLowerCase(), user.id));
  });
  for (const row of assignments) {
    [row.pm, row.sales, ...(row.members || [])].filter(Boolean).forEach((key) => {
      const id = lowerUserKeys.get(String(key).toLowerCase());
      if (id) loadByUserId.set(id, Number(loadByUserId.get(id) || 0) + 1);
    });
  }
  const projectDept = projectDepartment(project);
  const clientText = [project.client, project.name, project.extractedFields?.brand].filter(Boolean).join(" ");
  const scoreUser = (user, targetRoles = []) => {
    const load = Number(loadByUserId.get(user.id) || 0);
    let score = 100 - load * 32;
    const roleMatched = targetRoles.includes(user.role);
    if (roleMatched) score += 30;
    if (user.role === targetRoles[0]) score += 20;
    if (projectDept && user.department === projectDept) score += 16;
    if (clientText && user.department && clientText.includes(user.department)) score += 8;
    if (user.role === "director") score += 6;
    if (user.role === "admin" || user.role === "shareholder") score -= 8;
    return Math.max(0, score);
  };
  const serialize = (user, roles) => {
    const load = Number(loadByUserId.get(user.id) || 0);
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role] || user.role,
      department: user.department || "",
      load,
      score: scoreUser(user, roles),
      reason: `${load ? `当前 ${load} 个项目，建议谨慎加派` : "当前较空闲，适合承接"}${projectDept && user.department === projectDept ? "，部门匹配" : ""}${roles.includes(user.role) ? "，角色匹配" : ""}`
    };
  };
  const pmRoles = ["pm", "director", "admin", "member"];
  const salesRoles = ["sales", "director", "admin", "member"];
  const memberRoles = ["member", "pm", "sales", "finance"];
  const sortByScore = (rows) => rows.sort((a, b) => b.score - a.score || a.load - b.load || a.name.localeCompare(b.name, "zh-CN"));
  const pmCandidates = sortByScore(users.filter((user) => pmRoles.includes(user.role)).map((user) => serialize(user, pmRoles))).slice(0, 3);
  const salesCandidates = sortByScore(users.filter((user) => salesRoles.includes(user.role)).map((user) => serialize(user, salesRoles))).slice(0, 3);
  const memberCandidates = sortByScore(users.filter((user) => memberRoles.includes(user.role)).map((user) => serialize(user, memberRoles))).slice(0, 6);
  return {
    projectId: project.id,
    projectName: project.name,
    pmCandidates,
    salesCandidates,
    memberCandidates,
    recommended: {
      pmId: pmCandidates[0]?.id || "",
      salesId: salesCandidates[0]?.id || "",
      memberIds: memberCandidates.slice(0, 3).map((item) => item.id)
    },
    generatedAt: new Date().toISOString()
  };
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
  const assignmentNotices = db.systemNotifications || [];
  for (const notice of assignmentNotices) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (sameProject && notice.type === "project-assignment" && notice.status === "待处理") {
      notice.status = "已处理";
      notice.handledAt = now;
      notice.handledBy = actor.id;
      notice.handledByName = actor.name;
      notice.note = `项目已分派：PM ${project.pm || "待确认"}，销售 ${project.sales || "待确认"}，执行 ${assignedUsers.map((member) => member.name).join("、") || "待确认"}`;
      notice.updatedAt = now;
    }
  }
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
  const suppliers = (db.suppliers || []).filter((item) => projectNames.has(item.project));
  const supplierNames = new Set(suppliers.map((item) => item.supplier));
  const visibleAuditLogs = (db.auditLogs || [])
    .filter((item) => projectNames.has(item.target) || projectIds.has(item.projectId) || projectNames.has(item.projectName))
    .slice(0, 80);
  return {
    ...db,
    projects,
    clientProfiles: clientLibrary({ ...db, projects }),
    suppliers,
    supplierProfiles: supplierLibrary({
      ...db,
      suppliers,
      supplierProfiles: (db.supplierProfiles || []).filter((item) => supplierNames.has(item.supplier))
    }),
    approvals: (db.approvals || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    payments: (db.payments || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    collectionScripts: (db.collectionScripts || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName || item.project)),
    feishuProjectBindings: (db.feishuProjectBindings || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    feishuEvents: (db.feishuEvents || []).filter((item) => !item.projectId || projectIds.has(item.projectId) || projectNames.has(item.projectName)).slice(0, 50),
    feishuPendingFiles: (db.feishuPendingFiles || []).filter((item) => item.projectId && (projectIds.has(item.projectId) || projectNames.has(item.projectName))).slice(0, 50),
    systemNotifications: visibleSystemNotificationsFor(db, user),
    files: (db.files || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    parseJobs: (db.parseJobs || []).filter((item) => projectIds.has(item.projectId) || projectNames.has(item.projectName)),
    comments: (db.comments || []).filter((item) => projectNames.has(item.project)),
    alertUpdates: (db.alertUpdates || []).filter((item) => projectNames.has(item.project)),
    auditLogs: visibleAuditLogs
  };
}

function canAccessProject(db, user, projectId) {
  return visibleProjectsForUser(db, ensureMemberFields(user)).some((project) => project.id === projectId);
}

function visibleProjectForBody(db, user, body = {}) {
  const projectId = String(body.projectId || body.id || "").trim();
  const projectName = String(body.projectName || body.project || "").trim();
  return visibleProjectsForUser(db, ensureMemberFields(user))
    .find((project) => (projectId && project.id === projectId) || (projectName && project.name === projectName));
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
      if (item.projectId || item.projectName) return false;
      if (managementLike && Array.isArray(item.recipients) && item.recipients.includes(actor.role)) return true;
      return false;
    })
    .slice(0, 50);
}

function canAccessSystemNotification(db, user, item = {}) {
  const actor = ensureMemberFields(user);
  if (ADMIN_ROLES.includes(actor.role)) return true;
  const projects = visibleProjectsForUser(db, actor);
  const projectIds = new Set(projects.map((project) => project.id));
  const projectNames = new Set(projects.map((project) => project.name));
  if (item.projectId || item.projectName) {
    return item.projectId ? projectIds.has(item.projectId) : projectNames.has(item.projectName);
  }
  return MANAGEMENT_ROLES.includes(actor.role) && Array.isArray(item.recipients) && item.recipients.includes(actor.role);
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
  const state = {
    ...db,
    projects: (db.projects || []).map((project) => ({
      ...project,
      pettyCashBudget: Number(project.pettyCashBudget ?? project.extractedFields?.pettyCashBudget ?? project.extractedFields?.projectPettyCashBudget ?? 0),
      pettyCashUsed: Number(project.pettyCashUsed ?? project.extractedFields?.pettyCashUsed ?? project.extractedFields?.projectPettyCashUsed ?? 0)
    })),
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
  return stripPrivatePayloads(state);
}

function stripPrivatePayloads(value) {
  if (Array.isArray(value)) return value.map(stripPrivatePayloads);
  if (!value || typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (["pin", "pinHash", "base64", "dataUrl", "buffer", "binary", "bytes"].includes(key)) continue;
    safe[key] = stripPrivatePayloads(item);
  }
  return safe;
}

export async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      data: await deployHealthPayload()
    });
    return;
  }

  // URL verification must finish within Feishu's 3-second deadline and needs no database state.
  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/events") {
    const body = await readBody(req);
    if (body?.challenge) {
      sendJson(res, 200, { challenge: body.challenge });
      return;
    }
    const data = await mutateDb(async (db) => handleFeishuEvent(db, body, { id: "feishu-bot", name: "飞书机器人", role: "bot" }));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  const snapshot = await readDb();

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    const pin = String(body.pin || "");
    const limitKey = loginLimitKey(req, email);
    if (isLoginLimited(limitKey)) {
      sendJson(res, 429, { ok: false, error: "登录失败次数过多，请 15 分钟后重试" });
      return;
    }
    const account = snapshot.users.map(ensureMemberFields).find((item) => normalizeEmail(item.email) === email);
    const storedPin = account?.pinHash || account?.pin || "";
    const validPin = account && pin && verifyPin(pin, storedPin);
    if (!validPin || account.status === "disabled") {
      recordLoginFailure(limitKey);
      sendJson(res, 401, { ok: false, error: "账号或 PIN 不正确，或账号已停用" });
      return;
    }
    clearLoginFailures(limitKey);
    if (!account.pinHash) {
      await mutateDb((db) => {
        const current = db.users.find((item) => item.id === account.id);
        if (current) {
          current.pinHash = hashPin(pin);
          delete current.pin;
        }
      });
    }
    if (account.mustChangePin) {
      sendJson(res, 200, { ok: true, data: { requiresPasswordChange: true, resetToken: issuePasswordChangeToken(account) } });
      return;
    }
    sendJson(res, 200, { ok: true, data: { ...publicUser(account), token: issueAuthToken(account) } });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    const body = await readBody(req);
    const tokenData = verifyPasswordChangeToken(body.resetToken);
    const newPin = String(body.newPin || "");
    if (!tokenData) { sendJson(res, 401, { ok: false, error: "改密凭证已失效，请重新登录" }); return; }
    if (!/^\d{6,12}$/.test(newPin) || newPin === "123456") { sendJson(res, 400, { ok: false, error: "新 PIN 需为 6-12 位数字，且不能使用 123456" }); return; }
    const updated = await mutateDb((db) => {
      const current = db.users.find((item) => item.id === tokenData.sub && item.status !== "disabled");
      if (!current) return null;
      current.pinHash = hashPin(newPin); delete current.pin; current.mustChangePin = false;
      return publicUser(current);
    });
    if (!updated) { sendJson(res, 401, { ok: false, error: "账号不可用" }); return; }
    sendJson(res, 200, { ok: true, data: { ...updated, token: issueAuthToken(updated) } });
    return;
  }

  const user = getCurrentUser(req, snapshot);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "登录已失效，请重新登录" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/change-pin") {
    const body = await readBody(req);
    const currentPin = String(body.currentPin || "");
    const newPin = String(body.newPin || "");
    const account = snapshot.users.find((item) => item.id === user.id && item.status !== "disabled");
    if (!account || !currentPin || !verifyPin(currentPin, account.pinHash || account.pin || "")) {
      sendJson(res, 400, { ok: false, error: "当前 PIN 不正确" });
      return;
    }
    if (!/^\d{6,12}$/.test(newPin) || newPin === "123456") {
      sendJson(res, 400, { ok: false, error: "新 PIN 需为 6-12 位数字，且不能使用 123456" });
      return;
    }
    if (currentPin === newPin) {
      sendJson(res, 400, { ok: false, error: "新 PIN 不能与当前 PIN 相同" });
      return;
    }
    await mutateDb((db) => {
      const current = db.users.find((item) => item.id === user.id && item.status !== "disabled");
      if (!current) throw new Error("账号不可用");
      current.pinHash = hashPin(newPin);
      delete current.pin;
      current.mustChangePin = false;
      db.auditLogs.unshift({ type: "account-security", target: current.email || current.name, action: "change-pin", user: current.name, at: new Date().toISOString() });
    });
    sendJson(res, 200, { ok: true, data: { changed: true } });
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
    const visible = canAccessSystemNotification(snapshot, ensureMemberFields(user), notice);
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
    const visible = canAccessSystemNotification(snapshot, ensureMemberFields(user), notice);
    if (!visible || !["shareholder", "admin", "director", "pm", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限发送该飞书通知" });
      return;
    }
    try {
      const data = await mutateDb((db) => sendSystemNotificationToFeishu(db, body, ensureMemberFields(user)));
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message, data: error.data || null });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/wechat/send") {
    const body = await readBody(req);
    const notice = (snapshot.systemNotifications || []).find((item) => item.id === body.id);
    if (!notice) {
      sendJson(res, 404, { ok: false, error: "系统通知不存在" });
      return;
    }
    const visible = canAccessSystemNotification(snapshot, ensureMemberFields(user), notice);
    if (!visible || !["shareholder", "admin", "director", "pm", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限发送该企业微信通知" });
      return;
    }
    const data = await mutateDb((db) => sendSystemNotificationToWechat(db, body, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/system/scan") {
    if (!requireRole(user, ["shareholder", "admin", "director", "finance"], res)) return;
    await mutateDb((db) => scanSystemNotifications(db, ensureMemberFields(user)));
    const fresh = await readDb();
    const data = fresh.systemNotifications || [];
    sendJson(res, 200, {
      ok: true,
      data: {
        notifications: visibleSystemNotificationsFor(fresh, ensureMemberFields(user)),
        total: data.filter((item) => item.status === "待处理").length
      }
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

  if (req.method === "POST" && url.pathname === "/api/members/disable-insecure-defaults") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const data = await mutateDb((db) => disableInsecureDefaultAccounts(db, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/contacts/sync") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => syncFeishuContacts(db, body, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project-assignments") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    sendJson(res, 200, { ok: true, data: projectAssignments(scoped) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project-assignments/members") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const data = (snapshot.users || [])
      .map((item) => assignmentUser(item))
      .filter((item) => item.status !== "disabled");
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/project-assignments/suggestions") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const projectId = url.searchParams.get("projectId") || "";
    if (!canAccessProject(snapshot, user, projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限读取该项目分派建议" });
      return;
    }
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    const data = projectAssignmentSuggestions(scoped, projectId);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project-assignments") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限分派该项目" });
      return;
    }
    const data = await mutateDb((db) => saveProjectAssignment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveSetting(db, body.type, body.values, user));
    const scheduler = ["product", "scheduler"].includes(body.type) ? await reloadSystemScheduler() : getSchedulerStatus();
    sendJson(res, 200, { ok: true, data: { ...data, scheduler } });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/compensation") {
    if (!requireRole(user, COMPENSATION_ROLES, res)) return;
    sendJson(res, 200, { ok: true, data: compensationOverview(snapshot, url.searchParams.get("year") || new Date().getFullYear()) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/compensation/member") {
    if (!requireRole(user, COMPENSATION_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveCompensationMember(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/compensation/allocate") {
    if (!requireRole(user, COMPENSATION_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => generateLaborAllocation(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/compensation/dividend") {
    if (!requireRole(user, OWNER_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveProjectDividend(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/company-finance") {
    if (!requireRole(user, MANAGEMENT_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveCompanyFinance(db, body.values || body, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/backup") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const data = exportBackupSnapshot(snapshot, ensureMemberFields(user));
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ad-project-hub-backup-${new Date().toISOString().slice(0, 10)}.json"`
    });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/backup/validate") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = validateBackupSnapshot(snapshot, body, ensureMemberFields(user));
    sendJson(res, data.ok ? 200 : 400, { ok: data.ok, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/backup/restore") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    try {
      const data = await mutateDb((db) => restoreBackupSnapshot(db, body, ensureMemberFields(user)));
      const scheduler = await reloadSystemScheduler();
      sendJson(res, 200, { ok: true, data: { ...data, scheduler } });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai/test") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await testAiSettings(body.values);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/storage/test") {
    if (!requireRole(user, ADMIN_ROLES, res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => testObjectStorage(db, body.values, ensureMemberFields(user)));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/assistant") {
    const body = await readBody(req);
    const data = await mutateDb((db) => answerAiAssistant(db, body, ensureMemberFields(user), scopedSnapshot(db, ensureMemberFields(user))));
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

  if (req.method === "POST" && url.pathname === "/api/integrations/feishu/pending-files/action") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const pending = (snapshot.feishuPendingFiles || []).find((item) => item.id === body.id);
    if (!pending) {
      sendJson(res, 404, { ok: false, error: "飞书待确认文件不存在" });
      return;
    }
    if (!pending.projectId && !ADMIN_ROLES.includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限处理未匹配项目的飞书文件" });
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
    const data = await mutateDb(async (db) => {
      const result = body.previewId
        ? await confirmProjectUpload(db, body, user)
        : await createProject(db, body.values, body.files || [], user);
      if (!result?.merged) scanSystemNotifications(db, { id: "system", name: "项目入库巡检" });
      return result;
    });
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/upload-preview") {
    const body = await readBody(req);
    if (body.type === "create-project") {
      if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    } else if (!requireRole(user, PROJECT_UPLOAD_ROLES, res)) {
      return;
    }
    if (body.type !== "create-project" && !canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传文件" });
      return;
    }
    const data = await mutateDb((db) => previewProjectUpload(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/update") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限更新该项目" });
      return;
    }
    const data = await mutateDb((db) => updateProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/delete") {
    if (!requireRole(user, DIRECTOR_ROLES, res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限删除该项目" });
      return;
    }
    const data = await mutateDb((db) => deleteProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/reparse") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限重新解析该项目" });
      return;
    }
    const data = await mutateDb((db) => reparseProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/cost-sheet") {
    if (!requireRole(user, PROJECT_UPLOAD_ROLES, res)) return;
    const body = applyIdempotencyKey(req, await readBody(req));
    if (!canAccessProject(snapshot, user, body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限向该项目上传执行成本表" });
      return;
    }
    const data = await mutateDb((db) => uploadProjectCostSheet(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/quote-sheet") {
    if (!requireRole(user, PROJECT_UPLOAD_ROLES, res)) return;
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
    if (!requireRole(user, PROJECT_UPLOAD_ROLES, res)) return;
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
    const body = applyIdempotencyKey(req, await readBody(req));
    if (!canAccessProject(snapshot, user, body.projectId || body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限为该项目记录回款" });
      return;
    }
    const data = await mutateDb((db) => recordProjectPayment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments/void") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const payment = (snapshot.payments || []).find((item) => item.id === body.id || item.id === body.paymentId);
    if (!payment) {
      sendJson(res, 404, { ok: false, error: "回款记录不存在" });
      return;
    }
    if (!canAccessProject(snapshot, user, payment.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限作废该回款记录" });
      return;
    }
    const data = await mutateDb((db) => voidProjectPayment(db, body, user));
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

  if (req.method === "POST" && url.pathname === "/api/project-tasks/archive") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    if (!canAccessProject(snapshot, user, body.projectId || body.id)) {
      sendJson(res, 403, { ok: false, error: "无权限归档该项目任务" });
      return;
    }
    const data = await mutateDb((db) => archiveProjectTask(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/files/record") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const visibleProject = visibleProjectForBody(snapshot, user, body);
    if (!visibleProject) {
      sendJson(res, 403, { ok: false, error: "无权限记录该项目文件" });
      return;
    }
    body.projectId = visibleProject.id;
    body.projectName = visibleProject.name;
    const data = await mutateDb((db) => recordFiles(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/parse-jobs/progress") {
    if (!requireRole(user, PROJECT_UPLOAD_ROLES, res)) return;
    const body = await readBody(req);
    const idOrProjectId = body.id || body.projectId;
    const job = (snapshot.parseJobs || []).find((item) => item.id === idOrProjectId || item.projectId === idOrProjectId);
    if (!job) {
      sendJson(res, 404, { ok: false, error: "解析任务不存在" });
      return;
    }
    if (!canAccessProject(snapshot, user, job.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限推进该解析任务" });
      return;
    }
    const data = await mutateDb((db) => advanceParseJob(db, idOrProjectId));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/alerts/update") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const projectName = String(body.project || body.projectName || "").trim();
    if (projectName) {
      const visibleProject = visibleProjectsForUser(snapshot, ensureMemberFields(user))
        .find((project) => project.name === projectName || project.id === body.projectId);
      if (!visibleProject) {
        sendJson(res, 403, { ok: false, error: "无权限处理该项目预警" });
        return;
      }
      body.project = visibleProject.name;
    } else if (!MANAGEMENT_ROLES.includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限处理公司级预警" });
      return;
    }
    const data = await mutateDb((db) => updateAlert(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/files/archive") {
    if (!requireRole(user, PROJECT_WRITE_ROLES, res)) return;
    const body = await readBody(req);
    const visibleProject = visibleProjectForBody(snapshot, user, body);
    if (!visibleProject) {
      sendJson(res, 403, { ok: false, error: "无权限归档该项目文件" });
      return;
    }
    body.projectId = visibleProject.id;
    body.projectName = visibleProject.name;
    const data = await mutateDb((db) => archiveFileRecord(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/comments") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const projectName = String(body.project || body.projectName || "").trim();
    const visibleProject = visibleProjectsForUser(snapshot, ensureMemberFields(user))
      .find((project) => project.name === projectName || project.id === body.projectId);
    if (!visibleProject) {
      sendJson(res, 403, { ok: false, error: "无权限记录该项目动态" });
      return;
    }
    body.project = visibleProject.name;
    const data = await mutateDb((db) => addComment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/comments/archive") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const projectName = String(body.project || body.projectName || "").trim();
    const visibleProject = visibleProjectsForUser(snapshot, ensureMemberFields(user))
      .find((project) => project.name === projectName || project.id === body.projectId);
    if (!visibleProject) {
      sendJson(res, 403, { ok: false, error: "无权限归档该项目动态" });
      return;
    }
    body.project = visibleProject.name;
    body.projectId = visibleProject.id;
    const data = await mutateDb((db) => archiveComment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = applyIdempotencyKey(req, await readBody(req));
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
    if (!MANAGEMENT_ROLES.includes(user.role) && !canAccessProject(snapshot, user, target.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限处理该项目审批" });
      return;
    }
    const data = await mutateDb((db) => actOnApproval(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/approvals/withdraw") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance", "member"], res)) return;
    const body = await readBody(req);
    const target = (snapshot.approvals || []).find((item) => item.id === body.id);
    if (!target) {
      sendJson(res, 404, { ok: false, error: "审批不存在" });
      return;
    }
    if (!canAccessProject(snapshot, user, target.projectId)) {
      sendJson(res, 403, { ok: false, error: "无权限撤回该项目审批" });
      return;
    }
    const data = await mutateDb((db) => withdrawApproval(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suppliers/export") {
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=supplier-settlements.csv"
    });
    res.end(supplierCsv(scoped));
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

  if (req.method === "POST" && url.pathname === "/api/suppliers/settlement") {
    if (!requireRole(user, ["shareholder", "admin", "director", "pm", "sales", "finance"], res)) return;
    const body = await readBody(req);
    const scoped = scopedSnapshot(snapshot, ensureMemberFields(user));
    const visibleRows = scoped.suppliers || [];
    const canUpdate = visibleRows.some((item) => {
      if (body.id && item.id === body.id) return true;
      return body.supplier
        && item.supplier === body.supplier
        && (!body.project && !body.projectName || item.project === (body.project || body.projectName));
    });
    if (!canUpdate && !["shareholder", "admin", "finance"].includes(user.role)) {
      sendJson(res, 403, { ok: false, error: "无权限更新该供应商结算" });
      return;
    }
    const data = await mutateDb((db) => updateSupplierSettlement(db, body, user));
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
    const project = (snapshot.projects || []).find((item) => item.id === record.projectId || item.name === record.projectName);
    const canUpdateOutcome = ["shareholder", "admin", "director", "finance"].includes(user.role)
      || record.salesId === user.id
      || record.salesName === user.name
      || (project && projectHasUserRole(project, ensureMemberFields(user)));
    if (!canUpdateOutcome || (!canAccessProject(snapshot, user, record.projectId) && !["shareholder", "admin", "finance"].includes(user.role))) {
      sendJson(res, 403, { ok: false, error: "无权限更新该催收记录" });
      return;
    }
    const data = await mutateDb((db) => saveCollectionOutcome(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  sendJson(res, 404, { ok: false, error: "API not found" });
}
