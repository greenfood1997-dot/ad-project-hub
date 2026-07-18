import assert from "node:assert/strict";
import {
  cashChartOption,
  costChartOption,
  progressChartOption
} from "../src/utils/dashboardCharts.js";

const projects = [
  { client: "捷途", pm: "唐初", status: "执行中", risk: "高", paid: 300000, receivable: 700000, costBudget: 500000, costUsed: 250000 },
  { client: "咖啡", pm: "小林", status: "已完成", risk: "低", paid: 500000, receivable: 0, costBudget: 200000, costUsed: 100000 },
  { client: "食品", pm: "小王", status: "草稿", risk: "中", paid: 0, receivable: 100000, costBudget: 0, costUsed: 0 }
];

const progress = progressChartOption(projects);
assert.equal(progress.series[0].type, "pie");
assert.deepEqual(progress.series[0].data.map((item) => item.name), ["执行中", "已完成", "筹备中", "高风险"]);

const cash = cashChartOption(projects);
assert.deepEqual(cash.xAxis.data, ["捷途", "咖啡", "食品"]);
assert.deepEqual(cash.series[0].data, [300000, 500000, 0]);
assert.deepEqual(cash.series[1].data, [700000, 0, 100000]);
assert.equal(cash.yAxis.axisLabel.formatter(10000), "¥10,000.00");

const cost = costChartOption(projects);
assert.deepEqual(cost.yAxis.data, ["唐初", "小林", "小王"]);
assert.deepEqual(cost.series[0].data, [50, 50, 0]);

console.log("frontend dashboard charts regression passed");
