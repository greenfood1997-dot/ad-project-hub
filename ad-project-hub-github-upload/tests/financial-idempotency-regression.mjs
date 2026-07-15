import assert from "node:assert/strict";
import { createApproval, recordProjectPayment, uploadProjectCostSheet } from "../server/services.mjs";

const user = { id: "u-finance", name: "财务", role: "finance" };
const project = { id: "p-1", name: "幂等项目", client: "客户", contract: 100000, paid: 0, receivable: 100000, costUsed: 0, files: [], costs: [], extractedFields: {} };
const db = {
  users: [user], projects: [project], payments: [], approvals: [], files: [], parseJobs: [], suppliers: [], auditLogs: [], systemNotifications: [], collectionScripts: [], settings: { approvalRules: {} }
};

const paymentBody = { projectId: "p-1", amount: 10000, idempotencyKey: "payment-submit-1" };
const firstPayment = recordProjectPayment(db, paymentBody, user);
const repeatedPayment = recordProjectPayment(db, paymentBody, user);
assert.equal(db.payments.length, 1);
assert.equal(project.paid, 10000, "replayed payment must not increase paid twice");
assert.equal(repeatedPayment.payment.id, firstPayment.payment.id);
assert.equal(repeatedPayment.duplicate, true);

const approvalBody = { projectId: "p-1", type: "reimbursement", amount: 500, reason: "交通", idempotencyKey: "approval-submit-1" };
const firstApproval = createApproval(db, approvalBody, user);
const repeatedApproval = createApproval(db, approvalBody, user);
assert.equal(db.approvals.length, 1);
assert.equal(repeatedApproval.id, firstApproval.id, "replayed approval must return the existing record");

const file = { id: "cost-file-1", name: "成本.csv", type: "text/csv", text: "项目,费用类型,金额\n幂等项目,交通,88" };
const firstCost = await uploadProjectCostSheet(db, { id: "p-1", files: [file], idempotencyKey: "cost-submit-1" }, user);
const costAfterFirst = project.costUsed;
const repeatedCost = await uploadProjectCostSheet(db, { id: "p-1", files: [file], idempotencyKey: "cost-submit-1" }, user);
assert.equal(db.files.filter((item) => item.type === "execution-cost").length, 1);
assert.equal(project.costUsed, costAfterFirst, "replayed cost sheet must not deduct budget twice");
assert.equal(repeatedCost.duplicate, true);
assert(firstCost.parseJob);

console.log("financial idempotency regression passed");
