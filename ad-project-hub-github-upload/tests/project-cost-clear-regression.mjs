import assert from "node:assert/strict";
import { clearProjectCosts } from "../server/services.mjs";

const project = {
  id: "p-cost-clear", name: "成本清理项目", contract: 2000000, costUsed: 1500000,
  costs: [["日常支出", 500000], ["人力", 700000]], margin: -10,
  extractedFields: { profit: -200000, costAggregationMode: "snapshot", costSnapshotRepairVersion: "old", profitBreakdown: { totalDeduction: 2200000 } }
};
const db = {
  projects: [project],
  parseJobs: [
    { id: "cost-job", projectId: project.id, kind: "execution-cost", extractedFields: { hasCostSheet: true, profitBreakdown: { totalDeduction: 1500000 } } },
    { id: "contract-job", projectId: project.id, kind: "contract", extractedFields: { contract: 2000000 } }
  ],
  auditLogs: []
};
const result = clearProjectCosts(db, { id: project.id }, { id: "u-admin", name: "管理员", role: "admin" });
assert.equal(result.clearedCost, 1500000);
assert.equal(project.costUsed, 0);
assert.deepEqual(project.costs, []);
assert.equal(project.margin, 100);
assert.equal(project.extractedFields.profit, 2000000);
assert.equal(project.extractedFields.profitBreakdown, undefined);
assert.deepEqual(db.parseJobs.map((item) => item.id), ["contract-job"]);
assert.equal(db.auditLogs[0].action, "clear-all-costs");

console.log("project cost clear regression passed");
