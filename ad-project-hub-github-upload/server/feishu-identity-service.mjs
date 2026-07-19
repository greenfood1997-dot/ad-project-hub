import { getFeishuTenantAccessToken } from "./feishu-service.mjs";

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function nextUserId() {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeContact(raw = {}, department = "") {
  return {
    name: String(raw.name || raw.en_name || raw.nickname || raw.user_id || raw.open_id || "").trim(),
    email: normalizeEmail(raw.email || raw.enterprise_email || ""),
    department: String(raw.department || raw.departmentName || department || "").trim(),
    feishuOpenId: String(raw.open_id || raw.openId || "").trim(),
    feishuUserId: String(raw.user_id || raw.userId || "").trim(),
    status: raw.status?.is_activated === false || raw.status?.is_resigned ? "disabled" : "active"
  };
}

async function fetchFeishu(path, token, options = {}) {
  const res = await fetch(`https://open.feishu.cn${path}`, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${token}` } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) throw new Error(`飞书身份接口失败：${payload.msg || res.status}`);
  return payload.data || {};
}

export async function exchangeFeishuLoginCode(settings = {}, code = "") {
  if (settings.mockLoginUser) return normalizeContact(typeof settings.mockLoginUser === "string" ? JSON.parse(settings.mockLoginUser) : settings.mockLoginUser);
  if (!code) throw new Error("飞书登录授权码缺失");
  const appToken = await getFeishuTenantAccessToken(settings);
  const data = await fetchFeishu("/open-apis/authen/v1/oidc/access_token", appToken, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ grant_type: "authorization_code", code })
  });
  const userToken = data.access_token;
  if (!userToken) throw new Error("飞书未返回用户授权凭证");
  const user = await fetchFeishu("/open-apis/authen/v1/user_info", userToken);
  return normalizeContact(user);
}

export function upsertFeishuIdentity(db, contact, actor = "飞书人事同步") {
  db.users ||= [];
  const existing = db.users.find((user) =>
    (contact.feishuOpenId && user.feishuOpenId === contact.feishuOpenId)
    || (contact.feishuUserId && user.feishuUserId === contact.feishuUserId)
    || (contact.email && normalizeEmail(user.email) === contact.email)
  );
  const at = new Date().toISOString();
  const member = existing || { id: nextUserId(), role: "member", createdAt: at };
  member.name = contact.name || member.name || contact.email || contact.feishuOpenId;
  member.email = contact.email || member.email || `${contact.feishuUserId || contact.feishuOpenId}@feishu.local`;
  member.department = contact.department || member.department || "";
  member.feishuOpenId = contact.feishuOpenId || member.feishuOpenId || "";
  member.feishuUserId = contact.feishuUserId || member.feishuUserId || "";
  member.feishuName = contact.name || member.feishuName || "";
  member.status = contact.status || member.status || "active";
  member.syncedFromFeishuAt = at;
  if (!existing) db.users.push(member);
  db.auditLogs ||= [];
  db.auditLogs.unshift({ type: "feishu-hr", target: member.email, action: existing ? "update-account" : "create-account", user: actor, at });
  return { member, created: !existing };
}

export function feishuLoginUrl(settings = {}, origin = "") {
  if (!settings.appId) throw new Error("请先配置飞书 App ID");
  const redirectUri = settings.oauthRedirectUrl || `${origin}/api/auth/feishu/callback`;
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(settings.appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=oa-login`;
}

export async function syncAuthoritativeFeishuUsers(db) {
  const settings = db.settings?.feishu || {};
  if (!(settings.hrAuthoritative === true || settings.hrAuthoritative === "true")) return { enabled: false, created: 0, updated: 0, disabled: 0 };
  const token = await getFeishuTenantAccessToken(settings);
  const contacts = [];
  const seenDepartments = new Set();
  async function walk(departmentId = "0", departmentName = "飞书组织") {
    if (seenDepartments.has(departmentId)) return;
    seenDepartments.add(departmentId);
    const userData = await fetchFeishu(`/open-apis/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&page_size=50`, token).catch(() => ({ items: [] }));
    for (const user of userData.items || []) contacts.push(normalizeContact(user, departmentName));
    const deptData = await fetchFeishu(`/open-apis/contact/v3/departments/${encodeURIComponent(departmentId)}/children?fetch_child=true&page_size=50`, token).catch(() => ({ items: [] }));
    for (const department of deptData.items || []) {
      const id = department.open_department_id || department.department_id;
      if (id) await walk(id, department.name || departmentName);
    }
  }
  await walk();
  const result = { enabled: true, created: 0, updated: 0, disabled: 0 };
  for (const contact of contacts) {
    const { created } = upsertFeishuIdentity(db, contact);
    created ? result.created++ : result.updated++;
    if (contact.status === "disabled") result.disabled++;
  }
  db.settings.feishu.lastHrSyncAt = new Date().toISOString();
  db.settings.feishu.lastHrSyncResult = result;
  return result;
}
