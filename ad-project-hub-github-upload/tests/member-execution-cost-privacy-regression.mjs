import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/ProjectProgressCostPanel.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(api.includes('const executionOnly = ["member", "viewer"].includes(user.role)'), "server should identify execution-only roles");
assert(api.includes("costBudget: 0") && api.includes("costUsed: 0") && api.includes("costs: []"), "server should remove overall project costs for execution roles");
assert(api.includes("!executionOnly || item.applicantId === user.id"), "execution roles should only receive their own approvals");
assert(detail.includes("ownMonthlyReimbursements") && detail.includes('item.applicantId === session.id && item.status === "已完成"'), "split detail should use the member's completed reimbursements");
assert(panel.includes("我的本月执行支出") && panel.includes("不展示项目整体成本和利润"), "split panel should explain the scoped execution view");
assert(panel.includes("${percent}% · ${count} 笔"), "split panel should show category share and count");
assert(main.includes("我的本月执行支出") && main.includes("ownMonthlyReimbursements"), "production fallback should keep the same privacy view");

console.log("member execution cost privacy regression passed");
