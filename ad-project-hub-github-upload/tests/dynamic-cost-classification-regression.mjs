import assert from "node:assert/strict";
import { previewProjectUpload } from "../server/services.mjs";

const project = {
  id: "p-dynamic-cost",
  name: "2025年捷途营销高端产品序列新媒体账号运营项目",
  client: "捷途",
  contract: 2070000,
  paid: 0,
  receivable: 2070000,
  costUsed: 0,
  costs: [],
  files: [],
  extractedFields: {}
};
const db = {
  settings: { aiService: { "API Key": "test-key", "Base URL": "https://ai.invalid/v1", "模型名称": "test-model" } }, projects: [project], parseJobs: [], files: [], suppliers: [], auditLogs: [],
  approvals: [], payments: [], collectionScripts: [], systemNotifications: []
};
const user = { id: "u-finance", name: "财务", role: "finance" };
const csv = `季度,收入,日常支出,税费,挂靠费,垫款,投流,刷单,人力,中标服务费,贷款利息,利润
第一季度,640687.02,145396.3,65216.17,124337.08,0,54553.21,0,168950,26800,0,55344.26
第二季度,392776.12,128831.56,39981.08,21337.7,0,28516.12,0,182214.29,0,0,-8104.63
第三季度,599922.13,95197.71,61066.69,0,0,37542.13,0,203301,10000,0,192814.6
第四季度,437198.52,156891.39,17147.19,7209,0,34256.14,0,200088,0,0,21606.8`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
  hasCostSheet: true,
  advancePayment: 307751.38,
  advanceInterest: 26800,
  executionCost: 526316.96,
  internalLabor: 754553.29,
  additionalCost: 220211.13,
  costs: [["项目垫款", 307751.38], ["垫款利息", 26800], ["项目执行总成本", 526316.96], ["内部人力", 754553.29], ["其他项目成本", 220211.13]],
  costClassifications: [{ name: "挂靠费", category: "advancePayment", reason: "AI 错误合并到垫款", confidence: "high" }]
}) } }] }), { status: 200, headers: { "content-type": "application/json" } });

const preview = await previewProjectUpload(db, {
  type: "cost-sheet",
  id: project.id,
  files: [{ name: "工作簿1212.csv", type: "text/csv", text: csv, size: csv.length }]
}, user);
globalThis.fetch = originalFetch;
const section = preview.sections.find((item) => item.title === "成本归集");
const rows = new Map(section.rows.map((item) => [item.name, item.amount]));

assert.equal(rows.get("税费"), 183411.13);
assert.equal(rows.get("挂靠费"), 152883.78);
assert.equal(rows.get("投流"), 154867.6);
assert.equal(rows.get("中标服务费"), 36800);
assert.equal(rows.get("人力"), 754553.29);
assert.equal(rows.has("项目执行总成本"), false, "AI 聚合名称不得覆盖原始表头");
assert.equal(preview.fields["项目垫款"], 154867.6, "投流应按该合同资金语义归入垫款");
assert.equal(preview.fields["垫款利息"], 0, "表格明确贷款利息为 0 时不得由 AI 填入其他费用");
assert.equal(preview.fields["总成本影响"], 1808832.76, "利润必须扣除所有动态成本科目且不得重复计算");
assert.equal(Number((project.contract - preview.fields["总成本影响"]).toFixed(2)), 261167.24);

console.log("dynamic cost classification regression passed");
