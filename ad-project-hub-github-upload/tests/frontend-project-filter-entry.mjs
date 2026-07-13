import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("const [projectFilters, setProjectFilters]"), "project dashboard should keep real project filter state");
assert(source.includes("projectFilters.risk") && source.includes("projectFilters.status") && source.includes("projectFilters.money") && source.includes("projectFilters.material"), "project filters should cover risk, status, money, and material");
assert(source.includes("const materialStatus = projectMaterialStatus(project, [], [])"), "project material filter should reuse material status helper");
assert(source.includes("有待回款") && source.includes("无待回款") && source.includes("有材料缺口") && source.includes("材料较完整"), "filter panel should expose receivable and material filters");
assert(source.includes("function updateProjectFilter(field, value)") && source.includes("setProjectFilters((current) => ({ ...current, [field]: value }))"), "project filter controls should update filter state");
assert(source.includes("function clearProjectFilters()") && source.includes("已清空搜索和项目筛选。"), "project filters should provide a clear-all action with user feedback");
assert(source.includes("清空搜索和筛选") && source.includes("当前搜索或筛选没有结果。"), "empty project result state should clear search and filters together");
assert(source.includes("filter-group") && source.includes("项目风险") && source.includes("项目状态") && source.includes("资金状态") && source.includes("材料状态"), "filter panel should render grouped project filters");
assert(source.includes("function csvCell(value)") && source.includes("function downloadCsv(filename, rows = [])"), "project ledger export should use safe browser CSV helpers");
assert(source.includes("function projectLedgerRows(projects = [], isManagement = false)") && source.includes("材料状态") && source.includes("项目利润") && source.includes("毛利率"), "project ledger export should build readable rows with management-only financial columns");
assert(source.includes("...(isManagement ? [\"项目利润\", \"毛利率\"] : [])") && source.includes("...(isManagement ? [profit, margin] : [])"), "project ledger export should hide profit and margin from non-management users");
assert(source.includes("const [exportingProjectLedger, setExportingProjectLedger]") && source.includes("function exportProjectLedger()"), "project dashboard should keep export loading state and action");
assert(source.includes("projectLedgerRows(visibleProjects, isManagement)") && source.includes("hasProjectFilters ? \"（按当前筛选）\" : \"\""), "project ledger export should respect the current visible/filter result");
assert(source.includes("当前没有可导出的项目，请先清空筛选或上传合同创建项目。") && source.includes("项目台账 CSV 已导出"), "project ledger export should explain empty and success states");
assert(source.includes("导出台账") && source.includes("<FileSpreadsheet size={16} />"), "topbar should expose a project ledger export button");
assert(styles.includes(".filter-panel label") && styles.includes(".filter-group") && styles.includes(".filter-panel label select"), "project filter panel should have form-control styles");

console.log("frontend project filter entry passed");
