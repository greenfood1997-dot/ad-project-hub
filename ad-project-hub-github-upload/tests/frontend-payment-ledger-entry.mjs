import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function ProjectDetail"), "project detail should exist");
assert(source.includes("const [paymentForm") && source.includes("recordingPayment"), "project detail should keep a real payment form state");
assert(source.includes('apiRequest("/api/payments"') || source.includes("apiRequest('/api/payments'"), "project detail should submit payments to backend");
assert(source.includes("const [voidingPaymentId") && source.includes("async function voidPayment(item)"), "project detail should keep a real payment void action state");
assert(source.includes('/api/payments/void"') && source.includes("作废回款"), "project detail should void payments through backend");
assert(source.includes("回款已作废，项目金额已回滚：已回款") && source.includes("待回款 ${money(nextProject.receivable ?? project.receivable)}"), "payment void should tell user the rolled-back paid and receivable amounts");
assert(source.includes("projectPayments = payments.filter"), "project detail should read real payment ledger from state");
assert(source.includes("function paymentLedgerRows(project = {}, payments = [])") && source.includes("作废原因"), "payment ledger export should build readable CSV rows with void metadata");
assert(source.includes("const [exportingPaymentLedger, setExportingPaymentLedger]") && source.includes("function exportPaymentLedger()"), "project detail should keep payment ledger export state and action");
assert(source.includes("downloadCsv(filename, paymentLedgerRows(project, projectPayments))"), "payment ledger export should use the current project's real payment rows");
assert(source.includes("当前项目还没有回款流水，请先记录回款或上传核销表。") && source.includes("回款台账 CSV 已导出"), "payment ledger export should explain empty and success states");
assert(source.includes("setPaymentForm({ amount: \"\", payer: \"\", method: \"\", note: \"\" })"), "payment form should reset after successful save");
assert(source.includes("const [focusedPaymentId") && source.includes("setFocusedPaymentId(payment.id || \"\")"), "payment save should focus the newly created ledger row");
assert(source.includes("回款已记录，回款流水已刷新：本次") && source.includes("待回款 ${money(nextProject.receivable ?? project.receivable)}"), "payment save should tell user the new amount, paid total, and receivable balance");
assert(source.includes('setLocalFocusTarget("payments")'), "payment save should focus the payment ledger after refresh");
assert(source.includes("已回款 {money(project.paid)} · 待回款 {money(project.receivable)}"), "payment section should show live paid and receivable values");
assert(source.includes("placeholder=\"回款金额\"") && source.includes("placeholder=\"付款方 / 客户\"") && source.includes("placeholder=\"方式：银行 / 票据等\""), "payment form should collect amount, payer, and method");
assert(source.includes("记录回款"), "project detail should expose a payment record action");
assert(source.includes("projectPayments.length ? projectPayments.slice"), "project detail should render saved payment rows");
assert(source.includes('focusedPaymentId === item.id ? "fresh" : ""'), "payment rows should visually mark the latest saved ledger entry");
assert(source.includes('item.status === "已作废" || item.voidedAt') && source.includes("作废人 ${item.voidedByName"), "payment rows should preserve and label voided records");
assert(source.includes('disabled={voidingPaymentId === item.id}') && source.includes('voidingPaymentId === item.id ? "作废中" : "作废回款"'), "payment void button should show per-row loading state");
assert(source.includes("canRecordPayment") && source.includes("pm\", \"sales\", \"finance"), "payment entry should be role-gated to PM/sales/finance/management");
assert(source.includes("function preparePaymentEntry") && source.includes("已帮你预填回款登记信息，请补充金额后点击记录回款。"), "empty payment ledger should let allowed roles prepare a payment entry");
assert(source.includes("payment-action-empty") && source.includes("暂无回款流水") && source.includes("上传核销表"), "empty payment ledger should expose actionable payment and verification next steps");
assert(source.includes('setQuickUploadType("verification-sheet")') && source.includes("生成催收话术"), "payment empty state should connect to verification upload and collection assistant actions");
assert(source.includes("导出回款") && source.includes("<FileSpreadsheet size={14} />"), "payment section should expose a per-project payment ledger export button");
assert(styles.includes(".detail-list > div.voided"), "voided payment rows should have dedicated visual style");
assert(styles.includes(".section-head-actions"), "section head actions should keep payment export aligned with the paid/receivable summary");

console.log("frontend payment ledger entry passed");
