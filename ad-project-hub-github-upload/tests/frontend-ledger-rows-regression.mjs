import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  activityLedgerRows,
  approvalLedgerRows,
  assignmentLedgerRows,
  clientHandoffRows,
  closeoutReviewRows,
  collectionLedgerRows,
  feishuPendingLedgerRows,
  managementLedgerRows,
  paymentLedgerRows,
  projectLedgerRows,
  reimbursementSummaryRows,
  supplierProfileRows,
  taskLedgerRows
} from "../src/utils/ledgerRows.js";

const project = {
  id: "p-1",
  name: "捷途汽车项目",
  client: "捷途汽车",
  owner: "唐初",
  pm: "唐初",
  sales: "销售A",
  status: "执行中",
  risk: "中",
  contract: 1870700,
  paid: 800000,
  receivable: 1070700,
  costBudget: 900000,
  costUsed: 130000,
  progress: 45,
  nextMilestone: "中期交付",
  paymentDue: "月底回款",
  startDate: "2026-01-01",
  endDate: "2026-12-31"
};

const projectRows = projectLedgerRows([project], true, {
  materialStatus: () => ({ missing: [{ label: "核销表" }], doneCount: 3 })
});
assert.deepEqual(projectRows[0].slice(0, 4), ["项目名称", "客户/品牌", "负责人", "PM"]);
assert.equal(projectRows[1][0], "捷途汽车项目");
assert.equal(projectRows[1][7], 1870700);
assert.equal(projectRows[1][17], "缺：核销表；已完成 3/4");
assert.equal(projectRows[1].at(-2), 1740700);

const paymentRows = paymentLedgerRows(project, [{ payer: "捷途财务", amount: 300000, method: "银行转账", recordedByName: "财务A" }]);
assert.equal(paymentRows[1][0], "捷途汽车项目");
assert.equal(paymentRows[1][3], 300000);

const approval = {
  projectName: "捷途汽车项目",
  typeName: "报销",
  expenseCategory: "拍摄交通",
  amount: 520,
  payee: "执行同事",
  applicantName: "小王",
  status: "待审批",
  waitHours: 5,
  reason: "拍摄打车",
  logs: [{ user: "小王", action: "submit", note: "提交报销" }]
};
const runtimeInfo = () => ({ handler: "PM / 项目负责人", slaText: "建议今天处理" });
const approvalRows = approvalLedgerRows([approval], { runtimeInfo });
assert.equal(approvalRows[1][2], "拍摄交通");
assert.equal(approvalRows[1][7], "PM / 项目负责人");
assert.match(approvalRows[1][13], /提交报销/);

const reimbursementRows = reimbursementSummaryRows([approval], [project], "2026-07", { runtimeInfo });
assert.equal(reimbursementRows[1][0], "2026-07");
assert.equal(reimbursementRows[1][2], "拍摄交通");

const assignmentRows = assignmentLedgerRows([{ ...project, department: "内容部", members: ["执行A", "执行B"] }]);
assert.deepEqual(assignmentRows[0].slice(0, 8), ["项目名称", "客户/品牌", "项目状态", "部门", "PM", "销售", "执行成员", "执行人数"]);
assert.equal(assignmentRows[1][0], "捷途汽车项目");
assert.equal(assignmentRows[1][6], "执行A、执行B");
assert.equal(assignmentRows[1][7], 2);
assert.equal(assignmentRows[1][8], 1870700);

const feishuRows = feishuPendingLedgerRows([{
  file: { name: "报销单.xlsx" },
  status: "待确认",
  projectName: "捷途汽车项目",
  uploadType: "reimbursement",
  chatName: "捷途项目群",
  senderName: "执行A",
  preview: { summary: "识别到 3 条报销" },
  note: "待财务确认",
  createdAt: "2026-07-12",
  handledBy: "财务A",
  handledAt: "2026-07-13"
}]);
assert.deepEqual(feishuRows[0].slice(0, 6), ["文件名", "状态", "归属项目", "上传类型", "飞书群", "发送人"]);
assert.equal(feishuRows[1][0], "报销单.xlsx");
assert.equal(feishuRows[1][4], "捷途项目群");
assert.equal(feishuRows[1][10], "2026-07-13");

