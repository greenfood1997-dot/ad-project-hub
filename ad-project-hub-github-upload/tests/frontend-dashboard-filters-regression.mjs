import assert from "node:assert/strict";
import {
  defaultProjectFilters,
  filterProjects,
  hasActiveProjectFilters,
  projectDashboardStats
} from "../src/utils/dashboardFilters.js";

const projects = [
  { name: "捷途汽车", client: "捷途", owner: "唐初", pm: "唐初", sales: "销售A", status: "执行中", risk: "高", contract: 1000, costUsed: 200, paid: 300, receivable: 700 },
  { name: "咖啡新品", client: "咖啡品牌", owner: "小林", pm: "小林", sales: "销售B", status: "已完成", risk: "低", contract: 500, costUsed: 100, paid: 500, receivable: 0 }
];

const materialStatus = (project) => project.name === "捷途汽车"
  ? { missing: [{ label: "核销表" }] }
  : { missing: [] };

assert.equal(hasActiveProjectFilters("", defaultProjectFilters), false);
assert.equal(hasActiveProjectFilters("捷途", defaultProjectFilters), true);
assert.equal(hasActiveProjectFilters("", { ...defaultProjectFilters, money: "有待回款" }), true);

assert.deepEqual(
  filterProjects(projects, "捷途", defaultProjectFilters, { materialStatus }).map((project) => project.name),
  ["捷途汽车"]
);
assert.deepEqual(
  filterProjects(projects, "", { ...defaultProjectFilters, risk: "低", money: "无待回款", material: "材料较完整" }, { materialStatus }).map((project) => project.name),
  ["咖啡新品"]
);
assert.deepEqual(projectDashboardStats(projects), { contract: 1500, used: 300, paid: 800, receivable: 700 });

console.log("frontend dashboard filters regression passed");
