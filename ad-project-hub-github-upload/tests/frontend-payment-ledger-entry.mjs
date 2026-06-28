import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function ProjectDetail"), "project detail should exist");
assert(source.includes("const [paymentForm") && source.includes("recordingPayment"), "project detail should keep a real payment form state");
assert(source.includes('apiRequest("/api/payments"') || source.includes("apiRequest('/api/payments'"), "project detail should submit payments to backend");
assert(source.includes("projectPayments = payments.filter"), "project detail should read real payment ledger from state");
assert(source.includes("setPaymentForm({ amount: \"\", payer: \"\", method: \"\", note: \"\" })"), "payment form should reset after successful save");
assert(source.includes("回款已记录，项目已回款和待回款已更新"), "payment save should tell user that project receivable data updates");
assert(source.includes("已回款 {money(project.paid)} · 待回款 {money(project.receivable)}"), "payment section should show live paid and receivable values");
assert(source.includes("placeholder=\"回款金额\"") && source.includes("placeholder=\"付款方 / 客户\"") && source.includes("placeholder=\"方式：银行 / 票据等\""), "payment form should collect amount, payer, and method");
assert(source.includes("记录回款"), "project detail should expose a payment record action");
assert(source.includes("projectPayments.length ? projectPayments.slice"), "project detail should render saved payment rows");
assert(source.includes("canRecordPayment") && source.includes("pm\", \"sales\", \"finance"), "payment entry should be role-gated to PM/sales/finance/management");

console.log("frontend payment ledger entry passed");
