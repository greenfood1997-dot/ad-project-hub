import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  averageProgress,
  inferTimeProgress,
  normalizeCostRow,
  normalizeTask,
  projectHealth,
  taskDueInfo
} from "../src/utils/projectMetrics.js";

assert.deepEqual(normalizeTask(["首轮脚本", 40, "task-script"], 0), {
  id: "task-script",
  title: "首轮脚本",
  progress: 40,
  status: "doing",
  owner: "",
  dueDate: "",
  note: ""
});
assert.equal(normalizeTask({ title: "核销", progress: 100 }, 1).status, "done");
assert.equal(averageProgress([{ progress: 20 }, { progress: 80 }]), 50);
assert.deepEqual(normalizeCostRow(["加油费", 130], 0), { name: "加油费", value: 130 });
assert.equal(normalizeCostRow({ "费用项": "餐饮", "金额": 520 }, 1).name, "餐饮");
assert.equal(normalizeCostRow({ "费用项": "餐饮", "金额": 520 }, 1).value, 520);

const fixedNow = new Date("2026-07-10T08:00:00.000Z");
assert.deepEqual(taskDueInfo({ dueDate: "2026-07-09", progress: 20 }, fixedNow), { tone: "overdue", label: "已逾期 1 天" });
assert.deepEqual(taskDueInfo({ dueDate: "2026-07-10", progress: 20 }, fixedNow), { tone: "today", label: "今天截止" });
assert.deepEqual(taskDueInfo({ dueDate: "2026-07-12", progress: 20 }, fixedNow), { tone: "soon", label: "2 天后截止" });
assert.equal(taskDueInfo({ dueDate: "2026-07-10", progress: 100 }, fixedNow), null);

assert.equal(inferTimeProgress({
  startDate: "2026-01-01",
  endDate: "2026-12-31"
}, new Date("2026-07-02T00:00:00.000Z")), 50);
assert.equal(inferTimeProgress({
  extractedFields: { servicePeriod: "2026年1月1日至2026年12月31日" }
}, new Date("2026-07-02T00:00:00.000Z")), 50);

assert.equal(projectHealth({
  progress: 20,
  startDate: "2026-01-01",
  endDate: "2026-12-31"
}, new Date("2026-07-02T00:00:00.000Z")).label, "滞后");
assert.equal(projectHealth({
  progress: 80,
  startDate: "2026-01-01",
  endDate: "2026-12-31"
}, new Date("2026-07-02T00:00:00.000Z")).label, "超前");
assert.equal(projectHealth({
  progress: 51,
  startDate: "2026-01-01",
  endDate: "2026-12-31"
}, new Date("2026-07-02T00:00:00.000Z")).label, "正常");

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const aiSource = await readFile(new URL("../src/AiWorkspace.jsx", import.meta.url), "utf8");
const closeoutSource = await readFile(new URL("../src/CloseoutReview.jsx", import.meta.url), "utf8");

assert(mainSource.includes('from "./utils/projectMetrics.js"'), "main should use shared project metrics");
assert(aiSource.includes('import { projectHealth } from "./utils/projectMetrics.js";'), "AI workspace should use shared project health");
assert(closeoutSource.includes('import { normalizeCostRow } from "./utils/projectMetrics.js";'), "closeout review should use shared cost row normalization");

for (const [name, source] of [["main", mainSource], ["ai", aiSource], ["closeout", closeoutSource]]) {
  assert(!source.includes("function normalizeTask("), `${name} should not redefine normalizeTask`);
  assert(!source.includes("function taskDueInfo("), `${name} should not redefine taskDueInfo`);
  assert(!source.includes("function normalizeCostRow("), `${name} should not redefine normalizeCostRow`);
  assert(!source.includes("function averageProgress("), `${name} should not redefine averageProgress`);
  assert(!source.includes("function inferTimeProgress("), `${name} should not redefine inferTimeProgress`);
  assert(!source.includes("function projectHealth("), `${name} should not redefine projectHealth`);
}

console.log("frontend project metrics regression passed");
