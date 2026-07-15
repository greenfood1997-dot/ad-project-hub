import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bootstrap = await readFile(new URL("../server/bootstrap-admin.mjs", import.meta.url), "utf8");
const entry = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const guide = await readFile(new URL("../RENDER_POSTGRES_MIGRATION.md", import.meta.url), "utf8");

assert(bootstrap.includes("(admin.pinHash || admin.pin) && !insecureDefault"), "bootstrap must preserve secure credentials while allowing default PIN migration");
assert(bootstrap.includes('pin === "123456"'), "bootstrap must reject the old default PIN");
assert(bootstrap.includes("admin.mustChangePin = true") && bootstrap.includes('admin.status = "active"'), "bootstrap must activate only the admin and require immediate PIN change");
assert(bootstrap.includes('account.pin !== "123456"') && bootstrap.includes('account.status = "disabled"'), "bootstrap must disable the remaining default accounts");
assert(entry.includes("await bootstrapPostgresAdminFromEnv()"), "server must bootstrap before accepting requests");
assert(api.includes("bootstrapAdminPinConfigured"), "health must expose whether the temporary bootstrap secret still exists");
assert(guide.includes("删除 `OA_BOOTSTRAP_ADMIN_PIN`") && guide.includes('`bootstrapAdminPinConfigured` 应为 `false`'), "migration guide must require removing and verifying the temporary secret");
assert(!guide.includes("PIN：`123456`") && !guide.includes("重置为 PIN `123456`"), "migration guide must not instruct use of default PINs");

console.log("postgres bootstrap admin regression passed");
