import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const topbarSource = await readFile(new URL("../src/DashboardTopbar.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(mainSource.includes('import DashboardTopbar from "./DashboardTopbar.jsx";'), "project dashboard should import the shared topbar component");
assert(mainSource.includes("<DashboardTopbar") && mainSource.includes("onExportProjectLedger={exportProjectLedger}") && mainSource.includes("onUpdateProjectFilter={updateProjectFilter}"), "project dashboard should wire export and filter handlers into the topbar");
assert(topbarSource.includes("搜索项目、客户、负责人"), "topbar should keep project search input");
assert(topbarSource.includes("导出台账") && topbarSource.includes("待办") && topbarSource.includes("新建项目"), "topbar should keep export, notification, and create-project actions");
assert(topbarSource.includes("成员管理") && topbarSource.includes("AI 已接入") && topbarSource.includes("接入 AI"), "topbar should keep admin actions");
assert(topbarSource.includes("filter-panel") && topbarSource.includes("清空筛选") && topbarSource.includes("项目风险") && topbarSource.includes("材料状态"), "topbar should keep project filter panel");
assert(topbarSource.includes("notice-bar") && topbarSource.includes("知道了"), "topbar should keep dismissible notice bar");

console.log("frontend dashboard topbar entry passed");
