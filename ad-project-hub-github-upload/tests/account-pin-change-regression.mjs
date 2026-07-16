import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

assert(api.includes('url.pathname === "/api/auth/change-pin"'), "authenticated users need a self-service PIN route");
assert(api.includes("verifyPin(currentPin") && api.includes('action: "change-pin"'), "PIN change must verify the current PIN and create an audit record");
assert(api.includes('newPin === "123456"') && api.includes("新 PIN 不能与当前 PIN 相同"), "PIN change must reject unsafe or unchanged values");
assert(main.includes("修改登录 PIN") && main.includes('apiRequest(session, "/api/auth/change-pin"'), "employee UI must expose the real PIN change route");
assert(main.includes("两次输入的新 PIN 不一致") && main.includes('autoComplete="current-password"'), "PIN dialog must confirm the new PIN and use password fields");
assert(styles.includes(".account-pin-dialog"), "PIN dialog must have viewport-safe styling");

console.log("account PIN change regression passed");
