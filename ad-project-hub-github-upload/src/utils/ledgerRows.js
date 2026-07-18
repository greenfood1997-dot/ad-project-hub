import { money } from "./format.js";

export function projectLedgerRows(projects = [], isManagement = false, options = {}) {
  const materialStatus = typeof options.materialStatus === "function"
    ? options.materialStatus
    : () => ({ missing: [], doneCount: 0 });
  const headers = [
    "项目名称",
    "客户/品牌",
    "负责人",
    "PM",
    "销售",
    "状态",
    "风险",
    "合同金额",
    "已回款",
    "待回款",
    "成本预算",
    "已用成本",
    "进度",
    "下一节点",
    "回款节点",
    "开始时间",
    "结束时间",
    "材料状态",
    ...(isManagement ? ["项目利润", "毛利率"] : [])
  ];
  const body = projects.map((project) => {
    const materials = materialStatus(project, [], []);
    const missing = Array.isArray(materials.missing) ? materials.missing : [];
    const profit = Number(project.contract || 0) - Number(project.costUsed || 0);
    const margin = project.contract ? `${Math.round((profit / Number(project.contract || 1)) * 100)}%` : "";
    return [
      project.name || "",
      project.client || project.brand || "",
      project.owner || "",
      project.pm || "",
      project.sales || "",
      project.status || "",
      project.risk || "",
      Number(project.contract || 0),
      Number(project.paid || 0),
      Number(project.receivable || 0),
      Number(project.costBudget || 0),
      Number(project.costUsed || 0),
      `${Number(project.progress || 0)}%`,
      project.nextMilestone || "",
      project.paymentDue || "",
      project.startDate || "",
      project.endDate || "",
      missing.length ? `缺：${missing.map((item) => item.label).join("、")}；已完成 ${materials.doneCount || 0}/4` : "关键材料较完整",
      ...(isManagement ? [profit, margin] : [])
    ];
  });
  return [headers, ...body];
}

export function paymentLedgerRows(project = {}, payments = []) {
  const headers = [
    "项目名称",
    "客户/品牌",
    "付款方",
    "回款金额",
    "方式",
    "备注",
    "状态",
    "记录人",
    "到账/记录时间",
    "作废人",
    "作废时间",
    "作废原因"
  ];
  const body = payments.map((payment) => [
    payment.projectName || payment.project || project.name || "",
    project.client || project.brand || payment.client || "",
    payment.payer || payment.client || "",
    Number(payment.amount || 0),
    payment.method || "",
    payment.note || "",
    payment.status || "已记录",
    payment.recordedByName || payment.recordedBy || "",
    payment.receivedAt || payment.createdAt || "",
    payment.voidedByName || "",
    payment.voidedAt || "",
    payment.voidReason || ""
  ]);
  return [headers, ...body];
}

export function approvalLedgerRows(approvals = [], options = {}) {
  const runtimeInfo = typeof options.runtimeInfo === "function" ? options.runtimeInfo : () => ({});
  const headers = [
    "项目名称",
    "审批类型",
    "报销类目",
    "金额",
    "收款人/用途",
    "申请人",
    "状态",
    "当前处理人",
    "SLA",
    "等待小时",
    "说明",
    "提交时间",
    "更新时间",
    "处理日志"
  ];
  const body = approvals.map((approval) => {
    const runtime = runtimeInfo(approval);
    const logs = (approval.logs || []).map((log) => {
      const action = log.action === "reject" ? "驳回" : log.action === "approve" ? "通过" : log.action === "withdraw" ? "撤回" : "提交";
      return `${log.user || "处理人"} ${action}${log.note ? `：${log.note}` : ""}`;
    }).join("；");
    return [
      approval.project || approval.projectName || "",
      approval.typeName || approval.typeLabel || approval.category || approval.type || "",
      approval.expenseCategory || "",
      Number(approval.amount || 0),
      approval.payee || approval.scope || approval.reason || "",
      approval.user || approval.applicantName || "",
      approval.status || "",
      runtime.handler || "",
      runtime.slaText || "",
      Number(approval.waitHours || 0),
      approval.scope || approval.reason || "",
      approval.createdAt || approval.submittedAt || approval.appliedAt || "",
      approval.updatedAt || approval.handledAt || "",
      logs
    ];
  });
  return [headers, ...body];
}

