import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const identity = await readFile(new URL("../server/feishu-identity-service.mjs", import.meta.url), "utf8");

assert(main.includes("使用飞书扫码登录") && main.includes('href="/api/auth/feishu"'), "production login must expose Feishu login");
assert(main.includes("window.location.hash") && main.includes("feishu_session"), "production login must consume the Feishu callback session");
assert(main.includes("系统会自动补全 @feishu.local"), "login should explain short account names");
assert(api.includes('!account.includes("@") ? `${account}@feishu.local`'), "server should normalize short account names");
assert(identity.includes("raw.en_name") && identity.includes("contact.loginName"), "Feishu provisioning should prefer a stable English login name");

console.log("Feishu account login regression passed");
