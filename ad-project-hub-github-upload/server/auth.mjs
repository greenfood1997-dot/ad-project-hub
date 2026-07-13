import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

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
  const payload = encode({ sub: user.id, exp: Date.now() + TOKEN_TTL_MS });
  return `${payload}.${sign(payload)}`;
}

export function verifyAuthToken(token = "") {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub && Number(data.exp) > Date.now() ? data : null;
  } catch {
    return null;
  }
}
