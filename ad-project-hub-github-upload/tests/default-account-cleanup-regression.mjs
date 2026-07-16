import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/AdminMemberPanel.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(api.includes('url.pathname === "/api/members/disable-insecure-defaults"') && api.includes("requireRole(user, ADMIN_ROLES"), "default cleanup must be admin-only");
assert(api.includes("DEFAULT_ACCOUNT_IDS.has(account.id)") && api.includes('account.pin !== "123456"'), "cleanup must only target built-in accounts still using the default PIN");
assert(api.includes('current.pin === "123456" || !current.pinHash'), "the acting admin must secure their own account first");
assert(api.includes('action: "disable-insecure-default-accounts"'), "cleanup must be audited");
for (const [label, source] of [["split shell", shell + panel], ["production entry", main]]) {
  assert(source.includes("停用其余默认账号") && source.includes("/api/members/disable-insecure-defaults"), `${label} must expose the real cleanup flow`);
}

console.log("default account cleanup regression passed");
