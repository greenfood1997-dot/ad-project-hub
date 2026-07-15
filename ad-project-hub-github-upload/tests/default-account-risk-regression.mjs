import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const readiness = await readFile(new URL("../src/utils/deployReadiness.js", import.meta.url), "utf8");
const standalone = await readFile(new URL("../standalone.html", import.meta.url), "utf8");

assert(api.includes("insecureDefaultAccountCount") && api.includes("authenticationReady"), "health must expose insecure default accounts");
assert(readiness.includes("先移除默认 123456 账号") && readiness.includes("OA_BOOTSTRAP_ADMIN_PIN"), "admin readiness must explain the safe migration action");
assert(!standalone.includes('value="123456"'), "fallback login must not prefill the default PIN");
assert(!standalone.includes("owner@company.local / 123456") && !standalone.includes("admin@company.local / 123456"), "fallback page must not publish credentials");

console.log("default account risk regression passed");