const supplierRows = supplierProfileRows([{
  supplier: "灯光供应商",
  star: 4,
  recommendationAction: "优先推荐",
  cooperationCount: 5,
  projectCount: 3,
  totalAmount: 210000,
  paidCount: 4,
  averageRating: 4.7,
  ratingCount: 6,
  riskLevel: "低",
  riskTags: ["报价稳"],
  types: ["灯光", "执行"],
  projects: ["捷途汽车项目"],
  recommendationReason: "合作稳定",
  selectionAdvice: "可继续复用",
  ratings: [{ comment: "配合快", at: "2026-07-12" }]
}]);
assert.deepEqual(supplierRows[0].slice(0, 5), ["供应商", "推荐星级", "推荐动作", "合作次数", "合作项目数"]);
assert.equal(supplierRows[1][0], "灯光供应商");
assert.equal(supplierRows[1][10], "报价稳");
assert.equal(supplierRows[1][15], "配合快");

const clientRows = clientHandoffRows({
  client: "捷途汽车",
  projectCount: 2,
  totalContract: 1870700,
  receivable: 1070700,
  commentCount: 4,
  latestProject: "捷途汽车项目",
  latestStatus: "执行中",
  likes: ["真实场景"],
  dislikes: ["空概念"],
  pitfalls: ["不要临时改报价"],
  contactStyle: "先给依据",
  handoffPackage: {
    activeProjectCount: 1,
    summary: "先看历史方案",
    firstActions: ["确认回款节点"],
    receivableProjects: [{ name: "捷途汽车项目", amount: 1070700, paymentDue: "月底" }],
    latestFeedback: ["客户喜欢数据案例"]
  }
});
assert.equal(clientRows[1][1], "捷途汽车");
assert.match(clientRows[10][1], /¥1,070,700/);
assert.equal(clientRows[14][1], "不要临时改报价");

const closeoutRows = closeoutReviewRows({
  project,
  costRows: [{ name: "灯光供应商", value: 80000 }, { name: "拍摄交通", value: 50000 }],
  topCost: { name: "灯光供应商", value: 80000 },
  totalCost: 130000,
  topCostShare: 62,
  costContractRate: 7,
  suggestedReserve: 92000,
  costWarning: "单项支出占比偏高",
  closeoutNote: "下次提前锁价",
  isManagement: true
});
assert.equal(closeoutRows[0][0], "复盘字段");
assert.equal(closeoutRows[7][0], "项目利润");
assert.equal(closeoutRows[9][1], "灯光供应商");
assert.equal(closeoutRows.at(-2)[0], "支出排行 1");
assert.equal(closeoutRows.at(-2)[3], "62%");

const memberCloseoutRows = closeoutReviewRows({ project, topCost: { name: "灯光供应商", value: 80000 }, isManagement: false });
assert.equal(memberCloseoutRows[7][0], "利润信息");
assert.equal(memberCloseoutRows[7][1], "普通成员不可见");
assert.equal(memberCloseoutRows[7][2], "");

const taskRows = taskLedgerRows(project, [{ title: "中期脚本", owner: "唐初", progress: 80, status: "doing", dueDate: "2026-07-20" }]);
assert.equal(taskRows[1][1], "中期脚本");
assert.equal(taskRows[1][4], "80%");

const activityRows = activityLedgerRows(project, [{ at: "2026-07-10", title: "上传合同", text: "合同已识别", target: "files" }]);
assert.equal(activityRows[1][4], "文件与 AI 解析");

const collectionRows = collectionLedgerRows([{ projectId: "p-1", script: "我想和你同步一下回款资料", amount: 1070700, success: true }], [project]);
assert.equal(collectionRows[1][0], "捷途汽车项目");
assert.equal(collectionRows[1][8], "是");

