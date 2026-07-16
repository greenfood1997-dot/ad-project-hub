import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/AdminMemberPanel.jsx", import.meta.url), "utf8");
const login = await readFile(new URL("../src/LoginScreen.jsx", import.meta.url), "utf8");

assert(api.includes('temporaryPin === "123456"'), "member API must reject the known default PIN");
assert(api.includes("/^\\d{6,12}$/"), "member API must validate temporary PIN format server-side");
assert(!shell.includes('pin: "123456"'), "admin shell must not prefill a default member PIN");
assert(panel.includes("填写 6-12 位数字，不能使用 123456"), "shared member panel must explain the temporary PIN rule");
assert(main.includes("填写 6-12 位数字，不能使用 123456"), "production entry must explain the temporary PIN rule");
assert(panel.includes('type="password"') && panel.includes('inputMode="numeric"'), "shared member panel must mask numeric PIN input");
assert(!login.includes('useState("admin@company.local")') && !login.includes('useState("123456")'), "shared login must not prefill public credentials");
assert(!login.includes("默认管理员"), "shared login must not publish default credentials");

console.log("member PIN safety regression passed");
