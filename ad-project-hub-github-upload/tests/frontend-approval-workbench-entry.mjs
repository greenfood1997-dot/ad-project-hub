import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('["approvals", "待我审批"]'), "approval nav should include pending approvals");
assert(source.includes('["approvals", "项目备用金"]'), "approval nav should include project petty cash");
assert(source.includes('["approvals", "报销"]'), "approval nav should include reimbursements");
assert(source.includes('["approvals", "供应商付款"]'), "approval nav should include supplier payments");
assert(source.includes("function ApprovalFunds"), "frontend should render approval workbench");
assert(source.includes("actionableApprovals"), "approval workbench should compute approvals actionable by current user");
assert(source.includes("visibleApprovals"), "approval workbench should filter approvals by active sub page");
assert(source.includes("approval-summary-row"), "approval workbench should show per-tab summary");
assert(source.includes("visibleAmount") && source.includes("pendingVisible") && source.includes("completedVisible") && source.includes("rejectedVisible"), "approval summary should include amount and status counts");
assert(source.includes('/api/approvals"'), "approval workbench should submit approvals to backend");
assert(source.includes('/api/approvals/action"'), "approval workbench should approve/reject through backend");
assert(source.includes("const [actingApprovalId, setActingApprovalId]"), "approval action buttons should keep loading state");
assert(source.includes("setActingApprovalId(selectedApproval.id)") && source.includes('setActingApprovalId("")'), "approval actions should disable duplicate clicks and reset loading");
assert(source.includes("const nextApproval = visibleApprovals.find") && source.includes("setSelectedApprovalKey(nextApproval?.id || \"\")"), "approval workbench should move to the next actionable approval after handling one");
assert(source.includes("已切到下一条待处理") && source.includes("当前列表暂无下一条待处理"), "approval action notices should explain where the user landed next");
assert(source.includes('form.type === "supplier_payment" ? "供应商付款"'), "supplier payment submission should return to supplier payment tab");
assert(source.includes("流程进度") && source.includes("approval-steps"), "approval workbench should show process progress");
assert(source.includes("通过") && source.includes("驳回"), "approval workbench should expose approve and reject actions");
assert(source.includes("project.pettyCashBudget ?? project.extractedFields?.pettyCashBudget"), "project normalization should preserve real petty cash budget from backend");
assert(source.includes("project.pettyCashUsed ?? project.extractedFields?.pettyCashUsed"), "project normalization should preserve real petty cash usage from backend");
assert(source.includes("预算额度") && source.includes("剩余额度"), "approval workbench should show petty cash budget and remaining amount");
assert(source.includes("const pettyCashProject = projects.find") && source.includes("selectedApproval.projectId") && source.includes("form.projectId"), "petty cash card should follow selected approval or form project");
assert(source.includes("跟随当前审批/表单项目") && source.includes("pettyCashLeft"), "petty cash card should label the active project and compute remaining amount from it");
assert(styles.includes(".approval-workbench"), "approval workbench should have layout styles");
assert(styles.includes(".approval-summary-row"), "approval summary should have dedicated styles");

console.log("frontend approval workbench entry passed");