export function reimbursementSummaryRows(approvals = [], projects = [], month = "", options = {}) {
  const runtimeInfo = typeof options.runtimeInfo === "function" ? options.runtimeInfo : () => ({});
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const rows = [["月份", "项目名称", "报销类目", "金额", "申请人", "收款人/用途", "说明", "状态", "当前处理人", "提交时间", "完成时间", "处理日志"]];
  approvals.forEach((approval) => {
    const project = projectById.get(approval.projectId) || {};
    const logs = (approval.logs || []).map((log) => `${log.user || "处理人"} ${log.action || ""}${log.note ? `：${log.note}` : ""}`).join("；");
    rows.push([
      month,
      approval.projectName || approval.project || project.name || "",
      approval.expenseCategory || "其他",
      Number(approval.amount || 0),
      approval.applicantName || approval.user || "",
      approval.payee || "",
      approval.reason || approval.scope || "",
      approval.status || "",
      approval.currentHandlerLabel || runtimeInfo(approval).handler || "",
      approval.createdAt || "",
      approval.completedAt || approval.appliedAt || "",
      logs
    ]);
  });
  return rows;
}

export function assignmentLedgerRows(assignments = []) {
  const headers = [
    "项目名称",
    "客户/品牌",
    "项目状态",
    "部门",
    "PM",
    "销售",
    "执行成员",
    "执行人数",
    "合同金额",
    "已回款",
    "待回款",
    "进度",
    "风险",
    "下一节点",
    "回款节点",
    "开始时间",
    "结束时间"
  ];
  const body = assignments.map((project) => {
    const executionMembers = Array.isArray(project.members) ? project.members.filter(Boolean) : [];
    return [
      project.name || "",
      project.client || project.brand || "",
      project.status || "",
      project.department || "",
      project.pm || "待分派",
      project.sales || "待确认",
      executionMembers.join("、"),
      executionMembers.length,
      Number(project.contract || 0),
      Number(project.paid || 0),
      Number(project.receivable || 0),
      `${Number(project.progress || 0)}%`,
      project.risk || "",
      project.nextMilestone || "",
      project.paymentDue || "",
      project.startDate || "",
      project.endDate || ""
    ];
  });
  return [headers, ...body];
}

export function feishuPendingLedgerRows(items = []) {
  const headers = [
    "文件名",
    "状态",
    "归属项目",
    "上传类型",
    "飞书群",
    "发送人",
    "预览摘要",
    "备注",
    "创建时间",
    "处理人",
    "处理时间"
  ];
  const body = items.map((item) => [
    item.file?.name || item.preview?.fileName || "飞书文件",
    item.status || "",
    item.projectName || "待匹配项目",
    item.uploadType || "file",
    item.chatName || item.chatId || "",
    item.senderName || "",
    item.preview?.summary || "",
    item.note || "",
    item.createdAt || "",
    item.handledBy || "",
    item.handledAt || ""
  ]);
  return [headers, ...body];
}

export function supplierProfileRows(suppliers = []) {
  const headers = [
    "供应商",
    "推荐星级",
    "推荐动作",
    "合作次数",
    "合作项目数",
    "累计金额",
    "已付款次数",
    "内部评分",
    "评分人数",
    "风险等级",
    "风险标签",
    "合作类型",
    "合作项目",
    "推荐原因",
    "选择建议",
    "最近评价",
    "更新时间"
  ];
  const body = suppliers.map((supplier) => {
    const latestRating = (supplier.ratings || [])[0] || {};
    return [
      supplier.supplier || "",
      supplier.star || 1,
      supplier.recommendationAction || "可试用",
      Number(supplier.cooperationCount || 0),
      Number(supplier.projectCount || 0),
      Number(supplier.totalAmount || 0),
      Number(supplier.paidCount || 0),
      supplier.averageRating || "",
      Number(supplier.ratingCount || 0),
      supplier.riskLevel || "低",
      (supplier.riskTags || []).join("、"),
      (supplier.types || []).join("、") || supplier.market || "",
      (supplier.projects || []).join("、"),
      supplier.recommendationReason || "",
      supplier.selectionAdvice || "",
      latestRating.comment || "",
      supplier.updatedAt || latestRating.at || ""
    ];
  });
  return [headers, ...body];
}

