import assert from "node:assert/strict";
import { feishuLoginUrl, upsertFeishuIdentity } from "../server/feishu-identity-service.mjs";

const db = { users: [], auditLogs: [] };
const first = upsertFeishuIdentity(db, { name: "新员工", email: "new@example.com", department: "执行部", feishuOpenId: "ou_new", status: "active" });
assert.equal(first.created, true);
assert.equal(first.member.role, "member", "Feishu must never auto-grant a sensitive role");
assert.equal(first.member.status, "active");
const updated = upsertFeishuIdentity(db, { name: "新员工", email: "new@example.com", department: "项目部", feishuOpenId: "ou_new", status: "disabled" });
assert.equal(updated.created, false);
assert.equal(updated.member.status, "disabled");
assert.equal(updated.member.department, "项目部");
assert.match(feishuLoginUrl({ appId: "cli_test" }, "https://oa.example.com"), /authorize.*cli_test/);

console.log("feishu identity regression passed");
