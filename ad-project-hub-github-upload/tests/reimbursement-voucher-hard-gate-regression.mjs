import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");
const assistant = await readFile(new URL("../server/assistant-service.mjs", import.meta.url), "utf8");

assert(services.includes('提交报销前请选择发票、支付截图或暂未提供凭证'), "server must reject reimbursement without an explicit voucher choice");
assert(services.includes("voucherType: confirmedAction.voucherType"), "production AI path should forward only confirmed voucher fields");
assert(assistant.includes("voucherType: confirmedAction.voucherType"), "split AI service should forward confirmed voucher fields");
assert(services.includes('requiresVoucher: type === "reimbursement"'), "AI reimbursement action should advertise voucher requirement");

console.log("reimbursement voucher hard gate regression passed");