export function clientHandoffRows(client = {}) {
  const handoff = client.handoffPackage || {};
  return [
    ["交接字段", "内容"],
    ["客户", client.client || ""],
    ["项目数", `${client.projectCount || 0} 个`],
    ["合同总额", Number(client.totalContract || 0)],
    ["待回款", Number(client.receivable || 0)],
    ["动态记录", `${client.commentCount || 0} 条`],
    ["在执行项目", `${handoff.activeProjectCount || 0} 个`],
    ["最近项目", `${client.latestProject || "待补充"}${client.latestStatus ? `（${client.latestStatus}）` : ""}`],
    ["自动交接摘要", handoff.summary || client.handoffSummary || "待补充"],
    ["接手先做", handoff.firstActions?.join("；") || "先确认项目状态、回款节点和客户雷区"],
    ["重点回款", handoff.receivableProjects?.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") || "暂无待回款"],
    ["最近反馈", handoff.latestFeedback?.join("；") || "暂无可交接反馈"],
    ["客户喜欢", client.likes?.join("；") || "待沉淀"],
    ["客户不喜欢", client.dislikes?.join("；") || "待沉淀"],
    ["雷区", client.pitfalls?.join("；") || "待沉淀"],
    ["沟通风格", client.contactStyle || "待沉淀"],
    ["交接备注", client.handoffNote || client.handoffSummary || "待补充"]
  ];
}

export function closeoutReviewRows({ project = {}, costRows = [], topCost = {}, totalCost = 0, topCostShare = 0, costContractRate = 0, suggestedReserve = 0, costWarning = "", closeoutNote = "", isManagement = false }) {
  const rankingRows = (costRows.length ? costRows : [topCost])
    .filter((row) => row?.name)
    .slice(0, 12)
    .map((row, index) => [
      `支出排行 ${index + 1}`,
      row.name || "",
      Number(row.value || 0),
      totalCost ? `${Math.round((Number(row.value || 0) / totalCost) * 100)}%` : "0%"
    ]);
  return [
    ["复盘字段", "内容", "金额", "备注"],
    ["项目名称", project.name || "", "", ""],
    ["客户", project.client || project.brand || "", "", ""],
    ["项目状态", project.status || "", "", ""],
    ["结案时间", project.closedAt || project.extractedFields?.closedAt || "待确认", "", ""],
    ["合同金额", "", Number(project.contract || 0), ""],
    ["总成本", "", Number(project.costUsed || 0), ""],
    [isManagement ? "项目利润" : "利润信息", isManagement ? "" : "普通成员不可见", isManagement ? Number(project.contract || 0) - Number(project.costUsed || 0) : "", ""],
    [isManagement ? "毛利率" : "资料完整度", isManagement ? `${project.margin || 0}%` : `${Math.min(100, Number(project.progress || 0) + 12)}%`, "", ""],
    ["最大支出", topCost.name || "", Number(topCost.value || 0), `${topCostShare}%`],
    ["成本占合同", `${costContractRate}%`, "", costWarning],
    ["待回款", "", Number(project.receivable || 0), project.receivable > 0 ? "结案后仍需跟进" : "已无待回款"],
    ["下次预算建议", topCost.name || "", Number(suggestedReserve || 0), "按最大支出上浮 15%"],
    ["AI优化建议", costWarning, "", ""],
    ["结案复盘备注", closeoutNote || project.closeoutNote || project.extractedFields?.closeoutNote || "", "", ""],
    ...rankingRows
  ];
}

export function taskLedgerRows(project = {}, tasks = []) {
  const headers = [
    "项目名称",
    "任务名称",
    "负责人",
    "截止时间",
    "进度",
    "状态",
    "备注",
    "更新时间",
    "更新人",
    "是否归档",
    "归档时间",
    "归档人"
  ];
  const body = tasks.map((task) => [
    project.name || "",
    task.title || "",
    task.owner || "",
    task.dueDate || "",
    `${Number(task.progress || 0)}%`,
    task.status || "",
    task.note || "",
    task.updatedAt || "",
    task.updatedByName || task.updatedBy || "",
    task.archivedAt ? "是" : "否",
    task.archivedAt || "",
    task.archivedByName || task.archivedBy || ""
  ]);
  return [headers, ...body];
}

export function activityLedgerRows(project = {}, items = []) {
  const headers = [
    "项目名称",
    "时间",
    "动态类型",
    "内容",
    "关联区域"
  ];
  const body = items.map((item) => [
    project.name || "",
    item.at || "",
    item.title || "",
    item.text || "",
    item.target === "files" ? "文件与 AI 解析" : item.target === "payments" ? "回款/供应商" : item.target === "approvals" ? "审批与成本" : item.target === "progress" ? "执行进度" : "项目动态"
  ]);
  return [headers, ...body];
}

export function collectionLedgerRows(scripts = [], projects = []) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const projectByName = new Map(projects.map((project) => [project.name, project]));
  const headers = ["项目名称", "客户/品牌", "待回款", "销售", "话术风格", "话术内容", "生成原因", "结果", "是否有效", "下次跟进时间", "下一步动作", "创建时间", "更新时间"];
  const body = scripts.map((script) => {
    const project = projectById.get(script.projectId) || projectByName.get(script.projectName || script.project) || {};
    return [
      script.projectName || script.project || project.name || "",
      project.client || project.brand || script.client || "",
      Number(script.amount ?? project.receivable ?? 0),
      script.salesName || script.sales || "",
      script.tone || script.style || "",
      script.script || "",
      script.reason || "",
      script.outcome || "",
      typeof script.success === "boolean" ? (script.success ? "是" : "否") : "待记录",
      script.nextFollowUpAt || "",
      script.nextAction || "",
      script.createdAt || "",
      script.updatedAt || script.handledAt || ""
    ];
  });
  return [headers, ...body];
}

