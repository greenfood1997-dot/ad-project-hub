import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../src/utils/api.js", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const login = await readFile(new URL("../src/LoginScreen.jsx", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const session = await readFile(new URL("../src/utils/session.js", import.meta.url), "utf8");

assert(session.includes('response?.status !== 401') && session.includes("SESSION_EXPIRED_EVENT"), "401 responses should broadcast one session-expired event");
assert(api.includes("handleUnauthorizedResponse(res, payload)"), "shared API requests should detect expired sessions");
assert(main.includes("window.addEventListener(SESSION_EXPIRED_EVENT") && main.includes("localStorage.removeItem(SESSION_KEY)"), "app shell should clear the expired session and return to login");
assert(main.includes("if (handleUnauthorizedResponse(res, payload)) return"), "state loading must not convert an expired login into an empty project list");
assert(!main.includes('.catch(() => setState({ projects: [] }))'), "transient state failures must preserve the last successful project data");
assert(main.includes("项目数据连接暂时中断，正在自动重试；已保留上次成功数据。") && main.includes("15000"), "transient state failures should explain recovery and retry automatically");
assert(main.includes("setSelectedId((currentId) =>") && main.includes("project.id === currentId"), "background refresh should preserve the user's currently expanded project");
assert(!main.includes("project.id === selectedId)) setSelectedId(first.id)"), "background refresh must not use a stale selected-project closure");
assert(login.includes("login-session-notice") && login.includes("notice"), "login screen should explain why the user was redirected");
assert(admin.includes("handleUnauthorizedResponse(res, payload)"), "admin requests should also redirect expired sessions");

console.log("session expiry redirect regression passed");
