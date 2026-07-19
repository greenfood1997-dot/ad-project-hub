import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canSeeManagement } from "../src/utils/permissions.js";

assert.equal(canSeeManagement({ role: "shareholder" }), true);
assert.equal(canSeeManagement({ role: "admin" }), true);
assert.equal(canSeeManagement({ role: "finance" }), true);
for (const role of ["director", "pm", "sales", "member", "viewer"]) {
  assert.equal(canSeeManagement({ role }), false, `${role} must not see the company cockpit`);
}

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
assert(api.includes('if (!requireRole(user, COCKPIT_ROLES, res)) return;\n    const body = await readBody(req);\n    const data = await mutateDb((db) => saveCompanyFinance'), "company finance writes must use cockpit roles");
assert(api.includes('if (COCKPIT_ROLES.includes(user.role)) {\n    result.companyFinance'), "company finance state must use cockpit roles");
assert(api.includes('companyFinanceNotice') && api.includes('return COCKPIT_ROLES.includes(actor.role)'), "company cash notifications must use cockpit roles");

console.log("owner cockpit permission regression passed");