export function managementLedgerRows(metrics = {}, stats = {}, projects = []) {
  return [
    ["经营字段", "内容", "金额/数值", "说明"],
    ["经营建议", metrics.recommendation || "", "", ""],
    ["合同总额", "", Number(stats.contract || 0), ""],
    ["已回款", "", Number(stats.paid || 0), ""],
    ["待回款", "", Number(stats.receivable || 0), `待回款占合同 ${metrics.receivableRate || 0}%`],
    ["总支出", "", Number(metrics.spending || 0), ""],
    ["项目利润", "", Number(metrics.profit || 0), ""],
    ["综合毛利率", "", `${metrics.margin || 0}%`, ""],
    ["进行中项目", "", metrics.activeProjects?.length || 0, ""],
    ["已完成项目", "", metrics.completedProjects?.length || 0, ""],
    ["当前公司现金", "", Number(metrics.runway?.currentCash || 0), ""],
    ["月固定支出", "", Number(metrics.runway?.monthlyFixedCost || 0), "人力 + 租金 + 贷款 + 利息 + 其他"],
    ["6个月安全线", "", Number(metrics.runway?.safetyReserve || 0), ""],
    ["现金可撑", "", metrics.runway?.monthlyFixedCost ? `${Number(metrics.runway.runwayMonths || 0).toFixed(1)}个月` : "待设置", metrics.runway?.runwayLabel || ""],
    ["6个月缺口", "", Number(metrics.runway?.gap || 0), ""],
    ["现金压力总暴露", "", Number(metrics.cashPressureAmount || 0), ""],
    ["待备用金", "", Number(metrics.pendingPettyCash || 0), ""],
    ["待报销", "", Number(metrics.pendingReimbursements || 0), ""],
    ["待供应商付款", "", Number(metrics.pendingSupplierPay || 0), ""],
    ["待处理审批", "", metrics.pendingApprovals?.length || 0, ""],
    ...((metrics.advisorActions || []).map((action, index) => [`AI建议 ${index + 1}`, action, "", ""])),
    ...((metrics.highRiskProjects || projects || []).slice(0, 8).map((project, index) => [
      `优先项目 ${index + 1}`,
      project.name || "",
      Number(project.receivable || 0),
      `风险 ${project.risk || "待判断"}；成本占合同 ${project.costRate ?? ""}%；毛利率 ${project.projectMargin ?? ""}%；动作 ${project.actionLabel || ""} ${project.actionReason || ""}`
    ]))
  ];
}
