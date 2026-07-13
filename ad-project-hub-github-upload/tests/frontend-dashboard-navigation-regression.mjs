import assert from "node:assert/strict";
import { dashboardNavGroups } from "../src/utils/dashboardNavigation.js";

const baseGroups = dashboardNavGroups();
assert.deepEqual(baseGroups.map((item) => item.label), ["项目工作台", "AI 助手", "审批与备用金", "成本复盘", "供应商库", "客户偏好"]);
assert.deepEqual(baseGroups[0].children.map((item) => item[1]), ["项目大盘", "我的项目"]);
assert.equal(baseGroups.some((item) => item.label === "催收助手"), false);
assert.equal(baseGroups.some((item) => item.label === "经营舱"), false);

const salesGroups = dashboardNavGroups({ canUseCollection: true });
assert.equal(salesGroups.some((item) => item.label === "催收助手"), true);
assert.equal(salesGroups.some((item) => item.label === "经营舱"), false);

const managementGroups = dashboardNavGroups({ canUseCollection: true, isManagement: true });
assert.equal(managementGroups.some((item) => item.label === "催收助手"), true);
const management = managementGroups.find((item) => item.label === "经营舱");
assert.deepEqual(management.children.map((item) => item[1]), ["公司大盘", "现金流压力", "AI 商业顾问"]);

console.log("frontend dashboard navigation regression passed");
