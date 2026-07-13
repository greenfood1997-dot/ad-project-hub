import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function secret() {
  return process.env.AUTH_SECRET || "local-development-only-secret";
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function issueAuthToken(user) {
  const payload = encode({ sub: user.id, purpose: "session", exp: Date.now() + TOKEN_TTL_MS });
  return `${payload}.${sign(payload)}`;
}

export function issuePasswordChangeToken(user) {
  const payload = encode({ sub: user.id, purpose: "password-change", exp: Date.now() + 10 * 60 * 1000 });
  return `${payload}.${sign(payload)}`;
}

export function verifyAuthToken(token = "") {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub && data.purpose === "session" && Number(data.exp) > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function verifyPasswordChangeToken(token = "") {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub && data.purpose === "password-change" && Number(data.exp) > Date.now() ? data : null;
  } catch { return null; }
}

export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(String(pin), salt, 32).toString("hex")}`;
}

export function verifyPin(pin, stored = "") {
  if (!stored.startsWith("scrypt$")) return String(pin) === String(stored);
  const [, salt, expected] = stored.split("$");
  const actual = scryptSync(String(pin), salt, 32).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function loginLimitKey(req, email) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return `${String(email).toLowerCase()}|${forwarded || req.socket?.remoteAddress || "unknown"}`;
}

export function isLoginLimited(key, now = Date.now()) {
  const entry = loginFailures.get(key);
  if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) return false;
  return entry.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key, now = Date.now()) {
  const current = loginFailures.get(key);
  const entry = !current || now - current.startedAt >= LOGIN_WINDOW_MS
    ? { count: 1, startedAt: now }
    : { ...current, count: current.count + 1 };
  loginFailures.set(key, entry);
  return entry.count;
}

export function clearLoginFailures(key) {
  loginFailures.delete(key);
}
