import assert from "node:assert/strict";
import { compensationOverview, generateLaborAllocation, saveCompensationMember, saveProjectDividend } from "../server/compensation-service.mjs";

const shareholder = { id: "u-owner", name: "股东A", role: "shareholder", status: "active" };
const director = { id: "u-director", name: "编导A", role: "member", status: "active" };
const projects = [
  { id: "p-1", name: "项目甲", contract: 100000, costUsed: 40000, owner: "股东A", pm: "编导A", status: "执行中" },
  { id: "p-2", name: "项目乙", contract: 200000, costUsed: 80000, owner: "股东A", members: ["编导A"], status: "执行中" }
];
const db = { users: [shareholder, director], projects, settings: {}, auditLogs: [] };
const actor = { id: "u-owner", name: "股东A", role: "shareholder" };

saveCompensationMember(db, { userId: director.id, monthlyCost: 13000, projectRate: 100 }, actor);
saveCompensationMember(db, { userId: shareholder.id, monthlyCost: 30000, projectRate: 60 }, actor);
const rows = generateLaborAllocation(db, { month: "2026-07" }, actor);
assert.equal(rows.find((item) => item.userId === director.id && item.projectId === "p-1").amount, 6500);
assert.equal(rows.find((item) => item.userId === director.id && item.projectId === "p-2").amount, 6500);
assert.equal(rows.find((item) => item.userId === shareholder.id && item.projectId === "p-1").amount, 9000);
assert.equal(rows.find((item) => item.userId === shareholder.id && item.projectId === "p-2").amount, 9000);
assert.equal(rows.find((item) => item.userId === shareholder.id && item.projectId === "company-overhead").amount, 12000);

saveProjectDividend(db, { projectId: "p-1", year: 2026, distributionRate: 60, status: "confirmed", shareholders: [{ userId: shareholder.id, name: shareholder.name, weight: 100 }] }, actor);
const overview = compensationOverview(db, 2026);
assert.equal(overview.dividends[0].profit, 60000);
assert.equal(overview.dividends[0].distributable, 36000);
assert.equal(overview.dividends[0].retained, 24000);
assert.equal(overview.shareholderTotals[0].confirmed, 36000);

assert.throws(() => saveProjectDividend(db, { projectId: "p-1", year: 2026, distributionRate: 60, shareholders: [{ userId: "a", weight: 70 }, { userId: "b", weight: 40 }] }, actor), /不能超过/);

console.log("compensation and dividend regression passed");
