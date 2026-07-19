import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const login = await readFile(new URL("../src/LoginScreen.jsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../src/IntegrationSettingsPanel.jsx", import.meta.url), "utf8");
assert(login.includes('href="/api/auth/feishu"') && login.includes("使用飞书账号登录"));
assert(login.includes("feishu_session") && login.includes("localStorage.setItem(sessionKey"));
assert(login.includes("window.location.hash"), "Feishu session should be read from a fragment instead of a server-visible query string");
assert(settings.includes("hrAuthoritative") && settings.includes("入职开户、离职停用"));
console.log("frontend feishu login regression passed");