const managementRows = managementLedgerRows({
  recommendation: "现金流偏紧，优先催收",
  receivableRate: 57,
  spending: 130000,
  profit: 1740700,
  margin: 93,
  activeProjects: [project],
  completedProjects: [],
  runway: { currentCash: 500000, monthlyFixedCost: 120000, safetyReserve: 720000, runwayMonths: 4.16, runwayLabel: "谨慎", gap: 220000 },
  pendingApprovals: [approval],
  highRiskProjects: [project]
}, { contract: 1870700, paid: 800000, receivable: 1070700 }, [project]);
assert.equal(managementRows[1][1], "现金流偏紧，优先催收");
assert.equal(managementRows.some((row) => row[0] === "6个月安全线" && row[2] === 720000), true);

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const approvalSource = await readFile(new URL("../src/ApprovalFunds.jsx", import.meta.url), "utf8");
const collectionSource = await readFile(new URL("../src/CollectionAssistant.jsx", import.meta.url), "utf8");
const managementSource = await readFile(new URL("../src/ManagementCockpit.jsx", import.meta.url), "utf8");
const feishuSource = await readFile(new URL("../src/FeishuBotPanel.jsx", import.meta.url), "utf8");
const supplierSource = await readFile(new URL("../src/SupplierLibrary.jsx", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../src/ClientLibrary.jsx", import.meta.url), "utf8");
const closeoutSource = await readFile(new URL("../src/CloseoutReview.jsx", import.meta.url), "utf8");

assert(mainSource.includes('from "./utils/ledgerRows.js"'), "main should use shared ledger row helpers");
assert(mainSource.includes("projectLedgerRows(visibleProjects, isManagement, { materialStatus: projectMaterialStatus })"), "project ledger export should preserve material status callback");
assert(approvalSource.includes('import { approvalLedgerRows, reimbursementSummaryRows } from "./utils/ledgerRows.js";'), "approval workbench should use shared ledger helpers");
assert(collectionSource.includes('import { collectionLedgerRows } from "./utils/ledgerRows.js";'), "collection assistant should use shared collection ledger helper");
assert(managementSource.includes('import { managementLedgerRows } from "./utils/ledgerRows.js";'), "management cockpit should use shared management ledger helper");
assert(feishuSource.includes('import { feishuPendingLedgerRows } from "./utils/ledgerRows.js";'), "Feishu bot panel should use shared pending-file ledger helper");
assert(supplierSource.includes('import { supplierProfileRows } from "./utils/ledgerRows.js";'), "supplier library should use shared supplier profile ledger helper");
assert(clientSource.includes('import { clientHandoffRows } from "./utils/ledgerRows.js";'), "client library should use shared client handoff ledger helper");
assert(closeoutSource.includes('import { closeoutReviewRows } from "./utils/ledgerRows.js";'), "closeout review should use shared closeout ledger helper");

for (const [name, source] of [["main", mainSource], ["approval", approvalSource], ["collection", collectionSource], ["management", managementSource], ["feishu", feishuSource], ["supplier", supplierSource], ["client", clientSource], ["closeout", closeoutSource]]) {
  assert(!source.includes("function projectLedgerRows("), `${name} should not redefine projectLedgerRows`);
  assert(!source.includes("function paymentLedgerRows("), `${name} should not redefine paymentLedgerRows`);
  assert(!source.includes("function approvalLedgerRows("), `${name} should not redefine approvalLedgerRows`);
  assert(!source.includes("function reimbursementSummaryRows("), `${name} should not redefine reimbursementSummaryRows`);
  assert(!source.includes("function assignmentLedgerRows("), `${name} should not redefine assignmentLedgerRows`);
  assert(!source.includes("function feishuPendingLedgerRows("), `${name} should not redefine feishuPendingLedgerRows`);
  assert(!source.includes("function supplierProfileRows("), `${name} should not redefine supplierProfileRows`);
  assert(!source.includes("function clientHandoffRows("), `${name} should not redefine clientHandoffRows`);
  assert(!source.includes("function closeoutReviewRows("), `${name} should not redefine closeoutReviewRows`);
  assert(!source.includes("function taskLedgerRows("), `${name} should not redefine taskLedgerRows`);
  assert(!source.includes("function activityLedgerRows("), `${name} should not redefine activityLedgerRows`);
  assert(!source.includes("function collectionLedgerRows("), `${name} should not redefine collectionLedgerRows`);
  assert(!source.includes("function managementLedgerRows("), `${name} should not redefine managementLedgerRows`);
}

console.log("frontend ledger rows regression passed");
