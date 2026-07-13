import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fileKindLabel,
  materialMatches,
  materialStatusLabel,
  projectActionItems,
  projectAiAdvice,
  projectMaterialStatus
} from "../src/utils/projectMaterials.js";

assert.equal(fileKindLabel("quote-sheet"), "报价表");
assert.equal(fileKindLabel("verification upload"), "核销表");
assert.equal(fileKindLabel("execution cost"), "成本表");
assert.equal(fileKindLabel("contract"), "合同");
assert.equal(materialMatches("contract", "甲方与乙方签署服务协议"), true);
assert.equal(materialMatches("quote", "达人报价表"), true);
assert.equal(materialMatches("cost", "供应商结算费用"), true);
assert.equal(materialMatches("verification", "月度核销验收"), true);
assert.equal(materialStatusLabel({ status: "review" }), "需复核");

const project = {
  name: "捷途汽车项目",
  client: "捷途汽车",
  contract: 1870700,
  costBudget: 900000,
  costUsed: 820000,
  receivable: 1070700,
  paymentDue: "月底尾款",
  margin: 18,
  extractedFields: {
    revenueRecognition: {
      quoteRules: [{ name: "短视频" }],
      verificationRecords: [{ status: "待复核" }]
    }
  }
};
const status = projectMaterialStatus(project, [{ name: "执行成本表.xlsx" }], [{ status: "解析中", progress: 30, files: [{ name: "成本表.xlsx" }] }]);
assert.equal(status.doneCount, 2);
assert.deepEqual(status.items.map((item) => [item.key, item.status]), [
  ["contract", "parsed"],
  ["quote", "review"],
  ["cost", "parsed"],
  ["verification", "review"]
]);
assert.equal(status.missing.map((item) => item.label).join("、"), "报价表、核销表");

const actions = projectActionItems({
  project,
  files: [],
  jobs: [],
  approvals: [{ status: "待审批" }],
  health: { label: "滞后", text: "完成度落后于时间进度" },
  isManagement: true,
  feishuPending: [{ status: "待确认" }]
});
assert.equal(actions[0].title, "确认飞书文件");
assert(actions.some((item) => item.title === "进度需要追赶"));

const costActions = projectActionItems({
  project: { ...project, receivable: 0, extractedFields: { revenueRecognition: { quoteRules: [{ name: "短视频" }], updatedAt: "2026-07-10", verificationRecords: [{ status: "已确认" }] } } },
  files: [],
  jobs: [],
  approvals: [],
  health: { label: "正常", text: "进度正常" },
  isManagement: true,
  feishuPending: []
});
assert(costActions.some((item) => item.title === "成本接近预算"));

const advice = projectAiAdvice({
  project,
  materialStatus: status,
  approvals: [{ status: "待审批" }],
  health: { label: "滞后" },
  isManagement: true,
  feishuPending: [{ status: "待确认" }]
});
assert(advice.some((item) => item.includes("飞书待确认文件")));
assert(advice.some((item) => item.includes("优先补齐")));

const marginAdvice = projectAiAdvice({
  project: { ...project, receivable: 0, paymentDue: "", margin: 18 },
  materialStatus: projectMaterialStatus({
    ...project,
    receivable: 0,
    paymentDue: "",
    extractedFields: { revenueRecognition: { quoteRules: [{ name: "短视频" }], updatedAt: "2026-07-10", verificationRecords: [{ status: "已确认" }] } }
  }, [], []),
  approvals: [],
  health: { label: "正常" },
  isManagement: true,
  feishuPending: []
});
assert(marginAdvice.some((item) => item.includes("毛利率偏低")));

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
assert(mainSource.includes('from "./utils/projectMaterials.js"'), "main should import shared project material helpers");
assert(!mainSource.includes("function projectMaterialStatus("), "main should not redefine projectMaterialStatus");
assert(!mainSource.includes("function projectActionItems("), "main should not redefine projectActionItems");
assert(!mainSource.includes("function projectAiAdvice("), "main should not redefine projectAiAdvice");

console.log("frontend project materials regression passed");
