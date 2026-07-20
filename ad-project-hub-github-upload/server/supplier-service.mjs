import { money } from "./service-utils.mjs";

export function supplierCsv(db) {
  const header = "供应商,归属项目,费用类型,应结金额,状态,付款时间,付款备注\n";
  const rows = db.suppliers.map((item) => [item.supplier, item.project, item.type, item.amount, item.status, item.paidAt || "", item.paymentNote || ""]
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  return header + rows.join("\n");
}

function supplierProfileFor(db, supplierName) {
  db.supplierProfiles = db.supplierProfiles || [];
  const name = String(supplierName || "").trim();
  let profile = db.supplierProfiles.find((item) => item.supplier === name);
  if (!profile) {
    profile = { supplier: name, market: "", contact: "", note: "", ratings: [], updatedAt: new Date().toISOString() };
    db.supplierProfiles.unshift(profile);
  }
  profile.ratings = Array.isArray(profile.ratings) ? profile.ratings : [];
  return profile;
}

function supplierRiskInsights({ profile = {}, rows = [], projects = [], totalAmount = 0, paidCount = 0, averageRating = 0, ratings = [] }) {
  const comments = ratings.map((item) => `${item.comment || ""} ${item.project || ""}`).join(" ");
  const pendingRows = rows.filter((item) => !/已付|已结|审批已驳回|审批已撤回/.test(String(item.status || "")));
  const pendingAmount = pendingRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const signals = [];
  const addSignal = (tag, level = "medium", advice = "") => {
    if (!signals.some((item) => item.tag === tag)) signals.push({ tag, level, advice });
  };

  if (/发票慢|开票慢|票慢|结算慢|回票慢|发票/.test(comments)) {
    addSignal("发票/结算偏慢", "medium", "下次合作前先约定开票节点、资料格式和最晚提交时间。");
  }
  if (/需比价|比价|报价偏高|价格高|贵|溢价/.test(comments)) {
    addSignal("报价需比价", "medium", "同类项目建议至少找 2 家备选报价，再决定是否继续使用。");
  }
  if (/临时追加|追加费用|加钱|超预算|预算偏高/.test(comments)) {
    addSignal("易追加费用", "high", "报价阶段要求拆清服务项和追加边界，避免执行中被动加钱。");
  }
  if (/返工|质量|不稳定|客户不满意|差评|翻车/.test(comments)) {
    addSignal("质量需复核", "high", "重要交付建议设置样稿/小样确认，不要一次性放量。");
  }
  if (/交付慢|逾期|延期|拖延|排期不稳/.test(comments)) {
    addSignal("交付时效风险", "high", "时间紧的项目谨慎使用，必须写清交付节点和延期责任。");
  }
  if (averageRating > 0 && averageRating < 3.5) {
    addSignal("内部评分偏低", "high", `当前内部评分 ${averageRating}/5，复用前建议先看历史评价。`);
  }
  if (pendingAmount > 0 && totalAmount > 0 && pendingAmount / totalAmount >= 0.5) {
    addSignal("待结算占比高", "medium", `待结算 ${money(pendingAmount)}，继续合作前先确认付款/发票状态。`);
  } else if (pendingAmount > 0) {
    addSignal("存在待结算", "low", `还有 ${money(pendingAmount)} 待结算，合作前同步财务状态。`);
  }
  if (rows.length <= 1 && totalAmount >= 50000) {
    addSignal("大额首合作", "medium", "合作记录较少但金额较大，建议先拆阶段验收或保留备选供应商。");
  }
  if (rows.length >= 3 && paidCount === 0) {
    addSignal("暂无已付款闭环", "medium", "已有多次结算记录但缺少已付款闭环，建议财务确认真实结算状态。");
  }

  const hasHigh = signals.some((item) => item.level === "high");
  const hasMedium = signals.some((item) => item.level === "medium");
  const riskLevel = hasHigh ? "高" : hasMedium ? "中" : signals.length ? "低" : "低";
  const riskTags = signals.map((item) => item.tag);
  const positiveEvidence = [];
  if (rows.length >= 3) positiveEvidence.push(`合作 ${rows.length} 次`);
  if (projects.length >= 2) positiveEvidence.push(`覆盖 ${projects.length} 个项目`);
  if (averageRating >= 4.5) positiveEvidence.push(`内部评分 ${averageRating}/5`);
  if (paidCount > 0) positiveEvidence.push(`${paidCount} 次已付款闭环`);

  let recommendationAction = "可试用";
  if (hasHigh) recommendationAction = "谨慎使用";
  else if (riskTags.includes("报价需比价") || riskTags.includes("待结算占比高") || riskTags.includes("大额首合作")) recommendationAction = "先比价";
  else if (rows.length >= 3 && averageRating >= 4 && !hasMedium) recommendationAction = "优先推荐";
  else if (rows.length >= 2 && averageRating >= 4) recommendationAction = "可优先考虑";

  const selectionAdvice = hasHigh
    ? signals.find((item) => item.level === "high")?.advice || "该供应商存在高风险信号，建议先复盘历史项目再决定。"
    : riskTags.length
      ? signals[0]?.advice || "该供应商可用，但下次合作建议补充约束条件。"
      : positiveEvidence.length
        ? `暂无明显风险，${positiveEvidence.join("，")}，可作为同类型项目备选。`
        : "暂无足够历史数据，建议从小额或低风险项目开始合作并补充评分。";

  return {
    riskLevel,
    riskTags,
    riskSignals: signals,
    recommendationAction,
    selectionAdvice,
    pendingAmount
  };
}

export function supplierLibrary(db) {
  const profiles = new Map((db.supplierProfiles || []).map((item) => [item.supplier, { ...item, ratings: Array.isArray(item.ratings) ? item.ratings : [] }]));
  for (const row of db.suppliers || []) {
    const name = String(row.supplier || "未命名供应商").trim();
    if (!profiles.has(name)) profiles.set(name, { supplier: name, market: "", contact: "", note: "", ratings: [], updatedAt: "" });
  }
  return Array.from(profiles.values()).map((profile) => {
    const rows = (db.suppliers || []).filter((item) => String(item.supplier || "").trim() === profile.supplier);
    const projects = Array.from(new Set(rows.map((item) => item.project).filter(Boolean)));
    const types = Array.from(new Set(rows.map((item) => item.type).filter(Boolean)));
    const totalAmount = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const paidCount = rows.filter((item) => /已付|已结/.test(String(item.status || ""))).length;
    const ratings = profile.ratings || [];
    const averageRating = ratings.length
      ? Number((ratings.reduce((sum, item) => sum + Number(item.score || 0), 0) / ratings.length).toFixed(1))
      : 0;
    const reuseScore = Math.min(5, projects.length + Math.floor(rows.length / 3));
    const ratingScore = averageRating || 3;
    const star = Math.max(1, Math.min(5, Math.round((reuseScore + ratingScore) / 2)));
    const insights = supplierRiskInsights({ profile, rows, projects, totalAmount, paidCount, averageRating, ratings });
    return {
      ...profile,
      cooperationCount: rows.length,
      projectCount: projects.length,
      projects,
      types,
      totalAmount,
      paidCount,
      pendingAmount: insights.pendingAmount,
      averageRating,
      ratingCount: ratings.length,
      star,
      riskLevel: insights.riskLevel,
      riskTags: insights.riskTags,
      riskSignals: insights.riskSignals,
      recommendationAction: insights.recommendationAction,
      selectionAdvice: insights.selectionAdvice,
      recommendationReason: rows.length
        ? `合作 ${rows.length} 次，覆盖 ${projects.length} 个项目，累计金额 ${Math.round(totalAmount)}，内部评分 ${averageRating || "待评分"}。`
        : "暂无项目结算记录，建议合作后补充评分。"
    };
  }).sort((a, b) => b.star - a.star || b.cooperationCount - a.cooperationCount || b.totalAmount - a.totalAmount);
}

export function deleteMistakenSupplier(db, body, user) {
  const supplierName = String(body.supplier || "").trim();
  if (!supplierName) throw new Error("请选择要删除的供应商");
  const rows = (db.suppliers || []).filter((item) => String(item.supplier || "").trim() === supplierName);
  const paidRows = rows.filter((item) => /已付|已结/.test(String(item.status || "")) || item.paidAt);
  const completedApproval = (db.approvals || []).some((item) => item.type === "supplier_payment" && item.payee === supplierName && item.status === "已完成");
  const forced = body.forceMistake === true && String(body.confirmSupplierName || "").trim() === supplierName;
  if ((paidRows.length || completedApproval) && !forced) throw new Error(`“${supplierName}”已有真实付款或已完成审批；如确认属于历史误识别，请输入完整名称后强制清理`);

  let rolledBack = 0;
  for (const row of rows) {
    if (!row.costAppliedAt) continue;
    const project = (db.projects || []).find((item) => item.id === row.projectId || item.name === row.project);
    if (!project) continue;
    const amount = Number(row.amount || 0);
    project.costs = (project.costs || []).filter((item) => !(item?.source === "supplier-settlement" && item?.settlementId === row.id));
    project.costUsed = Math.max(0, Number(project.costUsed || 0) - amount);
    project.margin = Number(project.contract || 0) ? Math.round(((Number(project.contract || 0) - project.costUsed) / Number(project.contract || 1)) * 100) : 0;
    rolledBack += amount;
  }
  db.suppliers = (db.suppliers || []).filter((item) => String(item.supplier || "").trim() !== supplierName);
  db.supplierProfiles = (db.supplierProfiles || []).filter((item) => String(item.supplier || "").trim() !== supplierName);
  const at = new Date().toISOString();
  const snapshot = rows.map((item) => ({ id: item.id || "", project: item.project || "", projectId: item.projectId || "", amount: Number(item.amount || 0), status: item.status || "", paidAt: item.paidAt || "" }));
  db.auditLogs.unshift({ type: "supplier", target: supplierName, action: forced ? "force-delete-mistaken-supplier" : "delete-mistaken-supplier", user: user.name, meta: { rows: rows.length, rolledBack, completedApproval, snapshot }, at });
  return { supplier: supplierName, deletedRows: rows.length, rolledBack, forced, needsCostReview: rows.some((item) => !item.costAppliedAt) };
}


export function rateSupplier(db, body, user) {
  const supplierName = String(body.supplier || "").trim();
  if (!supplierName) throw new Error("请填写供应商名称");
  const score = Number(body.score || 0);
  if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error("评分需要在 1-5 之间");
  const at = new Date().toISOString();
  const profile = supplierProfileFor(db, supplierName);
  profile.market = String(body.market || profile.market || "").trim();
  profile.contact = String(body.contact || profile.contact || "").trim();
  profile.note = String(body.note || profile.note || "").trim();
  profile.ratings.unshift({
    score,
    project: String(body.project || "").trim(),
    comment: String(body.comment || "").trim(),
    user: user.name,
    userId: user.id,
    at
  });
  profile.updatedAt = at;
  db.auditLogs.unshift({
    type: "supplier",
    target: supplierName,
    action: "rate",
    user: user.name,
    meta: { score, project: body.project || "" },
    at
  });
  return supplierLibrary(db).find((item) => item.supplier === supplierName);
}
