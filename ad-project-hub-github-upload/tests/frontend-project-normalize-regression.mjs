import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeProject } from "../src/utils/projectNormalize.js";

const normalized = normalizeProject({
  name: "捷途汽车项目",
  client: "捷途汽车",
  owner: "唐初",
  contract: "1870700",
  paid: "800000",
  cost_budget: "900000",
  cost_used: "130000",
  ai_summary: "合同已识别",
  files: [{ name: "合同.pdf" }],
  extractedFields: {
    brand: "捷途",
    sales: "销售A",
    pm: "PM A",
    pettyCashBudget: "30000",
    pettyCashUsed: "9000"
  },
  next_milestone: "中期交付",
  payment_due: "月底尾款"
});

assert.equal(normalized.contract, 1870700);
assert.equal(normalized.paid, 800000);
assert.equal(normalized.receivable, 1070700);
assert.equal(normalized.costBudget, 900000);
assert.equal(normalized.costUsed, 130000);
assert.equal(normalized.brand, "捷途");
assert.equal(normalized.sales, "销售A");
assert.equal(normalized.pm, "PM A");
assert.equal(normalized.aiSummary, "合同已识别");
assert.equal(normalized.pettyCashBudget, 30000);
assert.equal(normalized.pettyCashUsed, 9000);
assert.equal(normalized.nextMilestone, "中期交付");
assert.equal(normalized.paymentDue, "月底尾款");
assert.equal(normalized.tasks.length, 3);
assert.equal(normalized.tasks[0].title, "资料归档");
assert.equal(normalized.tasks[0].progress, 100);
assert.deepEqual(normalized.costs[0], ["待归集成本", 130000]);

const empty = normalizeProject({ contract: 1000, paid: 400, costUsed: 100 });
assert.equal(empty.receivable, 600);
assert.equal(empty.sales, "待确认");
assert.equal(empty.pm, "待分派");
assert.equal(empty.pettyCashBudget, 20000);
assert.equal(empty.pettyCashUsed, 12);
assert.equal(empty.paymentDue, "待确认回款节点");

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
assert(mainSource.includes('import { normalizeProject } from "./utils/projectNormalize.js";'), "main should import shared project normalizer");
assert(!mainSource.includes("function normalizeProject("), "main should not redefine normalizeProject");

console.log("frontend project normalize regression passed");
