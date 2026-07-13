export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(JSON.stringify(body));
}

export function sendCorsPreflight(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400"
  });
  res.end();
}

export function getCurrentUser(req, db) {
  const auth = String(req.headers.authorization || "");
  const tokenData = verifyAuthToken(auth.startsWith("Bearer ") ? auth.slice(7) : "");
  const legacyId = process.env.NODE_ENV === "production" ? "" : req.headers["x-user-id"];
  const id = tokenData?.sub || legacyId;
  return db.users.find((user) => user.id === id && user.status !== "disabled") || null;
}

export function requireRole(user, roles, res) {
  if (user?.status !== "disabled" && roles.includes(user.role)) return true;
  sendJson(res, 403, { ok: false, error: "无权限执行该操作" });
  return false;
}
import { verifyAuthToken } from "./auth.mjs";
