import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectionFollowUpQueue } from "../src/utils/collectionMetrics.js";
import { calculateRunway, operatingMetrics, operatingSettings } from "../src/utils/operatingMetrics.js";

const now = new Date("2026-07-10T08:00:00.000Z");
const projects = [
  { id: "p-1", name: "捷途汽车项目", client: "捷途汽车", receivable: 1070700, contract: 1870700, paymentDue: "月底尾款", risk: "中", costUsed: 130000, status: "执行中" },
  { id: "p-2", name: "低压项目", client: "客户B", receivable: 20000, contract: 100000, paymentDue: "下月", risk: "低", costUsed: 20000, status: "已完成" }
];
const scripts = [
  { projectId: "p-1", followUpStatus: "待跟进", nextFollowUpAt: "2026-07-09", nextAction: "今天补齐回款资料" }
];

const queue = collectionFollowUpQueue(projects, scripts, now);
assert.equal(queue[0].project.name, "捷途汽车项目");
assert.equal(queue[0].status, "已逾期");
assert.equal(queue[0].nextAction, "今天补齐回款资料");
assert.equal(queue[0].receivableRate, 57);

const runway = calculateRunway({
  currentCash: 300000,
  monthlyLaborCost: 120000,
  monthlyRent: 20000,
  monthlyLoan: 10000,
  monthlyInterest: 5000,
  monthlyOtherCost: 45000
});
assert.equal(runway.monthlyFixedCost, 200000);
assert.equal(runway.safetyReserve, 1200000);
assert.equal(runway.runwayMonths, 1.5);
assert.equal(runway.runwayLabel, "危险！你快倒闭啦！需要收缩现金流");

const settings = { companyFinance: { currentCash: 900000, monthlyLaborCost: 80000, monthlyRent: 20000, monthlyLoan: 10000, monthlyInterest: 5000, monthlyOtherCost: 35000 } };
assert.equal(operatingSettings(settings).runwayLabel, "安全");

const metrics = operatingMetrics(projects, [
  { id: "a-1", type: "petty_cash", amount: 10000, status: "待审批" },
  { id: "a-2", type: "supplier_payment", amount: 30000, status: "审批中" }
], { contract: 1970700, receivable: 1090700 }, { companyFinance: { currentCash: 300000, monthlyLaborCost: 120000, monthlyRent: 20000, monthlyLoan: 10000, monthlyInterest: 5000, monthlyOtherCost: 45000 } }, { formatMoney: (value) => `¥${Number(value).toLocaleString("zh-CN")}` });

assert.equal(metrics.pendingApprovals.length, 1);
assert.equal(metrics.pendingPettyCash, 10000);
assert.equal(metrics.pendingSupplierPay, 30000);
assert.equal(metrics.recommendation, "危险！你快倒闭啦！需要收缩现金流");
assert.equal(metrics.highRiskProjects[0].name, "捷途汽车项目");
assert(metrics.advisorActions.some((item) => item.includes("6个月安全线缺口 ¥900,000")));

const collectionSource = await readFile(new URL("../src/CollectionAssistant.jsx", import.meta.url), "utf8");
const managementSource = await readFile(new URL("../src/ManagementCockpit.jsx", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(collectionSource.includes('import { collectionFollowUpQueue } from "./utils/collectionMetrics.js";'), "collection assistant should use shared follow-up queue");
assert(managementSource.includes('import { calculateRunway, operatingMetrics } from "./utils/operatingMetrics.js";'), "management cockpit should use shared operating metrics");
assert(!mainSource.includes("function collectionFollowUpQueue("), "main should not redefine collectionFollowUpQueue");
assert(!mainSource.includes("function operatingMetrics("), "main should not redefine operatingMetrics");
assert(!collectionSource.includes("function collectionFollowUpQueue("), "collection assistant should not redefine collectionFollowUpQueue");
assert(!managementSource.includes("function operatingMetrics("), "management cockpit should not redefine operatingMetrics");
assert(!managementSource.includes("function calculateRunway("), "management cockpit should not redefine calculateRunway");

console.log("frontend operating collection utils regression passed");
