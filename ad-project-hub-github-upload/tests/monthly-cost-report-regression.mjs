import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/ProjectProgressCostPanel.jsx", import.meta.url), "utf8");
const ledgers = await readFile(new URL("../src/utils/ledgerRows.js", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const cockpit = await readFile(new URL("../src/ManagementCockpit.jsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/ManagementCostDashboard.jsx", import.meta.url), "utf8");

assert(api.includes('/api/reports/monthly-project-costs') && api.includes('["shareholder", "admin", "director", "finance"]'), "monthly full-cost API should be management-scoped");
assert(api.includes("fullCost: realtimeCost + labor") && api.includes("managementProfit"), "monthly report should combine realtime cost and labor without rewriting project cost");
assert(detail.includes("memberExecutionCostRows") && detail.includes("我的执行费用.csv"), "member project detail should export monthly execution costs");
assert(panel.includes("导出月报"), "member execution panel should expose monthly export");
assert(ledgers.includes("monthlyProjectCostRows") && ledgers.includes("管理全成本"), "ledger helpers should include full management cost columns");
assert(main.includes("exportMonthlyProjectCosts") && main.includes("导出本月全成本"), "production dashboard should export management monthly full costs");
assert(main.includes('const ManagementCostDashboard = React.lazy') && main.includes('subView === "实时全成本"'), "production cockpit should load the realtime full-cost dashboard");
assert(cockpit.includes("ManagementCostDashboard") && cockpit.includes("实时全成本"), "split cockpit should expose realtime full costs");
assert(dashboard.includes("月度管理总结") && dashboard.includes("导出总表与全部细项") && dashboard.includes("management-cost-detail-row"), "full-cost dashboard should summarize, drill down, and export details");

console.log("monthly cost report regression passed");
