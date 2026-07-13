function financeNumber(source = {}, key) {
  return Number(source[key] || 0);
}

export function operatingSettings(settings = {}) {
  const company = settings.companyFinance || settings.product?.companyFinance || {};
  const monthlyFixedCost =
    financeNumber(company, "monthlyLaborCost") +
    financeNumber(company, "monthlyRent") +
    financeNumber(company, "monthlyLoan") +
    financeNumber(company, "monthlyInterest") +
    financeNumber(company, "monthlyOtherCost");
  const currentCash = financeNumber(company, "currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置"
    : runwayMonths >= 6
      ? "安全"
      : runwayMonths >= 3
        ? "谨慎"
        : "危险！你快倒闭啦！需要收缩现金流";
  return { ...company, currentCash, monthlyFixedCost, safetyReserve, runwayMonths, gap, runwayLabel };
}

export function calculateRunway(values = {}) {
  const monthlyFixedCost =
    financeNumber(values, "monthlyLaborCost") +
    financeNumber(values, "monthlyRent") +
    financeNumber(values, "monthlyLoan") +
    financeNumber(values, "monthlyInterest") +
    financeNumber(values, "monthlyOtherCost");
  const currentCash = financeNumber(values, "currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置"
    : runwayMonths >= 6
      ? "安全"
      : runwayMonths >= 3
        ? "谨慎"
        : "危险！你快倒闭啦！需要收缩现金流";
  return { currentCash, monthlyFixedCost, safetyReserve, runwayMonths, gap, runwayLabel };
}

export function operatingMetrics(projects = [], approvals = [], stats = {}, settings = {}, options = {}) {
  const formatMoney = typeof options.formatMoney === "function" ? options.formatMoney : (value) => String(Number(value || 0));
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const completedProjects = projects.filter((project) => project.status === "已完成");
  const spending = projects.reduce((sum, project) => sum + Number(project.costUsed || 0), 0);
  const profit = projects.reduce((sum, project) => sum + (Number(project.contract || 0) - Number(project.costUsed || 0)), 0);
  const margin = stats.contract ? Math.round((profit / stats.contract) * 100) : 0;
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  const pendingPettyCash = pendingApprovals.filter((item) => item.type === "petty_cash").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingReimbursements = pendingApprovals.filter((item) => item.type === "reimbursement").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingSupplierPay = approvals
    .filter((item) => item.type === "supplier_payment" && item.status !== "已完成" && item.status !== "已驳回")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashPressureAmount = Number(stats.receivable || 0) + pendingPettyCash + pendingReimbursements + pendingSupplierPay;
  const receivableRate = stats.contract ? Math.round((Number(stats.receivable || 0) / stats.contract) * 100) : 0;
  const runway = operatingSettings(settings);
  const runwayPenalty = runway.monthlyFixedCost && runway.runwayMonths < 3 ? 30 : runway.monthlyFixedCost && runway.runwayMonths < 6 ? 14 : 0;
  const pressureScore = receivableRate + (pendingApprovals.length * 4) + (margin < 25 ? 20 : 0) + runwayPenalty;
  const pressureLevel = pressureScore >= 70 ? "高" : pressureScore >= 38 ? "中" : "低";
  const highRiskProjects = projects
    .map((project) => {
      const costRate = project.contract ? Math.round((Number(project.costUsed || 0) / Number(project.contract || 1)) * 100) : 0;
      const receivableProjectRate = project.contract ? Math.round((Number(project.receivable || 0) / Number(project.contract || 1)) * 100) : 0;
      const projectMargin = project.contract ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100) : 0;
      const score = (project.risk === "高" ? 35 : project.risk === "中" ? 18 : 0) + costRate + receivableProjectRate + (projectMargin < 25 ? 24 : 0);
      const actionTarget = Number(project.receivable || 0) > 0
        ? "payments"
        : costRate >= 70 || projectMargin < 25
          ? "costs"
          : "progress";
      const actionLabel = actionTarget === "payments" ? "跟进回款" : actionTarget === "costs" ? "看成本" : "看进度";
      const actionReason = actionTarget === "payments"
        ? `待回款占比 ${receivableProjectRate}%`
        : actionTarget === "costs"
          ? `成本占合同 ${costRate}% / 毛利率 ${projectMargin}%`
          : `风险等级 ${project.risk || "待判断"}`;
      return { ...project, costRate, receivableProjectRate, projectMargin, score, actionTarget, actionLabel, actionReason };
    })
    .sort((a, b) => b.score - a.score);
  const topRisk = highRiskProjects[0];
  const recommendation = runway.runwayLabel.includes("危险")
    ? "危险！你快倒闭啦！需要收缩现金流"
    : pressureLevel === "高"
      ? "控制现金流，优先催收和暂停低毛利新增支出"
      : pressureLevel === "中"
        ? "稳健推进，控制审批节奏并盯紧回款节点"
        : "可适度拓展，优先复制高毛利和回款快的项目类型";
  const advisorActions = [
    stats.receivable > 0 ? `优先催收待回款最高的项目：${[...highRiskProjects].sort((a, b) => b.receivable - a.receivable)[0]?.name || "暂无"}` : "当前回款压力较低，保持合同归档和核销节奏",
    pendingApprovals.length ? `先处理 ${pendingApprovals.length} 条待审批，避免备用金/报销堆积` : "审批队列清爽，可以把精力放到项目交付和回款",
    runway.monthlyFixedCost ? `现金可撑 ${runway.runwayMonths.toFixed(1)} 个月，6个月安全线缺口 ${formatMoney(runway.gap)}` : "请先填写公司现金和月固定支出，才能计算6个月安全线",
    margin < 25 ? "毛利率偏低，新增项目报价要提高执行预算安全线" : "毛利率暂时健康，可复盘高毛利项目打法",
  ];
  return { activeProjects, completedProjects, spending, profit, margin, pendingApprovals, pendingPettyCash, pendingReimbursements, pendingSupplierPay, cashPressureAmount, receivableRate, pressureScore, pressureLevel, highRiskProjects, topRisk, recommendation, advisorActions, runway };
}
