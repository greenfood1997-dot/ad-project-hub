import assert from "node:assert/strict";
import { notifyApprovalInFeishu } from "../server/approval-feishu-service.mjs";

const db = {
  settings: { feishu: { mockSend: true } },
  users: [
    { id: "pm1", name: "项目经理", role: "pm", status: "active", feishuOpenId: "ou_pm" },
    { id: "applicant", name: "申请人", role: "member", status: "active", feishuOpenId: "ou_applicant" }
  ],
  projects: [{ id: "p1", name: "项目一", pm: "项目经理" }],
  auditLogs: []
};
const approval = { id: "ap1", type: "reimbursement", typeLabel: "报销", projectId: "p1", projectName: "项目一", applicantId: "applicant", applicantName: "申请人", amount: 1234.56, reason: "交通费", status: "待PM确认", currentRole: "pm", voucher: { status: "valid-invoice" } };
const submitted = await notifyApprovalInFeishu(db, approval, "submitted", { origin: "https://oa.example.com" });
assert.equal(submitted.results[0].userId, "pm1");
assert.match(submitted.text, /¥1,234\.56/);
assert.match(submitted.text, /approvalId=ap1/);
assert.equal((await notifyApprovalInFeishu(db, approval, "submitted", {})).duplicate, true);
approval.status = "已完成"; approval.currentRole = "";
const completed = await notifyApprovalInFeishu(db, approval, "completed", {});
assert.equal(completed.results[0].userId, "applicant");
console.log("approval Feishu notification regression passed");
