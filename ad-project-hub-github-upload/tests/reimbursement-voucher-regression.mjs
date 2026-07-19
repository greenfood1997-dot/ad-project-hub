import assert from "node:assert/strict";
import { createApproval, supplementReimbursementVoucher } from "../server/services.mjs";

const user = { id: "u-member", name: "执行A", role: "member" };
const db = { projects: [{ id: "p-1", name: "项目甲", contract: 100000, paid: 0, costUsed: 0 }], approvals: [], auditLogs: [], settings: {} };

const screenshot = createApproval(db, { projectId: "p-1", type: "reimbursement", amount: 120, reason: "项目打车", voucherType: "payment-screenshot", transactionNo: "TX-001" }, user);
assert.equal(screenshot.voucher.status, "awaiting-invoice");
assert.equal(screenshot.invoiceGap, 120);
assert.throws(() => createApproval(db, { projectId: "p-1", type: "reimbursement", amount: 120, voucherType: "payment-screenshot", transactionNo: "TX-001" }, user), /重复报销/);

const supplemented = supplementReimbursementVoucher(db, { approvalId: screenshot.id, voucherType: "vat-special", invoiceNo: "INV-001", taxRate: 1 }, user);
assert.equal(supplemented.invoiceGap, 0);
assert.equal(supplemented.voucher.deductible, true);
assert.equal(db.projects[0].costUsed, 0, "补票只改变凭证状态，不能重复增加项目成本");

const invoice = createApproval(db, { projectId: "p-1", type: "reimbursement", amount: 88, reason: "道具", voucherType: "invoice", invoiceNo: "INV-002", taxRate: 1 }, user);
assert.equal(invoice.invoiceGap, 0);
assert.equal(invoice.voucher.deductible, false);

console.log("reimbursement voucher regression passed");
