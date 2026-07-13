export const defaultProjectFilters = {
  risk: "全部风险",
  status: "全部状态",
  money: "全部资金",
  material: "全部材料"
};

export function hasActiveProjectFilters(searchText = "", projectFilters = defaultProjectFilters) {
  return Boolean(searchText.trim())
    || Object.values(projectFilters || {}).some((value) => !String(value).startsWith("全部"));
}

export function filterProjects(projects = [], searchText = "", projectFilters = defaultProjectFilters, options = {}) {
  const materialStatus = options.materialStatus || (() => ({ missing: [] }));
  const query = searchText.trim().toLowerCase();
  return projects.filter((project) => {
    const searchMatched = !query || [project.name, project.client, project.owner, project.pm, project.sales, project.status]
      .some((value) => String(value || "").toLowerCase().includes(query));
    const riskMatched = projectFilters.risk === "全部风险" || project.risk === projectFilters.risk;
    const statusMatched = projectFilters.status === "全部状态" || project.status === projectFilters.status;
    const moneyMatched = projectFilters.money === "全部资金"
      || (projectFilters.money === "有待回款" && Number(project.receivable || 0) > 0)
      || (projectFilters.money === "无待回款" && Number(project.receivable || 0) <= 0);
    const material = materialStatus(project, [], []);
    const materialMatched = projectFilters.material === "全部材料"
      || (projectFilters.material === "有材料缺口" && material.missing.length > 0)
      || (projectFilters.material === "材料较完整" && material.missing.length === 0);
    return searchMatched && riskMatched && statusMatched && moneyMatched && materialMatched;
  });
}

export function projectDashboardStats(projects = []) {
  return projects.reduce((stats, item) => ({
    contract: stats.contract + Number(item.contract || 0),
    used: stats.used + Number(item.costUsed || 0),
    paid: stats.paid + Number(item.paid || 0),
    receivable: stats.receivable + Number(item.receivable || 0)
  }), { contract: 0, used: 0, paid: 0, receivable: 0 });
}
