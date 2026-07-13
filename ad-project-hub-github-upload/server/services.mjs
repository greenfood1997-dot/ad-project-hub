import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { recognizeFileWithTencentOcr, recognizeFileWithTencentOcrDetailed, tencentOcrConfigured } from "./tencent-ocr.mjs";
import { rootDir } from "./config.mjs";

export async function createProject(db, values, files, user) {
  if (!values?.["项目名称"] && !files.length) throw new Error("请填写项目名称或先上传合同/执行表");
  const now = new Date().toISOString();
  if (files.length) {
    const parsedForRouting = await analyzeProjectFiles(db.settings?.aiService, values || {}, files || [], db.settings?.interestRate);
    const hasContractInBatch = hasContractLikeFile(files, parsedForRouting);
    if (parsedForRouting.hasCostSheet && !hasContractInBatch) {
      const targetProject = findMatchingProjectForCostSheet(db, parsedForRouting, files);
      if (targetProject) {
        const parseJob = createParseJob(targetProject, files, parsedForRouting, values);
        db.parseJobs.unshift(parseJob);
        applyParsedFields(db, targetProject, parseJob, parsedForRouting);
        targetProject.files = [...(targetProject.files || []), ...files];
        db.auditLogs.unshift({ type: "project", target: targetProject.name, action: "cost-sheet-merge", user: user.name, at: now });
        return { project: targetProject, parseJob, merged: true };
      }
      throw new Error("这是成本/利润测算表，但未匹配到已有合同项目。请先上传合同，或在表内补充完整项目名称/客户名称。");
    }
  }
  const contract = parseMoney(values["合同金额"]);
  assertUniqueProject(db, values, files, contract);
  const project = {
    id: `P-${Date.now()}`,
    name: values["项目名称"] || `待解析合同-${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    client: values["客户 / 品牌"] || "",
    owner: values["负责人"] || user.name,
    contract,
    costBudget: contract * parsePercent(values["执行预算占比"] || values["合同成本率"] || ""),
    costUsed: 0,
    paid: 0,
    receivable: contract,
    status: files.length ? "AI解析中" : "草稿",
    risk: "低",
    aiSummary: files.length ? "合同/执行表已进入 AI 解析队列，可在项目详情查看解析进度。" : "",
    nextMilestone: "",
    paymentDue: "",
    margin: 0,
    tasks: [],
    costs: [],
    extractedFields: { executionBudgetRatio: values["执行预算占比"] || values["合同成本率"] || "" },
    createdAt: now,
    createdBy: user.id,
    files
  };
  project.alerts = projectRiskAlerts(project);
  const parseJob = createParseJob(project, files, {}, values);
  db.projects.unshift(project);
  db.parseJobs.unshift(parseJob);
  db.auditLogs.unshift({ type: "project", target: project.name, action: "create", user: user.name, at: now });

  if (files.length) {
    try {
      await analyzeAndApplyProjectFiles(db, project, parseJob);
      await applyInitialQuoteSheets(db, project, parseJob.files || project.files || files, user, now);
      assertUniqueProject(db, projectToValues(project), project.files || files, project.contract, project.id);
    } catch (error) {
      removeCreatedProject(db, project.id, parseJob.id);
      throw error;
    }
  }

  return { project, parseJob };
}

export async function previewProjectUpload(db, body, user) {
  const type = body?.type || "create-project";
  const now = new Date().toISOString();
  const targetProject = body?.id
    ? (db.projects || []).find((item) => item.id === body.id)
    : null;
  if (type !== "create-project" && !targetProject) throw new Error("项目不存在");

  const category = type === "cost-sheet"
    ? "execution-cost"
    : type === "quote-sheet"
      ? "quote-sheet"
      : type === "verification-sheet"
        ? "verification-sheet"
        : "project";
  const files = await normalizeUploadedFiles(body.files || [], category, user, now, db.settings?.storage || {});
  if (!files.length && type !== "create-project") throw new Error("请先选择要上传的文件");

  const values = body.values || {};
  const warnings = [];
  let parsed = {};
  let preview = {
    type,
    targetProject: targetProject ? {
      id: targetProject.id,
      name: targetProject.name,
      client: targetProject.client || "",
      owner: targetProject.owner || "",
      contract: Number(targetProject.contract || 0)
    } : null,
    files: files.map(fileReference),
    fields: {},
    sections: [],
    warnings,
    canConfirm: true,
    previewedAt: now
  };

  if (type === "quote-sheet") {
    const rules = extractQuoteRules(files);
    if (!rules.length) warnings.push("未识别到报价核销规则，请检查是否包含服务内容、数量、单位、单价、小计等字段。");
    preview.sections.push({
      title: "报价规则",
      rows: rules.slice(0, 12).map((rule) => ({
        name: rule.serviceName,
        quantity: rule.quantity,
        unit: rule.unit,
        unitPrice: rule.unitPrice,
        amount: rule.amount,
        status: "待确认"
      })),
      total: rules.reduce((sum, rule) => sum + Number(rule.amount || 0), 0)
    });
    preview.summary = rules.length ? `识别到 ${rules.length} 条报价规则，确认后会写入项目报价规则库。` : "报价规则识别不足，建议调整表格后再上传。";
    preview.canConfirm = rules.length > 0;
    return preview;
  }

  if (type === "verification-sheet") {
    const revenue = targetProject.extractedFields?.revenueRecognition || {};
    const quoteRules = Array.isArray(revenue.quoteRules) ? revenue.quoteRules : [];
    if (!quoteRules.length) {
      warnings.push("当前项目还没有报价规则库，请先上传合同报价表。");
      preview.canConfirm = false;
      preview.summary = "缺少报价规则，暂不能确认核销入库。";
      return preview;
    }
    const verificationItems = extractVerificationItems(files);
    const verificationSummary = verificationItems.summary || {};
    const matchedItems = matchVerificationItems(verificationItems, quoteRules, {
      recognizedRevenue: Number(revenue.recognizedRevenue || 0),
      contract: Number(targetProject.contract || 0),
      records: revenue.verificationRecords || []
    });
    const recognizedRevenue = verificationSummary.totalAmount || matchedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (!verificationItems.length && !verificationSummary.totalAmount) {
      warnings.push("未识别到核销条数或核销金额，请检查核销表是否包含服务项、数量、月份等字段。");
      preview.canConfirm = false;
    }
    preview.fields = {
      "核销月份": inferVerificationMonth(files) || monthKey(new Date(now)),
      "确认收入": recognizedRevenue,
      "匹配状态": matchedItems.some((item) => item.status !== "自动通过") ? "待复核" : "自动通过"
    };
    preview.sections.push({
      title: "核销明细",
      rows: matchedItems.slice(0, 12).map((item) => ({
        name: item.serviceName,
        quantity: item.quantity,
        amount: item.amount,
        matched: item.matchedServiceName || "未匹配",
        status: item.status
      })),
      total: recognizedRevenue
    });
    if (verificationSummary.breakdown?.length) {
      preview.sections.push({
        title: "核销汇总",
        rows: verificationSummary.breakdown.map((item) => ({
          name: item.type,
          amount: item.amount,
          status: "汇总项"
        })),
        total: verificationSummary.totalAmount
      });
    }
    preview.summary = `预计确认收入 ${recognizedRevenue}，确认后会生成一条月度核销记录。`;
    return preview;
  }

  try {
    const sourceValues = type === "cost-sheet"
      ? { ...projectToValues(targetProject), "文件类型": "月度执行成本表", "上传人": user.name }
      : values;
    parsed = files.length ? await analyzeProjectFiles(db.settings?.aiService, sourceValues, files, db.settings?.interestRate) : {};
  } catch (error) {
    warnings.push(`AI 解析未完成：${error.message}`);
    parsed = {};
  }

  if (type === "cost-sheet") {
    const contract = Number(targetProject.contract || 0) || parseMoney(parsed.contract);
    const profitBreakdown = calculateProfitBreakdown(contract, { ...parsed, hasCostSheet: true }, db.settings?.interestRate);
    const reimbursementItems = extractReimbursementItems(files);
    const reimbursementTotal = reimbursementItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    preview.fields = {
      "项目名称": targetProject.name,
      "执行预算": profitBreakdown.executionBudget,
      "执行成本": profitBreakdown.executionCost,
      "项目垫款": profitBreakdown.advancePayment,
      "垫款利息": profitBreakdown.advanceInterest,
      "总成本影响": profitBreakdown.totalDeduction
    };
    preview.sections.push({
      title: "成本归集",
      rows: profitBreakdown.costs.filter(([, amount]) => Number(amount || 0) > 0).map(([name, amount]) => ({
        name,
        amount,
        status: "待入库"
      })),
      total: profitBreakdown.totalDeduction
    });
    if (reimbursementItems.length) {
      preview.sections.push({
        title: "员工报销/项目报销明细",
        rows: reimbursementItems.slice(0, 12).map((item) => ({
          name: `${item.person ? `${item.person} · ` : ""}${item.item}`,
          amount: item.amount,
          status: item.category
        })),
        total: reimbursementTotal
      });
      warnings.push("已识别为内部报销/项目报表明细，不会按供应商支出预览；请确认明细后入库。");
    } else if (Array.isArray(parsed.suppliers) && parsed.suppliers.length) {
      preview.sections.push({
        title: "供应商支出",
        rows: parsed.suppliers.slice(0, 12).map((item) => ({
          name: item.supplier || item.name || "未命名供应商",
          amount: Number(item.amount || 0),
          status: item.status || "待结算"
        })),
        total: parsed.suppliers.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      });
    }
    preview.summary = parsed.summary || "成本表已完成预解析，确认后会合并到项目成本和利润测算。";
    return preview;
  }

  const contract = parseMoney(parsed.contract) || parseMoney(values["合同金额"]);
  const paid = parseMoney(parsed.paid);
  preview.fields = {
    "项目名称": parsed.projectName || parsed.name || values["项目名称"] || "",
    "客户 / 品牌": parsed.client || values["客户 / 品牌"] || "",
    "负责人": values["负责人"] || user.name,
    "合同金额": contract,
    "已回款": paid,
    "待回款": parseMoney(parsed.receivable) || Math.max(contract - paid, 0),
    "服务周期": parsed.servicePeriod || "",
    "下一节点": parsed.nextMilestone || parsed.deliveryDate || ""
  };
  const quoteFiles = files.filter(isPotentialQuoteSheetFile).filter(looksLikeQuoteSheetFile);
  const quoteRules = extractQuoteRules(quoteFiles);
  if (quoteRules.length) {
    preview.sections.push({
      title: "自动识别报价规则",
      rows: quoteRules.slice(0, 12).map((rule) => ({
        name: rule.serviceName,
        quantity: rule.quantity,
        unit: rule.unit,
        unitPrice: rule.unitPrice,
        amount: rule.amount,
        status: "待写入"
      })),
      total: quoteRules.reduce((sum, rule) => sum + Number(rule.amount || 0), 0)
    });
  }
  if (!preview.fields["项目名称"]) warnings.push("项目名称未明确识别，确认前建议手动填写或检查合同。");
  if (!contract) warnings.push("合同金额未明确识别，确认后可能需要在项目详情中补充。");
  preview.summary = parsed.summary || "合同/报价文件已完成预解析，确认后会创建项目并写入项目台账。";
  return preview;
}

export function updateProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");

  const values = body.values || {};
  const oldName = project.name;
  const nextName = String(values["项目名称"] || project.name || "").trim();
  const nextClient = String(values["客户 / 品牌"] || project.client || "").trim();
  const nextOwner = String(values["负责人"] || project.owner || "").trim();
  const nextPm = String(values["PM"] || values["项目经理"] || project.pm || project.extractedFields?.pm || "").trim();
  const nextSales = String(values["销售"] || project.sales || project.extractedFields?.sales || "").trim();
  const nextStatus = String(values["项目状态"] || project.status || "").trim();
  const nextMilestone = String(values["下一节点"] || project.nextMilestone || "").trim();
  const nextPaymentDue = String(values["回款节点"] || project.paymentDue || "").trim();
  const nextCloseoutNote = values["结案复盘备注"] !== undefined
    ? String(values["结案复盘备注"] || "").trim()
    : String(project.closeoutNote || project.extractedFields?.closeoutNote || "").trim();
  const nextClosedAt = values["结案时间"] !== undefined
    ? String(values["结案时间"] || "").trim()
    : String(project.closedAt || project.extractedFields?.closedAt || "").trim();
  const contract = values["合同金额"] !== undefined && values["合同金额"] !== ""
    ? parseMoney(values["合同金额"])
    : parseMoney(project.contract);
  const paid = values["已回款"] !== undefined && values["已回款"] !== ""
    ? parseMoney(values["已回款"])
    : parseMoney(project.paid);

  const existingBreakdown = project.extractedFields?.profitBreakdown || {};
  const executionBudgetRatio = values["执行预算占比"] || project.extractedFields?.executionBudgetRatio || "";
  const explicitBudgetLimit = values["项目预算上限"] || values["执行预算上限"] || values["项目执行预算上限"];
  const ratio = parsePercent(executionBudgetRatio);
  const budgetLimit = explicitBudgetLimit !== undefined && explicitBudgetLimit !== ""
    ? parseMoney(explicitBudgetLimit)
    : (parseMoney(existingBreakdown.executionBudget) || parseMoney(project.extractedFields?.executionBudget));
  const executionBudget = ratio ? contract * ratio : budgetLimit;

  if (nextName) project.name = nextName;
  project.client = nextClient;
  project.owner = nextOwner || user.name;
  project.pm = nextPm || project.pm || "";
  project.sales = nextSales || project.sales || "";
  if (nextStatus) project.status = nextStatus;
  project.nextMilestone = nextMilestone;
  project.paymentDue = nextPaymentDue;
  if (nextCloseoutNote) project.closeoutNote = nextCloseoutNote;
  if (nextClosedAt) project.closedAt = nextClosedAt;
  project.contract = contract;
  project.paid = paid;
  project.receivable = Math.max(contract - paid, 0);
  project.extractedFields = {
    ...(project.extractedFields || {}),
    pm: project.pm,
    sales: project.sales,
    executionBudgetRatio,
    executionBudget,
    closeoutNote: nextCloseoutNote,
    closedAt: nextClosedAt
  };

  const profitBreakdown = syncProjectProfit(project, executionBudget);
  project.costBudget = executionBudget || profitBreakdown.executionBudget || parseMoney(project.costBudget);
  project.costUsed = profitBreakdown.totalDeduction || parseMoney(project.costUsed);
  project.margin = contract ? profitMargin(contract, contract - project.costUsed) : 0;
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = new Date().toISOString();

  for (const supplier of db.suppliers || []) {
    if (supplier.project === oldName) supplier.project = project.name;
  }
  for (const job of db.parseJobs || []) {
    if (job.projectId === project.id) job.projectName = project.name;
  }

  db.auditLogs.unshift({
    type: "project",
    target: project.name,
    action: /已完成|结案|已结案/.test(project.status || "") || nextClosedAt ? "closeout" : "update",
    user: user.name,
    at: project.updatedAt,
    meta: { status: project.status, closedAt: project.closedAt || "", closeoutNote: project.closeoutNote || "" }
  });
  syncProjectHealthNotificationsAfterUpdate(db, project, user);
  return project;
}

function nextPaymentId() {
  return `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function syncRevenuePaymentStatus(project) {
  const revenue = project.extractedFields?.revenueRecognition;
  if (!revenue) return;
  const records = Array.isArray(revenue.verificationRecords) ? revenue.verificationRecords : [];
  let remainingPaid = Number(project.paid || 0);
  const syncedRecords = records.map((record) => {
    const amount = Number(record.amount || 0);
    const paidAmount = Math.min(amount, Math.max(remainingPaid, 0));
    remainingPaid -= paidAmount;
    return {
      ...record,
      paidAmount,
      unpaidAmount: Math.max(amount - paidAmount, 0),
      paymentStatus: amount && paidAmount >= amount ? "已回款" : paidAmount > 0 ? "部分回款" : "未回款"
    };
  });
  const recognizedRevenue = Number(revenue.recognizedRevenue || records.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  project.extractedFields.revenueRecognition = {
    ...revenue,
    recognizedUnpaid: Math.max(recognizedRevenue - Number(project.paid || 0), 0),
    verificationRecords: syncedRecords,
    updatedAt: new Date().toISOString()
  };
}

function syncReceivableNotificationAfterPayment(db, project = {}, user = {}, action = "record") {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  const receivable = Number(project.receivable || 0);
  const notices = db.systemNotifications.filter((item) => {
    const sameProject = item.projectId === project.id || item.projectName === project.name;
    return sameProject && item.type === "project-receivable-risk";
  });
  if (receivable <= 0) {
    for (const notice of notices) {
      if (notice.status !== "待处理") continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = "项目已无待回款，系统在记录回款后自动处理。";
      notice.updatedAt = at;
    }
    return;
  }

  if (action !== "void") return;
  const existing = notices.find((item) => item.status === "待处理");
  if (existing) {
    existing.updatedAt = at;
    existing.text = `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`;
    return;
  }
  const reopen = notices.find((item) => ["已处理", "已忽略"].includes(item.status));
  if (reopen) {
    reopen.status = "待处理";
    reopen.reopenedAt = at;
    reopen.reopenedBy = user.id || "";
    reopen.reopenedByName = user.name || "";
    reopen.reopenReason = "回款作废后项目重新出现待回款。";
    reopen.text = `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`;
    reopen.updatedAt = at;
    return;
  }
  db.systemNotifications.unshift({
    id: nextNotificationId(`receivable-${project.id}`),
    key: `project-receivable-risk::${project.id}::payment-void`,
    type: "project-receivable-risk",
    title: "项目回款需要跟进",
    text: `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`,
    severity: "中",
    role: "sales",
    recipients: notificationRecipientsForRole("sales"),
    projectId: project.id,
    projectName: project.name,
    source: "payment",
    sourceId: project.id,
    actionLabel: "看回款",
    actionView: "project-detail",
    status: "待处理",
    createdAt: at,
    updatedAt: at
  });
}

function syncCollectionScriptsAfterPayment(db, project = {}, user = {}, action = "record") {
  const rows = db.collectionScripts || [];
  if (!project?.id || !rows.length) return;
  const at = new Date().toISOString();
  const receivable = Number(project.receivable || 0);
  for (const row of rows) {
    if (!sameProject(row, project)) continue;
    if (action === "record" && receivable <= 0) {
      closeCollectionFollowUpNotification(db, row, user, "项目已无待回款，系统在记录回款后自动关闭催收跟进。");
      if (row.followUpStatus === "待跟进" || row.nextFollowUpAt || row.nextAction) {
        row.followUpStatus = "已关闭";
        row.followUpClosedAt = at;
        row.updatedAt = at;
        row.updatedBy = user.id || "";
        row.updatedByName = user.name || "";
      }
    }
    if (action === "record" && receivable <= 0 && !row.outcome && typeof row.success !== "boolean") {
      row.outcome = "项目已完成回款，系统自动标记为待复核成功样本";
      row.success = true;
      row.score = Number(row.score || 4);
      row.autoResolvedByPayment = true;
      row.paymentSyncedAt = at;
      row.updatedAt = at;
      row.updatedBy = user.id || "";
      row.updatedByName = user.name || "";
      continue;
    }
    if (action === "void" && row.autoResolvedByPayment) {
      row.outcome = "回款已作废，需重新跟进客户付款";
      row.success = false;
      row.score = 2;
      row.autoResolvedByPayment = false;
      row.paymentVoidedAt = at;
      row.updatedAt = at;
      row.updatedBy = user.id || "";
      row.updatedByName = user.name || "";
    }
  }
}

function syncApprovalNotificationAfterAction(db, approval = {}, user = {}, action = "update") {
  db.systemNotifications = db.systemNotifications || [];
  if (!approval.id) return;
  const at = new Date().toISOString();
  const notices = db.systemNotifications.filter((item) => item.type === "approval-stale" && item.sourceId === approval.id);
  if (!notices.length) return;

  const terminal = ["已完成", "已驳回", "已撤回"].includes(String(approval.status || ""));
  const handledNote = terminal
    ? `审批已${approval.status.replace(/^已/, "")}，系统自动处理旧审批待办。`
    : `审批已流转到「${approval.status || "下一步"}」，系统自动处理上一轮超时待办。`;

  for (const notice of notices) {
    if (notice.status !== "待处理") continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = action === "withdraw" ? "审批已撤回，不会继续流转。" : handledNote;
    notice.updatedAt = at;
  }
}

function pendingSupplierRowsForProject(db, project = {}) {
  return (db.suppliers || []).filter((item) => {
    const sameProject = item.projectId === project.id || item.project === project.name;
    return sameProject && !/已付|已结|已付款|已结算|审批已驳回|审批已撤回/.test(String(item.status || ""));
  });
}

function syncSupplierSettlementNotificationAfterUpdate(db, row = {}, user = {}, status = "") {
  db.systemNotifications = db.systemNotifications || [];
  const project = findProjectForSupplierSettlement(db, row);
  if (!project) return;
  const at = new Date().toISOString();
  const pendingRows = pendingSupplierRowsForProject(db, project);
  const notices = db.systemNotifications.filter((item) => {
    const sameProject = item.projectId === project.id || item.projectName === project.name;
    return sameProject && item.type === "supplier-settlement-pending";
  });

  if (status === "已付款" && pendingRows.length === 0) {
    for (const notice of notices) {
      if (notice.status !== "待处理") continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = "项目供应商结算已全部标记为已付款，系统自动处理待办。";
      notice.updatedAt = at;
    }
    return;
  }

  if (status !== "待结算" || pendingRows.length === 0) return;
  const pendingAmount = pendingRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const text = `「${project.name}」仍有 ${pendingRows.length} 条供应商待结算，合计 ${pendingAmount.toLocaleString("zh-CN")} 元。请 PM/财务确认付款或发起供应商付款审批。`;
  const active = notices.find((item) => item.status === "待处理");
  if (active) {
    active.text = text;
    active.updatedAt = at;
    return;
  }
  const reopen = notices.find((item) => ["已处理", "已忽略"].includes(item.status));
  if (reopen) {
    reopen.status = "待处理";
    reopen.reopenedAt = at;
    reopen.reopenedBy = user.id || "";
    reopen.reopenedByName = user.name || "";
    reopen.reopenReason = "供应商结算退回待结算。";
    reopen.text = text;
    reopen.updatedAt = at;
    return;
  }
  upsertSystemNotification(db, {
    type: "supplier-settlement-pending",
    title: "供应商待结算",
    text,
    severity: pendingAmount >= 20000 || pendingRows.length >= 3 ? "高" : "中",
    role: "finance",
    recipients: Array.from(new Set([...notificationRecipientsForRole("finance"), ...notificationRecipientsForRole("pm")])),
    projectId: project.id,
    projectName: project.name,
    source: "supplier-settlement",
    sourceId: project.id,
    actionLabel: "看供应商结算",
    actionView: "project-detail"
  });
}

function syncVerificationNotificationAfterUpload(db, project = {}, record = {}, user = {}) {
  db.systemNotifications = db.systemNotifications || [];
  if (!project.id) return;
  const at = new Date().toISOString();
  const recordMonth = record.month || monthKey(new Date(at));
  const revenue = project.extractedFields?.revenueRecognition || {};
  const hasMonthVerification = (revenue.verificationRecords || []).some((item) => item.month === recordMonth);
  if (!hasMonthVerification) return;
  for (const notice of db.systemNotifications || []) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (!sameProject || notice.type !== "verification-sheet-missing" || notice.status !== "待处理") continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = `已上传 ${recordMonth} 核销表，系统自动处理本月核销待办。`;
    notice.updatedAt = at;
  }
}

function syncProjectHealthNotificationsAfterUpdate(db, project = {}, user = {}) {
  db.systemNotifications = db.systemNotifications || [];
  if (!project.id) return;
  const at = new Date().toISOString();
  const status = String(project.status || "");
  const inactiveProject = /已完成|完成|结案|已结案|取消/.test(status);
  const health = projectTimeHealth(project, new Date(at));
  const costPressure = projectCostPressure(project);
  if (inactiveProject) {
    closeExecutionNotificationsForInactiveProject(db, project, user, at);
  }

  for (const notice of db.systemNotifications || []) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (!sameProject || notice.status !== "待处理") continue;
    if (notice.type === "project-progress-lag") {
      const noLongerLag = inactiveProject || health.timeProgress < 20 || health.diff > -15;
      if (!noLongerLag) continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = inactiveProject
        ? "项目已结束，系统自动处理进度滞后待办。"
        : `项目完成度已追到 ${health.completion}%，时间进度 ${health.timeProgress}%，系统自动处理进度滞后待办。`;
      notice.updatedAt = at;
    }
    if (["project-cost-pressure", "project-cost-overrun"].includes(notice.type)) {
      const noLongerPressure = inactiveProject || !costPressure.executionBudget || costPressure.rate < 0.8;
      if (!noLongerPressure) continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = inactiveProject
        ? "项目已结束，系统自动处理成本压力待办。"
        : `项目成本使用率已降至 ${costPressure.percent || 0}%，系统自动处理成本压力待办。`;
      notice.updatedAt = at;
    }
  }
}

function closeExecutionNotificationsForInactiveProject(db, project = {}, user = {}, at = new Date().toISOString()) {
  const executionTypes = new Set([
    "project-assignment",
    "project-progress-lag",
    "project-cost-pressure",
    "project-cost-overrun",
    "verification-sheet-missing",
    "supplier-settlement-pending",
    "feishu-pending-file"
  ]);
  for (const notice of db.systemNotifications || []) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (!sameProject || notice.status !== "待处理" || !executionTypes.has(notice.type)) continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = "项目已结案，系统自动处理执行类待办；回款类提醒会继续保留。";
    notice.updatedAt = at;
  }
}

function syncFeishuPendingNotificationAfterAction(db, pending = {}, user = {}, action = "confirm") {
  db.systemNotifications = db.systemNotifications || [];
  if (!pending.id) return;
  const at = new Date().toISOString();
  for (const notice of db.systemNotifications || []) {
    const sameSource = notice.type === "feishu-pending-file" && notice.sourceId === pending.id;
    if (!sameSource || notice.status !== "待处理") continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = action === "reject"
      ? "飞书文件已驳回，不会写入项目，系统自动处理待办。"
      : "飞书文件已确认入库，系统自动处理待办。";
    notice.updatedAt = at;
  }
}

function syncCompanyCashRunwayNotificationAfterSave(db, finance = {}, user = {}) {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  const runwayMonths = Number(finance.runwayMonths || 0);
  const monthlyFixedCost = Number(finance.monthlyFixedCost || 0);
  const needsReminder = monthlyFixedCost > 0 && runwayMonths < 6;
  const notices = db.systemNotifications.filter((item) => item.type === "company-cash-runway");

  if (!needsReminder) {
    for (const notice of notices) {
      if (notice.status !== "待处理") continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = monthlyFixedCost
        ? `现金流已达到 ${runwayMonths.toFixed(1)} 个月，超过 6 个月安全线，系统自动处理现金流待办。`
        : "现金流参数待完善，系统自动处理旧现金流待办。";
      notice.updatedAt = at;
    }
    return;
  }

  const text = `当前现金可撑 ${runwayMonths.toFixed(1)} 个月，月固定支出 ${monthlyFixedCost.toLocaleString("zh-CN")} 元，6个月安全线缺口 ${Number(finance.gap || 0).toLocaleString("zh-CN")} 元。`;
  const active = notices.find((item) => item.status === "待处理");
  if (active) {
    active.title = runwayMonths < 3 ? "危险！你快倒闭啦！需要收缩现金流" : "公司现金流低于 6 个月安全线";
    active.text = text;
    active.severity = runwayMonths < 3 ? "高" : "中";
    active.updatedAt = at;
    return;
  }
  const reopen = notices.find((item) => ["已处理", "已忽略"].includes(item.status));
  if (reopen) {
    reopen.status = "待处理";
    reopen.reopenedAt = at;
    reopen.reopenedBy = user.id || "";
    reopen.reopenedByName = user.name || "";
    reopen.reopenReason = "现金流设置更新后低于 6 个月安全线。";
    reopen.title = runwayMonths < 3 ? "危险！你快倒闭啦！需要收缩现金流" : "公司现金流低于 6 个月安全线";
    reopen.text = text;
    reopen.severity = runwayMonths < 3 ? "高" : "中";
    reopen.updatedAt = at;
    return;
  }
  upsertSystemNotification(db, {
    type: "company-cash-runway",
    title: runwayMonths < 3 ? "危险！你快倒闭啦！需要收缩现金流" : "公司现金流低于 6 个月安全线",
    text,
    severity: runwayMonths < 3 ? "高" : "中",
    role: "finance",
    recipients: notificationRecipientsForRole("finance"),
    source: "finance-settings",
    sourceId: "company-cash-runway",
    actionLabel: "看现金流",
    actionView: "management:cash"
  });
}

export function recordProjectPayment(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const amount = parseMoney(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("请填写正确的回款金额");
  const contract = parseMoney(project.contract);
  const currentPaid = parseMoney(project.paid);
  if (contract && currentPaid + amount > contract * 1.05) throw new Error("回款金额超过合同金额过多，请核对后再记录");

  const at = new Date().toISOString();
  const payment = {
    id: nextPaymentId(),
    projectId: project.id,
    projectName: project.name,
    client: project.client || "",
    amount,
    payer: String(body.payer || body.client || project.client || "").trim(),
    method: String(body.method || "").trim(),
    note: String(body.note || body.remark || "").trim(),
    receivedAt: body.receivedAt || at,
    recordedBy: user.id,
    recordedByName: user.name,
    createdAt: at
  };

  db.payments = db.payments || [];
  db.payments.unshift(payment);
  project.paid = currentPaid + amount;
  project.receivable = Math.max(contract - Number(project.paid || 0), 0);
  project.risk = inferRisk({
    contract,
    costBudget: project.costBudget,
    costUsed: project.costUsed,
    receivable: project.receivable
  });
  syncRevenuePaymentStatus(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  syncReceivableNotificationAfterPayment(db, project, user, "record");
  syncCollectionScriptsAfterPayment(db, project, user, "record");
  db.auditLogs.unshift({
    type: "payment",
    target: project.name,
    action: "record",
    user: user.name,
    meta: { paymentId: payment.id, amount, paid: project.paid, receivable: project.receivable },
    at
  });
  return { payment, project };
}

export function voidProjectPayment(db, body, user) {
  const payment = (db.payments || []).find((item) => item.id === body?.id || item.id === body?.paymentId);
  if (!payment) throw new Error("回款记录不存在");
  if (payment.status === "已作废" || payment.voidedAt) throw new Error("该回款记录已作废");
  const project = (db.projects || []).find((item) => item.id === payment.projectId || item.name === payment.projectName);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  const amount = Number(payment.amount || 0);
  const contract = parseMoney(project.contract);
  project.paid = Math.max(parseMoney(project.paid) - amount, 0);
  project.receivable = Math.max(contract - Number(project.paid || 0), 0);
  project.risk = inferRisk({
    contract,
    costBudget: project.costBudget,
    costUsed: project.costUsed,
    receivable: project.receivable
  });
  syncRevenuePaymentStatus(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  syncReceivableNotificationAfterPayment(db, project, user, "void");
  syncCollectionScriptsAfterPayment(db, project, user, "void");
  payment.status = "已作废";
  payment.voidedAt = at;
  payment.voidedBy = user.id;
  payment.voidedByName = user.name;
  payment.voidReason = String(body.reason || body.note || "").trim() || "手动作废";
  db.auditLogs.unshift({
    type: "payment",
    target: project.name,
    action: "void",
    user: user.name,
    meta: { paymentId: payment.id, amount, paid: project.paid, receivable: project.receivable, reason: payment.voidReason },
    at
  });
  return { payment, project };
}

function nextTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeProjectTask(task, index = 0) {
  if (Array.isArray(task)) {
    const progress = Math.max(0, Math.min(100, Number(task[1] || 0)));
    return {
      id: task[2] || `legacy-task-${index}`,
      title: String(task[0] || `任务 ${index + 1}`).trim(),
      progress,
      status: progress >= 100 ? "done" : progress > 0 ? "doing" : "todo",
      owner: "",
      dueDate: "",
      note: "",
      updatedAt: ""
    };
  }
  const progress = Math.max(0, Math.min(100, Number(task?.progress || 0)));
  return {
    id: task?.id || `legacy-task-${index}`,
    title: String(task?.title || task?.name || `任务 ${index + 1}`).trim(),
    progress,
    status: task?.status || (progress >= 100 ? "done" : progress > 0 ? "doing" : "todo"),
    owner: task?.owner || "",
    dueDate: task?.dueDate || "",
    note: task?.note || "",
    archivedAt: task?.archivedAt || "",
    archivedBy: task?.archivedBy || "",
    createdAt: task?.createdAt || "",
    createdBy: task?.createdBy || "",
    updatedAt: task?.updatedAt || "",
    updatedBy: task?.updatedBy || ""
  };
}

function syncProjectProgressFromTasks(project) {
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  project.tasks = tasks;
  const activeTasks = tasks.filter((task) => !task.archivedAt);
  const values = activeTasks.map((task) => Number(task.progress || 0)).filter(Number.isFinite);
  const progress = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  project.progress = progress;
  project.extractedFields = {
    ...(project.extractedFields || {}),
    taskProgress: progress,
    taskSummary: {
      total: activeTasks.length,
      archived: tasks.filter((task) => task.archivedAt).length,
      done: activeTasks.filter((task) => task.status === "done" || Number(task.progress || 0) >= 100).length,
      doing: activeTasks.filter((task) => task.status === "doing").length,
      todo: activeTasks.filter((task) => task.status === "todo").length,
      updatedAt: new Date().toISOString()
    }
  };
  return progress;
}

function taskDueInfo(task = {}, now = new Date()) {
  if (!task.dueDate || task.archivedAt || Number(task.progress || 0) >= 100 || task.status === "done") {
    return { active: false, tone: "done", label: "无需提醒", daysLeft: null };
  }
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return { active: false, tone: "none", label: "未设置有效截止时间", daysLeft: null };
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const daysLeft = Math.ceil((dueStart - todayStart) / 86400000);
  if (daysLeft < 0) return { active: true, tone: "overdue", label: `已逾期 ${Math.abs(daysLeft)} 天`, daysLeft };
  if (daysLeft === 0) return { active: true, tone: "today", label: "今天截止", daysLeft };
  if (daysLeft <= 2) return { active: true, tone: "soon", label: `${daysLeft} 天后截止`, daysLeft };
  return { active: false, tone: "normal", label: `${daysLeft} 天后截止`, daysLeft };
}

function syncProjectTaskDueNotificationsAfterUpdate(db, project = {}, user = {}, at = new Date().toISOString()) {
  db.systemNotifications = db.systemNotifications || [];
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const activeTaskIds = new Set(tasks.filter((task) => taskDueInfo(task, new Date(at)).active).map((task) => task.id));
  for (const notice of db.systemNotifications) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (!sameProject || notice.type !== "project-task-due" || notice.status !== "待处理") continue;
    if (activeTaskIds.has(notice.sourceId)) continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = "任务已完成、归档或截止风险解除，系统自动处理任务提醒。";
    notice.updatedAt = at;
  }
}

export function upsertProjectTask(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const taskId = body.taskId || body.task?.id || "";
  const existingIndex = tasks.findIndex((task) => task.id === taskId);
  const rawProgress = body.progress ?? body.task?.progress;
  const action = body.action || "";
  const nextProgress = action === "complete"
    ? 100
    : rawProgress !== undefined && rawProgress !== ""
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : existingIndex >= 0 ? tasks[existingIndex].progress : 0;
  const nextStatus = action === "complete"
    ? "done"
    : body.status || body.task?.status || (nextProgress >= 100 ? "done" : nextProgress > 0 ? "doing" : "todo");
  const candidate = {
    ...(existingIndex >= 0 ? tasks[existingIndex] : {}),
    id: existingIndex >= 0 ? tasks[existingIndex].id : nextTaskId(),
    title: String(body.title || body.task?.title || body.task?.name || (existingIndex >= 0 ? tasks[existingIndex].title : "")).trim(),
    owner: String(body.owner || body.task?.owner || (existingIndex >= 0 ? tasks[existingIndex].owner : "")).trim(),
    dueDate: String(body.dueDate || body.task?.dueDate || (existingIndex >= 0 ? tasks[existingIndex].dueDate : "")).trim(),
    note: String(body.note || body.task?.note || (existingIndex >= 0 ? tasks[existingIndex].note : "")).trim(),
    progress: nextProgress,
    status: nextStatus,
    createdAt: existingIndex >= 0 ? tasks[existingIndex].createdAt : at,
    createdBy: existingIndex >= 0 ? tasks[existingIndex].createdBy : user.id,
    updatedAt: at,
    updatedBy: user.id
  };
  if (!candidate.title) throw new Error("请填写任务名称");
  if (existingIndex >= 0) tasks[existingIndex] = candidate;
  else tasks.unshift(candidate);
  project.tasks = tasks;
  syncProjectProgressFromTasks(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  db.auditLogs.unshift({
    type: "task",
    target: project.name,
    action: existingIndex >= 0 ? "update" : "create",
    user: user.name,
    meta: { taskId: candidate.id, title: candidate.title, progress: candidate.progress, status: candidate.status },
    at
  });
  syncProjectHealthNotificationsAfterUpdate(db, project, user);
  syncProjectTaskDueNotificationsAfterUpdate(db, project, user, at);
  return { project, task: candidate };
}

export function archiveProjectTask(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const taskId = body.taskId || body.id || "";
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("任务不存在");
  const at = new Date().toISOString();
  task.archivedAt = at;
  task.archivedBy = user.id;
  task.updatedAt = at;
  task.updatedBy = user.id;
  project.tasks = tasks;
  syncProjectProgressFromTasks(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  db.auditLogs.unshift({
    type: "task",
    target: project.name,
    action: "archive",
    user: user.name,
    meta: { taskId: task.id, title: task.title, reason: String(body.reason || "").trim() },
    at
  });
  syncProjectHealthNotificationsAfterUpdate(db, project, user);
  syncProjectTaskDueNotificationsAfterUpdate(db, project, user, at);
  return { project, task };
}

export function deleteProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const isProjectRecord = (item = {}) => {
    const names = [item.projectName, item.project, item.targetProject, item.relatedProject, item.chatName].filter(Boolean).map(String);
    return item.projectId === project.id || names.includes(project.name);
  };

  db.projects = (db.projects || []).filter((item) => item.id !== project.id);
  db.parseJobs = (db.parseJobs || []).filter((item) => !isProjectRecord(item));
  db.files = (db.files || []).filter((item) => !isProjectRecord(item));
  db.suppliers = (db.suppliers || []).filter((item) => !isProjectRecord(item));
  db.payments = (db.payments || []).filter((item) => !isProjectRecord(item));
  db.approvals = (db.approvals || []).filter((item) => !isProjectRecord(item));
  db.collectionScripts = (db.collectionScripts || []).filter((item) => !isProjectRecord(item));
  db.comments = (db.comments || []).filter((item) => !isProjectRecord(item));
  db.alertUpdates = (db.alertUpdates || []).filter((item) => !isProjectRecord(item));
  db.systemNotifications = (db.systemNotifications || []).filter((item) => !isProjectRecord(item));
  db.feishuProjectBindings = (db.feishuProjectBindings || []).filter((item) => !isProjectRecord(item));
  db.feishuPendingFiles = (db.feishuPendingFiles || []).filter((item) => !isProjectRecord(item));
  db.feishuEvents = (db.feishuEvents || []).filter((item) => !isProjectRecord(item));
  const at = new Date().toISOString();
  db.auditLogs.unshift({ type: "project", target: project.name, action: "delete", user: user.name, at });
  return { id: project.id, name: project.name };
}

function syncProjectProfit(project, executionBudget = 0) {
  const current = project.extractedFields?.profitBreakdown || {};
  const parsed = {
    ...project.extractedFields,
    ...current,
    executionBudget: executionBudget || current.executionBudget || project.extractedFields?.executionBudget || 0
  };
  const breakdown = calculateProfitBreakdown(project.contract, parsed);
  const hasExistingCost = breakdown.totalDeduction || parseMoney(project.costUsed) || (project.costs || []).length;
  if (!hasExistingCost) {
    const emptyBreakdown = {
      ...breakdown,
      totalDeduction: 0,
      profit: Number(project.contract || 0),
      margin: profitMargin(project.contract, Number(project.contract || 0))
    };
    project.costs = [];
    project.extractedFields = { ...(project.extractedFields || {}), profitBreakdown: emptyBreakdown, profit: emptyBreakdown.profit };
    return emptyBreakdown;
  }
  project.costs = breakdown.costs;
  project.extractedFields = { ...(project.extractedFields || {}), profitBreakdown: breakdown, profit: breakdown.profit };
  return breakdown;
}

function hasContractLikeFile(files = [], parsed = {}) {
  if (parseMoney(parsed.contract) || parsed.partyA || parsed.partyB) return true;
  return files.some((file) => {
    const source = `${file.name || ""}\n${file.text || ""}`;
    return /(合同|协议|甲方|乙方|委托方|受托方|合同金额|服务费用|付款方式)/.test(source)
      && !/(成本表|利润测算|执行支出|人力|公摊|月度成本|供应商结算)/.test(file.name || "");
  });
}

function isPotentialQuoteSheetFile(file = {}) {
  const source = `${file.name || ""}\n${file.type || ""}\n${file.text || ""}`;
  const lowerName = String(file.name || "").toLowerCase();
  if (/(成本表|利润测算|执行支出|供应商结算|月度核销|核销表|验收表)/.test(source)) return false;
  return /(报价|报价单|报价表|刊例|报价规则|核销规则)/.test(source)
    || /\.(xlsx|xls|xlsm|csv|tsv)$/i.test(lowerName)
    || String(file.type || "").includes("spreadsheet");
}

function looksLikeQuoteSheetFile(file = {}) {
  const source = `${file.name || ""}\n${file.text || ""}`;
  if (/(成本表|利润测算|执行支出|供应商结算|月度核销|核销表|验收表)/.test(source)) return false;
  if (/(报价|报价单|报价表|刊例|报价规则|核销规则)/.test(source)) return true;
  const rows = parseTableLines([file]);
  return rows.some((row) => {
    const normalized = (row.cells || []).map(normalizeHeaderText).join(" ");
    const hasService = /(服务|内容|项目|资源|达人|账号|平台|刊例|报价)/.test(normalized);
    const hasPrice = /(单价|报价|金额|小计|总价|合计金额)/.test(normalized);
    const hasQuantity = /(数量|条数|篇数|次数|支数|单位)/.test(normalized);
    const hasMonthlyVerification = /(本月|当月|月度|核销|确认收入|验收金额)/.test(normalized);
    return hasService && hasPrice && hasQuantity && !hasMonthlyVerification;
  });
}

export function createParseJob(project, files, parsed = {}, sourceValues = {}) {
  const now = new Date().toISOString();
  const finished = files.length && (parsed.summary || parsed.contract || parsed.client);
  return {
    id: `J-${Date.now()}`,
    projectId: project.id,
    projectName: project.name,
    status: finished ? "已完成" : files.length ? "解析中" : "等待文件",
    progress: finished ? 100 : files.length ? 25 : 0,
    steps: [
      { name: "文件接收", status: files.length ? "完成" : "等待" },
      { name: "字段识别", status: finished ? "完成" : files.length ? "进行中" : "等待" },
      { name: "人工确认", status: finished ? "完成" : "等待" },
      { name: "写入项目", status: finished ? "完成" : "等待" }
    ],
    files,
    sourceValues,
    extractedFields: parsed,
    createdAt: now,
    updatedAt: now
  };
}

function assertUniqueProject(db, values = {}, files = [], contract = 0, ignoreProjectId = "") {
  const incomingName = normalizeProjectText(values["项目名称"] || files.map((file) => file.name).join(" "));
  const incomingClient = normalizeProjectText(values["客户 / 品牌"] || "");
  const incomingFiles = normalizeProjectText(files.map((file) => file.name).join(" "));
  const incomingAmount = Math.round(Number(contract || 0));

  for (const project of db.projects || []) {
    if (ignoreProjectId && project.id === ignoreProjectId) continue;
    const existingName = normalizeProjectText(project.name || "");
    const existingClient = normalizeProjectText(project.client || "");
    const existingFiles = normalizeProjectText((project.files || []).map((file) => file.name).join(" "));
    const existingAmount = Math.round(Number(project.contract || 0));
    const sameAmount = incomingAmount && existingAmount && Math.abs(incomingAmount - existingAmount) <= Math.max(100, incomingAmount * 0.01);
    const sameClient = incomingClient && existingClient && (incomingClient.includes(existingClient) || existingClient.includes(incomingClient));
    const similarName = incomingName && existingName && similarity(incomingName, existingName) >= 0.82;
    const sameFile = incomingFiles && existingFiles && (incomingFiles.includes(existingFiles) || existingFiles.includes(incomingFiles));

    if ((sameClient && sameAmount) || (similarName && (sameClient || sameAmount)) || (sameFile && (sameClient || sameAmount))) {
      throw new Error(`疑似重复项目：${project.name}。请在项目台账中确认后再上传，避免重复归档。`);
    }
  }
}

function projectToValues(project) {
  return {
    "项目名称": project.name || "",
    "客户 / 品牌": project.client || "",
    "合同金额": project.contract || 0
  };
}

function removeCreatedProject(db, projectId, parseJobId) {
  db.projects = (db.projects || []).filter((item) => item.id !== projectId);
  db.parseJobs = (db.parseJobs || []).filter((item) => item.id !== parseJobId && item.projectId !== projectId);
  db.files = (db.files || []).filter((item) => item.projectId !== projectId);
  db.suppliers = (db.suppliers || []).filter((item) => item.projectId !== projectId);
  db.auditLogs = (db.auditLogs || []).filter((item) => !(item.type === "project" && item.action === "create"));
}

function findMatchingProjectForCostSheet(db, parsed = {}, files = []) {
  const incomingName = normalizeProjectText(parsed.projectName || parsed.name || files.map((file) => file.name).join(" "));
  const incomingClient = normalizeProjectText(parsed.client || parsed.partyA || "");
  const incomingText = normalizeProjectText([
    parsed.projectName,
    parsed.client,
    parsed.partyA,
    files.map((file) => `${file.name || ""} ${file.text || ""}`).join(" ")
  ].join(" "));
  const incomingContract = parseMoney(parsed.contract);

  const scored = (db.projects || []).map((project) => {
    const existingName = normalizeProjectText(project.name || "");
    const existingClient = normalizeProjectText(project.client || "");
    const existingContract = parseMoney(project.contract);
    let score = 0;

    if (incomingName && existingName) score += similarity(incomingName, existingName) * 55;
    if (incomingClient && existingClient && (incomingClient.includes(existingClient) || existingClient.includes(incomingClient))) score += 35;
    if (incomingText && existingName && (incomingText.includes(existingName) || existingName.includes(incomingName))) score += 30;
    if (incomingText && existingClient && incomingText.includes(existingClient)) score += 25;
    if (incomingContract && existingContract && Math.abs(incomingContract - existingContract) <= Math.max(100, existingContract * 0.05)) score += 25;

    return { project, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 45 ? scored[0].project : null;
}

function normalizeProjectText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length > b.length ? a : b;
  if (long.includes(short)) return short.length / long.length;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((char) => setB.has(char)).length;
  const union = new Set([...setA, ...setB]).size || 1;
  return intersection / union;
}

export async function advanceParseJob(db, idOrProjectId) {
  const job = db.parseJobs.find((item) => item.id === idOrProjectId || item.projectId === idOrProjectId);
  if (!job) throw new Error("解析任务不存在");

  if (job.status === "已完成" && job.extractedFields?.summary) return job;

  if (/失败/.test(String(job.status || ""))) {
    job.status = "重新解析中";
    job.progress = Math.max(25, Number(job.progress || 0));
    job.error = "";
    job.steps = [
      { name: "文件接收", status: "完成" },
      { name: "字段识别", status: "进行中" },
      { name: "人工确认", status: "等待" },
      { name: "写入项目", status: "等待" }
    ];
  }

  job.progress = Math.min(100, job.progress + 25);
  job.status = job.progress >= 100 ? "已完成" : "解析中";
  job.steps = job.steps.map((step, index) => {
    const threshold = [25, 50, 75, 100][index];
    const current = Math.floor(job.progress / 25);
    return { ...step, status: job.progress >= threshold ? "完成" : index === current ? "进行中" : "等待" };
  });
  job.updatedAt = new Date().toISOString();

  if (job.progress >= 75 && !job.extractedFields?.summary) {
    const project = db.projects.find((item) => item.id === job.projectId);
    if (project) {
      try {
        await analyzeAndApplyProjectFiles(db, project, job);
      } catch (error) {
        markParseJobFailed(job, error);
        project.status = project.status === "AI解析中" ? "解析失败" : project.status;
        project.aiSummary = `AI 解析失败：${error.message}`;
        project.updatedAt = new Date().toISOString();
      }
    }
  }

  return job;
}

export async function reparseProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  validateAiSettings(db.settings?.aiService || {});
  const files = project.files?.length
    ? project.files
    : (db.parseJobs || []).find((item) => item.projectId === project.id)?.files || [];
  if (!files.length) throw new Error("当前项目没有可重新解析的原始文件，请重新上传合同或执行表。");
  const now = new Date().toISOString();
  let job = (db.parseJobs || []).find((item) => item.projectId === project.id);
  if (!job) {
    job = createParseJob(project, files, {}, projectToValues(project));
    db.parseJobs.unshift(job);
  }
  job.files = files;
  job.sourceValues = projectToValues(project);
  job.status = "重新解析中";
  job.progress = 35;
  job.extractedFields = {};
  job.updatedAt = now;
  job.steps = [
    { name: "文件接收", status: "完成" },
    { name: "字段识别", status: "进行中" },
    { name: "人工确认", status: "等待" },
    { name: "写入项目", status: "等待" }
  ];
  project.status = "AI解析中";
  project.aiSummary = "已使用服务端共享 AI 配置重新解析原始文件，请稍候查看最新结果。";
  project.updatedAt = now;
  try {
    await analyzeAndApplyProjectFiles(db, project, job);
  } catch (error) {
    markParseJobFailed(job, error);
    project.status = "解析失败";
    project.aiSummary = `AI 解析失败：${error.message}`;
    project.updatedAt = new Date().toISOString();
  }
  db.auditLogs.unshift({ type: "project", target: project.name, action: "reparse", user: user.name, at: now });
  return { project, parseJob: job };
}

export async function uploadProjectCostSheet(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const now = new Date().toISOString();
  const files = await normalizeUploadedFiles(body.files || [], "execution-cost", user, now, db.settings?.storage || {});
  files.forEach((file) => {
    file.coveredMonths = Array.isArray(file.coveredMonths) && file.coveredMonths.length
      ? file.coveredMonths
      : inferCoveredMonths(`${file.name || ""} ${file.text || ""}`, new Date(now));
  });
  if (!files.length) throw new Error("请先上传月度执行成本表");

  project.files = [...(project.files || []), ...files];
  const sourceValues = {
    ...projectToValues(project),
    "文件类型": "月度执行成本表",
    "上传人": user.name
  };
  let parsed = {};
  try {
    parsed = await analyzeProjectFiles(db.settings?.aiService, sourceValues, files, db.settings?.interestRate);
  } catch {
    parsed = {};
  }
  const parsedMonths = inferCoveredMonths(JSON.stringify(parsed || {}), new Date(now));
  if (parsedMonths.length) {
    files.forEach((file) => {
      file.coveredMonths = Array.from(new Set([...(file.coveredMonths || []), ...parsedMonths])).sort();
    });
  }
  const parseJob = createParseJob(project, files, parsed, sourceValues);
  parseJob.kind = "execution-cost";
  parseJob.uploadedBy = user.id;
  parseJob.uploadedByName = user.name;
  db.parseJobs.unshift(parseJob);
  if (parsed.summary || parsed.hasCostSheet || parsed.costs || parsed.suppliers) {
    applyParsedFields(db, project, parseJob, { ...parsed, hasCostSheet: true });
  } else {
    project.status = "AI解析中";
    project.aiSummary = "月度执行成本表已上传，等待 AI 解析并归并到项目成本。";
  }
  db.files.unshift({ files, projectId: project.id, projectName: project.name, type: "execution-cost", user: user.name, at: now });
  db.auditLogs.unshift({ type: "upload", target: project.name, action: "execution-cost", count: files.length, user: user.name, at: now });
  return { project, parseJob, files };
}

export async function uploadProjectQuoteSheet(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const now = new Date().toISOString();
  const files = await normalizeUploadedFiles(body.files || [], "quote-sheet", user, now, db.settings?.storage || {});
  if (!files.length) throw new Error("请先上传合同报价表");
  const rules = extractQuoteRules(files);
  if (!rules.length) throw new Error("未识别到可核销的报价项，请检查报价表是否包含服务内容、数量、单位、单价、小计等字段。");
  learnParserSkills(db, files, "quote-sheet", user, now);
  syncQuoteRulesToProject(project, files, rules, now);
  db.files.unshift({ files, projectId: project.id, projectName: project.name, type: "quote-sheet", user: user.name, at: now });
  db.auditLogs.unshift({ type: "upload", target: project.name, action: "quote-sheet", count: files.length, user: user.name, at: now });
  return { project, rules, files };
}

async function applyInitialQuoteSheets(db, project, files = [], user, now = new Date().toISOString()) {
  const candidateFiles = files.filter(isPotentialQuoteSheetFile);
  if (!candidateFiles.length) return null;

  const quoteFiles = (await normalizeUploadedFiles(candidateFiles, "quote-sheet", user, now, db.settings?.storage || {}))
    .filter(looksLikeQuoteSheetFile);
  const rules = extractQuoteRules(quoteFiles);
  if (!rules.length) return null;

  learnParserSkills(db, quoteFiles, "quote-sheet", user, now);
  syncQuoteRulesToProject(project, quoteFiles, rules, now);
  db.files.unshift({ files: quoteFiles, projectId: project.id, projectName: project.name, type: "quote-sheet", user: user.name, at: now });
  db.auditLogs.unshift({ type: "upload", target: project.name, action: "quote-sheet-auto", count: quoteFiles.length, user: user.name, at: now });
  return { files: quoteFiles, rules };
}

function syncQuoteRulesToProject(project, files, rules, now) {
  const existingFiles = project.files || [];
  const fileKeys = new Set(files.map(uploadedFileKey));
  project.files = [
    ...existingFiles.filter((file) => !fileKeys.has(uploadedFileKey(file))),
    ...files
  ];
  project.extractedFields = {
    ...(project.extractedFields || {}),
    revenueRecognition: {
      ...(project.extractedFields?.revenueRecognition || {}),
      quoteRules: rules,
      quoteFiles: files.map(fileReference),
      updatedAt: now
    }
  };
  project.aiSummary = `${project.aiSummary || "文件已解析。"} 已识别 ${rules.length} 条报价核销规则，可用于月度核销表自动匹配。`;
  project.updatedAt = now;
}

function uploadedFileKey(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.type || ""}`;
}

export async function uploadProjectVerificationSheet(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const now = new Date().toISOString();
  const files = await normalizeUploadedFiles(body.files || [], "verification-sheet", user, now, db.settings?.storage || {});
  if (!files.length) throw new Error("请先上传月度核销表");
  learnParserSkills(db, files, "verification-sheet", user, now);
  const revenue = project.extractedFields?.revenueRecognition || {};
  const quoteRules = Array.isArray(revenue.quoteRules) ? revenue.quoteRules : [];
  if (!quoteRules.length) throw new Error("当前项目还没有报价规则库，请先上传合同报价表。");
  const verificationItems = extractVerificationItems(files);
  const verificationSummary = verificationItems.summary || {};
  if (!verificationItems.length && !verificationSummary.totalAmount) throw new Error("未识别到核销条数或核销金额，请检查核销表是否包含服务项、数量、月份等字段。");
  const matchedItems = matchVerificationItems(verificationItems, quoteRules, {
    recognizedRevenue: Number(revenue.recognizedRevenue || 0),
    contract: Number(project.contract || 0),
    records: revenue.verificationRecords || []
  });
  const recognizedRevenue = verificationSummary.totalAmount || matchedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const recognizedTotal = Number(revenue.recognizedRevenue || 0) + recognizedRevenue;
  const paid = Number(project.paid || 0);
  const record = {
    id: `VR-${Date.now()}`,
    month: inferVerificationMonth(files) || monthKey(new Date(now)),
    amount: recognizedRevenue,
    paidAmount: 0,
    unpaidAmount: recognizedRevenue,
    paymentStatus: "未回款",
    status: matchedItems.some((item) => item.status !== "自动通过") ? "待复核" : "自动通过",
    uploadedAt: now,
    uploadedBy: user.id,
    uploadedByName: user.name,
    files: files.map(fileReference),
    summary: verificationSummary.totalAmount ? verificationSummary : undefined,
    items: matchedItems
  };
  project.files = [...(project.files || []), ...files];
  project.extractedFields = {
    ...(project.extractedFields || {}),
    revenueRecognition: {
      ...revenue,
      quoteRules,
      recognizedRevenue: recognizedTotal,
      recognizedUnpaid: Math.max(recognizedTotal - paid, 0),
      unrecognizedContract: Math.max(Number(project.contract || 0) - recognizedTotal, 0),
      verificationRecords: [record, ...(revenue.verificationRecords || [])],
      updatedAt: now
    }
  };
  project.receivable = Math.max(Number(project.contract || 0) - paid, 0);
  project.aiSummary = `${project.aiSummary || "文件已解析。"} 本次核销确认收入 ${recognizedRevenue}，状态：${record.status}。`;
  project.updatedAt = now;
  db.files.unshift({ files, projectId: project.id, projectName: project.name, type: "verification-sheet", user: user.name, at: now });
  db.auditLogs.unshift({ type: "upload", target: project.name, action: "verification-sheet", amount: recognizedRevenue, user: user.name, at: now });
  syncVerificationNotificationAfterUpload(db, project, record, user);
  return { project, record, files };
}

function fileReference(file = {}) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    category: file.category,
    text: file.text,
    tableRows: file.tableRows,
    extractionStatus: file.extractionStatus,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy,
    uploadedByName: file.uploadedByName,
    dataUrl: file.dataUrl,
    base64: file.base64
  };
}

async function normalizeUploadedFiles(files, category, user, now, storageSettings = {}) {
  return Promise.all((Array.isArray(files) ? files : []).map(async (file) => {
    const withId = { ...file, id: file.id || nextFileId() };
    const stored = await persistLocalUploadFile(withId, category, now, storageSettings);
    const shouldExtract = stored.base64 && (/\.(xlsx|xls|xlsm)$/i.test(stored.name || "") || String(stored.type || "").includes("spreadsheet"));
    const extracted = shouldExtract || !stored.text ? await extractFileContent(stored) : stored;
    const tableRows = extracted.tableRows || file.tableRows || [];
    const tableText = tableRowsToText(tableRows);
    const extractedText = extracted.extractionStatus === "仅记录文件信息" ? "" : extracted.text;
    return {
      ...stored,
      text: extractedText || stored.text || tableText || extracted.text || "",
      tableRows,
      extractionStatus: extracted.extractionStatus || stored.extractionStatus || "",
      storageStatus: stored.storageStatus || "仅记录文件信息",
      category,
      uploadedAt: stored.uploadedAt || now,
      uploadedBy: stored.uploadedBy || user.id,
      uploadedByName: user.name
    };
  }));
}

function tableRowsToText(tableRows = []) {
  if (!Array.isArray(tableRows) || !tableRows.length) return "";
  return tableRows
    .map((row) => {
      const cells = Array.isArray(row.cells) ? row.cells : [];
      return `${row.sheetName ? `工作表：${row.sheetName}\n` : ""}${cells.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ")).join("\t")}`;
    })
    .join("\n");
}

function setStepStatus(steps, name, status) {
  return steps.map((step) => step.name === name ? { ...step, status } : step);
}

function markParseJobFailed(job, error) {
  const message = error?.message || "AI/OCR 解析失败，请检查文件或 AI 配置后重试。";
  job.status = "解析失败";
  job.progress = Math.max(75, Number(job.progress || 0));
  job.error = message;
  job.failedAt = new Date().toISOString();
  job.updatedAt = job.failedAt;
  job.steps = (job.steps || []).map((step) => {
    if (step.name === "字段识别") return { ...step, status: "失败" };
    if (["人工确认", "写入项目"].includes(step.name)) return { ...step, status: "等待" };
    return step;
  });
}

async function analyzeAndApplyProjectFiles(db, project, job) {
  job.status = "解析中";
  job.progress = Math.max(job.progress || 0, 50);
  job.steps = setStepStatus(job.steps, "字段识别", "进行中");
  job.updatedAt = new Date().toISOString();

  const parsed = await analyzeProjectFiles(db.settings?.aiService, job.sourceValues || {}, job.files || [], db.settings?.interestRate);
  applyParsedFields(db, project, job, parsed);
}

function applyParsedFields(db, project, job, parsed) {
  const existingExtractedFields = project.extractedFields || {};
  const existingRevenueRecognition = existingExtractedFields.revenueRecognition || {};
  const parsedContract = parseMoney(parsed.contract);
  const existingContract = parseMoney(project.contract);
  const hasCostSheet = Boolean(parsed.hasCostSheet);
  const contract = hasCostSheet ? (existingContract || parsedContract) : (parsedContract || existingContract);
  const configuredRatioText = project.extractedFields?.executionBudgetRatio || job.sourceValues?.["执行预算占比"] || job.sourceValues?.["合同成本率"] || "";
  const configuredRatio = parsePercent(configuredRatioText);
  const configuredBudget = configuredRatio && contract ? contract * configuredRatio : parseMoney(project.costBudget);
  const profitBreakdown = hasCostSheet ? calculateProfitBreakdown(contract, parsed) : null;
  const costBudget = configuredBudget || (hasCostSheet ? profitBreakdown.executionBudget : 0) || parseMoney(project.costBudget);
  const previousCostUsed = parseMoney(project.costUsed);
  const currentUploadCost = hasCostSheet ? profitBreakdown.totalDeduction : 0;
  const costUsed = hasCostSheet ? previousCostUsed + currentUploadCost : previousCostUsed;
  if (hasCostSheet) {
    profitBreakdown.executionBudget = costBudget;
    profitBreakdown.totalDeduction = costUsed;
    profitBreakdown.profit = contract - costUsed;
    profitBreakdown.margin = profitMargin(contract, profitBreakdown.profit);
  }
  const parsedPaid = parseMoney(parsed.paid);
  const existingPaid = parseMoney(project.paid);
  const paid = hasCostSheet ? Math.max(existingPaid, parsedPaid) : parsedPaid;
  const receivable = parseMoney(parsed.receivable) || Math.max(contract - paid, 0);
  const oldName = project.name;
  const parsedProjectName = parsed.projectName || parsed.name || "";
  const shouldUseParsedName = (!project.name || project.name.startsWith("待解析合同-")) && parsedProjectName;

  Object.assign(project, {
    name: shouldUseParsedName ? parsedProjectName : project.name,
    client: project.client || parsed.client || "",
    contract,
    costBudget,
    costUsed,
    paid,
    receivable,
    status: "解析完成",
    risk: inferRisk({ contract, costBudget, costUsed, receivable }),
    aiSummary: parsed.summary || "文件已解析，结构化字段已同步到项目台账。",
    nextMilestone: parsed.nextMilestone || parsed.servicePeriod || parsed.deliveryDate || "",
    paymentDue: parsed.paymentDue || "",
    margin: contract ? profitMargin(contract, contract - costUsed) : 0,
    tasks: parsed.tasks || [],
    costs: hasCostSheet ? profitBreakdown.costs : (project.costs || []),
    extractedFields: mergeProjectExtractedFields(existingExtractedFields, parsed, {
      hasCostSheet,
      profitBreakdown,
      profit: contract - costUsed,
      revenueRecognition: existingRevenueRecognition
    })
  });
  project.extractedFields.executionBudgetRatio = configuredRatioText;
  project.extractedFields.executionBudget = costBudget;
  if (Array.isArray(parsed.extractedFiles) && parsed.extractedFiles.length) {
    project.files = parsed.extractedFiles;
    job.files = parsed.extractedFiles;
  }
  project.alerts = projectRiskAlerts(project);

  job.projectName = project.name;
  job.status = "已完成";
  job.progress = 100;
  job.extractedFields = parsed;
  job.updatedAt = new Date().toISOString();
  job.steps = job.steps.map((step) => ({ ...step, status: "完成" }));

  for (const supplier of hasCostSheet ? (parsed.suppliers || []) : []) {
    db.suppliers.unshift({
      supplier: supplier.supplier || supplier.name || "未命名供应商",
      project: project.name,
      type: supplier.type || "项目费用",
      amount: Number(supplier.amount || 0),
      status: supplier.status || "待结算"
    });
  }

  for (const supplier of db.suppliers || []) {
    if (supplier.project === oldName) supplier.project = project.name;
  }
}

function mergeProjectExtractedFields(existing = {}, parsed = {}, options = {}) {
  const revenueRecognition = {
    ...(existing.revenueRecognition || {}),
    ...(parsed.revenueRecognition || {}),
    ...(options.revenueRecognition || {})
  };
  const merged = options.hasCostSheet
    ? { ...existing, ...parsed, profitBreakdown: options.profitBreakdown, profit: options.profit }
    : { ...existing, ...parsed };
  if (Object.keys(revenueRecognition).length) merged.revenueRecognition = revenueRecognition;
  return merged;
}

export function validateAiSettings(values) {
  const normalized = normalizeAiSettings(values);
  if (!normalized["API Key"]) throw new Error("请先填写 API Key");
  if (!normalized["Base URL"]) throw new Error("请先填写 Base URL");
  if (!normalized["模型名称"]) throw new Error("请先选择服务商，系统会自动匹配模型名称");
  try {
    new URL(normalized["Base URL"]);
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  return normalized;
}

export async function testAiSettings(values) {
  const normalized = validateAiSettings(values);
  const baseUrl = normalized["Base URL"].replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${normalized["API Key"]}` },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`AI 服务返回 ${res.status}`);
    }
    return {
      provider: normalized["服务商"] || "OpenAI 兼容接口",
      model: normalized["模型名称"] || "",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 服务连接超时，请检查 Base URL 或网络");
    throw new Error(`AI 配置校验失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveSetting(db, type, values, user) {
  if (type === "companyFinance") return saveCompanyFinance(db, values, user);
  const current = db.settings?.[type] || {};
  const candidate = type === "aiService" ? { ...current, ...values } : values;
  const checked = type === "aiService" ? await testAiSettings(candidate) : null;
  const normalized = type === "aiService" ? validateAiSettings(candidate) : values;
  const saved = { ...current, ...normalized, connection: checked, savedAt: new Date().toISOString(), savedBy: user.id };
  db.settings[type] = saved;
  db.auditLogs.unshift({ type: "settings", target: type, user: user.name, at: saved.savedAt });
  return saved;
}

export function saveCompanyFinance(db, values = {}, user = {}) {
  db.settings = db.settings || {};
  const current = db.settings.companyFinance || {};
  const number = (key) => Math.max(0, Number(values[key] ?? current[key] ?? 0) || 0);
  const monthlyFixedCost =
    number("monthlyLaborCost") +
    number("monthlyRent") +
    number("monthlyLoan") +
    number("monthlyInterest") +
    number("monthlyOtherCost");
  const currentCash = number("currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置现金流参数"
    : runwayMonths < 3
      ? "危险！你快倒闭啦！需要收缩现金流"
      : runwayMonths < 6
        ? "现金偏紧，需要控制支出并加快回款"
        : "现金安全线达标，可以稳健推进";
  const saved = {
    ...current,
    currentCash,
    monthlyLaborCost: number("monthlyLaborCost"),
    monthlyRent: number("monthlyRent"),
    monthlyLoan: number("monthlyLoan"),
    monthlyInterest: number("monthlyInterest"),
    monthlyOtherCost: number("monthlyOtherCost"),
    monthlyFixedCost,
    safetyReserve,
    runwayMonths,
    gap,
    runwayLabel,
    note: String(values.note || current.note || "").trim(),
    savedAt: new Date().toISOString(),
    savedBy: user.id || "",
    savedByName: user.name || ""
  };
  db.settings.companyFinance = saved;
  db.auditLogs.unshift({
    type: "finance",
    target: "companyFinance",
    action: "save-cash-runway",
    user: user.name,
    at: saved.savedAt,
    meta: {
      monthlyFixedCost,
      currentCash,
      runwayMonths: Number(runwayMonths.toFixed(2)),
      gap
    }
  });
  syncCompanyCashRunwayNotificationAfterSave(db, saved, user);
  return saved;
}

export async function refreshInterestRate(db, user) {
  const current = db.settings?.interestRate || {};
  const fetched = await fetchLatestLprRate().catch((error) => ({
    ok: false,
    error: error.message,
    annualRate: Number(current.annualRate || current.fallbackRate || 3.45)
  }));
  const saved = {
    source: "latest_lpr",
    term: "1Y",
    annualRate: fetched.annualRate,
    spread: Number(current.spread || 0),
    fallbackRate: Number(current.fallbackRate || 3.45),
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    status: fetched.ok ? "已刷新" : "使用兜底利率",
    note: fetched.ok
      ? `已从中国货币网匹配 1 年期 LPR：${fetched.annualRate}%`
      : `联网刷新失败，继续使用兜底利率：${fetched.error || "未知错误"}`
  };
  Object.assign(saved, {
    "利率来源": saved.source,
    "年化利率": saved.annualRate,
    "公司加点": saved.spread,
    "兜底利率": saved.fallbackRate
  });
  db.settings.interestRate = saved;
  db.auditLogs.unshift({ type: "settings", target: "interestRate", user: user.name, at: saved.updatedAt });
  return saved;
}

async function fetchLatestLprRate() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://www.chinamoney.com.cn/chinese/bklpr/", {
      headers: { "user-agent": "ad-project-hub/1.0" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`中国货币网返回 ${res.status}`);
    const html = await res.text();
    const annualRate = parseLprRate(html);
    if (!annualRate) throw new Error("未识别到 1 年期 LPR");
    return { ok: true, annualRate };
  } finally {
    clearTimeout(timer);
  }
}

function parseLprRate(text) {
  const compact = String(text || "").replace(/\s+/g, " ");
  const oneYearMatch = compact.match(/1\s*年期[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/i)
    || compact.match(/一年期[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/i);
  if (oneYearMatch) return Number(oneYearMatch[1]);
  const rates = [...compact.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 20);
  return rates[0] || 0;
}

export async function recordFiles(db, body, user) {
  const now = new Date().toISOString();
  const files = await normalizeUploadedFiles(Array.isArray(body.files) ? body.files : [], body.type || body.category || "file", user, now, db.settings?.storage || {});
  const upload = { id: body.id || nextFileId("upload"), files, projectId: body.projectId || "", projectName: body.projectName || "", user: user.name, at: now };
  db.files.unshift(upload);
  db.auditLogs.unshift({ type: "upload", target: upload.projectName || "未命名项目", count: files.length, user: user.name, at: now });
  return upload;
}

export async function testObjectStorage(db, values = {}, user = {}) {
  const now = new Date().toISOString();
  const settings = { ...(db.settings?.storage || {}), ...(values || {}) };
  const fileName = `oa-storage-test-${now.slice(0, 10)}.txt`;
  const content = `ad-project-hub object storage test\n${now}\n`;
  const [file] = await normalizeUploadedFiles([{
    name: fileName,
    type: "text/plain",
    size: Buffer.byteLength(content),
    base64: Buffer.from(content, "utf8").toString("base64")
  }], "storage-test", user, now, settings);
  const ok = Boolean(file.storageUrl || file.localStorageUrl) && !file.storageRemoteError;
  db.auditLogs.unshift({
    type: "settings",
    target: "storage",
    action: "test-object-storage",
    user: user.name,
    at: now,
    meta: {
      ok,
      provider: file.storageProvider || settings.provider || "local",
      storageStatus: file.storageStatus || "",
      storageUrl: file.storageUrl || "",
      localStorageUrl: file.localStorageUrl || "",
      error: file.storageRemoteError || ""
    }
  });
  return {
    ok,
    provider: file.storageProvider || settings.provider || "local",
    storageStatus: file.storageStatus || "",
    storageUrl: file.storageUrl || "",
    localStorageUrl: file.localStorageUrl || "",
    storagePath: file.storagePath || "",
    localStoragePath: file.localStoragePath || "",
    storageRemoteError: file.storageRemoteError || "",
    fileName,
    testedAt: now
  };
}

function nextFileId(prefix = "file") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function fileArchiveMatches(file = {}, body = {}) {
  if (body.fileId && file.id === body.fileId) return true;
  const name = String(body.fileName || body.name || "").trim();
  const uploadedAt = String(body.uploadedAt || "").trim();
  if (!name || file.name !== name) return false;
  if (uploadedAt && file.uploadedAt !== uploadedAt) return false;
  return true;
}

function safeFileName(name = "file") {
  const ext = extname(String(name || "")).slice(0, 12);
  const base = String(name || "file")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "file";
  return `${base}${ext || ""}`;
}

function storageObjectKey(file = {}, category = "file", now = new Date().toISOString(), settings = {}) {
  const prefix = String(settings.pathPrefix || settings.prefix || "ad-project-hub").replace(/^\/+|\/+$/g, "");
  const day = now.slice(0, 10);
  const id = file.id || nextFileId();
  return [prefix, day, `${id}-${safeFileName(file.name || "upload")}`].filter(Boolean).join("/");
}

function s3Enabled(settings = {}) {
  const provider = String(settings.provider || "").toLowerCase();
  return Boolean(settings.bucket && (settings.endpoint || provider.includes("s3") || provider.includes("r2") || provider.includes("minio")) && settings.accessKeyId && settings.secretAccessKey);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacBuffer(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function s3PublicUrl(settings = {}, objectKey = "") {
  const base = String(settings.publicBaseUrl || "").replace(/\/+$/, "");
  if (base) return `${base}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const endpoint = String(settings.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) return "";
  return `${endpoint}/${settings.bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

function s3SignedHeaders({ settings = {}, objectKey = "", buffer, contentType = "application/octet-stream", now = new Date() }) {
  const endpointUrl = new URL(String(settings.endpoint || `https://${settings.bucket}.s3.${settings.region || "us-east-1"}.amazonaws.com`).replace(/\/+$/, ""));
  const region = String(settings.region || "us-east-1");
  const service = "s3";
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const pathStyle = settings.pathStyle === true || settings.pathStyle === "true" || endpointUrl.hostname.includes("r2.cloudflarestorage.com") || endpointUrl.hostname.includes("localhost") || endpointUrl.hostname.includes("127.0.0.1");
  const canonicalUri = `/${[pathStyle ? settings.bucket : "", objectKey].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`;
  const host = pathStyle ? endpointUrl.host : `${settings.bucket}.${endpointUrl.host}`;
  const payloadHash = sha256Hex(buffer);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmacBuffer(hmacBuffer(hmacBuffer(hmacBuffer(`AWS4${settings.secretAccessKey}`, date), region), service), "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);
  return {
    url: `${endpointUrl.protocol}//${host}${canonicalUri}`,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": contentType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  };
}

async function uploadToS3CompatibleStorage(file = {}, buffer, category = "file", now = new Date().toISOString(), settings = {}) {
  const objectKey = storageObjectKey(file, category, now, settings);
  const publicUrl = s3PublicUrl(settings, objectKey);
  const mockUpload = settings.mockUpload === true || settings.mockUpload === "true";
  if (mockUpload) {
    return { storageUrl: publicUrl || `s3://${settings.bucket}/${objectKey}`, storagePath: objectKey, storageProvider: settings.provider || "s3-compatible", storageStatus: "已上传对象存储", storageMocked: true };
  }
  const { url, headers } = s3SignedHeaders({ settings, objectKey, buffer, contentType: file.type || "application/octet-stream" });
  const res = await fetch(url, { method: "PUT", headers, body: buffer });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`对象存储上传失败：${res.status} ${text.slice(0, 160)}`);
  }
  return { storageUrl: publicUrl || url, storagePath: objectKey, storageProvider: settings.provider || "s3-compatible", storageStatus: "已上传对象存储" };
}

async function persistLocalUploadFile(file = {}, category = "file", now = new Date().toISOString(), storageSettings = {}) {
  if (file.storageUrl || file.storagePath) return file;
  if (!file.base64) return { ...file, storageStatus: file.storageStatus || "仅记录文件信息" };
  const buffer = Buffer.from(String(file.base64 || ""), "base64");
  if (!buffer.length) return { ...file, storageStatus: "仅记录文件信息" };
  const day = now.slice(0, 10);
  const id = file.id || nextFileId();
  const folder = join(rootDir, "uploads", day);
  await mkdir(folder, { recursive: true });
  const name = `${id}-${safeFileName(file.name || "upload")}`;
  const diskPath = join(folder, name);
  await writeFile(diskPath, buffer);
  const localRecord = {
    ...file,
    id,
    storageUrl: `/uploads/${day}/${encodeURIComponent(name)}`,
    storagePath: `uploads/${day}/${name}`,
    storageProvider: "local",
    storageStatus: "已持久化",
    category: file.category || category,
    size: file.size || buffer.length
  };
  if (!s3Enabled(storageSettings)) return localRecord;
  try {
    const remote = await uploadToS3CompatibleStorage(localRecord, buffer, category, now, storageSettings);
    return { ...localRecord, ...remote, localStorageUrl: localRecord.storageUrl, localStoragePath: localRecord.storagePath };
  } catch (error) {
    return { ...localRecord, storageRemoteError: error.message };
  }
}

export function archiveFileRecord(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.projectName);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  let archivedFile = null;
  let archivedUpload = null;
  db.files = db.files || [];
  for (const upload of db.files) {
    const matchesProject = upload.projectId === project.id || upload.projectName === project.name;
    if (!matchesProject) continue;
    upload.files = (upload.files || []).map((file) => {
      if (archivedFile || file.archivedAt || !fileArchiveMatches(file, body)) return file;
      archivedFile = {
        ...file,
        archivedAt: at,
        archivedBy: user.id,
        archivedByName: user.name,
        archiveReason: String(body.reason || "").trim() || "文件归档纠错"
      };
      archivedUpload = upload;
      return archivedFile;
    });
  }
  if (!archivedFile) {
    for (const file of project.files || []) {
      if (archivedFile || file.archivedAt || !fileArchiveMatches(file, body)) continue;
      archivedFile = {
        ...file,
        archivedAt: at,
        archivedBy: user.id,
        archivedByName: user.name,
        archiveReason: String(body.reason || "").trim() || "文件归档纠错"
      };
    }
    if (archivedFile) {
      project.files = (project.files || []).map((file) => fileArchiveMatches(file, body) ? archivedFile : file);
    }
  }
  if (!archivedFile) throw new Error("文件记录不存在");
  db.auditLogs.unshift({
    type: "upload",
    target: project.name,
    action: "archive-file",
    user: user.name,
    meta: {
      uploadId: archivedUpload?.id || "",
      fileId: archivedFile.id || "",
      fileName: archivedFile.name || "",
      reason: archivedFile.archiveReason
    },
    at
  });
  return { projectId: project.id, projectName: project.name, uploadId: archivedUpload?.id || "", file: archivedFile };
}

export function updateAlert(db, body, user) {
  const at = new Date().toISOString();
  const update = { ...body, user: user.name, at };
  db.alertUpdates.unshift(update);
  db.auditLogs.unshift({ type: "alert", target: body.project, action: body.action, user: user.name, at });
  return update;
}

export function addComment(db, body, user) {
  const at = new Date().toISOString();
  const comment = { id: body.id || nextCommentId(), ...body, user: user.name, userId: user.id, at };
  db.comments.unshift(comment);
  db.auditLogs.unshift({ type: "comment", target: body.project, user: user.name, at });
  return comment;
}

function nextCommentId() {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function archiveComment(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.project || item.name === body.projectName);
  if (!project) throw new Error("项目不存在");
  const commentId = String(body.id || body.commentId || "").trim();
  const at = new Date().toISOString();
  const comments = db.comments || [];
  const comment = comments.find((item) => {
    const sameProject = item.project === project.name || item.projectName === project.name || item.projectId === project.id;
    if (!sameProject || item.archivedAt) return false;
    if (commentId && item.id === commentId) return true;
    return item.body === body.body && item.at === body.at;
  });
  if (!comment) throw new Error("项目动态不存在");
  const isOwner = comment.userId === user.id || comment.user === user.name;
  if (!isOwner && !["shareholder", "admin", "director", "pm"].includes(user.role)) throw new Error("只有记录人或项目管理角色可以归档动态");
  comment.archivedAt = at;
  comment.archivedBy = user.id;
  comment.archivedByName = user.name;
  comment.archiveReason = String(body.reason || "").trim() || "项目动态归档纠错";
  db.auditLogs.unshift({
    type: "comment",
    target: project.name,
    action: "archive",
    user: user.name,
    meta: { commentId: comment.id || "", reason: comment.archiveReason },
    at
  });
  return comment;
}

function nextNotificationId(seed = "") {
  return `notice-${Date.now().toString(36)}-${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

function notificationKey(item = {}) {
  return [item.type, item.projectId || item.projectName || "", item.sourceId || ""].join("::");
}

function projectHasAssignedPm(project = {}) {
  const pm = String(project.pm || project.extractedFields?.pm || "").trim();
  return Boolean(pm && !/待分派|待确认|未分配|暂无/.test(pm));
}

function notificationRecipientsForRole(role) {
  const map = {
    management: ["shareholder", "admin", "director"],
    finance: ["shareholder", "admin", "finance"],
    pm: ["shareholder", "admin", "director", "pm"],
    sales: ["shareholder", "admin", "director", "sales"]
  };
  return map[role] || ["shareholder", "admin"];
}

function projectTimeHealth(project = {}, now = new Date()) {
  const start = new Date(project.startDate || project.serviceStart || project.createdAt || now);
  const end = new Date(project.endDate || project.serviceEnd || project.deadline || project.deliveryDate || now.getTime() + 30 * 86400000);
  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, now - start);
  const timeProgress = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const completion = Math.max(0, Math.min(100, Math.round(Number(project.progress || 0))));
  const diff = completion - timeProgress;
  return { completion, timeProgress, diff };
}

function projectCostPressure(project = {}) {
  const breakdown = project.extractedFields?.profitBreakdown || {};
  const executionBudget = parseMoney(project.extractedFields?.executionBudget)
    || parseMoney(breakdown.executionBudget)
    || (project.extractedFields?.profitBreakdown ? 0 : parseMoney(project.costBudget));
  const costUsed = parseMoney(project.costUsed)
    || parseMoney(breakdown.executionCost)
    || Number((breakdown.costs || []).reduce?.((sum, item) => sum + Number(item?.[1] || item?.amount || 0), 0) || 0);
  const rate = executionBudget ? costUsed / executionBudget : 0;
  return {
    executionBudget,
    costUsed,
    rate,
    percent: Math.round(rate * 100)
  };
}

function cashRunwayForNotifications(settings = {}) {
  const finance = settings.companyFinance || {};
  const currentCash = Number(finance.currentCash || 0);
  const monthlyFixedCost = [
    finance.monthlyLaborCost,
    finance.monthlyRent,
    finance.monthlyLoan,
    finance.monthlyInterest,
    finance.monthlyOtherCost
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  if (!monthlyFixedCost) return null;
  const runwayMonths = currentCash / monthlyFixedCost;
  const safetyReserve = monthlyFixedCost * 6;
  const gap = Math.max(safetyReserve - currentCash, 0);
  return { currentCash, monthlyFixedCost, runwayMonths, safetyReserve, gap };
}

function upsertSystemNotification(db, draft) {
  db.systemNotifications = db.systemNotifications || [];
  const key = draft.key || notificationKey(draft);
  const at = new Date().toISOString();
  const existing = db.systemNotifications.find((item) => item.key === key && !["已处理", "已忽略"].includes(item.status));
  if (existing) {
    Object.assign(existing, {
      ...draft,
      key,
      status: existing.status || "待处理",
      createdAt: existing.createdAt || at,
      updatedAt: at
    });
    return existing;
  }
  const record = {
    id: nextNotificationId(key),
    key,
    type: draft.type || "system",
    title: draft.title || "系统提醒",
    text: draft.text || "",
    severity: draft.severity || "中",
    role: draft.role || "management",
    recipients: draft.recipients || notificationRecipientsForRole(draft.role || "management"),
    projectId: draft.projectId || "",
    projectName: draft.projectName || "",
    source: draft.source || "scanner",
    sourceId: draft.sourceId || "",
    actionLabel: draft.actionLabel || "查看",
    actionView: draft.actionView || "",
    status: "待处理",
    createdAt: at,
    updatedAt: at
  };
  db.systemNotifications.unshift(record);
  return record;
}

export function scanSystemNotifications(db, user = { id: "system", name: "系统扫描" }) {
  db.systemNotifications = db.systemNotifications || [];
  const now = new Date();
  const notifications = [];

  for (const project of db.projects || []) {
    const quoteRules = project.extractedFields?.revenueRecognition?.quoteRules || [];
    const createdAt = project.createdAt ? new Date(project.createdAt) : now;
    const hoursSinceCreated = Math.max(0, (now - createdAt) / 36e5);
    if (!projectHasAssignedPm(project) && (quoteRules.length || /待补|草稿|AI解析中|筹备/.test(String(project.status || "")) || hoursSinceCreated >= 1)) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-assignment",
        title: "项目待分派 PM",
        text: `「${project.name}」还没有明确 PM。建议总监尽快分派，避免合同/报价已进来但执行没人承接。`,
        severity: hoursSinceCreated >= 24 ? "高" : "中",
        role: "management",
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "去分派",
        actionView: "admin:assignments"
      }));
    }

    const status = String(project.status || "");
    const activeProject = !/已完成|完成|结案|已结案|取消/.test(status);
    const health = projectTimeHealth(project, now);
    if (activeProject) {
      for (const task of (project.tasks || []).map(normalizeProjectTask)) {
        const due = taskDueInfo(task, now);
        if (!due.active) continue;
        notifications.push(upsertSystemNotification(db, {
          type: "project-task-due",
          title: due.tone === "overdue" ? "项目任务已逾期" : due.tone === "today" ? "项目任务今天截止" : "项目任务即将截止",
          text: `「${project.name}」任务「${task.title}」${due.label}，负责人 ${task.owner || project.pm || project.owner || "待确认"}，当前进度 ${task.progress || 0}%。请及时更新进度或标记完成。`,
          severity: due.tone === "overdue" ? "高" : "中",
          role: "pm",
          recipients: notificationRecipientsForRole("pm"),
          projectId: project.id,
          projectName: project.name,
          source: "task-scanner",
          sourceId: task.id,
          actionLabel: "看任务",
          actionView: "project-detail"
        }));
      }
    }

    if (activeProject && health.timeProgress >= 20 && health.diff <= -15) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-progress-lag",
        title: "项目进度滞后",
        text: `「${project.name}」完成度 ${health.completion}%，时间进度 ${health.timeProgress}%，已落后 ${Math.abs(health.diff)} 个百分点。建议 PM 拆出本周必须完成的交付节点。`,
        severity: health.diff <= -30 ? "高" : "中",
        role: "pm",
        recipients: notificationRecipientsForRole("pm"),
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "看项目",
        actionView: "project-detail"
      }));
    }

    const costPressure = projectCostPressure(project);
    if (activeProject && costPressure.executionBudget && costPressure.rate >= 0.8) {
      const overBudget = costPressure.rate >= 1;
      notifications.push(upsertSystemNotification(db, {
        type: overBudget ? "project-cost-overrun" : "project-cost-pressure",
        title: overBudget ? "项目成本已超预算" : "项目成本接近预算",
        text: `「${project.name}」执行成本 ${costPressure.costUsed.toLocaleString("zh-CN")} 元，预算 ${costPressure.executionBudget.toLocaleString("zh-CN")} 元，已使用 ${costPressure.percent}%。${overBudget ? "建议暂停非必要支出并做成本复盘。" : "建议 PM 先确认后续支出是否必须发生。"}`,
        severity: overBudget ? "高" : "中",
        role: "pm",
        recipients: Array.from(new Set([...notificationRecipientsForRole("pm"), "finance"])),
        projectId: project.id,
        projectName: project.name,
        source: "cost-scanner",
        sourceId: project.id,
        actionLabel: overBudget ? "看成本复盘" : "看成本压力",
        actionView: "project-detail"
      }));
    }

    const contract = Number(project.contract || 0);
    const receivable = Number(project.receivable || Math.max(contract - Number(project.paid || 0), 0));
    const receivableRate = contract ? Math.round((receivable / contract) * 100) : 0;
    if (activeProject && receivable > 0 && (receivableRate >= 50 || /逾期|本月底|月底|付款|回款/.test(String(project.paymentDue || "")))) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-receivable-risk",
        title: "项目回款需要跟进",
        text: `「${project.name}」待回款 ${receivable.toLocaleString("zh-CN")} 元，占合同 ${receivableRate}%。建议销售/PM确认「${project.paymentDue || "下一笔回款节点"}」。`,
        severity: receivableRate >= 80 ? "高" : "中",
        role: "sales",
        recipients: notificationRecipientsForRole("sales"),
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "看回款",
        actionView: "project-detail"
      }));
    }

    const targetText = monthlyVerificationTargetText(project);
    if (activeProject && targetText) {
      notifications.push(upsertSystemNotification(db, {
        type: "verification-sheet-missing",
        title: "本月核销表待上传",
        text: `「${project.name}」本月还没有核销记录。AI 已从报价表识别月度目标：${targetText}。请 PM 或执行同事完成后上传核销表。`,
        severity: "中",
        role: "pm",
        recipients: notificationRecipientsForRole("pm"),
        projectId: project.id,
        projectName: project.name,
        source: "verification-scanner",
        sourceId: project.id,
        actionLabel: "上传核销表",
        actionView: "project-files"
      }));
    }

    const pendingSupplierRows = pendingSupplierRowsForProject(db, project);
    const pendingSupplierAmount = pendingSupplierRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (activeProject && pendingSupplierRows.length) {
      const topSuppliers = pendingSupplierRows
        .slice()
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        .slice(0, 3)
        .map((item) => `${item.supplier || "未命名供应商"} ${Number(item.amount || 0).toLocaleString("zh-CN")}元`)
        .join("、");
      notifications.push(upsertSystemNotification(db, {
        type: "supplier-settlement-pending",
        title: "供应商待结算",
        text: `「${project.name}」还有 ${pendingSupplierRows.length} 条供应商待结算，合计 ${pendingSupplierAmount.toLocaleString("zh-CN")} 元。${topSuppliers ? `主要为：${topSuppliers}。` : ""}请 PM/财务确认是否发起供应商付款或标记已付款。`,
        severity: pendingSupplierAmount >= 20000 || pendingSupplierRows.length >= 3 ? "高" : "中",
        role: "finance",
        recipients: Array.from(new Set([...notificationRecipientsForRole("finance"), ...notificationRecipientsForRole("pm")])),
        projectId: project.id,
        projectName: project.name,
        source: "supplier-scanner",
        sourceId: project.id,
        actionLabel: "看供应商结算",
        actionView: "project-detail"
      }));
    }
  }

  const runway = cashRunwayForNotifications(db.settings || {});
  if (runway && runway.runwayMonths < 6) {
    notifications.push(upsertSystemNotification(db, {
      type: "company-cash-runway",
      title: runway.runwayMonths < 3 ? "危险！你快倒闭啦！需要收缩现金流" : "公司现金流低于 6 个月安全线",
      text: `当前现金可撑 ${runway.runwayMonths.toFixed(1)} 个月，月固定支出 ${runway.monthlyFixedCost.toLocaleString("zh-CN")} 元，6个月安全线缺口 ${runway.gap.toLocaleString("zh-CN")} 元。`,
      severity: runway.runwayMonths < 3 ? "高" : "中",
      role: "finance",
      recipients: notificationRecipientsForRole("finance"),
      source: "finance-scanner",
      sourceId: "company-cash-runway",
      actionLabel: "看现金流",
      actionView: "management:cash"
    }));
  }

  for (const item of db.feishuPendingFiles || []) {
    if (item.status !== "待确认") continue;
    const createdAt = item.createdAt ? new Date(item.createdAt) : now;
    const hours = Math.max(0, (now - createdAt) / 36e5);
    notifications.push(upsertSystemNotification(db, {
      type: "feishu-pending-file",
      title: "飞书文件待确认",
      text: `「${item.file?.name || item.preview?.fileName || "飞书文件"}」来自飞书，等待确认后才会写入「${item.projectName || "待匹配项目"}」。`,
      severity: hours >= 24 ? "高" : "中",
      role: "pm",
      recipients: notificationRecipientsForRole("pm"),
      projectId: item.projectId || "",
      projectName: item.projectName || "",
      source: "feishu",
      sourceId: item.id,
      actionLabel: "处理文件",
      actionView: "project-files"
    }));
  }

  for (const approval of db.approvals || []) {
    if (!isPendingApprovalForScan(approval)) continue;
    const createdAt = approval.createdAt ? new Date(approval.createdAt) : now;
    const hours = Math.max(0, (now - createdAt) / 36e5);
    if (hours < 24) continue;
    const financeRole = approval.currentRole === "finance" || /财务/.test(String(approval.currentRole || ""));
    const ownerRole = approval.currentRole === "owner" || /老板/.test(String(approval.status || ""));
    notifications.push(upsertSystemNotification(db, {
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: `「${approval.projectName || "项目"}」的${approval.typeLabel || approval.type || "审批"} ${approval.amount || 0} 元已等待较久，请${financeRole ? "财务" : ownerRole ? "老板线" : "负责人"}及时处理。`,
      severity: hours >= 48 ? "高" : "中",
      role: financeRole ? "finance" : ownerRole ? "management" : "management",
      recipients: financeRole ? notificationRecipientsForRole("finance") : approval.currentRole === "pm" ? notificationRecipientsForRole("pm") : notificationRecipientsForRole("management"),
      projectId: approval.projectId || "",
      projectName: approval.projectName || "",
      source: "approval",
      sourceId: approval.id,
      actionLabel: "看审批",
      actionView: "approvals"
    }));
  }

  db.systemNotifications = db.systemNotifications.slice(0, 200);
  db.auditLogs.unshift({
    type: "notification",
    target: "system",
    action: "scan",
    user: user.name || "系统扫描",
    meta: { active: db.systemNotifications.filter((item) => item.status === "待处理").length, generated: notifications.length },
    at: new Date().toISOString()
  });
  return db.systemNotifications;
}

function isPendingApprovalForScan(approval = {}) {
  const status = String(approval.status || "");
  if (!approval.id || ["已完成", "已驳回", "已撤回"].includes(status)) return false;
  if (status.includes("待") || status.includes("审批中") || status.includes("处理中")) return true;
  return Boolean(approval.currentRole && currentApprovalStep(approval));
}

function monthlyVerificationTargetText(project = {}, now = new Date()) {
  const revenue = project.extractedFields?.revenueRecognition || {};
  const quoteRules = Array.isArray(revenue.quoteRules) ? revenue.quoteRules : [];
  if (!quoteRules.length) return "";
  const targetText = monthlyTargetSummaryFromRules(quoteRules);
  if (!targetText) return "";
  const currentMonth = monthKey(now);
  const hasVerification = (revenue.verificationRecords || []).some((record) => record.month === currentMonth);
  return hasVerification ? "" : targetText;
}

export function updateSystemNotification(db, body, user) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const at = new Date().toISOString();
  const action = body?.action === "ignore" ? "ignore" : body?.action === "reopen" ? "reopen" : "resolve";
  if (action === "reopen") {
    item.status = "待处理";
    item.reopenedAt = at;
    item.reopenedBy = user.id;
    item.reopenedByName = user.name;
    item.reopenReason = String(body.note || body.reason || "").trim();
  } else {
    item.status = action === "ignore" ? "已忽略" : "已处理";
    item.handledAt = at;
    item.handledBy = user.id;
    item.handledByName = user.name;
    item.note = String(body.note || "").trim();
  }
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "notification",
    target: item.title,
    action,
    user: user.name,
    meta: { notificationId: item.id, source: item.source, sourceId: item.sourceId },
    at
  });
  return item;
}

function feishuMessageTextForNotification(item = {}) {
  const lines = [
    `【${item.title || "OA 待办"}】`,
    item.projectName ? `项目：${item.projectName}` : "",
    item.severity ? `优先级：${item.severity}` : "",
    item.text || "",
    item.actionLabel ? `建议动作：${item.actionLabel}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function candidateUsersForNotification(db, item = {}) {
  const roles = Array.isArray(item.recipients) && item.recipients.length ? item.recipients : notificationRecipientsForRole(item.role);
  const activeUsers = (db.users || []).filter((user) => user.status !== "disabled");
  const project = (db.projects || []).find((row) => row.id === item.projectId || row.name === item.projectName);
  const projectNames = new Set([project?.pm, project?.owner, project?.sales].filter(Boolean).map((name) => String(name).toLowerCase()));
  let users = activeUsers.filter((user) => roles.includes(user.role));
  if (item.projectId && projectNames.size) {
    const projectUsers = activeUsers.filter((user) => projectNames.has(String(user.name || "").toLowerCase()) || projectNames.has(String(user.email || "").toLowerCase()));
    users = [...projectUsers, ...users];
  }
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

async function sendFeishuTextMessage(settings = {}, openId, text) {
  if (!openId) throw new Error("缺少飞书 open_id");
  const mockSend = settings.mockSend === true || settings.mockSend === "true" || settings.mockNotificationSend === true || settings.mockNotificationSend === "true";
  if (mockSend) {
    return { mocked: true, receiveId: openId, messageId: `mock-${Date.now()}` };
  }
  const token = await getFeishuTenantAccessToken(settings);
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) {
    throw new Error(`飞书私聊发送失败：${payload.msg || res.status}`);
  }
  return { messageId: payload.data?.message_id || "", receiveId: openId, raw: payload.data || {} };
}

export async function sendSystemNotificationToFeishu(db, body, user) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const settings = db.settings?.feishu || {};
  const recipients = candidateUsersForNotification(db, item)
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email || "",
      role: recipient.role,
      openId: recipient.feishuOpenId || recipient.feishuUserId || "",
      feishuName: recipient.feishuName || recipient.name
    }));
  const targets = recipients.filter((recipient) => recipient.openId);
  const missingRecipients = recipients.filter((recipient) => !recipient.openId)
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      role: recipient.role
    }));
  if (!targets.length) {
    const delivery = {
      sentAt: new Date().toISOString(),
      sentBy: user.id,
      sentByName: user.name,
      text: "",
      results: [],
      missingRecipients,
      okCount: 0,
      total: recipients.length,
      missingCount: missingRecipients.length,
      blocked: true,
      error: "没有找到已绑定飞书 Open ID 的收件人，请先在成员管理里填写飞书 Open ID。"
    };
    item.feishuDelivery = delivery;
    item.updatedAt = delivery.sentAt;
    throw Object.assign(new Error(delivery.error), { data: delivery });
  }
  const text = String(body.text || feishuMessageTextForNotification(item)).trim();
  const at = new Date().toISOString();
  const results = [];
  for (const target of targets) {
    try {
      const result = await sendFeishuTextMessage(settings, target.openId, text);
      results.push({ ...target, ok: true, ...result });
    } catch (error) {
      results.push({ ...target, ok: false, error: error.message });
    }
  }
  item.feishuDelivery = {
    sentAt: at,
    sentBy: user.id,
    sentByName: user.name,
    text,
    results,
    missingRecipients,
    okCount: results.filter((row) => row.ok).length,
    failCount: results.filter((row) => !row.ok).length,
    missingCount: missingRecipients.length,
    total: recipients.length
  };
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "feishu",
    target: item.title,
    action: "send-notification",
    user: user.name,
    meta: { notificationId: item.id, total: results.length, ok: results.filter((row) => row.ok).length },
    at
  });
  return item.feishuDelivery;
}

async function sendWechatWebhookMessage(settings = {}, text) {
  const webhookUrl = String(settings.webhookUrl || settings.webhook || "").trim();
  if (!webhookUrl) throw new Error("企业微信 Webhook 未配置，请先在产品设置里填写群机器人 Webhook。");
  const mockSend = settings.mockSend === true || settings.mockSend === "true" || settings.mockNotificationSend === true || settings.mockNotificationSend === "true";
  if (mockSend) {
    return { mocked: true, webhookConfigured: true, messageId: `mock-wechat-${Date.now()}` };
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: text }
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || Number(payload.errcode || 0) !== 0) {
    throw new Error(`企业微信发送失败：${payload.errmsg || res.status}`);
  }
  return { webhookConfigured: true, raw: payload };
}

export async function sendSystemNotificationToWechat(db, body, user) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const settings = db.settings?.wechat || {};
  const text = String(body.text || feishuMessageTextForNotification(item)).trim();
  const at = new Date().toISOString();
  const result = await sendWechatWebhookMessage(settings, text);
  item.wechatDelivery = {
    sentAt: at,
    sentBy: user.id,
    sentByName: user.name,
    text,
    ok: true,
    ...result
  };
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "wechat",
    target: item.title,
    action: "send-notification",
    user: user.name,
    meta: { notificationId: item.id, ok: true, mocked: Boolean(result.mocked) },
    at
  });
  return item.wechatDelivery;
}

const APPROVAL_LABELS = {
  petty_cash: "项目备用金",
  reimbursement: "报销",
  supplier_payment: "供应商付款"
};
const EXPENSE_CATEGORIES = ["拍摄交通", "餐饮", "住宿", "道具", "场地", "达人/KOL", "制作", "投放", "快递", "办公杂费", "其他"];
const EXPENSE_CATEGORY_RULES = [
  { category: "拍摄交通", keywords: ["打车", "出租", "网约车", "滴滴", "油费", "停车", "过路", "高速", "高铁", "火车", "机票", "航班", "交通", "车费", "租车"] },
  { category: "餐饮", keywords: ["餐", "饭", "盒饭", "午餐", "晚餐", "饮料", "咖啡", "奶茶", "招待", "餐费"] },
  { category: "住宿", keywords: ["住宿", "酒店", "民宿", "房费", "客房"] },
  { category: "道具", keywords: ["道具", "物料", "服装", "化妆", "造型", "布景", "美术", "样品", "置景"] },
  { category: "场地", keywords: ["场地", "影棚", "摄影棚", "录音棚", "租场", "场租"] },
  { category: "达人/KOL", keywords: ["达人", "kol", "koc", "博主", "主播", "演员", "模特", "出镜", "艺人", "肖像"] },
  { category: "制作", keywords: ["拍摄", "摄影", "摄像", "剪辑", "后期", "制作", "导演", "灯光", "收音", "器材", "设备", "航拍", "调色"] },
  { category: "投放", keywords: ["投放", "广告费", "信息流", "dou+", "巨量", "小红书", "流量", "推广", "媒介"] },
  { category: "快递", keywords: ["快递", "物流", "顺丰", "邮寄", "运费", "同城"] },
  { category: "办公杂费", keywords: ["办公", "打印", "复印", "文具", "耗材", "软件", "会员", "杂费"] }
];

function inferExpenseCategory(body = {}) {
  const manual = String(body.expenseCategory || body.categoryDetail || "").trim();
  if (manual && manual !== "自动识别" && EXPENSE_CATEGORIES.includes(manual)) {
    return { category: manual, source: "manual", confidence: 1 };
  }
  const text = [body.reason, body.payee, body.note, body.description, body.scope]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  for (const rule of EXPENSE_CATEGORY_RULES) {
    const hits = rule.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
    if (hits) return { category: rule.category, source: "ai-rule", confidence: Math.min(0.95, 0.58 + hits * 0.12) };
  }
  return { category: "其他", source: "ai-rule", confidence: 0.35 };
}

function nextApprovalId() {
  return `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function approvalRuleNumber(rules = {}, key, fallback) {
  const value = Number(rules[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function approvalSteps(type, amount = 0, rules = {}) {
  const numericAmount = Number(amount || 0);
  const pettyCashDirectorLimit = approvalRuleNumber(rules, "pettyCashDirectorLimit", 3000);
  const financeRequiredAmount = approvalRuleNumber(rules, "financeRequiredAmount", 1000);
  const ownerRequiredAmount = approvalRuleNumber(rules, "ownerRequiredAmount", 10000);
  const needsDirector = type === "petty_cash"
    ? numericAmount >= pettyCashDirectorLimit
    : type === "reimbursement"
      ? numericAmount > financeRequiredAmount
      : true;
  const needsFinance = type !== "petty_cash" || numericAmount >= financeRequiredAmount;
  const needsOwner = numericAmount >= ownerRequiredAmount;
  const base = [
    { key: "submit", label: "员工提交", role: "member", status: "done" },
    { key: "pm", label: "PM确认", role: "pm", status: "current" },
    { key: "director", label: "总监审批", role: "director", status: "todo" },
    { key: "finance", label: "财务处理", role: "finance", status: "todo" },
    { key: "owner", label: "老板审批", role: "owner", status: "todo" },
    { key: "done", label: type === "reimbursement" ? "完成入账" : "完成付款", role: "finance", status: "todo" }
  ];
  if (type === "supplier_payment") base[0].label = "PM发起";
  return base.filter((step) => {
    if (step.key === "director") return needsDirector;
    if (step.key === "finance") return needsFinance;
    if (step.key === "owner") return needsOwner;
    return true;
  });
}

function currentApprovalStep(approval) {
  return (approval.steps || []).find((step) => step.status === "current");
}

function approvalHandlerLabel(role = "") {
  if (role === "pm") return "PM / 项目负责人";
  if (role === "director") return "项目总监";
  if (role === "finance") return "财务";
  if (role === "owner") return "老板 / 股东";
  return "审批负责人";
}

function approvalNextActionHint(approval = {}) {
  if (approval.status === "已完成") return "审批已完成，财务影响已写入项目。";
  if (approval.status === "已驳回") return "审批已驳回，可按意见补充后重新提交。";
  if (approval.status === "已撤回") return "审批已撤回，不会继续流转。";
  const step = currentApprovalStep(approval);
  if (!step) return "等待提交或流程已结束。";
  return `当前轮到${approvalHandlerLabel(step.role)}处理「${step.label}」。`;
}

function enrichApprovalRuntimeFields(approval = {}, at = new Date().toISOString()) {
  const step = currentApprovalStep(approval);
  const terminal = ["已完成", "已驳回", "已撤回"].includes(String(approval.status || ""));
  const updatedAt = approval.updatedAt || approval.createdAt || at;
  const waitHours = terminal ? 0 : Math.max(0, Math.round((new Date(at) - new Date(updatedAt)) / 36e5));
  const slaDueAt = terminal ? "" : new Date(new Date(updatedAt).getTime() + 24 * 36e5).toISOString();
  approval.currentStepLabel = step?.label || "";
  approval.currentHandlerLabel = step ? approvalHandlerLabel(step.role) : "";
  approval.nextActionHint = approvalNextActionHint(approval);
  approval.waitHours = waitHours;
  approval.slaDueAt = slaDueAt;
  approval.slaStatus = terminal ? "已结束" : waitHours >= 24 ? "已超时" : waitHours >= 18 ? "即将超时" : "正常";
  return approval;
}

function syncApprovalSteps(approval, action, user) {
  const currentIndex = (approval.steps || []).findIndex((step) => step.status === "current");
  if (currentIndex < 0) return;
  if (action === "reject") {
    approval.steps[currentIndex].status = "rejected";
    approval.status = "已驳回";
    approval.currentRole = "";
    return;
  }
  approval.steps[currentIndex].status = "done";
  const nextIndex = approval.steps.findIndex((step, index) => index > currentIndex && step.key !== "done");
  if (nextIndex >= 0) {
    approval.steps[nextIndex].status = "current";
    approval.currentRole = approval.steps[nextIndex].role;
    approval.status = `待${approval.steps[nextIndex].label}`;
    return;
  }
  const doneStep = approval.steps.find((step) => step.key === "done");
  if (doneStep) doneStep.status = "done";
  approval.status = "已完成";
  approval.currentRole = "";
  approval.completedAt = new Date().toISOString();
  approval.completedBy = user.name;
}

function canRoleHandleApproval(userRole, currentRole) {
  if (["shareholder", "admin"].includes(userRole)) return true;
  if (currentRole === "pm") return ["pm", "director"].includes(userRole);
  if (currentRole === "director") return userRole === "director";
  if (currentRole === "finance") return userRole === "finance";
  if (currentRole === "owner") return userRole === "shareholder";
  return false;
}

function applyApprovedFinanceImpact(db, approval) {
  if (approval.status !== "已完成" || approval.appliedAt) return;
  const project = (db.projects || []).find((item) => item.id === approval.projectId);
  if (!project) return;
  project.extractedFields = project.extractedFields || {};
  const amount = Number(approval.amount || 0);
  if (approval.type === "petty_cash") {
    const currentBudget = Number(project.extractedFields.pettyCashBudget || project.extractedFields.projectPettyCashBudget || 0);
    project.extractedFields.pettyCashBudget = currentBudget + amount;
  }
  if (approval.type === "reimbursement") {
    const currentUsed = Number(project.extractedFields.pettyCashUsed || project.extractedFields.projectPettyCashUsed || 0);
    const category = approval.expenseCategory || "其他";
    const costName = `员工报销-${category}`;
    project.extractedFields.pettyCashUsed = currentUsed + amount;
    project.costUsed = Number(project.costUsed || 0) + amount;
    const costs = Array.isArray(project.costs) ? project.costs : [];
    const row = costs.find((item) => Array.isArray(item) && item[0] === costName);
    if (row) row[1] = Number(row[1] || 0) + amount;
    else costs.push([costName, amount]);
    project.costs = costs;
  }
  if (approval.type === "supplier_payment") {
    project.costUsed = Number(project.costUsed || 0) + amount;
    const costs = Array.isArray(project.costs) ? project.costs : [];
    const supplierName = approval.payee || "供应商付款";
    const row = costs.find((item) => Array.isArray(item) && item[0] === supplierName);
    if (row) row[1] = Number(row[1] || 0) + amount;
    else costs.push([supplierName, amount]);
    project.costs = costs;
    db.suppliers = db.suppliers || [];
    const at = new Date().toISOString();
    const pendingRow = db.suppliers.find((item) => {
      if (item.status === "已付款") return false;
      const sameProject = item.projectId === project.id || item.project === project.name;
      const sameSupplier = String(item.supplier || "").trim() === supplierName;
      const sameAmount = Math.abs(Number(item.amount || 0) - amount) <= 0.01;
      return sameProject && sameSupplier && sameAmount;
    });
    const supplierRow = pendingRow || {
      supplier: supplierName,
      projectId: project.id,
      project: project.name,
      type: approval.reason || "供应商付款",
      amount,
      status: "待结算"
    };
    supplierRow.status = "已付款";
    supplierRow.approvalId = approval.id;
    supplierRow.paidAt = supplierRow.paidAt || at;
    supplierRow.paidBy = approval.completedBy || "审批完成";
    supplierRow.paymentNote = supplierRow.paymentNote || "供应商付款审批完成后自动标记已付款";
    supplierRow.updatedAt = at;
    supplierRow.updatedBy = approval.completedBy || "";
    if (!pendingRow) db.suppliers.unshift(supplierRow);
    syncSupplierSettlementNotificationAfterUpdate(db, supplierRow, { id: approval.completedBy || "", name: approval.completedBy || "审批完成" }, "已付款");
  }
  project.receivable = Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0);
  project.margin = Number(project.contract || 0)
    ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100)
    : 0;
  project.updatedAt = new Date().toISOString();
  approval.appliedAt = project.updatedAt;
}

function syncSupplierSettlementAfterApprovalStopped(db, approval = {}, user = {}, action = "reject") {
  if (approval.type !== "supplier_payment" || !approval.id) return null;
  const at = new Date().toISOString();
  const stoppedStatus = action === "withdraw" ? "审批已撤回" : "审批已驳回";
  let affected = null;
  for (const row of db.suppliers || []) {
    if (row.approvalId !== approval.id) continue;
    if (row.status === "已付款" || row.paidAt) continue;
    row.status = stoppedStatus;
    row.paymentNote = [row.paymentNote, approval.logs?.[0]?.note || ""].filter(Boolean).join("；") || stoppedStatus;
    row.updatedAt = at;
    row.updatedBy = user.id || "";
    row.updatedByName = user.name || "";
    row.approvalStoppedAt = at;
    row.approvalStoppedBy = user.id || "";
    row.approvalStoppedAction = action;
    affected = row;
    syncSupplierSettlementNotificationAfterUpdate(db, row, user, stoppedStatus);
  }
  return affected;
}

function settlementCostRowId(row = {}) {
  const id = row.id || row.supplierId || "";
  if (id) return `supplier-settlement:${id}`;
  return `supplier-settlement:${row.projectId || row.project || ""}:${row.supplier || ""}:${row.amount || 0}:${row.createdAt || ""}`;
}

function findProjectForSupplierSettlement(db, row = {}) {
  return (db.projects || []).find((item) => {
    if (row.projectId && item.id === row.projectId) return true;
    return row.project && item.name === row.project;
  });
}

function recalculateProjectMargin(project = {}) {
  project.receivable = Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0);
  project.margin = Number(project.contract || 0)
    ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100)
    : 0;
  project.updatedAt = new Date().toISOString();
}

function applySupplierSettlementCost(db, row = {}, user = {}) {
  if (row.costAppliedAt) return null;
  const project = findProjectForSupplierSettlement(db, row);
  if (!project) return null;
  const amount = Number(row.amount || 0);
  if (!amount) return null;
  const costRow = {
    id: settlementCostRowId(row),
    name: row.supplier || "供应商结算",
    type: row.type || "供应商结算",
    amount,
    source: "supplier-settlement",
    supplier: row.supplier || "",
    settlementId: row.id || "",
    appliedBy: user.id || "",
    appliedByName: user.name || "",
    appliedAt: new Date().toISOString()
  };
  const costs = Array.isArray(project.costs) ? project.costs : [];
  if (!costs.some((item) => item?.source === "supplier-settlement" && item?.settlementId && item.settlementId === costRow.settlementId)) {
    costs.push(costRow);
  }
  project.costs = costs;
  project.costUsed = Number(project.costUsed || 0) + amount;
  recalculateProjectMargin(project);
  row.costAppliedAt = costRow.appliedAt;
  row.costAppliedBy = user.id || "";
  row.costAppliedByName = user.name || "";
  return project;
}

function rollbackSupplierSettlementCost(db, row = {}, user = {}) {
  if (!row.costAppliedAt) return null;
  const project = findProjectForSupplierSettlement(db, row);
  if (!project) return null;
  const rowId = settlementCostRowId(row);
  const amount = Number(row.amount || 0);
  project.costs = (Array.isArray(project.costs) ? project.costs : []).filter((item) => {
    if (item?.source === "supplier-settlement" && item?.settlementId && row.id && item.settlementId === row.id) return false;
    if (item?.id && item.id === rowId) return false;
    return true;
  });
  project.costUsed = Math.max(0, Number(project.costUsed || 0) - amount);
  recalculateProjectMargin(project);
  row.costRolledBackAt = new Date().toISOString();
  row.costRolledBackBy = user.id || "";
  row.costAppliedAt = "";
  row.costAppliedBy = "";
  row.costAppliedByName = "";
  return project;
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
}

function textIncludes(text, target) {
  return Boolean(target) && String(text || "").includes(String(target || ""));
}

function findAssistantProject(query, projects = [], selectedProjectId = "") {
  const text = String(query || "");
  return projects.find((project) => project.id === selectedProjectId)
    || projects.find((project) => textIncludes(text, project.name) || textIncludes(text, project.client))
    || projects[0]
    || null;
}

function amountFromAssistantText(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(万|元)?/);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === "万" ? amount * 10000 : amount;
}

function assistantApprovalTypeFromText(text = "") {
  const value = String(text || "");
  if (/备用金|预算/.test(value)) return "petty_cash";
  if (/报销|票据|发票|打车|出租|网约车|滴滴|油费|停车|过路|高速|交通|车费|餐费|盒饭|午餐|晚餐|餐饮|住宿|酒店|道具|物料|场地|影棚|达人|kol|koc|制作|拍摄|剪辑|投放|快递|物流|办公|杂费/.test(value)) return "reimbursement";
  return "";
}

function parseAssistantTaskDraft(query = "", user = {}) {
  const text = String(query || "").trim();
  if (!/(任务|节点|待办|安排|加一个|新增|创建|跟进|推进)/.test(text)) return null;
  if (!/(任务|节点|待办)/.test(text) && !/(加一个|新增|创建|安排)/.test(text)) return null;
  const cleaned = text
    .replace(/帮我|请|麻烦|给我|在.+?项目|到.+?项目|给.+?项目/g, "")
    .replace(/(新增|创建|加一个|安排|登记|记录)?(一个|一条)?(项目)?(任务|节点|待办)/g, "")
    .replace(/截止.*$/g, "")
    .replace(/负责人.*$/g, "")
    .replace(/进度\s*\d+%?/g, "")
    .replace(/[，,。；;]/g, " ")
    .trim();
  const title = cleaned || text.match(/(?:任务|节点|待办)[：: ]?(.+?)(?:截止|负责人|进度|$)/)?.[1]?.trim() || "";
  const owner = text.match(/负责人[是为:]?([^，,。；; ]+)/)?.[1]?.trim() || user.name || "";
  const dueDate = text.match(/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}|明天|后天|今天|本周五|本周内|这周内|下周[一二三四五六日天]?)/)?.[1] || "";
  const progressMatch = text.match(/进度\s*(\d{1,3})%?/);
  const progress = progressMatch ? Math.max(0, Math.min(100, Number(progressMatch[1]))) : 0;
  if (!title) return null;
  return { title, owner, dueDate, progress, note: query };
}

function simpleProjectHealth(project = {}) {
  const completion = Math.max(0, Math.min(100, Math.round(Number(project.progress || 0))));
  const start = new Date(project.startDate || project.createdAt || Date.now());
  const end = new Date(project.endDate || project.serviceEnd || project.deadline || Date.now() + 30 * 86400000);
  const now = new Date();
  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, now - start);
  const timeProgress = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const diff = completion - timeProgress;
  return {
    completion,
    timeProgress,
    label: diff >= 8 ? "超前" : diff <= -8 ? "滞后" : "正常",
    text: diff >= 8 ? "进度比时间更快，可以保持节奏并准备复盘材料。" : diff <= -8 ? "进度落后于时间，建议先拆出本周必须完成的交付节点。" : "进度和时间基本匹配，继续按当前节奏推进。"
  };
}

function assistantRunway(settings = {}) {
  const finance = settings.companyFinance || {};
  const currentCash = Number(finance.currentCash || 0);
  const monthlyFixedCost = [
    finance.monthlyLaborCost,
    finance.monthlyRent,
    finance.monthlyLoan,
    finance.monthlyInterest,
    finance.monthlyOtherCost
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const safetyReserve = monthlyFixedCost * 6;
  const gap = Math.max(safetyReserve - currentCash, 0);
  let label = "待设置现金流参数";
  if (monthlyFixedCost) {
    if (runwayMonths < 3) label = "危险！你快倒闭啦！需要收缩现金流";
    else if (runwayMonths < 6) label = "现金偏紧，需要控制支出并加快回款";
    else label = "现金安全线达标，可以稳健推进";
  }
  return { currentCash, monthlyFixedCost, runwayMonths, safetyReserve, gap, label };
}

function assistantMetrics(scopedDb = {}) {
  const projects = scopedDb.projects || [];
  const approvals = scopedDb.approvals || [];
  const contract = projects.reduce((sum, project) => sum + Number(project.contract || 0), 0);
  const paid = projects.reduce((sum, project) => sum + Number(project.paid || 0), 0);
  const receivable = projects.reduce((sum, project) => sum + Number(project.receivable || Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0)), 0);
  const spending = projects.reduce((sum, project) => sum + Number(project.costUsed || project.executionCost || 0), 0);
  const profit = contract - spending;
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  return {
    contract,
    paid,
    receivable,
    spending,
    profit,
    margin: contract ? Math.round((profit / contract) * 100) : 0,
    pendingApprovals
  };
}

function assistantProjectContext(project = {}) {
  if (!project?.id) return "";
  const pettyBudget = Number(project.pettyCashBudget || project.extractedFields?.pettyCashBudget || project.extractedFields?.projectPettyCashBudget || 0);
  const pettyUsed = Number(project.pettyCashUsed || project.extractedFields?.pettyCashUsed || project.extractedFields?.projectPettyCashUsed || 0);
  const health = simpleProjectHealth(project);
  return [
    `项目：${project.name}`,
    `客户：${project.client || "未填写"}`,
    `状态：${project.status || "未填写"}`,
    `进度：${health.completion}% / 时间进度：${health.timeProgress}% / 判断：${health.label}`,
    `合同：${money(project.contract)} / 已回款：${money(project.paid)} / 待回款：${money(project.receivable)}`,
    `已用成本：${money(project.costUsed)} / 备用金预算：${money(pettyBudget)} / 已用备用金：${money(pettyUsed)}`,
    `下一节点：${project.nextMilestone || "待确认"}`,
    `回款节点：${project.paymentDue || "待确认"}`
  ].join("\n");
}

function assistantSafeSettings(settings = {}) {
  return {
    companyFinance: settings.companyFinance ? assistantRunway(settings) : null,
    approvalRules: settings.approvalRules || null
  };
}

async function requestAssistantAiReply(db, { query, user, scopedDb, target, fallbackReply }) {
  const ai = resolveAiSettings(db.settings?.aiService || {});
  if (!ai?.["API Key"]) return null;
  const url = `${ai["Base URL"].replace(/\/$/, "")}/chat/completions`;
  const metrics = assistantMetrics(scopedDb);
  const visibleProjects = (scopedDb.projects || []).slice(0, 8).map((project) => ({
    name: project.name,
    client: project.client,
    status: project.status,
    progress: project.progress,
    contract: Number(project.contract || 0),
    paid: Number(project.paid || 0),
    receivable: Number(project.receivable || 0),
    costUsed: Number(project.costUsed || 0)
  }));
  const messages = [
    {
      role: "system",
      content: [
        "你是广告公司内部 OA 的 AI 项目伙伴，回答要像靠谱同事，简洁、具体、会说人话。",
        "你只能根据用户可见项目和已授权数据回答，不要编造不可见项目、密钥、利润明细或公司现金流。",
        "普通员工不能看到公司经营现金流、全公司利润、密钥或非自己项目；遇到敏感问题要礼貌说明权限。",
        "不要直接承诺已经写入数据。报销、备用金、供应商付款、成本写入等动作必须走系统确认流程。",
        "输出纯文本，不要 Markdown 表格。优先给 1-3 条具体下一步。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户：${user.name} / 角色：${user.role}`,
        `问题：${query}`,
        `当前匹配项目：\n${assistantProjectContext(target) || "无"}`,
        `可见项目摘要：${JSON.stringify(visibleProjects)}`,
        `可见经营汇总：${JSON.stringify(metrics)}`,
        `安全设置摘要：${JSON.stringify(assistantSafeSettings(scopedDb.settings || db.settings || {}))}`,
        `系统规则兜底回答：${fallbackReply}`
      ].join("\n\n")
    }
  ];
  const res = await postAi(url, ai["API Key"], {
    model: ai["模型名称"] || "deepseek-chat",
    temperature: 0.4,
    messages
  });
  if (!res.ok) throw new Error(`AI 服务返回 ${res.res.status}：${res.detail || "请求失败"}`);
  const data = await res.res.json();
  return String(data.choices?.[0]?.message?.content || "").trim().slice(0, 1600);
}

function answerAiAssistantByRules(db, body, user, scopedDb) {
  const query = String(body?.query || "").trim();
  if (!query) throw new Error("先输入一个问题");
  const projects = scopedDb.projects || [];
  const target = findAssistantProject(query, projects, body?.selectedProjectId);
  if (!target) {
    return {
      reply: "你当前还没有可见项目。请让管理员或总监先把你加入项目，分派后我就能回答进度、备用金、报销和文件归档。",
      action: "empty-projects"
    };
  }

  const amount = amountFromAssistantText(query);
  if (amount && /(提交|申请|登记|记录|记一笔|报销|备用金|费用|花了|支出)/.test(query)) {
    const type = assistantApprovalTypeFromText(query);
    if (type) {
      const category = type === "reimbursement" ? inferExpenseCategory({ reason: query, payee: user.name }) : null;
      const pendingAction = {
        kind: "create-approval",
        projectId: target.id,
        projectName: target.name,
        type,
        typeLabel: type === "petty_cash" ? "项目备用金" : "报销",
        amount,
        payee: user.name,
        reason: query,
        expenseCategory: category?.category || ""
      };
      if (!body?.confirmAction || body.confirmAction.kind !== pendingAction.kind) {
        return {
          reply: `我理解你要给「${target.name}」提交${pendingAction.typeLabel}申请，金额 ${money(amount)}${pendingAction.expenseCategory ? `，类目 ${pendingAction.expenseCategory}` : ""}。这会进入审批流程，还不会直接影响成本；请确认后我再提交。`,
          action: "approval-confirmation-required",
          pendingAction
        };
      }
      const approval = createApproval(db, pendingAction, user);
      return {
        reply: `已帮你提交「${target.name}」的${pendingAction.typeLabel}申请，金额 ${money(amount)}${approval.expenseCategory ? `，类目 ${approval.expenseCategory}` : ""}。当前状态：${approval.status}。`,
        action: "approval-created",
        approval
      };
    }
  }

  const taskDraft = parseAssistantTaskDraft(query, user);
  if (taskDraft) {
    const pendingAction = {
      kind: "create-task",
      projectId: target.id,
      projectName: target.name,
      title: taskDraft.title,
      owner: taskDraft.owner,
      dueDate: taskDraft.dueDate,
      progress: taskDraft.progress,
      note: taskDraft.note
    };
    if (!body?.confirmAction || body.confirmAction.kind !== pendingAction.kind) {
      return {
        reply: `我理解你要给「${target.name}」新增任务「${taskDraft.title}」${taskDraft.dueDate ? `，截止 ${taskDraft.dueDate}` : ""}${taskDraft.owner ? `，负责人 ${taskDraft.owner}` : ""}。确认后我会写入项目进度，不会直接影响财务数据。`,
        action: "task-confirmation-required",
        pendingAction
      };
    }
    const result = upsertProjectTask(db, pendingAction, user);
    return {
      reply: `已给「${target.name}」新增任务「${result.task.title}」，项目进度已刷新到 ${result.project.progress || 0}%。`,
      action: "task-created",
      task: result.task,
      project: result.project
    };
  }

  const pettyBudget = Number(target.pettyCashBudget || target.extractedFields?.pettyCashBudget || target.extractedFields?.projectPettyCashBudget || 0);
  const pettyUsed = Number(target.pettyCashUsed || target.extractedFields?.pettyCashUsed || target.extractedFields?.projectPettyCashUsed || 0);
  if (/备用金|预算/.test(query)) {
    return {
      reply: `「${target.name}」备用金预算 ${money(pettyBudget)}，已使用 ${money(pettyUsed)}，当前剩余 ${money(Math.max(pettyBudget - pettyUsed, 0))}。`,
      action: "petty-cash"
    };
  }
  if (/报销|票据|审批/.test(query)) {
    const rows = (scopedDb.approvals || []).filter((item) => item.projectId === target.id || item.projectName === target.name);
    return {
      reply: rows.length
        ? `「${target.name}」共有 ${rows.length} 条审批：${rows.slice(0, 3).map((item) => `${item.typeLabel || item.type} ${money(item.amount)} ${item.status}`).join("；")}。`
        : `「${target.name}」当前没有审批记录。你可以说“帮我提交 500 元报销到${target.name}”，我会直接生成审批单。`,
      action: "approval-summary"
    };
  }
  if (/回款|收款|催收|待收|尾款|首款/.test(query)) {
    const contract = Number(target.contract || 0);
    const paid = Number(target.paid || 0);
    const receivable = Number(target.receivable || Math.max(contract - paid, 0));
    const rate = contract ? Math.round((paid / contract) * 100) : 0;
    return {
      reply: `「${target.name}」合同 ${money(contract)}，已回款 ${money(paid)}，待回款 ${money(receivable)}，回款率 ${rate}%。建议围绕「${target.paymentDue || "待确认回款节点"}」温和确认付款安排。`,
      action: "collection-context"
    };
  }
  if (/登记|上传|归档|成本/.test(query)) {
    const explicitMatches = projects.filter((project) => textIncludes(query, project.name) || textIncludes(query, project.client));
    return {
      reply: !explicitMatches.length && projects.length > 1
        ? `我识别到你有 ${projects.length} 个可见项目。为了避免成本记错账，请在上传入口选择项目；如果你直接说项目名，比如“这个统计到${target.name}成本里”，我会按项目匹配。`
        : `当前匹配项目是「${target.name}」。财务类写入我会优先走审批单，文件归档请用上传入口，避免误改成本数据。`,
      action: "filing-guidance"
    };
  }
  if (/创意|内容|过稿|脚本/.test(query)) {
    return {
      reply: `针对「${target.client || target.name}」，建议先给真实使用场景，再给客户能确认的执行路径，减少空概念。可以把历史反馈继续上传，我会沉淀客户偏好和雷区。`,
      action: "content-idea"
    };
  }
  if (/进度|节点|滞后|超前|完成度/.test(query)) {
    const health = simpleProjectHealth(target);
    return {
      reply: `「${target.name}」当前完成度 ${health.completion}%，时间进度 ${health.timeProgress}%，AI 判断为${health.label}。${health.text}`,
      action: "progress"
    };
  }
  if (/现金流|经营|倒闭|安全线|老板|公司/.test(query)) {
    if (!["shareholder", "admin", "director", "finance"].includes(user.role)) {
      return {
        reply: "公司经营和现金流属于管理层可见内容。你可以继续问自己项目的进度、备用金、报销和材料状态。",
        action: "management-denied"
      };
    }
    const metrics = assistantMetrics(scopedDb);
    const runway = assistantRunway(scopedDb.settings || db.settings || {});
    return {
      reply: `公司经营判断：${runway.label}。待回款 ${money(metrics.receivable)}，待审批 ${metrics.pendingApprovals.length} 条，现金可撑 ${runway.monthlyFixedCost ? `${runway.runwayMonths.toFixed(1)}个月` : "待设置"}，6个月安全线缺口 ${money(runway.gap)}。`,
      action: "management-advice"
    };
  }
  if (/我的项目|有哪些项目/.test(query)) {
    return {
      reply: `你当前可见 ${projects.length} 个项目：${projects.slice(0, 5).map((project) => `${project.name}(${simpleProjectHealth(project).label})`).join("、")}。`,
      action: "project-list"
    };
  }
  return {
    reply: `我先按当前项目「${target.name}」理解：进度 ${Number(target.progress || 0)}%，下一节点是「${target.nextMilestone || "待确认"}」。你可以问“我的项目备用金还有多少”，也可以说“帮我提交 500 元报销到${target.name}”。`,
    action: "fallback"
  };
}

export async function answerAiAssistant(db, body, user, scopedDb) {
  const rules = answerAiAssistantByRules(db, body, user, scopedDb);
  if (rules.pendingAction || ["approval-created", "task-created"].includes(rules.action)) return rules;
  if (["management-denied", "empty-projects"].includes(rules.action)) return rules;
  if ([
    "petty-cash",
    "approval-summary",
    "collection-context",
    "progress",
    "management-advice",
    "project-list",
    "filing-guidance"
  ].includes(rules.action)) return rules;
  try {
    const target = findAssistantProject(body?.query, scopedDb.projects || [], body?.selectedProjectId);
    const reply = await requestAssistantAiReply(db, {
      query: String(body?.query || "").trim(),
      user,
      scopedDb,
      target,
      fallbackReply: rules.reply
    });
    if (reply) {
      return {
        ...rules,
        reply,
        aiGenerated: true,
        action: rules.action === "fallback" ? "ai-chat" : rules.action
      };
    }
  } catch (error) {
    return {
      ...rules,
      aiGenerated: false,
      aiFallbackReason: error.message
    };
  }
  return rules;
}

export function createApproval(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId);
  if (!project) throw new Error("项目不存在");
  const type = body.type || "reimbursement";
  if (!APPROVAL_LABELS[type]) throw new Error("不支持的审批类型");
  const amount = Number(body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("请填写正确的审批金额");
  const at = new Date().toISOString();
  const rules = db.settings?.approvalRules || {};
  const steps = approvalSteps(type, amount, rules);
  const current = steps.find((step) => step.status === "current");
  const expenseCategory = type === "reimbursement" ? inferExpenseCategory(body) : null;
  const approval = {
    id: nextApprovalId(),
    type,
    typeLabel: APPROVAL_LABELS[type],
    projectId: project.id,
    projectName: project.name,
    amount,
    reason: String(body.reason || "").trim() || "未填写说明",
    payee: String(body.payee || "").trim(),
    category: body.category || APPROVAL_LABELS[type],
    expenseCategory: expenseCategory?.category || "",
    expenseCategorySource: expenseCategory?.source || "",
    expenseCategoryConfidence: expenseCategory?.confidence || 0,
    status: `待${current?.label || "PM确认"}`,
    currentRole: current?.role || "pm",
    applicantId: user.id,
    applicantName: user.name,
    applicantRole: user.role,
    createdAt: at,
    updatedAt: at,
    steps,
    ruleSnapshot: {
      pettyCashDirectorLimit: approvalRuleNumber(rules, "pettyCashDirectorLimit", 3000),
      financeRequiredAmount: approvalRuleNumber(rules, "financeRequiredAmount", 1000),
      ownerRequiredAmount: approvalRuleNumber(rules, "ownerRequiredAmount", 10000)
    },
    logs: [{ action: "submit", user: user.name, role: user.role, note: body.reason || "", at }]
  };
  enrichApprovalRuntimeFields(approval, at);
  db.approvals = db.approvals || [];
  db.approvals.unshift(approval);
  db.auditLogs.unshift({ type: "approval", target: project.name, action: "submit", user: user.name, meta: { approvalId: approval.id, approvalType: type, amount }, at });
  return approval;
}

export function actOnApproval(db, body, user) {
  const approval = (db.approvals || []).find((item) => item.id === body.id);
  if (!approval) throw new Error("审批不存在");
  if (["已完成", "已驳回"].includes(approval.status)) throw new Error("该审批已结束");
  const step = currentApprovalStep(approval);
  if (!step || !canRoleHandleApproval(user.role, step.role)) throw new Error("当前角色不能处理这一步审批");
  const action = body.action === "reject" ? "reject" : "approve";
  const at = new Date().toISOString();
  syncApprovalSteps(approval, action, user);
  approval.updatedAt = at;
  enrichApprovalRuntimeFields(approval, at);
  approval.logs = approval.logs || [];
  approval.logs.unshift({
    action,
    user: user.name,
    role: user.role,
    step: step.label,
    note: String(body.note || "").trim(),
    at
  });
  const stoppedSupplierSettlement = action === "reject"
    ? syncSupplierSettlementAfterApprovalStopped(db, approval, user, "reject")
    : null;
  applyApprovedFinanceImpact(db, approval);
  db.auditLogs.unshift({
    type: "approval",
    target: approval.projectName,
    action,
    user: user.name,
    meta: {
      approvalId: approval.id,
      approvalType: approval.type,
      amount: approval.amount,
      status: approval.status,
      stoppedSupplierSettlementId: stoppedSupplierSettlement?.id || ""
    },
    at
  });
  syncApprovalNotificationAfterAction(db, approval, user, action);
  return approval;
}

export function withdrawApproval(db, body, user) {
  const approval = (db.approvals || []).find((item) => item.id === body.id);
  if (!approval) throw new Error("审批不存在");
  if (["已完成", "已驳回", "已撤回"].includes(approval.status)) throw new Error("该审批已结束，不能撤回");
  const canWithdraw = approval.applicantId === user.id || ["shareholder", "admin", "director"].includes(user.role);
  if (!canWithdraw) throw new Error("只有提交人或管理层可以撤回该审批");
  const at = new Date().toISOString();
  approval.status = "已撤回";
  approval.currentRole = "";
  approval.withdrawnAt = at;
  approval.withdrawnBy = user.id;
  approval.withdrawnByName = user.name;
  approval.updatedAt = at;
  approval.steps = (approval.steps || []).map((step) => step.status === "current" ? { ...step, status: "pending" } : step);
  enrichApprovalRuntimeFields(approval, at);
  approval.logs = approval.logs || [];
  approval.logs.unshift({
    action: "withdraw",
    user: user.name,
    role: user.role,
    note: String(body.note || body.reason || "").trim() || "提交人撤回审批",
    at
  });
  const stoppedSupplierSettlement = syncSupplierSettlementAfterApprovalStopped(db, approval, user, "withdraw");
  db.auditLogs.unshift({
    type: "approval",
    target: approval.projectName,
    action: "withdraw",
    user: user.name,
    meta: {
      approvalId: approval.id,
      approvalType: approval.type,
      amount: approval.amount,
      reason: String(body.reason || body.note || "").trim(),
      stoppedSupplierSettlementId: stoppedSupplierSettlement?.id || ""
    },
    at
  });
  syncApprovalNotificationAfterAction(db, approval, user, "withdraw");
  return approval;
}

export function supplierCsv(db) {
  const header = "供应商,归属项目,费用类型,应结金额,状态,付款时间,付款备注\n";
  const rows = db.suppliers.map((item) => [item.supplier, item.project, item.type, item.amount, item.status, item.paidAt || "", item.paymentNote || ""]
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  return header + rows.join("\n");
}

function redactSecretValue(value) {
  if (value === null || value === undefined || value === "") return value;
  return "[已脱敏]";
}

function redactSettingsForBackup(settings = {}) {
  const clone = JSON.parse(JSON.stringify(settings || {}));
  const secretKeys = new Set([
    "API Key",
    "apiKey",
    "appSecret",
    "app_secret",
    "secret",
    "Secret",
    "secretAccessKey",
    "accessKeySecret",
    "tenantAccessToken",
    "verificationToken",
    "webhookUrl",
    "mockFileBase64"
  ]);
  function walk(target) {
    if (!target || typeof target !== "object") return;
    for (const [key, value] of Object.entries(target)) {
      if (secretKeys.has(key) || /secret|token|key|webhook/i.test(key)) {
        target[key] = redactSecretValue(value);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  }
  walk(clone);
  return clone;
}

export function exportBackupSnapshot(db, user) {
  const safeUsers = (db.users || []).map((item) => {
    const { pin, ...rest } = item;
    return rest;
  });
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: { id: user.id, name: user.name, role: user.role },
    app: "ad-project-hub",
    format: "safe-backup-v1",
    counts: {
      users: safeUsers.length,
      projects: (db.projects || []).length,
      approvals: (db.approvals || []).length,
      payments: (db.payments || []).length,
      suppliers: (db.suppliers || []).length,
      files: (db.files || []).length,
      parseJobs: (db.parseJobs || []).length,
      notifications: (db.systemNotifications || []).length
    },
    data: {
      users: safeUsers,
      projects: db.projects || [],
      approvals: db.approvals || [],
      payments: db.payments || [],
      suppliers: db.suppliers || [],
      supplierProfiles: db.supplierProfiles || [],
      clientProfiles: db.clientProfiles || [],
      collectionScripts: db.collectionScripts || [],
      files: db.files || [],
      parseJobs: db.parseJobs || [],
      comments: db.comments || [],
      alertUpdates: db.alertUpdates || [],
      systemNotifications: db.systemNotifications || [],
      feishuProjectBindings: db.feishuProjectBindings || [],
      feishuEvents: db.feishuEvents || [],
      feishuPendingFiles: db.feishuPendingFiles || [],
      auditLogs: db.auditLogs || [],
      settings: redactSettingsForBackup(db.settings || {})
    }
  };
}

const BACKUP_COLLECTIONS = [
  "users",
  "projects",
  "approvals",
  "payments",
  "suppliers",
  "supplierProfiles",
  "clientProfiles",
  "collectionScripts",
  "files",
  "parseJobs",
  "comments",
  "alertUpdates",
  "systemNotifications",
  "feishuProjectBindings",
  "feishuEvents",
  "feishuPendingFiles",
  "auditLogs"
];

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

const BACKUP_DIFF_LABELS = {
  users: "成员",
  projects: "项目",
  approvals: "审批",
  payments: "回款",
  suppliers: "供应商结算",
  supplierProfiles: "供应商档案",
  clientProfiles: "客户档案",
  collectionScripts: "催收话术",
  files: "文件批次",
  parseJobs: "解析任务",
  comments: "评论",
  alertUpdates: "预警处理",
  systemNotifications: "系统待办",
  feishuProjectBindings: "飞书群绑定",
  feishuEvents: "飞书事件",
  feishuPendingFiles: "飞书待确认文件",
  auditLogs: "审计日志"
};

function backupRestoreDiff(currentCounts = {}, backupCounts = {}) {
  const items = BACKUP_COLLECTIONS.map((key) => {
    const current = Number(currentCounts[key] || 0);
    const backup = Number(backupCounts[key] || 0);
    const delta = backup - current;
    return {
      key,
      label: BACKUP_DIFF_LABELS[key] || key,
      current,
      backup,
      delta,
      direction: delta > 0 ? "increase" : delta < 0 ? "decrease" : "same"
    };
  });
  const changed = items.filter((item) => item.delta !== 0);
  return {
    items,
    changed,
    changedCount: changed.length,
    increases: changed.filter((item) => item.delta > 0).length,
    decreases: changed.filter((item) => item.delta < 0).length,
    summary: changed.length
      ? changed.slice(0, 5).map((item) => `${item.label}${item.delta > 0 ? "+" : ""}${item.delta}`).join("，")
      : "备份数量与当前 OA 基本一致"
  };
}

function parseBackupInput(body = {}) {
  const source = body.backup ?? body.text ?? body.json ?? body;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) throw new Error("请粘贴备份 JSON 后再校验");
    return JSON.parse(trimmed);
  }
  if (source && typeof source === "object") return source;
  throw new Error("请粘贴备份 JSON 后再校验");
}

export function validateBackupSnapshot(db, body = {}, user = {}) {
  let backup;
  try {
    backup = parseBackupInput(body);
  } catch {
    return {
      ok: false,
      dryRunOnly: true,
      error: "备份 JSON 格式无法解析，请确认粘贴的是完整导出的 .json 文件。",
      warnings: ["本次只是校验，不会写入或恢复任何 OA 数据。"]
    };
  }

  const warnings = ["本次只是校验/恢复预演，不会写入、覆盖或恢复任何 OA 数据。"];
  const data = backup?.data && typeof backup.data === "object" ? backup.data : {};
  const counts = {};
  const currentCounts = {};
  for (const key of BACKUP_COLLECTIONS) {
    counts[key] = arrayCount(data[key]);
    currentCounts[key] = arrayCount(db[key]);
    if (!Array.isArray(data[key])) warnings.push(`备份缺少 ${key} 列表，后续不能直接用于完整恢复。`);
  }

  const expectedCounts = backup?.counts && typeof backup.counts === "object" ? backup.counts : {};
  for (const [key, expected] of Object.entries(expectedCounts)) {
    const mappedKey = key === "notifications" ? "systemNotifications" : key;
    if (mappedKey in counts && Number(expected) !== counts[mappedKey]) {
      warnings.push(`${key} 数量与备份 counts 不一致：counts=${expected}，实际=${counts[mappedKey]}。`);
    }
  }

  const settingsText = JSON.stringify(data.settings || {});
  if (/cli_mock_secret|123456|sk-|AKIA|secretAccessKey|webhook/i.test(settingsText) && !settingsText.includes("[已脱敏]")) {
    warnings.push("备份设置里可能包含未脱敏密钥，请不要直接分享或上传到公开仓库。");
  }
  if (!backup?.exportedAt) warnings.push("备份缺少导出时间 exportedAt。");
  if (!backup?.exportedBy?.name) warnings.push("备份缺少导出人信息 exportedBy。");

  const ok = backup?.format === "safe-backup-v1" && Array.isArray(data.projects);
  if (backup?.format !== "safe-backup-v1") warnings.push("备份版本不是 safe-backup-v1，暂不建议用于恢复。");
  if (!Array.isArray(data.projects)) warnings.push("备份缺少 projects 项目列表。");
  const diff = backupRestoreDiff(currentCounts, counts);

  return {
    ok,
    dryRunOnly: true,
    canRestoreLater: ok,
    format: backup?.format || "",
    exportedAt: backup?.exportedAt || "",
    exportedBy: backup?.exportedBy || null,
    checkedAt: new Date().toISOString(),
    checkedBy: { id: user.id, name: user.name, role: user.role },
    counts,
    currentCounts,
    diff,
    warnings
  };
}

function mergeRestoredUsers(currentUsers = [], backupUsers = []) {
  const currentById = new Map((currentUsers || []).map((item) => [item.id, item]));
  return (backupUsers || []).map((item) => {
    const current = currentById.get(item.id) || {};
    return {
      ...item,
      pin: current.pin || "123456",
      status: item.status || current.status || "active"
    };
  });
}

function restoreSettingValue(currentValue, backupValue) {
  if (backupValue === "[已脱敏]") return currentValue;
  if (Array.isArray(backupValue)) return backupValue.map((item, index) => restoreSettingValue(currentValue?.[index], item));
  if (backupValue && typeof backupValue === "object") {
    const merged = { ...(currentValue && typeof currentValue === "object" ? currentValue : {}) };
    for (const [key, value] of Object.entries(backupValue)) {
      merged[key] = restoreSettingValue(merged[key], value);
    }
    return merged;
  }
  return backupValue;
}

function mergeRestoredSettings(currentSettings = {}, backupSettings = {}) {
  const restored = { ...(currentSettings || {}) };
  for (const [key, value] of Object.entries(backupSettings || {})) {
    restored[key] = restoreSettingValue(restored[key], value);
  }
  return restored;
}

export function restoreBackupSnapshot(db, body = {}, user = {}) {
  const confirmText = String(body.confirmText || body.confirm || "").trim();
  if (confirmText !== "确认恢复OA备份") throw new Error("请输入确认恢复OA备份，系统才会执行恢复。");
  const backup = parseBackupInput(body);
  const validation = validateBackupSnapshot(db, backup, user);
  if (!validation.ok) throw new Error(validation.error || "备份校验未通过，不能恢复。");
  const data = backup.data || {};
  const beforeCounts = {};
  const afterCounts = {};
  for (const key of BACKUP_COLLECTIONS) beforeCounts[key] = arrayCount(db[key]);

  db.users = mergeRestoredUsers(db.users || [], data.users || []);
  for (const key of BACKUP_COLLECTIONS.filter((item) => item !== "users" && item !== "auditLogs")) {
    db[key] = Array.isArray(data[key]) ? data[key] : [];
  }
  db.settings = mergeRestoredSettings(db.settings || {}, data.settings || {});
  db.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];

  const at = new Date().toISOString();
  db.auditLogs.unshift({
    type: "backup",
    target: "safe-backup-v1",
    action: "restore",
    user: user.name,
    meta: {
      restoredBy: user.id,
      exportedAt: backup.exportedAt || "",
      exportedBy: backup.exportedBy || null,
      beforeCounts,
      backupCounts: validation.counts,
      diff: validation.diff
    },
    at
  });

  for (const key of BACKUP_COLLECTIONS) afterCounts[key] = arrayCount(db[key]);
  return {
    ok: true,
    restored: true,
    restoredAt: at,
    restoredBy: { id: user.id, name: user.name, role: user.role },
    format: backup.format,
    exportedAt: backup.exportedAt || "",
    exportedBy: backup.exportedBy || null,
    counts: afterCounts,
    beforeCounts,
    diff: backupRestoreDiff(beforeCounts, afterCounts),
    warnings: [
      "恢复已完成。出于安全原因，备份里的 PIN、API Key、Webhook、Secret 等脱敏字段不会凭空恢复；系统会保留当前环境已有密钥。",
      ...validation.warnings.filter((item) => !/不会写入|不会恢复|不会覆盖/.test(item))
    ]
  };
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

export function updateSupplierSettlement(db, body, user) {
  const supplierId = String(body.id || body.supplierId || "").trim();
  const supplierName = String(body.supplier || "").trim();
  const projectName = String(body.project || body.projectName || "").trim();
  const row = (db.suppliers || []).find((item) => {
    if (supplierId && item.id === supplierId) return true;
    return supplierName
      && String(item.supplier || "").trim() === supplierName
      && (!projectName || String(item.project || "").trim() === projectName);
  });
  if (!row) throw new Error("供应商结算记录不存在");
  const status = body.status === "待结算" ? "待结算" : "已付款";
  const at = new Date().toISOString();
  row.status = status;
  row.paymentNote = String(body.note || body.paymentNote || row.paymentNote || "").trim();
  row.updatedAt = at;
  row.updatedBy = user.id;
  let affectedProject = null;
  if (status === "已付款") {
    row.paidAt = body.paidAt || row.paidAt || at;
    row.paidBy = user.name;
    affectedProject = applySupplierSettlementCost(db, row, user);
  } else {
    affectedProject = rollbackSupplierSettlementCost(db, row, user);
    row.paidAt = "";
    row.paidBy = "";
  }
  syncSupplierSettlementNotificationAfterUpdate(db, row, user, status);
  if (affectedProject) syncProjectHealthNotificationsAfterUpdate(db, affectedProject, user);
  db.auditLogs.unshift({
    type: "supplier",
    target: row.project || row.supplier,
    action: status === "已付款" ? "settlement-paid" : "settlement-pending",
    user: user.name,
    meta: {
      supplierId: row.id || "",
      supplier: row.supplier,
      project: row.project,
      amount: row.amount,
      status,
      note: row.paymentNote,
      costAppliedAt: row.costAppliedAt || "",
      projectCostUsed: affectedProject?.costUsed ?? null
    },
    at
  });
  return {
    settlement: row,
    project: affectedProject,
    supplier: supplierLibrary(db).find((item) => item.supplier === row.supplier)
  };
}

function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/\n|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clientProfileFor(db, clientName) {
  db.clientProfiles = db.clientProfiles || [];
  const client = String(clientName || "").trim();
  let profile = db.clientProfiles.find((item) => item.client === client);
  if (!profile) {
    profile = { client, likes: [], dislikes: [], pitfalls: [], handoffNote: "", contactStyle: "", updatedAt: new Date().toISOString() };
    db.clientProfiles.unshift(profile);
  }
  profile.likes = Array.isArray(profile.likes) ? profile.likes : splitLines(profile.likes);
  profile.dislikes = Array.isArray(profile.dislikes) ? profile.dislikes : splitLines(profile.dislikes);
  profile.pitfalls = Array.isArray(profile.pitfalls) ? profile.pitfalls : splitLines(profile.pitfalls);
  return profile;
}

function clientHandoffPackage({ profile = {}, projects = [], comments = [], pitfalls = [] }) {
  const activeProjects = projects.filter((project) => !/已完成|已结案|关闭|取消|作废/.test(String(project.status || "")));
  const receivableProjects = projects
    .filter((project) => Number(project.receivable || 0) > 0)
    .sort((a, b) => Number(b.receivable || 0) - Number(a.receivable || 0));
  const latestProject = [...projects].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  const latestComments = comments
    .slice()
    .sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0))
    .slice(0, 3)
    .map((comment) => String(comment.body || comment.text || "").trim())
    .filter(Boolean);
  const totalReceivable = receivableProjects.reduce((sum, project) => sum + Number(project.receivable || 0), 0);
  const mustAvoid = pitfalls.slice(0, 5);
  const firstActions = [];
  if (activeProjects.length) firstActions.push(`先确认在执行项目：${activeProjects.slice(0, 3).map((project) => `${project.name}（${project.status || "状态待补"}）`).join("、")}`);
  if (receivableProjects.length) firstActions.push(`优先跟进回款：${receivableProjects[0].name} 待回款 ${money(receivableProjects[0].receivable)}`);
  if (mustAvoid.length) firstActions.push(`沟通前先避开雷区：${mustAvoid.slice(0, 2).join("；")}`);
  if (profile.handoffNote) firstActions.push(`先读交接备注：${String(profile.handoffNote).split(/\n/).filter(Boolean)[0]}`);
  if (!firstActions.length) firstActions.push("先补充客户偏好、雷区、最近项目状态和回款节点。");

  return {
    title: `${profile.client || "客户"} PM 自动交接包`,
    activeProjectCount: activeProjects.length,
    activeProjects: activeProjects.map((project) => ({
      id: project.id || "",
      name: project.name,
      status: project.status || "",
      owner: project.pm || project.owner || "",
      receivable: Number(project.receivable || 0),
      paymentDue: project.paymentDue || ""
    })).slice(0, 5),
    latestProject: latestProject ? {
      id: latestProject.id || "",
      name: latestProject.name,
      status: latestProject.status || "",
      owner: latestProject.pm || latestProject.owner || "",
      receivable: Number(latestProject.receivable || 0),
      paymentDue: latestProject.paymentDue || ""
    } : null,
    receivableProjects: receivableProjects.map((project) => ({
      id: project.id || "",
      name: project.name,
      amount: Number(project.receivable || 0),
      paymentDue: project.paymentDue || ""
    })).slice(0, 5),
    totalReceivable,
    likes: (profile.likes || []).slice(0, 5),
    dislikes: (profile.dislikes || []).slice(0, 5),
    mustAvoid,
    contactStyle: profile.contactStyle || "",
    firstActions,
    latestFeedback: latestComments,
    handoffNote: profile.handoffNote || "",
    summary: [
      activeProjects.length ? `在执行 ${activeProjects.length} 个项目` : "暂无在执行项目",
      totalReceivable ? `待回款 ${money(totalReceivable)}` : "暂无待回款",
      mustAvoid.length ? `雷区 ${mustAvoid.length} 条` : "雷区待沉淀",
      profile.contactStyle ? `沟通风格：${profile.contactStyle}` : ""
    ].filter(Boolean).join("；")
  };
}

export function clientLibrary(db) {
  const profiles = new Map((db.clientProfiles || []).map((item) => [item.client, {
    ...item,
    likes: splitLines(item.likes),
    dislikes: splitLines(item.dislikes),
    pitfalls: splitLines(item.pitfalls)
  }]));
  for (const project of db.projects || []) {
    const client = String(project.client || project.brand || project.name || "").trim();
    if (!client) continue;
    if (!profiles.has(client)) profiles.set(client, { client, likes: [], dislikes: [], pitfalls: [], handoffNote: "", contactStyle: "", updatedAt: "" });
  }
  return Array.from(profiles.values()).map((profile) => {
    const projects = (db.projects || []).filter((project) => String(project.client || project.brand || project.name || "").trim() === profile.client);
    const comments = (db.comments || []).filter((comment) => projects.some((project) => project.name === comment.project));
    const totalContract = projects.reduce((sum, project) => sum + Number(project.contract || 0), 0);
    const receivable = projects.reduce((sum, project) => sum + Number(project.receivable || 0), 0);
    const latestProject = [...projects].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
    const inferredPitfalls = comments
      .map((comment) => String(comment.body || ""))
      .filter((text) => /雷区|不要|被骂|客户不喜欢|驳回|吐槽|差评|不满意/.test(text))
      .slice(0, 5);
    const pitfalls = Array.from(new Set([...profile.pitfalls, ...inferredPitfalls]));
    const handoffPackage = clientHandoffPackage({ profile: { ...profile, client: profile.client }, projects, comments, pitfalls });
    return {
      ...profile,
      pitfalls,
      projectCount: projects.length,
      projects: projects.map((project) => project.name),
      totalContract,
      receivable,
      latestProject: latestProject?.name || "",
      latestStatus: latestProject?.status || "",
      commentCount: comments.length,
      handoffPackage,
      handoffSummary: [
        profile.likes.length ? `客户偏好：${profile.likes.slice(0, 3).join("；")}` : "",
        pitfalls.length ? `注意雷区：${pitfalls.slice(0, 3).join("；")}` : "",
        profile.handoffNote ? `交接备注：${profile.handoffNote}` : "",
        latestProject ? `最近项目：${latestProject.name}（${latestProject.status || "状态待补"}）` : ""
      ].filter(Boolean).join("。") || "暂无客户偏好沉淀，建议 PM 在项目动态中记录客户反馈。"
    };
  }).sort((a, b) => b.projectCount - a.projectCount || b.totalContract - a.totalContract);
}

export function saveClientProfile(db, body, user) {
  const client = String(body.client || "").trim();
  if (!client) throw new Error("请填写客户名称");
  const at = new Date().toISOString();
  const profile = clientProfileFor(db, client);
  const appendMode = body.append === true || body.append === "true";
  if (appendMode) {
    profile.likes = Array.from(new Set([...(profile.likes || []), ...splitLines(body.likes)]));
    profile.dislikes = Array.from(new Set([...(profile.dislikes || []), ...splitLines(body.dislikes)]));
    profile.pitfalls = Array.from(new Set([...(profile.pitfalls || []), ...splitLines(body.pitfalls)]));
    const nextHandoff = String(body.handoffNote || "").trim();
    profile.handoffNote = [profile.handoffNote, nextHandoff].filter(Boolean).join("\n");
  } else {
    profile.likes = splitLines(body.likes ?? profile.likes);
    profile.dislikes = splitLines(body.dislikes ?? profile.dislikes);
    profile.pitfalls = splitLines(body.pitfalls ?? profile.pitfalls);
    profile.handoffNote = String(body.handoffNote ?? profile.handoffNote ?? "").trim();
  }
  profile.contactStyle = String(body.contactStyle ?? profile.contactStyle ?? "").trim();
  profile.updatedAt = at;
  db.auditLogs.unshift({
    type: "client",
    target: client,
    action: "profile",
    user: user.name,
    meta: { likes: profile.likes.length, pitfalls: profile.pitfalls.length },
    at
  });
  return clientLibrary(db).find((item) => item.client === client);
}

function nextCollectionScriptId() {
  return `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sameProject(row, project) {
  return row.projectId === project.id || row.projectName === project.name || row.project === project.name;
}

function closeCollectionFollowUpNotification(db, record = {}, user = {}, note = "") {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  for (const item of db.systemNotifications) {
    if (item.type !== "collection-follow-up" || item.sourceId !== record.id || item.status !== "待处理") continue;
    item.status = "已处理";
    item.handledAt = at;
    item.handledBy = user.id || "";
    item.handledByName = user.name || "";
    item.note = note || "催收跟进已处理。";
    item.updatedAt = at;
  }
}

function syncCollectionFollowUpNotification(db, record = {}, user = {}) {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  const hasFollowUp = !record.success && (record.nextFollowUpAt || record.nextAction);
  if (!hasFollowUp) {
    closeCollectionFollowUpNotification(db, record, user, record.success ? "催收已标记有效，系统关闭二次跟进。" : "催收未设置下一步，系统关闭二次跟进。");
    return;
  }
  const action = record.nextAction || "再次跟进客户付款";
  const dueText = record.nextFollowUpAt ? `，计划 ${record.nextFollowUpAt} 跟进` : "";
  const text = `「${record.projectName}」本次催收未推进付款${dueText}：${action}。待回款 ${Number(record.amount || 0).toLocaleString("zh-CN")} 元。`;
  const existing = db.systemNotifications.find((item) => item.type === "collection-follow-up" && item.sourceId === record.id);
  if (existing) {
    existing.status = "待处理";
    existing.title = "催收需要二次跟进";
    existing.text = text;
    existing.severity = record.nextFollowUpAt ? "中" : "低";
    existing.projectId = record.projectId || existing.projectId;
    existing.projectName = record.projectName || existing.projectName;
    existing.actionLabel = "继续催收";
    existing.actionView = "collections";
    existing.nextFollowUpAt = record.nextFollowUpAt || "";
    existing.nextAction = action;
    existing.updatedAt = at;
    return;
  }
  db.systemNotifications.unshift({
    id: nextNotificationId(`collection-follow-up-${record.id}`),
    key: `collection-follow-up::${record.id}`,
    type: "collection-follow-up",
    title: "催收需要二次跟进",
    text,
    severity: record.nextFollowUpAt ? "中" : "低",
    role: "sales",
    recipients: notificationRecipientsForRole("sales"),
    projectId: record.projectId || "",
    projectName: record.projectName || "",
    source: "collection",
    sourceId: record.id,
    actionLabel: "继续催收",
    actionView: "collections",
    nextFollowUpAt: record.nextFollowUpAt || "",
    nextAction: action,
    status: "待处理",
    createdAt: at,
    updatedAt: at
  });
}

function collectionStats(db, salesName = "") {
  const rows = db.collectionScripts || [];
  const completed = rows.filter((item) => item.outcome || typeof item.success === "boolean");
  const bySales = completed.filter((item) => item.salesName === salesName);
  const successful = completed.filter((item) => item.success);
  const best = [...successful].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  return {
    total: completed.length,
    ownTotal: bySales.length,
    ownSuccess: bySales.filter((item) => item.success).length,
    bestScript: best?.script || "",
    bestSalesName: best?.salesName || "",
    bestStyle: best?.style || ""
  };
}

function inferSalesStyle(db, user, body = {}) {
  if (body.style) return String(body.style).trim();
  const ownRows = (db.collectionScripts || []).filter((item) => item.salesName === user.name && item.style);
  if (ownRows[0]?.style) return ownRows[0].style;
  if (user.role === "sales") return "自然、轻松、先同步项目进展，再温和确认付款安排";
  return "专业、清楚、给客户留出确认空间";
}

function scriptToneFor(project, clientProfile, body = {}) {
  if (body.tone) return String(body.tone).trim();
  const due = String(project.paymentDue || "");
  if (/逾期|超期|已到期|尾款/.test(due) || Number(project.receivable || 0) > Number(project.contract || 0) * 0.5) {
    return "礼貌但要推进";
  }
  if (clientProfile?.contactStyle) return clientProfile.contactStyle;
  return "自然提醒";
}

function humanCollectionScript({ project, user, clientProfile, style, tone, stats }) {
  const clientName = project.client || project.brand || "客户";
  const amount = parseMoney(project.receivable);
  const paymentDue = project.paymentDue || "当前回款节点";
  const likes = (clientProfile?.likes || []).slice(0, 2).join("、");
  const pitfalls = (clientProfile?.pitfalls || []).slice(0, 2).join("、");
  const progress = project.nextMilestone || project.status || "项目正在推进中";
  const amountText = amount ? `${Math.round(amount).toLocaleString("zh-CN")} 元` : "这期款项";
  const lines = [
    `${clientName}老师，我跟您同步下「${project.name}」现在的进展：${progress}，我们这边已经在按节点往前推。`,
    `我想顺手跟您确认一下${paymentDue}这笔${amountText}的安排，您看大概什么时候方便走一下流程？我这边也好提前配合您补材料、开票或对账。`,
    `如果财务那边需要合同、报价明细或阶段交付说明，您直接跟我说，我今天就整理好发过去。`
  ];
  if (likes) lines.splice(1, 0, `我会按您之前比较认可的方向（${likes}）把交付资料整理得更清楚。`);
  if (pitfalls) lines.push(`另外我会避开之前提到过的点：${pitfalls}，这次沟通尽量不让您多费时间。`);
  if (stats.bestScript && stats.bestSalesName && stats.bestSalesName !== user.name) {
    lines.push(`我参考了${stats.bestSalesName}之前成功率比较高的说法，核心是先把交付和配合讲清楚，再轻轻推动付款节点。`);
  }
  return lines.join("\n");
}

export function collectionLibrary(db) {
  const rows = db.collectionScripts || [];
  return rows.map((item) => ({
    ...item,
    successRateNote: item.salesName
      ? (() => {
          const stats = collectionStats(db, item.salesName);
          return stats.ownTotal ? `${item.salesName} 已记录 ${stats.ownTotal} 次，成功 ${stats.ownSuccess} 次` : "暂无结果沉淀";
        })()
      : "暂无销售归属"
  }));
}

export function suggestCollectionScript(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const receivable = parseMoney(project.receivable);
  if (receivable <= 0) throw new Error("这个项目当前没有待回款，不需要生成催收话术");
  const clientProfile = clientLibrary(db).find((item) => item.client === (project.client || project.brand));
  const style = inferSalesStyle(db, user, body);
  const tone = scriptToneFor(project, clientProfile, body);
  const stats = collectionStats(db, user.name);
  const at = new Date().toISOString();
  const record = {
    id: nextCollectionScriptId(),
    projectId: project.id,
    projectName: project.name,
    client: project.client || project.brand || "",
    salesId: user.id,
    salesName: user.name,
    style,
    tone,
    amount: receivable,
    paymentDue: project.paymentDue || "",
    script: humanCollectionScript({ project, user, clientProfile, style, tone, stats }),
    reason: [
      `待回款 ${receivable.toLocaleString("zh-CN")} 元`,
      project.paymentDue ? `回款节点：${project.paymentDue}` : "回款节点待补",
      clientProfile?.pitfalls?.length ? `已避开客户雷区：${clientProfile.pitfalls.slice(0, 2).join("、")}` : "",
      stats.ownTotal ? `你的历史催收记录 ${stats.ownTotal} 次，成功 ${stats.ownSuccess} 次` : "暂无个人话术结果，先用稳妥模板"
    ].filter(Boolean).join("；"),
    outcome: "",
    success: null,
    score: null,
    createdAt: at,
    updatedAt: at
  };
  db.collectionScripts = db.collectionScripts || [];
  db.collectionScripts.unshift(record);
  db.auditLogs.unshift({
    type: "collection",
    target: project.name,
    action: "suggest",
    user: user.name,
    meta: { scriptId: record.id, amount: receivable },
    at
  });
  return record;
}

export function saveCollectionOutcome(db, body, user) {
  const id = String(body?.id || "").trim();
  const record = (db.collectionScripts || []).find((item) => item.id === id);
  if (!record) throw new Error("催收记录不存在");
  const at = new Date().toISOString();
  record.outcome = String(body.outcome || record.outcome || "").trim();
  record.success = Boolean(body.success);
  record.score = Number(body.score || (record.success ? 5 : 2));
  record.nextFollowUpAt = record.success ? "" : String(body.nextFollowUpAt || record.nextFollowUpAt || "").trim();
  record.nextAction = record.success ? "" : String(body.nextAction || record.nextAction || "").trim();
  record.followUpStatus = record.success ? "已关闭" : (record.nextFollowUpAt || record.nextAction ? "待跟进" : "待补计划");
  record.updatedAt = at;
  syncCollectionFollowUpNotification(db, record, user);
  db.auditLogs.unshift({
    type: "collection",
    target: record.projectName,
    action: "outcome",
    user: user.name,
    meta: { scriptId: record.id, success: record.success, score: record.score, nextFollowUpAt: record.nextFollowUpAt, nextAction: record.nextAction },
    at
  });
  return record;
}

function nextFeishuEventId() {
  return `feishu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextFeishuPendingFileId() {
  return `feishu-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeFeishuTextContent(message = {}) {
  const raw = message.content ?? message.text ?? "";
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.text || parsed.content || raw).trim();
  } catch {
    return raw.trim();
  }
}

function normalizeFeishuFileName(message = {}) {
  const raw = message.content ?? "";
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed.file_name || parsed.name || message.fileName || "";
    } catch {
      return message.fileName || "";
    }
  }
  return message.fileName || message.name || "";
}

function normalizeFeishuEvent(payload = {}) {
  const event = payload.event || payload;
  const message = event.message || payload.message || {};
  const sender = event.sender || payload.sender || {};
  const chatId = message.chat_id || event.chat_id || payload.chatId || payload.chat_id || "";
  const chatName = message.chat_name || event.chat_name || payload.chatName || payload.chat_name || "";
  const messageType = message.message_type || payload.messageType || payload.message_type || "text";
  return {
    eventId: payload.header?.event_id || payload.event_id || event.event_id || `event-${Date.now()}`,
    messageId: message.message_id || message.messageId || payload.messageId || payload.message_id || "",
    chatId,
    chatName,
    senderId: sender.sender_id?.open_id || sender.sender_id?.user_id || sender.open_id || payload.senderId || "",
    senderName: sender.sender_name || sender.name || payload.senderName || "",
    messageType,
    text: normalizeFeishuTextContent(message),
    fileName: normalizeFeishuFileName(message),
    fileKey: message.file_key || message.fileKey || payload.fileKey || ""
  };
}

function findProjectFromText(db, text = "") {
  const normalized = String(text || "").toLowerCase();
  return (db.projects || []).find((project) => {
    const keys = [project.name, project.client, project.brand].filter(Boolean).map((item) => String(item).toLowerCase());
    return keys.some((key) => key && normalized.includes(key));
  }) || null;
}

function feishuBindingFor(db, chatId) {
  return (db.feishuProjectBindings || []).find((item) => item.chatId === chatId) || null;
}

function findFeishuSenderUser(db, event) {
  const senderText = `${event.senderId || ""} ${event.senderName || ""}`.toLowerCase();
  return (db.users || []).find((user) => {
    const fields = [user.feishuOpenId, user.feishuUserId, user.feishuName, user.name, user.email]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());
    return fields.some((field) => field && senderText.includes(field));
  }) || null;
}

function inferFeishuUploadType(event = {}, text = "") {
  const sample = `${event.fileName || ""} ${text || ""}`.toLowerCase();
  if (/核销|verification/.test(sample)) return "verification-sheet";
  if (/报价|quote/.test(sample)) return "quote-sheet";
  if (/成本|支出|费用|结算|cost/.test(sample)) return "cost-sheet";
  if (/合同|contract/.test(sample)) return "create-project";
  return "file-reference";
}

export async function getFeishuTenantAccessToken(settings = {}) {
  if (settings.mockTenantAccessToken) return settings.mockTenantAccessToken;
  if (settings.tenantAccessToken) return settings.tenantAccessToken;
  const appId = settings.appId || settings.app_id;
  const appSecret = settings.appSecret || settings.app_secret;
  if (!appId || !appSecret) throw new Error("飞书 App ID / App Secret 未配置，无法下载文件");
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：${payload.msg || res.status}`);
  }
  return payload.tenant_access_token;
}

async function downloadFeishuMessageFile(settings = {}, event = {}) {
  if (settings.mockFileBase64) {
    return {
      name: settings.mockFileName || event.fileName || "飞书模拟文件.csv",
      type: settings.mockFileType || "text/csv",
      base64: settings.mockFileBase64,
      size: Buffer.byteLength(settings.mockFileBase64, "base64"),
      source: "feishu-mock"
    };
  }
  if (!event.messageId || !event.fileKey) throw new Error("飞书消息缺少 message_id 或 file_key，无法下载文件");
  const token = await getFeishuTenantAccessToken(settings);
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(event.messageId)}/resources/${encodeURIComponent(event.fileKey)}?type=file`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`下载飞书文件失败：${res.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    name: event.fileName || `飞书文件-${event.fileKey}`,
    type: res.headers.get("content-type") || "application/octet-stream",
    base64: buffer.toString("base64"),
    size: buffer.length,
    source: "feishu"
  };
}

async function applyFeishuDownloadedFile(db, project, file, uploadType, sender, event) {
  const payloadFile = {
    ...file,
    uploadedBy: sender.id,
    uploadedByName: sender.name || "飞书成员",
    uploadedAt: new Date().toISOString(),
    source: "feishu",
    feishuFileKey: event.fileKey,
    feishuMessageId: event.messageId
  };
  const actor = {
    id: sender.id || "feishu-bot",
    name: sender.name || "飞书成员",
    role: sender.role || "member"
  };
  if (uploadType === "cost-sheet") {
    return await uploadProjectCostSheet(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "quote-sheet") {
    return await uploadProjectQuoteSheet(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "verification-sheet") {
    return await uploadProjectVerificationSheet(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "create-project") {
    return await createProject(db, { "项目名称": project?.name || file.name.replace(/\.[^.]+$/, "") }, [payloadFile], actor);
  }
  if (project?.id) {
    project.files = [...(project.files || []), payloadFile];
    project.updatedAt = new Date().toISOString();
    db.files = db.files || [];
    db.files.unshift({
      files: [payloadFile],
      projectId: project.id,
      projectName: project.name,
      user: actor.name,
      at: payloadFile.uploadedAt,
      source: "feishu"
    });
    db.auditLogs.unshift({
      type: "upload",
      target: project.name,
      action: "feishu-file-reference",
      user: actor.name,
      meta: { fileName: payloadFile.name, source: "feishu", uploadType },
      at: payloadFile.uploadedAt
    });
    return { project, file: payloadFile };
  }
  return null;
}

function createFeishuPendingFile(db, { event, project, file, uploadType, sender, note = "" }) {
  const at = new Date().toISOString();
  const preview = {
    fileName: file.name,
    size: file.size || 0,
    type: file.type || "",
    uploadType,
    projectName: project?.name || "",
    canConfirm: Boolean(project?.id && file.base64),
    summary: file.text
      ? String(file.text).slice(0, 300)
      : `飞书文件已下载，等待人工确认后写入「${project?.name || "待匹配项目"}」。`
  };
  const record = {
    id: nextFeishuPendingFileId(),
    eventId: event.eventId,
    chatId: event.chatId,
    chatName: event.chatName,
    senderId: event.senderId,
    senderName: sender.name || event.senderName || "飞书成员",
    projectId: project?.id || "",
    projectName: project?.name || "",
    uploadType,
    file,
    preview,
    status: "待确认",
    note,
    createdAt: at,
    handledAt: "",
    handledBy: ""
  };
  db.feishuPendingFiles = db.feishuPendingFiles || [];
  db.feishuPendingFiles.unshift(record);
  return record;
}

export function feishuProjectBindings(db) {
  return (db.feishuProjectBindings || []).map((item) => ({
    ...item,
    projectExists: (db.projects || []).some((project) => project.id === item.projectId)
  }));
}

export function feishuPendingFiles(db) {
  return db.feishuPendingFiles || [];
}

export function saveFeishuProjectBinding(db, body, user) {
  const chatId = String(body.chatId || body.chat_id || "").trim();
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.projectName);
  if (!chatId) throw new Error("请填写飞书群 Chat ID");
  if (!project) throw new Error("请选择要绑定的项目");
  const at = new Date().toISOString();
  db.feishuProjectBindings = db.feishuProjectBindings || [];
  const existing = db.feishuProjectBindings.find((item) => item.chatId === chatId);
  const record = {
    chatId,
    chatName: String(body.chatName || body.chat_name || existing?.chatName || "").trim(),
    projectId: project.id,
    projectName: project.name,
    boundBy: user.id,
    boundAt: existing?.boundAt || at,
    updatedAt: at
  };
  if (existing) Object.assign(existing, record);
  else db.feishuProjectBindings.unshift(record);
  db.auditLogs.unshift({
    type: "feishu",
    target: record.chatName || record.chatId,
    action: "bind-project",
    user: user.name,
    meta: { projectId: project.id, projectName: project.name },
    at
  });
  return record;
}

export async function handleFeishuEvent(db, payload, user = { id: "system", name: "飞书机器人", role: "system" }) {
  if (payload?.challenge) return { challenge: payload.challenge };
  const token = db.settings?.feishu?.verificationToken;
  if (token && payload?.token && payload.token !== token) throw new Error("飞书 Verification Token 不匹配");
  const event = normalizeFeishuEvent(payload);
  const binding = feishuBindingFor(db, event.chatId);
  const textProject = findProjectFromText(db, `${event.text} ${event.fileName}`);
  const project = textProject || (binding ? (db.projects || []).find((item) => item.id === binding.projectId) : null);
  const sender = findFeishuSenderUser(db, event) || user;
  const text = event.text || "";
  const asksNewProject = /新谈|新项目|登记.*项目|创建项目|立项/.test(text);
  const fileLike = event.messageType !== "text" || event.fileName || event.fileKey;
  const uploadType = inferFeishuUploadType(event, text);
  const at = new Date().toISOString();
  let action = "message";
  let status = "已记录";
  let reply = "已收到，我会把这条消息沉淀到 OA。";

  if (asksNewProject && !project) {
    const projectName = event.fileName
      ? event.fileName.replace(/\.[^.]+$/, "")
      : `飞书新项目-${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    const draft = {
      id: `P-${Date.now()}`,
      name: projectName,
      client: "",
      owner: sender.name || user.name || "飞书机器人",
      contract: 0,
      costBudget: 0,
      costUsed: 0,
      paid: 0,
      receivable: 0,
      status: "待补合同/报价",
      risk: "低",
      aiSummary: "飞书机器人已接收销售的新项目线索。请在 OA 上传/补齐合同与报价表后确认入库。",
      nextMilestone: "等待销售补齐合同/报价表",
      paymentDue: "",
      margin: 0,
      tasks: [],
      costs: [],
      extractedFields: { source: "feishu-bot", feishuChatId: event.chatId, feishuEventId: event.eventId },
      createdAt: at,
      createdBy: sender.id || user.id,
      files: []
    };
    draft.alerts = projectRiskAlerts(draft);
    db.projects.unshift(draft);
    action = "create-project-draft";
    status = "已创建项目草稿";
    reply = `已创建「${draft.name}」项目草稿。请补齐合同/报价表，AI 会继续解析项目金额、客户和回款节点。`;
  } else if (project && fileLike) {
    const fileRecord = {
      name: event.fileName || `飞书文件-${event.eventId}`,
      size: 0,
      type: event.messageType,
      category: "feishu-intake",
      storageUrl: event.fileKey ? `feishu://${event.fileKey}` : "",
      uploadedAt: at,
      uploadedBy: sender.id || user.id,
      uploadedByName: sender.name || event.senderName || "飞书成员",
      source: "feishu"
    };
    try {
      const downloaded = await downloadFeishuMessageFile(db.settings?.feishu || {}, event);
      const pending = createFeishuPendingFile(db, { event, project, file: downloaded, uploadType, sender });
      action = `download-and-pending-${uploadType}`;
      status = "待人工确认";
      reply = `已下载飞书文件「${downloaded.name}」，已进入待确认队列。确认后才会写入「${project.name}」。`;
      fileRecord.pendingFileId = pending.id;
    } catch (error) {
      fileRecord.downloadStatus = `下载/解析待处理：${error.message}`;
      project.files = [...(project.files || []), fileRecord];
      db.files.unshift({ files: [fileRecord], projectId: project.id, projectName: project.name, user: fileRecord.uploadedByName, at });
      action = "record-file-reference";
      status = "已记录文件引用";
      reply = `已把飞书文件「${fileRecord.name}」登记到「${project.name}」，但暂未完成下载解析：${error.message}`;
    }
  } else if (project) {
    db.comments.unshift({
      project: project.name,
      body: `飞书群消息：${text || "无文本内容"}`,
      mentions: "",
      user: sender.name || event.senderName || "飞书成员",
      at
    });
    action = "record-comment";
    status = "已记录到项目动态";
    reply = `已把消息记录到「${project.name}」项目动态。`;
  } else {
    status = "待匹配项目";
    reply = "已收到，但还没匹配到项目。请在后台把飞书群 Chat ID 绑定项目，或在消息里写清项目/客户名称。";
  }

  const record = {
    id: nextFeishuEventId(),
    ...event,
    projectId: project?.id || "",
    projectName: project?.name || "",
    action,
    status,
    reply,
    createdAt: at
  };
  db.feishuEvents = db.feishuEvents || [];
  db.feishuEvents.unshift(record);
  db.auditLogs.unshift({
    type: "feishu",
    target: project?.name || event.chatName || event.chatId || "飞书事件",
    action,
    user: sender.name || event.senderName || "飞书机器人",
    meta: { eventId: record.id, chatId: event.chatId, status },
    at
  });
  return { event: record, reply };
}

export async function handleFeishuPendingFile(db, body, user) {
  const id = String(body?.id || "").trim();
  const action = body?.action === "reject" ? "reject" : "confirm";
  const pending = (db.feishuPendingFiles || []).find((item) => item.id === id);
  if (!pending) throw new Error("飞书待确认文件不存在");
  if (pending.status !== "待确认") throw new Error(`该文件已处理：${pending.status}`);
  const at = new Date().toISOString();
  if (action === "reject") {
    pending.status = "已驳回";
    pending.note = String(body.note || "人工驳回").trim();
    pending.handledAt = at;
    pending.handledBy = user.id;
    db.auditLogs.unshift({
      type: "feishu",
      target: pending.projectName || pending.file?.name || pending.id,
      action: "reject-pending-file",
      user: user.name,
      meta: { pendingFileId: pending.id, uploadType: pending.uploadType },
      at
    });
    syncFeishuPendingNotificationAfterAction(db, pending, user, "reject");
    return pending;
  }

  const project = (db.projects || []).find((item) => item.id === pending.projectId);
  if (!project && pending.uploadType !== "create-project") throw new Error("待确认文件未匹配到项目，无法确认入库");
  await applyFeishuDownloadedFile(db, project, pending.file, pending.uploadType, user, {
    eventId: pending.eventId,
    fileKey: pending.file?.feishuFileKey || "",
    messageId: pending.file?.feishuMessageId || ""
  });
  pending.status = "已确认入库";
  pending.note = String(body.note || "人工确认入库").trim();
  pending.handledAt = at;
  pending.handledBy = user.id;
  db.auditLogs.unshift({
    type: "feishu",
    target: pending.projectName || pending.file?.name || pending.id,
    action: "confirm-pending-file",
    user: user.name,
    meta: { pendingFileId: pending.id, uploadType: pending.uploadType },
    at
  });
  syncFeishuPendingNotificationAfterAction(db, pending, user, "confirm");
  return pending;
}

export function normalizeAiSettings(values = {}) {
  const normalized = { ...values };
  const selectedProvider = normalized["服务商"] || "";
  const providerText = `${selectedProvider}${normalized["Base URL"] || ""}${normalized["模型名称"] || ""}`.toLowerCase();
  const presets = [
    { match: ["deepseek"], provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    { match: ["kimi", "moonshot"], provider: "Kimi / Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
    { match: ["gpt", "openai"], provider: "GPT / OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" }
  ];
  const preset = presets.find((item) => item.provider === selectedProvider)
    || presets.find((item) => item.match.some((keyword) => providerText.includes(keyword)))
    || (normalized["API Key"] && !normalized["Base URL"] ? presets[0] : null);

  if (preset) {
    normalized["服务商"] = preset.provider;
    normalized["Base URL"] = normalized["Base URL"] || preset.baseUrl;
    normalized["模型名称"] = normalized["模型名称"] || preset.model;
  }

  normalized["Base URL"] = (normalized["Base URL"] || "").replace(/\/$/, "");
  return normalized;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const text = String(value).trim();
  if (!text) return 0;

  const chineseAmount = parseChineseMoney(text);
  if (chineseAmount) return chineseAmount;

  const match = text.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return 0;

  if (/万|w/i.test(text)) return number * 10000;
  return number;
}

function parseChineseMoney(text) {
  const source = String(text);
  const chineseMatch = source.match(/[壹贰叁肆伍陆柒捌玖拾佰仟万亿零一二三四五六七八九十百千万两]+(?:元|圆|整|正|人民币|RMB|¥|￥)*/);
  if (!chineseMatch && !/[壹贰叁肆伍陆柒捌玖拾佰仟万亿]/.test(source)) return 0;

  const normalized = (chineseMatch?.[0] || source)
    .replace(/[圆元整正]/g, "")
    .replace(/零/g, "")
    .replace(/两/g, "二")
    .replace(/[壹一]/g, "1")
    .replace(/[贰二]/g, "2")
    .replace(/[叁三]/g, "3")
    .replace(/[肆四]/g, "4")
    .replace(/[伍五]/g, "5")
    .replace(/[陆六]/g, "6")
    .replace(/[柒七]/g, "7")
    .replace(/[捌八]/g, "8")
    .replace(/[玖九]/g, "9")
    .replace(/拾/g, "十")
    .replace(/佰/g, "百")
    .replace(/仟/g, "千");

  const han = normalized.match(/[1-9十百千万亿]+/);
  const hasChineseDigits = /[壹贰叁肆伍陆柒捌玖拾佰仟零一二三四五六七八九十百两]/.test(source);
  if (hasChineseDigits && han && /[十百千万亿]/.test(han[0])) return parseChineseNumber(han[0]);

  const direct = normalized.match(/([1-9]\d*(?:\.\d+)?)\s*(亿|千万|百万|十万|万)/);
  if (direct) return Number(direct[1]) * chineseUnitValue(direct[2]);

  return 0;
}

function chineseUnitValue(unit) {
  return {
    十万: 100000,
    百万: 1000000,
    千万: 10000000,
    万: 10000,
    亿: 100000000
  }[unit] || 1;
}

function parseChineseNumber(value) {
  const digits = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9 };
  const smallUnits = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of value) {
    if (digits[char]) {
      number = digits[char];
      continue;
    }

    if (smallUnits[char]) {
      section += (number || 1) * smallUnits[char];
      number = 0;
      continue;
    }

    if (char === "万" || char === "亿") {
      section += number;
      total += section * chineseUnitValue(char);
      section = 0;
      number = 0;
    }
  }

  return total + section + number;
}

async function analyzeProjectFiles(aiSettings, values, files, interestRateSettings) {
  const extractedFiles = await Promise.all(files.map(extractFileContent));
  const text = extractedFiles
    .map((file) => `文件：${file.name}\n类型：${file.type || "unknown"}\n提取状态：${file.extractionStatus}\n${file.text || ""}`)
    .join("\n\n")
    .slice(0, 50000);
  const fallback = inferFieldsFromText(values, text, extractedFiles, interestRateSettings);
  const effectiveAiSettings = resolveAiSettings(aiSettings);

  if (!text.trim() || !effectiveAiSettings?.["API Key"]) return { ...fallback, extractedFiles };

  try {
    const ai = normalizeAiSettings(effectiveAiSettings);
    const data = await requestAiJson(ai, values, text);
    const content = data.choices?.[0]?.message?.content || "{}";
    return {
      ...normalizeParsedFields(mergeParsedFields(fallback, parseJsonObject(content)), values, files, interestRateSettings),
      extractedFiles
    };
  } catch (error) {
    return {
      ...fallback,
      extractedFiles,
      summary: `${fallback.summary} AI 解析未完成，已使用本地规则抽取。原因：${error.message}`
    };
  }
}

function resolveAiSettings(settings = {}) {
  const envSettings = {
    "服务商": process.env.AI_PROVIDER || process.env.OPENAI_PROVIDER || "",
    "API Key": process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    "Base URL": process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "",
    "模型名称": process.env.AI_MODEL || process.env.OPENAI_MODEL || ""
  };
  const merged = { ...(settings || {}) };
  for (const [key, value] of Object.entries(envSettings)) {
    if (!merged[key] && value) merged[key] = value;
  }
  return normalizeAiSettings(merged);
}

function mergeParsedFields(fallback, aiParsed) {
  const merged = { ...fallback };
  for (const [key, value] of Object.entries(aiParsed || {})) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && value === 0 && parseMoney(fallback[key])) continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[key] = value;
  }
  const fallbackContract = parseMoney(fallback.contract);
  if (fallbackContract) merged.contract = fallbackContract;
  return merged;
}

async function requestAiJson(ai, values, text) {
  const url = `${ai["Base URL"].replace(/\/$/, "")}/chat/completions`;
  const messages = [
    {
      role: "system",
      content: "你是广告项目经营中台的文件解析和自动归档助手。你要把合同、报价单、执行表、排期表、供应商结算表中的关键信息归类到项目中台。只返回 JSON，不要 Markdown。字段包括 projectName, client, partyA, partyB, contract, paid, receivable, advancePayment, advanceInterest, executionCost, executionBudget, internalLabor, overhead, costBudget, costUsed, servicePeriod, nextMilestone, paymentDue, risk, summary, costs, suppliers, tasks, archiveTags, confidence, missingFields, hasCostSheet。金额返回数字，日期保留原文。合同存在原价、报价合计和最终优惠总价时，contract 必须取双方最终约定的含税成交价或最终优惠总价，不得取优惠前原价；paid 只能填写文件明确说明已经实际回款的金额，付款计划不能算已回款；receivable 必须等于 contract 减 paid。遇到合同约定按季度/每季/季付/季度回款，或付款后附带承兑汇票、汇票期限、兑付周期时，必须把完整付款方式写入 paymentDue 或 summary，例如“按季度回款，项目完成并验收合格后支付6个月承兑汇票”。项目利润口径固定为：项目总金额 - 实时执行支出 - 项目垫款 - 垫款利息 - 内部人力 - 公摊费用（水电、办公室租金及其他公摊）= 项目利润。executionBudget 是项目预留预算上限，通常来自合同金额占比；执行表中的执行支出请写入 executionCost。只有文件明确是成本表、供应商结算表、费用明细表时，hasCostSheet 才为 true，并尽量返回 advancePayment、advanceInterest、executionCost、internalLabor、overhead；合同或报价单中的合同金额、服务费用、付款金额不要写入成本字段。costs 为 [科目, 金额]；suppliers 为对象数组，含 supplier,type,amount,status；tasks 为 [节点, 进度百分比]。"
    },
    {
      role: "user",
      content: `表单字段：${JSON.stringify(values)}\n\n请从以下上传文件内容中抽取并自动归档项目经营字段，同步项目进度、回款进度、成本科目和供应商费用：\n${text}`
    }
  ];
  const baseBody = {
    model: ai["模型名称"] || "deepseek-chat",
    temperature: 0.1,
    messages
  };

  const first = await postAi(url, ai["API Key"], {
    ...baseBody,
    response_format: { type: "json_object" }
  });
  if (first.ok) return await first.res.json();

  if (first.res.status === 400) {
    const retry = await postAi(url, ai["API Key"], baseBody);
    if (retry.ok) return await retry.res.json();
    throw new Error(`AI 服务返回 ${retry.res.status}：${retry.detail || first.detail || "请求格式不兼容"}`);
  }

  throw new Error(`AI 服务返回 ${first.res.status}：${first.detail || "请求失败"}`);
}

async function postAi(url, apiKey, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const detail = res.ok ? "" : await readAiError(res);
  return { ok: res.ok, res, detail };
}

async function readAiError(res) {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

async function extractFileContent(file) {
  const name = file.name || "未命名文件";
  const type = file.type || "";
  const lowerName = name.toLowerCase();
  const fallback = {
    ...file,
    text: file.text || `文件名：${name}\n文件类型：${type || "unknown"}\n文件大小：${file.size || 0} bytes`,
    extractionStatus: "仅记录文件信息"
  };

  try {
    if (file.text && !file.base64) return { ...file, extractionStatus: "浏览器已读取文本" };
    if (!file.base64) return fallback;

    const buffer = Buffer.from(file.base64, "base64");
    if (lowerName.endsWith(".pdf") || type === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || "").trim();
      if (shouldUseOcrForPdf(text) && tencentOcrConfigured()) {
        const reason = text ? "PDF 文本缺少可解析金额/日期" : "PDF 未提取到文本";
        console.log(`[OCR] ${name}: ${reason}; calling Tencent OCR`);
        try {
          const ocr = await recognizeFileWithTencentOcrDetailed(file, { isPdf: true, pageCount: parsed.numpages });
          console.log(`[OCR] ${name}: Tencent OCR returned ${ocr.text.length} characters`);
          return {
            ...file,
            text: ocr.text,
            tableRows: ocr.tableRows || [],
            pageCount: parsed.numpages,
            extractionStatus: ocr.text.trim() ? `${reason}，已使用腾讯云 OCR 识别` : "腾讯云 OCR 未识别到文本"
          };
        } catch (error) {
          console.error(`[OCR] ${name}: Tencent OCR failed: ${error.message}`);
          return {
            ...file,
            text,
            extractionStatus: `${reason}，但腾讯云 OCR 调用失败：${error.message}`
          };
        }
      }
      if (shouldUseOcrForPdf(text) && !tencentOcrConfigured()) {
        console.warn(`[OCR] ${name}: Tencent OCR is not configured`);
      }
      return {
        ...file,
        text,
        extractionStatus: text
          ? "PDF 文本提取成功"
          : "PDF 未提取到可解析文本，可能是扫描件或图片合同；需要接入 OCR/视觉模型后才能精准识别"
      };
    }

    if (type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(lowerName)) {
      if (!tencentOcrConfigured()) return fallback;
      try {
        console.log(`[OCR] ${name}: calling Tencent OCR for image`);
        const ocrText = await recognizeFileWithTencentOcr(file, { isPdf: false });
        console.log(`[OCR] ${name}: Tencent OCR returned ${ocrText.length} characters`);
        return {
          ...file,
          text: ocrText,
          extractionStatus: ocrText.trim() ? "图片合同已使用腾讯云 OCR 识别" : "腾讯云 OCR 未识别到文本"
        };
      } catch (error) {
        console.error(`[OCR] ${name}: Tencent OCR failed: ${error.message}`);
        return { ...fallback, extractionStatus: `图片合同腾讯云 OCR 调用失败：${error.message}` };
      }
    }

    if (lowerName.endsWith(".docx") || type.includes("wordprocessingml")) {
      const mammoth = await import("mammoth");
      const parsed = await mammoth.extractRawText({ buffer });
      return { ...file, text: parsed.value || "", extractionStatus: parsed.value ? "Word 文本提取成功" : "Word 未提取到文本" };
    }

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsm") || type.includes("spreadsheet")) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const tableRows = [];
      const text = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        rows.forEach((row) => tableRows.push({ sheetName, cells: row.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ")) }));
        const tsv = rows.map((row) => row.map((cell) => String(cell ?? "").replace(/\r?\n/g, " ")).join("\t")).join("\n");
        return `工作表：${sheetName}\n${tsv}`;
      }).join("\n\n");
      return { ...file, text, tableRows, extractionStatus: text ? "Excel 表格提取成功" : "Excel 未提取到表格内容" };
    }

    if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".tsv") || type.startsWith("text/")) {
      return { ...file, text: buffer.toString("utf8"), extractionStatus: "文本文件读取成功" };
    }

    return fallback;
  } catch (error) {
    return { ...fallback, extractionStatus: `文件内容提取失败：${humanizeExtractionError(error, name)}` };
  }
}

function humanizeExtractionError(error, fileName = "文件") {
  const message = String(error?.message || error || "");
  if (/invalid pdf|bad xref|xref|pdf structure|invalid root|no pdf/i.test(message)) {
    return `${fileName} 不是标准 PDF 或文件已损坏，请重新导出 PDF 后上传；如果是扫描件，建议先转成清晰图片或接入 OCR 后再识别`;
  }
  if (/password|encrypted|decrypt/i.test(message)) {
    return `${fileName} 可能被加密或设置了密码，请解除密码后重新上传`;
  }
  if (/end of file|unexpected/i.test(message)) {
    return `${fileName} 内容不完整，可能上传中断或文件损坏，请重新上传完整文件`;
  }
  return message || "文件暂时无法读取，请换一个清晰版本重新上传";
}

function shouldUseOcrForPdf(text) {
  const normalized = (text || "").trim();
  if (!normalized) return true;
  const hasAmount = extractAmounts(normalized).length > 0 || extractContractAmount(normalized) > 0;
  const hasDate = extractDates(normalized).length > 0;
  return !hasAmount && !hasDate;
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function inferFieldsFromText(values, text, files, interestRateSettings) {
  const amounts = extractAmounts(text);
  const dates = extractDates(text);
  const hasCostSheet = isCostSheet(files, text);
  const tableMetrics = hasCostSheet ? extractCostTableMetrics(text) : {};
  const hasContractInBatch = hasContractLikeFile(files, {});
  const contract = hasCostSheet && !hasContractInBatch
    ? parseMoney(values["合同金额"])
    : (parseMoney(values["合同金额"]) || extractContractAmount(text) || amounts[0] || 0);
  const explicitPaid = guessAmount(text, ["已回款", "已付款", "首付款", "预付款", "已收款"]) || 0;
  const paid = explicitPaid || 0;
  const advancePayment = hasCostSheet ? pickTableMetric(tableMetrics, "advancePayment", guessAmount(text, ["项目垫款", "垫款本金", "垫款", "代垫"])) : 0;
  const advanceInterest = hasCostSheet ? guessAmount(text, ["垫款利息", "资金占用费", "利息"]) || 0 : 0;
  const executionCost = hasCostSheet ? pickTableMetric(tableMetrics, "executionCost", guessAmount(text, ["执行支出", "执行成本", "供应商", "应结", "结算金额"])) : 0;
  const executionBudget = hasCostSheet ? guessAmount(text, ["项目执行预算", "执行预算"]) || 0 : 0;
  const internalLabor = hasCostSheet ? pickTableMetric(tableMetrics, "internalLabor", guessAmount(text, ["内部人力", "人力", "人力成本", "内部工时", "工时成本"])) : 0;
  const overhead = hasCostSheet ? pickTableMetric(tableMetrics, "overhead", guessAmount(text, ["公摊费用", "公摊", "水电", "办公室租金", "房租", "租金", "其他费用", "管理公摊"])) : 0;
  const costUsed = advancePayment + advanceInterest + executionCost + internalLabor + overhead;
  const parties = extractParties(text);
  const servicePeriod = extractServicePeriod(text, dates);
  const client = values["客户 / 品牌"] || parties.partyA || guessText(text, ["客户", "品牌"]) || "";
  const projectName = values["项目名称"] || guessText(text, ["项目名称", "项目", "合同名称"]) || "";
  const suppliers = hasCostSheet ? extractSuppliers(text) : [];
  const noReadableContent = files.length && !files.some((file) => (file.text || "").trim());
  const extractionNote = files
    .map((file) => file.extractionStatus)
    .filter(Boolean)
    .join("；");

  return normalizeParsedFields({
    projectName,
    client,
    contract,
    projectRevenue: tableMetrics.projectRevenue || 0,
    executionBudgetRatio: values["执行预算占比"] || values.executionBudgetRatio || "",
    paid,
    receivable: contract ? Math.max(contract - paid, 0) : 0,
    costBudget: hasCostSheet ? costUsed : 0,
    costUsed,
    advancePayment,
    advanceInterest,
    advanceStartDate: guessDateByLabels(text, ["垫款开始", "垫款日期", "垫款时间", "付款日期", "代垫日期"]) || "",
    advanceEndDate: guessDateByLabels(text, ["垫款结束", "归还日期", "回款日期", "结算日期", "计息截止"]) || "",
    executionCost,
    executionBudget,
    internalLabor,
    overhead,
    hasCostSheet,
    partyA: parties.partyA,
    partyB: parties.partyB,
    servicePeriod,
    nextMilestone: servicePeriod || dates[0] || "",
    paymentDue: guessDateByLabels(text, ["付款期限", "付款时间", "回款节点", "付款节点", "尾款", "余款"]) || dates[1] || dates[0] || "",
    risk: inferRisk({ contract, costBudget: hasCostSheet ? costUsed : 0, costUsed, receivable: contract - paid }),
    summary: noReadableContent
      ? `已读取 ${files.length} 个文件，但未提取到可解析正文。${extractionNote || "该文件可能是扫描件或图片合同，需要接入 OCR/视觉模型后才能精准识别金额、甲乙方和期限。"}`
      : files.length
        ? `已读取 ${files.length} 个文件，抽取到 ${amounts.length} 个金额字段、${dates.length} 个日期字段。${extractionNote ? `提取状态：${extractionNote}` : ""}`
      : "未上传文件，等待解析。",
    costs: hasCostSheet && costUsed ? [["成本表费用", costUsed]] : [],
    suppliers,
    tasks: dates.length ? dates.slice(0, 4).map((date, index) => [`节点 ${index + 1}：${date}`, index === 0 ? 30 : 0]) : []
  }, values, files, interestRateSettings);
}

function normalizeParsedFields(parsed, values, files, interestRateSettings) {
  const contract = parseMoney(parsed.contract) || parseMoney(values["合同金额"]);
  const paid = parseMoney(parsed.paid);
  const hasCostSheet = Boolean(parsed.hasCostSheet) || isCostSheet(files, files.map((file) => file.text || "").join("\n"));
  const profitBreakdown = hasCostSheet ? calculateProfitBreakdown(contract, parsed, interestRateSettings) : null;
  const costUsed = profitBreakdown?.totalDeduction || 0;
  return {
    ...parsed,
    projectName: parsed.projectName || values["项目名称"] || "",
    client: parsed.client || values["客户 / 品牌"] || "",
    contract,
    paid,
    receivable: parseMoney(parsed.receivable) || Math.max(contract - paid, 0),
    costBudget: hasCostSheet ? (parseMoney(parsed.costBudget) || costUsed || 0) : 0,
    costUsed,
    hasCostSheet,
    advancePayment: profitBreakdown?.advancePayment || 0,
    advanceInterest: profitBreakdown?.advanceInterest || 0,
    executionCost: profitBreakdown?.executionCost || 0,
    executionBudget: profitBreakdown?.executionBudget || 0,
    internalLabor: profitBreakdown?.internalLabor || 0,
    overhead: profitBreakdown?.overhead || 0,
    projectRevenue: parseMoney(parsed.projectRevenue),
    profit: hasCostSheet ? contract - costUsed : 0,
    profitBreakdown,
    risk: parsed.risk || inferRisk({ contract, costBudget: hasCostSheet ? parsed.costBudget : 0, costUsed, receivable: parsed.receivable }),
    summary: parsed.summary || `已完成 ${files.length} 个文件的结构化解析。`,
    costs: hasCostSheet ? profitBreakdown.costs : [],
    suppliers: hasCostSheet && Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizePair).filter(Boolean) : [],
    archiveTags: Array.isArray(parsed.archiveTags) ? parsed.archiveTags : [],
    confidence: parsed.confidence || "",
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : []
  };
}

function calculateProfitBreakdown(contract, parsed = {}, interestRateSettings) {
  const sourceCosts = Array.isArray(parsed.costs) ? parsed.costs.map(normalizePair).filter(Boolean) : [];
  const pick = (field, labels) => parseMoney(parsed[field]) || sumCostLabels(sourceCosts, labels);
  const executionBudgetRatio = parsePercent(parsed.executionBudgetRatio || parsed["执行预算占比"]);
  const executionBudget = parseMoney(parsed.executionBudget) || (executionBudgetRatio ? Number(contract || 0) * executionBudgetRatio : 0);
  const advancePayment = pick("advancePayment", ["项目垫款", "垫款本金", "垫款", "代垫"]);
  const explicitAdvanceInterest = pick("advanceInterest", ["垫款利息", "资金占用费", "利息"]);
  const interestMeta = calculateAdvanceInterest(advancePayment, parsed, interestRateSettings);
  const advanceInterest = explicitAdvanceInterest || interestMeta.amount;
  const executionCost = pick("executionCost", ["执行支出", "执行成本", "供应商", "媒介", "达人", "制作", "投放", "应结", "实付", "支出", "成本"]);
  const internalLabor = pick("internalLabor", ["内部人力", "人力成本", "人力", "内部工时", "工时"]);
  const overhead = pick("overhead", ["公摊费用", "公摊", "水电", "办公室租金", "房租", "租金", "其他费用", "管理公摊"]);
  const totalDeduction = advancePayment + advanceInterest + executionCost + internalLabor + overhead;
  const profit = Number(contract || 0) - totalDeduction;
  return {
    advancePayment,
    advanceInterest,
    executionCost,
    executionBudget,
    internalLabor,
    overhead,
    totalDeduction,
    profit,
    margin: profitMargin(contract, profit),
    interestRate: interestMeta.annualRate,
    interestDays: interestMeta.days,
    interestSource: explicitAdvanceInterest ? "成本表填写" : interestMeta.source,
    costs: [
      ["项目垫款", advancePayment],
      ["垫款利息", advanceInterest],
      ["项目执行总成本", executionCost],
      ["项目执行预算上限", executionBudget],
      ["内部人力", internalLabor],
      ["公摊费用", overhead]
    ]
  };
}

function parseTableLines(files = []) {
  return files.flatMap((file) => {
    if (Array.isArray(file.tableRows) && file.tableRows.length) {
      return file.tableRows
        .map((row) => ({ file: file.name, sheetName: row.sheetName || "", cells: row.cells || [] }))
        .filter((row) => row.cells.some((cell) => String(cell || "").trim()));
    }
    return String(file.text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !/^工作表[:：]/.test(line))
      .map((line) => ({ file: file.name, cells: splitTableLine(line) }));
  });
}

function splitTableLine(line) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function extractQuoteRules(files = []) {
  const rules = [];
  const rows = parseTableLines(files);
  const headerBySheet = new Map();
  const quoteBudgets = extractQuoteBudgets(rows);
  const entitlementRows = [];
  for (const row of rows) {
    const cells = row.cells;
    const sheetKey = `${row.file || ""}::${row.sheetName || ""}`;
    if (looksLikeQuoteHeader(cells)) {
      headerBySheet.set(sheetKey, buildQuoteColumnMap(cells));
      continue;
    }
    if (cells.length < 3) continue;
    if (/服务类别|服务内容|详细描述|内容概述/.test(cells.join(""))) continue;
    const columnMap = headerBySheet.get(sheetKey);
    if (!columnMap) continue;
    if (columnMap.monthlyQuantity >= 0 && columnMap.totalQuantity >= 0 && columnMap.unitPrice < 0 && columnMap.totalAmount < 0) {
      const entitlement = extractEntitlementQuoteRow(row, columnMap);
      if (entitlement) entitlementRows.push(entitlement);
      continue;
    }
    const unitPrice = columnMap ? parseMoney(cells[columnMap.unitPrice]) : parseMoney(cells[6]);
    const totalAmount = columnMap ? parseMoney(cells[columnMap.totalAmount]) : parseMoney(cells[7]);
    const quantity = columnMap ? parseMoney(cells[columnMap.quantity]) : parseMoney(cells[4]);
    const unit = columnMap ? (cells[columnMap.unit] || "") : (cells[5] || "");
    if (!unitPrice || !totalAmount || !quantity) continue;
    const serviceName = columnMap
      ? pickQuoteServiceName(cells, columnMap)
      : (cells[2] || cells[1] || cells[3] || "");
    if (!serviceName || isQuoteSummaryLine(cells, serviceName)) continue;
    const monthlyQuantity = inferMonthlyQuantity(
      quantity,
      files,
      row,
      columnMap ? (cells[columnMap.monthlyQuantity] || cells[columnMap.completionQuantity]) : ""
    );
    rules.push({
      id: `QR-${rules.length + 1}`,
      category: columnMap ? (cells[columnMap.category] || cells[0] || cells[1] || "") : (cells[0] || cells[1] || ""),
      serviceName,
      description: columnMap ? (cells[columnMap.description] || cells[columnMap.service] || "") : (cells[3] || ""),
      quantity,
      unit,
      unitPrice,
      totalAmount,
      monthlyQuantity,
      monthlyTargetText: monthlyQuantity ? `${serviceName}：每月约 ${formatSmartNumber(monthlyQuantity)}${unit || "项"}` : "",
      executionItems: [{
        content: serviceName,
        monthlyQuantity,
        totalQuantity: quantity,
        unit: unit || "项",
        unitPrice,
        totalAmount
      }],
      remainingQuantity: quantity,
      recognitionMethod: /(支|条|篇|次|个|项)/.test(unit) ? "按数量核销" : "按金额核销",
      sourceFile: row.file,
      confidence: "规则识别"
    });
  }
  appendEntitlementQuoteRules(rules, entitlementRows, quoteBudgets);
  return rules;
}

function looksLikeQuoteHeader(cells = []) {
  const normalized = cells.map(normalizeHeaderText).filter(Boolean);
  const line = normalized.join(" ");
  const hasUnitPrice = normalized.some((header) => /^(单价|执行价|执行单价|报价单价|未税单价)(元)?$/.test(header));
  const hasQuantity = normalized.some((header) => /(预估条数|执行条数|完成数量|数量|条数|篇数|次数|支数)$/.test(header));
  const hasTotal = normalized.some((header) => /^(总价|执行总价|小计|合计|合计金额|报价金额)(元)?$/.test(header));
  const hasMonthlyEntitlement = /具体数量.*条.*月/.test(line)
    && /服务周期.*月/.test(line)
    && /内容数量/.test(line);
  const hasBudgetSummary = /服务费报价|广告费报价/.test(line) && /类目/.test(line);
  return (hasUnitPrice && hasQuantity && hasTotal)
    || hasMonthlyEntitlement
    || hasBudgetSummary;
}

function buildQuoteColumnMap(cells = []) {
  const normalized = cells.map(normalizeHeaderText);
  const executionUnitPrice = findHeaderIndex(normalized, [/^执行价$/, /^执行单价$/]);
  const unitPrice = executionUnitPrice >= 0 ? executionUnitPrice : findHeaderIndex(normalized, [/^单价/, /未税单价/, /报价单价/]);
  const monthlyQuantity = findHeaderIndex(normalized, [/具体数量.*条.*月/, /每月.*(数量|条数|篇数|次数|支数)/, /月度.*(数量|条数|篇数|次数|支数)/]);
  return {
    category: findHeaderIndex(normalized, [/^分类$/, /^类目$/, /服务类别/]),
    name: findHeaderIndex(normalized, [/^名称$/, /^内容$/, /报价项/, /服务项/, /^项目$/]),
    subName: findHeaderIndex(normalized, [/^子项$/, /^内容类型$/, /^类型$/]),
    service: findHeaderIndex(normalized, [/^功能$/, /内容概述/, /服务内容/, /项目内容/, /详细描述/]),
    description: findHeaderIndex(normalized, [/内容概述/, /详细描述/, /服务内容/, /项目内容/]),
    unitPrice,
    quantity: findHeaderIndex(normalized, [/预估条数/, /执行条数/, /^数量$/, /条数$/, /篇数$/, /次数$/, /支数$/]),
    monthlyQuantity,
    completionQuantity: findHeaderIndex(normalized, [/完成数量/]),
    serviceMonths: findHeaderIndex(normalized, [/服务周期.*月/, /服务期限.*月/]),
    totalQuantity: findHeaderIndex(normalized, [/内容数量/, /总数量/, /总条数/, /总篇数/, /总次数/]),
    unit: findHeaderIndex(normalized, [/单位|计量|规格/]),
    totalAmount: findHeaderIndex(normalized, [/^总价$/, /^执行总价$/, /^小计/, /^合计$/, /合计金额/, /报价金额/]),
    budgetAmount: findHeaderIndex(normalized, [/服务费报价/, /广告费报价/])
  };
}

function pickQuoteServiceName(cells = [], columnMap = {}) {
  const explicitSubName = columnMap.subName >= 0 ? cells[columnMap.subName] : "";
  const adjacentSubName = columnMap.name >= 0 && columnMap.name + 1 !== columnMap.quantity ? cells[columnMap.name + 1] : "";
  const explicitName = columnMap.name >= 0 ? cells[columnMap.name] : "";
  const service = columnMap.service >= 0 ? cells[columnMap.service] : "";
  const description = columnMap.description >= 0 ? cells[columnMap.description] : "";
  const category = columnMap.category >= 0 ? cells[columnMap.category] : "";
  const candidate = explicitSubName || adjacentSubName || explicitName || service || description || category || cells.find((cell) => String(cell || "").trim());
  return String(candidate || "").trim();
}

function isQuoteSummaryLine(cells = [], serviceName = "") {
  const service = String(serviceName || "").replace(/\s+/g, "");
  const line = cells.filter(Boolean).join(" ").replace(/\s+/g, "");
  return /^(合计|总计|内容合计|报价合计|含税.*总计|项目优惠|项目最终优惠|备注)/.test(service)
    || /^(合计|总计|含税.*总计|项目优惠|项目最终优惠|备注)/.test(line);
}

function inferMonthlyQuantity(quantity, files = [], row = {}, monthlyQuantityText = "") {
  const explicitMonthlyQuantity = extractMonthlyQuantity(monthlyQuantityText);
  if (explicitMonthlyQuantity) return explicitMonthlyQuantity;
  const sheetText = files
    .filter((file) => file.name === row.file)
    .flatMap((file) => Array.isArray(file.tableRows) ? file.tableRows : [])
    .filter((tableRow) => !row.sheetName || tableRow.sheetName === row.sheetName)
    .map((tableRow) => (tableRow.cells || []).join(" "))
    .join("\n");
  const source = `${row.file || ""}\n${row.sheetName || ""}\n${sheetText || files.map((file) => `${file.name || ""}\n${file.text || ""}`).join("\n")}`;
  const monthSpan = inferServiceMonthSpan(source);
  return monthSpan > 1 && Number(quantity || 0) ? Math.round((Number(quantity || 0) / monthSpan) * 100) / 100 : 0;
}

function extractMonthlyQuantity(value) {
  const text = String(value || "").trim();
  if (!text || text === "/") return 0;
  const monthlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:支|条|篇|次|个|项)?.{0,8}\/\s*月|每月.{0,8}?(\d+(?:\.\d+)?)/);
  if (monthlyMatch) return Number(monthlyMatch[1] || monthlyMatch[2] || 0);
  return 0;
}

function inferServiceMonthSpan(text = "") {
  const source = String(text || "");
  if (/半年|半年度|6个月/.test(source)) return 6;
  const range = source.match(/(20\d{2})年\s*(\d{1,2})月?\s*[-至~—]\s*(20\d{2})年\s*(\d{1,2})月/);
  if (range) {
    const start = Number(range[1]) * 12 + Number(range[2]);
    const end = Number(range[3]) * 12 + Number(range[4]);
    const diff = end - start;
    return Math.max(1, diff >= 12 ? diff : diff + 1);
  }
  const sameYearRange = source.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})?日?\s*[-至~—]\s*(\d{1,2})月\s*(\d{1,2})?日?/);
  if (sameYearRange) {
    const startMonth = Number(sameYearRange[2]);
    const startDay = Number(sameYearRange[3] || 1);
    const endMonth = Number(sameYearRange[4]);
    const endDay = Number(sameYearRange[5] || startDay);
    const diff = endMonth >= startMonth ? endMonth - startMonth : endMonth + 12 - startMonth;
    return Math.max(1, endDay >= startDay ? diff + 1 : diff);
  }
  if (/年度|全年|年框|年服|年度合作|年度短视频/.test(source)) return 12;
  const noYearRange = source.match(/(\d{1,2})月\s*(\d{1,2})?日?\s*[-至~—]\s*(\d{1,2})月\s*(\d{1,2})?日?/);
  if (noYearRange) {
    const startMonth = Number(noYearRange[1]);
    const startDay = Number(noYearRange[2] || 1);
    const endMonth = Number(noYearRange[3]);
    const endDay = Number(noYearRange[4] || startDay);
    const diff = endMonth >= startMonth ? endMonth - startMonth : endMonth + 12 - startMonth;
    return Math.max(1, endDay >= startDay ? diff + 1 : diff);
  }
  const quarter = source.match(/\bq([1-4])\b/i);
  if (quarter) return 3;
  const months = Array.from(new Set(Array.from(source.matchAll(/20\d{2}年\s*(\d{1,2})月/g)).map((match) => Number(match[1]))));
  return months.length > 1 ? months.length : 0;
}

function extractQuoteBudgets(rows = []) {
  const budgets = new Map();
  const headerBySheet = new Map();
  for (const row of rows) {
    const cells = row.cells || [];
    const sheetKey = `${row.file || ""}::${row.sheetName || ""}`;
    const normalized = cells.map(normalizeHeaderText);
    if (normalized.some((header) => /服务费报价|广告费报价/.test(header))) {
      headerBySheet.set(sheetKey, {
        category: findHeaderIndex(normalized, [/^类目$/, /^分类$/]),
        serviceFee: findHeaderIndex(normalized, [/服务费报价/]),
        adFee: findHeaderIndex(normalized, [/广告费报价/])
      });
      continue;
    }
    const map = headerBySheet.get(sheetKey);
    if (!map) continue;
    const category = String(cells[map.category] || "").trim();
    if (!category || /总计|合计/.test(category)) continue;
    const amount = parseMoney(cells[map.serviceFee]) || parseMoney(cells[map.adFee]);
    if (!amount) continue;
    budgets.set(`${row.file || ""}::${category}`, amount);
  }
  return budgets;
}

function extractEntitlementQuoteRow(row = {}, columnMap = {}) {
  const cells = row.cells || [];
  const monthlyQuantity = extractMonthlyQuantity(cells[columnMap.monthlyQuantity]) || parseMoney(cells[columnMap.monthlyQuantity]);
  const serviceMonths = parseMoney(cells[columnMap.serviceMonths]);
  const totalQuantity = parseMoney(cells[columnMap.totalQuantity]) || (monthlyQuantity && serviceMonths ? monthlyQuantity * serviceMonths : 0);
  if (!monthlyQuantity && !totalQuantity) return null;
  const serviceName = pickQuoteServiceName(cells, columnMap);
  if (!serviceName || /^(合计|总计|备注|项目最终优惠)/.test(serviceName)) return null;
  const unitText = String(cells[columnMap.totalQuantity] || cells[columnMap.monthlyQuantity] || "").match(/(支|条|篇|次|个|项|套)/)?.[1] || "项";
  return {
    sourceFile: row.file,
    sheetName: row.sheetName,
    category: cells[columnMap.category] || cells[0] || "",
    serviceName,
    description: cells[columnMap.description] || cells[columnMap.service] || "",
    quantity: totalQuantity || monthlyQuantity,
    unit: unitText,
    monthlyQuantity,
    serviceMonths
  };
}

function appendEntitlementQuoteRules(rules, entitlementRows, quoteBudgets) {
  if (!entitlementRows.length) return;
  const groups = new Map();
  for (const row of entitlementRows) {
    const groupKey = `${row.sourceFile || ""}::内容`;
    groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
  }
  for (const [groupKey, rows] of groups) {
    const budget = quoteBudgets.get(groupKey) || 0;
    const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    let allocated = 0;
    rows.forEach((row, index) => {
      const isLast = index === rows.length - 1;
      const totalAmount = budget && totalQuantity
        ? (isLast ? Math.max(budget - allocated, 0) : Math.round((budget * Number(row.quantity || 0) / totalQuantity) * 100) / 100)
        : 0;
      allocated += totalAmount;
      rules.push({
        id: `QR-${rules.length + 1}`,
        category: row.category || "内容权益",
        serviceName: row.serviceName,
        description: row.description,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.quantity ? Math.round((totalAmount / row.quantity) * 100) / 100 : 0,
        totalAmount,
        monthlyQuantity: row.monthlyQuantity,
        monthlyTargetText: row.monthlyQuantity ? `${row.serviceName}：每月约 ${formatSmartNumber(row.monthlyQuantity)}${row.unit || "项"}` : "",
        executionItems: [{
          content: row.serviceName,
          monthlyQuantity: row.monthlyQuantity,
          totalQuantity: row.quantity,
          unit: row.unit || "项",
          unitPrice: row.quantity ? Math.round((totalAmount / row.quantity) * 100) / 100 : 0,
          totalAmount
        }],
        remainingQuantity: row.quantity,
        recognitionMethod: budget ? "按总包金额核销" : "按数量核销",
        sourceFile: row.sourceFile,
        confidence: budget ? "总包金额分摊识别" : "规则识别"
      });
    });
  }
}

function formatSmartNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
}

function learnParserSkills(db, files = [], category = "", user = {}, now = new Date().toISOString()) {
  db.settings = db.settings || {};
  const existing = Array.isArray(db.settings.parserSkills) ? db.settings.parserSkills : [];
  const learned = files.flatMap((file) => discoverParserSkills(file, category, user, now));
  for (const skill of learned) {
    const index = existing.findIndex((item) => item.signature === skill.signature && item.category === skill.category);
    if (index >= 0) {
      existing[index] = {
        ...existing[index],
        ...skill,
        hits: Number(existing[index].hits || 0) + 1,
        updatedAt: now,
        updatedBy: user.name || user.id || ""
      };
    } else {
      existing.push(skill);
    }
  }
  db.settings.parserSkills = existing.slice(-80);
  return db.settings.parserSkills;
}

function discoverParserSkills(file = {}, category = "", user = {}, now = new Date().toISOString()) {
  const rows = parseTableLines([file]);
  const skills = [];
  for (const row of rows) {
    const cells = row.cells || [];
    if (category === "quote-sheet" && looksLikeQuoteHeader(cells)) {
      const columnMap = buildQuoteColumnMap(cells);
      skills.push(buildParserSkill(file, row, category, cells, columnMap, "报价/执行规则"));
    }
    if (category === "verification-sheet" && looksLikeVerificationHeader(cells)) {
      const columnMap = buildVerificationColumnMap(cells);
      skills.push(buildParserSkill(file, row, category, cells, columnMap, "月度核销规则"));
    }
  }
  return skills.map((skill) => ({
    ...skill,
    createdAt: now,
    updatedAt: now,
    createdBy: user.name || user.id || "",
    hits: 1
  }));
}

function buildParserSkill(file, row, category, cells, columnMap, name) {
  const headers = cells.map(normalizeHeaderText);
  const signature = normalizeProjectText(headers.filter(Boolean).join("|")).slice(0, 120);
  return {
    id: `SK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    category,
    signature,
    sourceFile: file.name || row.file || "",
    sheetName: row.sheetName || "",
    headers,
    columnMap
  };
}

function extractVerificationItems(files = []) {
  const items = [];
  const rows = parseTableLines(files);
  const summary = extractVerificationSummary(rows);
  const headerBySheet = new Map();
  for (const row of rows) {
    const cells = row.cells || [];
    const line = cells.filter(Boolean).join(" ");
    if (!line) continue;
    const sheetKey = `${row.file || ""}::${row.sheetName || ""}`;
    if (looksLikeVerificationHeader(cells)) {
      headerBySheet.set(sheetKey, buildVerificationColumnMap(cells));
      continue;
    }
    if (/^(合计|总计|备注|项目最终优惠)/.test(line)) continue;
    const mapped = extractVerificationItemByHeader(row, headerBySheet.get(sheetKey));
    if (mapped) {
      if (mapped.amount === 0 && mapped.quantity === 0) continue;
      items.push(mapped);
      continue;
    }
    const headerMap = headerBySheet.get(sheetKey);
    if (headerMap?.hasMonthlyAmount || headerMap?.looksLikeQuoteSheet) continue;
  }
  items.summary = summary;
  return items;
}

function extractVerificationSummary(rows = []) {
  const breakdown = [];
  let totalAmount = 0;
  for (const row of rows) {
    const cells = row.cells || [];
    for (let index = 0; index < cells.length - 1; index += 1) {
      const label = String(cells[index] || "").replace(/\s+/g, "").trim();
      const amount = parseMoney(cells[index + 1]);
      if (!amount) continue;
      if (/^(视频|视频收入|投流|投放|垫款|垫款应收)$/.test(label)) {
        breakdown.push({
          type: label,
          amount,
          sourceFile: row.file,
          rawText: cells.filter(Boolean).join(" ")
        });
      }
      if (/^(总数|总计|应核销款项|应核销金额)$/.test(label)) {
        totalAmount = amount;
      }
    }
  }
  return {
    totalAmount,
    breakdown
  };
}

function looksLikeVerificationHeader(cells = []) {
  const normalized = cells.map(normalizeHeaderText).filter(Boolean);
  const explicitExecutionHeaders = normalized.filter((header) => /^(执行价|执行单价|执行条数|执行数量|总价|执行总价|核销金额|核销费用|核销数量|本月核销金额|本月确认收入)$/.test(header) || /核销费用$/.test(header) || /^[一二三四五六七八九十\d]+月核销$/.test(header));
  if (explicitExecutionHeaders.length >= 2) return true;
  const hasServiceHeader = normalized.some((header) => /^(服务内容|服务项目|项目内容|项目|报价项|名称|资源名称|达人|账号|平台)$/.test(header));
  const hasMetricHeader = normalized.some((header) => /^(核销金额|核销费用|核销数量|本月核销金额|本月核销数量|确认收入|本月确认收入|结算金额|验收金额)$/.test(header) || /核销费用$/.test(header) || /^[一二三四五六七八九十\d]+月核销$/.test(header));
  return hasServiceHeader && hasMetricHeader;
}

function buildVerificationColumnMap(cells = []) {
  const normalized = cells.map(normalizeHeaderText);
  const executionAmount = findHeaderIndex(normalized, [
    /^总价$/,
    /^执行总价$/,
    /^执行金额$/,
    /^核销总价$/,
    /^核销金额$/,
    /^本次核销金额$/,
    /^本月核销金额$/,
    /^确认收入$/,
    /^本月确认收入$/
  ]);
  const executionQuantity = findHeaderIndex(normalized, [
    /^执行条数$/,
    /^执行数量$/,
    /^核销条数$/,
    /^核销数量$/,
    /^本次核销条数$/,
    /^本月核销数量$/,
    /^本月核销条数$/,
    /^本月核销篇数$/,
    /^本月核销次数$/,
    /^本月核销支数$/
  ]);
  const executionUnitPrice = findHeaderIndex(normalized, [
    /^执行价$/,
    /^执行单价$/,
    /^核销单价$/,
    /^本次单价$/
  ]);
  const monthlyAmount = findHeaderIndex(normalized, [
    /(?:本月|当月|月度|[一二三四五六七八九十\d]+月).*(?:收入|金额|费用|结算|验收)/,
    /(?:本月|当月|月度|[一二三四五六七八九十\d]+月).*核销(?!.*(?:数量|条数|篇数|次数|支数))/,
    /(?:确认|收入|金额|费用|结算|验收).*(?:本月|当月|月度|[一二三四五六七八九十\d]+月)/,
    /核销.*(?:本月|当月|月度|[一二三四五六七八九十\d]+月)(?!.*(?:数量|条数|篇数|次数|支数))/
  ]);
  const monthlyQuantity = findHeaderIndex(normalized, [
    /(?:本月|当月|月度|[一二三四五六七八九十\d]+月).*(?:数量|条数|篇数|次数|支数)/,
    /(?:核销|确认|执行).*(?:数量|条数|篇数|次数|支数)/
  ]);
  return {
    service: findHeaderIndex(normalized, [/^名称$/, /^项目$/, /服务.*(内容|项目|名称|类别)?/, /项目.*(内容|名称)/, /资源.*(名称|位)/, /刊例|报价项/, /达人|账号/]),
    description: findHeaderIndex(normalized, [/详细|描述|备注|说明/]),
    quantity: monthlyQuantity >= 0 ? monthlyQuantity : findHeaderIndex(normalized, [/核销.*(数量|条数|篇数|次数|支数)/, /本月.*(数量|条数|篇数|次数|支数)/, /(条数|篇数|次数|支数)$/]),
    unit: findHeaderIndex(normalized, [/单位|计量/]),
    amount: monthlyAmount >= 0 ? monthlyAmount : findHeaderIndex(normalized, [/核销.*(金额|收入|费用)/, /确认.*(收入|金额|费用)/, /结算.*金额/, /验收.*金额/]),
    executionAmount,
    executionQuantity,
    executionUnitPrice,
    month: findHeaderIndex(normalized, [/月份|月度|周期|期间|日期|时间|[一二三四五六七八九十\d]+月/]),
    hasMonthlyAmount: monthlyAmount >= 0,
    hasMonthlyQuantity: monthlyQuantity >= 0,
    hasExecutionColumns: executionAmount >= 0 || executionQuantity >= 0 || executionUnitPrice >= 0,
    looksLikeQuoteSheet: monthlyAmount < 0 && monthlyQuantity < 0 && normalized.some((header) => /单价/.test(header)) && normalized.some((header) => /小计|总价|合计金额/.test(header))
  };
}

function normalizeHeaderText(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[：:()（）【】\[\]]/g, "").trim();
}

function findHeaderIndex(headers = [], patterns = []) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function extractVerificationItemByHeader(row, columnMap) {
  if (!columnMap) return null;
  const cells = row.cells || [];
  const cell = (index) => index >= 0 ? String(cells[index] || "").trim() : "";
  const serviceParts = [cell(columnMap.service), cell(columnMap.description)].filter(Boolean);
  const serviceName = serviceParts.join(" ");
  const quantityText = cell(columnMap.quantity);
  const unitText = cell(columnMap.unit);
  const amountText = cell(columnMap.amount);
  const monthText = cell(columnMap.month);
  const line = cells.filter(Boolean).join(" ");
  if (columnMap.hasExecutionColumns) {
    if (/^(合计|总计|备注|项目最终优惠|税率|含税总价|未税总价)/.test(line.replace(/\s+/g, ""))) return null;
    const executionQuantity = parseMoney(cell(columnMap.executionQuantity));
    const executionUnitPrice = parseMoney(cell(columnMap.executionUnitPrice));
    const executionAmount = parseMoney(cell(columnMap.executionAmount));
    const amount = executionAmount || (executionQuantity && executionUnitPrice ? Math.round(executionQuantity * executionUnitPrice * 100) / 100 : 0);
    if (!executionQuantity && !amount) return null;
    return {
      serviceName: serviceName || cells.slice(0, Math.min(cells.length, 4)).filter(Boolean).join(" "),
      quantity: executionQuantity,
      unit: "",
      amount,
      amountSource: executionAmount ? "sheet-total" : "sheet-calculated",
      unitPrice: executionUnitPrice,
      month: inferVerificationMonth([{ name: row.file, text: `${monthText} ${line}` }]),
      sourceFile: row.file,
      rawText: line
    };
  }
  if (looksLikeQuoteOrContractLine(line)) return null;
  const quantityMatch = `${quantityText} ${unitText}`.match(/(\d+(?:\.\d+)?)\s*(支|条|篇|次|个|项)/);
  const quantity = columnMap.hasMonthlyQuantity || !columnMap.hasMonthlyAmount
    ? (quantityMatch ? Number(quantityMatch[1]) : parseMoney(quantityText))
    : 0;
  const amount = parseMoney(amountText);
  if ((!serviceName && !line) || (!quantity && !amount)) return null;
  return {
    serviceName: serviceName || cells.slice(0, Math.min(cells.length, 4)).filter(Boolean).join(" "),
    quantity,
    unit: quantityMatch?.[2] || unitText,
    amount,
    amountSource: amount ? "sheet-total" : "",
    month: inferVerificationMonth([{ name: row.file, text: `${monthText} ${line}` }]),
    sourceFile: row.file,
    rawText: line
  };
}

function looksLikeQuoteOrContractLine(line = "") {
  const source = String(line || "").replace(/\s+/g, "");
  return /未税总价|含税总价|合同金额|报价总额|预算金额|预估预算|项目总额|系统报价填写|评标说明|报价说明|KPI|播放量|点赞数|观看量|收藏|评论/.test(source);
}

function matchVerificationItems(items = [], quoteRules = [], context = {}) {
  const usedQuantityByRule = new Map();
  for (const record of context.records || []) {
    for (const item of record.items || []) {
      if (!item.matchedRuleId) continue;
      usedQuantityByRule.set(item.matchedRuleId, (usedQuantityByRule.get(item.matchedRuleId) || 0) + Number(item.quantity || 0));
    }
  }
  const recognizedRevenue = Number(context.recognizedRevenue || 0);
  const contractRemaining = Math.max(Number(context.contract || 0) - recognizedRevenue, 0);
  return items.map((item) => {
    const scored = quoteRules.map((rule) => ({
      rule,
      score: quoteMatchScore(item.serviceName, `${rule.serviceName} ${rule.description}`)
    })).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 0.18) {
      return { ...item, matchedRuleId: "", matchedServiceName: "", amount: item.amount || 0, status: "待复核", reason: "未匹配到报价项" };
    }
    const quantity = Number(item.quantity || 0);
    const canBackfillAmount = !item.amountSource && quantity && Number(best.rule.unitPrice || 0);
    const amount = item.amount || (canBackfillAmount ? Math.round(quantity * Number(best.rule.unitPrice || 0)) : 0);
    const usedQuantity = usedQuantityByRule.get(best.rule.id) || 0;
    const remainingQuantity = Math.max(Number(best.rule.quantity || 0) - usedQuantity, 0);
    const overLimit = quantity && quantity > remainingQuantity;
    const replacementCandidates = overLimit ? quoteRules
      .filter((rule) => rule.id !== best.rule.id)
      .map((rule) => {
        const used = usedQuantityByRule.get(rule.id) || 0;
        const remaining = Math.max(Number(rule.quantity || 0) - used, 0);
        return {
          ruleId: rule.id,
          serviceName: rule.serviceName,
          remainingQuantity: remaining,
          remainingAmount: Math.round(remaining * Number(rule.unitPrice || 0))
        };
      })
      .filter((rule) => rule.remainingAmount > 0)
      .sort((a, b) => b.remainingAmount - a.remainingAmount)
      .slice(0, 5) : [];
    const replacementAvailable = replacementCandidates.reduce((sum, rule) => sum + rule.remainingAmount, 0);
    const canReplace = overLimit && amount <= contractRemaining && replacementAvailable > 0;
    const lowConfidence = best.score < 0.35;
    return {
      ...item,
      matchedRuleId: best.rule.id,
      matchedServiceName: best.rule.serviceName,
      unitPrice: best.rule.unitPrice,
      amount,
      matchScore: Number(best.score.toFixed(2)),
      remainingQuantity,
      replacementCandidates,
      status: !amount ? "待复核" : canReplace ? "置换待确认" : overLimit || lowConfidence ? "待复核" : "自动通过",
      reason: canReplace
        ? "核销数量超过本类目剩余额度，但合同内其他类目仍有可置换余额，需总监确认置换"
        : !amount
          ? "核销表未给出可确认金额，需人工复核"
          : overLimit
          ? "核销数量超过报价类目剩余额度，且未找到足够可置换余额"
          : lowConfidence
            ? "服务项为模糊匹配"
            : "报价项、数量和单价已匹配"
    };
  });
}

function quoteMatchScore(itemName = "", ruleText = "") {
  const item = normalizeProjectText(expandServiceAliases(itemName));
  const rule = normalizeProjectText(expandServiceAliases(ruleText));
  if (!item || !rule) return 0;
  let score = similarity(item, rule);
  if (rule.includes(item) || item.includes(rule.slice(0, Math.min(rule.length, item.length)))) score += 0.35;
  const itemTerms = importantTerms(expandServiceAliases(itemName));
  const ruleTerms = new Set(importantTerms(expandServiceAliases(ruleText)));
  const hits = itemTerms.filter((term) => ruleTerms.has(term) || rule.includes(normalizeProjectText(term)));
  if (itemTerms.length) score += Math.min(0.5, hits.length / itemTerms.length * 0.5);
  return Math.max(0, Math.min(1, score));
}

function expandServiceAliases(text = "") {
  return String(text || "")
    .replace(/二创/g, "二创 二次创作 素材混剪")
    .replace(/混剪/g, "混剪 二创 二次创作")
    .replace(/探店/g, "探店 达人探店")
    .replace(/笔记/g, "笔记 图文笔记 图文")
    .replace(/图文/g, "图文 图文笔记 笔记")
    .replace(/种草/g, "种草 种草短片 种草内容")
    .replace(/短片/g, "短片 短视频 视频")
    .replace(/投流/g, "投流 投放 加热 推流")
    .replace(/加热/g, "加热 投放 投流 推流")
    .replace(/TVC/gi, "TVC 高品质广告片");
}

function importantTerms(text = "") {
  const source = String(text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[0-9]+(?:\.[0-9]+)?\s*(支|条|篇|次|个|项|月|年|天|s|秒)?/gi, " ");
  const explicit = source.match(/[\p{Script=Han}A-Za-z]{2,12}/gu) || [];
  const terms = new Set();
  for (const word of explicit) {
    const normalized = normalizeProjectText(word);
    if (normalized.length < 2) continue;
    if (/汽车|项目|服务|内容|视频|短视频|发布|制作|执行|客户|品牌|核销|月度|本月/.test(normalized) && normalized.length <= 3) continue;
    terms.add(word);
    for (let size = 2; size <= Math.min(4, normalized.length); size += 1) {
      for (let index = 0; index <= normalized.length - size; index += 1) terms.add(normalized.slice(index, index + size));
    }
  }
  return Array.from(terms).slice(0, 80);
}

function inferVerificationMonth(files = []) {
  const months = inferCoveredMonths(files.map((file) => `${file.name || ""} ${file.text || ""}`).join("\n"));
  return months[0] || "";
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calculateAdvanceInterest(advancePayment, parsed = {}, interestRateSettings = {}) {
  const principal = Number(advancePayment || 0);
  if (!principal) return { amount: 0, annualRate: effectiveAnnualRate(interestRateSettings), days: 0, source: "无垫款" };
  const annualRate = effectiveAnnualRate(interestRateSettings);
  const days = advanceInterestDays(parsed);
  return {
    amount: Math.round(principal * (annualRate / 100) * (days / 365)),
    annualRate,
    days,
    source: interestRateSettings?.source === "latest_lpr" ? "最新LPR自动计算" : "配置利率自动计算"
  };
}

function effectiveAnnualRate(settings = {}) {
  const base = Number(settings.annualRate || settings.fallbackRate || 3.45);
  const spread = Number(settings.spread || 0);
  return Number((base + spread).toFixed(4));
}

function advanceInterestDays(parsed = {}) {
  const start = parseDateValue(parsed.advanceStartDate || parsed.advanceDate || parsed.paymentDate);
  const end = parseDateValue(parsed.advanceEndDate || parsed.settlementDate || parsed.receivableDate) || new Date();
  if (!start) return Number(parsed.advanceDays || parsed.interestDays || 30) || 30;
  const diff = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  return Math.max(1, diff);
}

function parseDateValue(value) {
  if (!value) return null;
  const text = String(value).trim().replace(/[年月.]/g, "-").replace(/日/g, "");
  const match = text.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] || 1));
  return Number.isNaN(date.getTime()) ? null : date;
}

function sumCostLabels(costs, labels) {
  return costs
    .filter(([name]) => labels.some((label) => String(name).includes(label)) && !isRevenueCostLabel(name))
    .reduce((sum, [, value]) => sum + parseMoney(value), 0);
}

function isRevenueCostLabel(name = "") {
  return /(收入|项目收入|确认收入|核销|应收|回款|客户|验收金额|销售额)/.test(String(name || ""));
}

function profitMargin(contract, profit) {
  const amount = Number(contract || 0);
  if (!amount) return 0;
  return Math.round((Number(profit || 0) / amount) * 100);
}

function parsePercent(value) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  const number = parseMoney(text);
  if (!number) return 0;
  return text.includes("%") || number > 1 ? number / 100 : number;
}

function normalizePair(item) {
  if (Array.isArray(item)) return [String(item[0] || "未命名"), parseMoney(item[1])];
  if (item && typeof item === "object") return [String(item.name || item.type || "未命名"), parseMoney(item.value || item.amount || item.progress)];
  return null;
}

function extractCostTableMetrics(text) {
  const totals = {
    _seen: {}
  };
  const lines = String(text || "").split(/\r?\n/);
  let headers = [];

  for (const line of lines) {
    const cells = line.split(/,|\t/).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const headerIndexes = cells
      .map((cell, index) => ({ key: costColumnKey(cell), index }))
      .filter((item) => item.key);

    if (headerIndexes.length >= 2) {
      headers = headerIndexes;
      headers.forEach(({ key }) => {
        totals._seen[key] = true;
        totals[key] = totals[key] || 0;
      });
      continue;
    }

    if (!headers.length) continue;
    for (const { key, index } of headers) {
      const amount = parseMoney(cells[index]);
      if (amount) totals[key] += amount;
    }
  }

  return totals;
}

function costColumnKey(label) {
  const text = String(label || "").replace(/\s+/g, "");
  if (/收入|项目收入|确认收入/.test(text)) return "projectRevenue";
  if (/执行支出|执行成本|项目执行/.test(text)) return "executionCost";
  if (/人力|内部人力|人力成本/.test(text)) return "internalLabor";
  if (/垫款|项目垫款|代垫/.test(text)) return "advancePayment";
  if (/公摊|公摊费用|水电|租金|办公室/.test(text)) return "overhead";
  return "";
}

function tableMetricValue(metrics, key) {
  return metrics?._seen?.[key] && metrics[key] !== null && metrics[key] !== undefined
    ? metrics[key]
    : null;
}

function pickTableMetric(metrics, key, fallback = 0) {
  const value = tableMetricValue(metrics, key);
  return value === null ? Number(fallback || 0) : value;
}

function isCostSheet(files = [], text = "") {
  const fileNames = files.map((file) => file.name || "").join(" ");
  const source = `${fileNames}\n${text}`.slice(0, 12000);
  if (isReimbursementSheet(files, text)) return true;
  const hasCostKeyword = /(成本表|成本明细|费用明细|供应商结算|结算表|月度成本|成本台账|成本归集|利润测算|项目利润|垫款|垫款利息|执行预算|内部人力|人力成本|公摊费用|水电|办公室租金|应结金额|实付金额|供应商费用)/.test(source);
  const hasTableCostColumns = /(供应商|费用类型|成本科目|应结|已结算|待结算|结算状态|垫款|利息|执行预算|内部人力|公摊|租金|水电)/.test(source)
    && /(金额|费用|成本|付款|结算)/.test(source);
  const looksOnlyContract = /(合同|协议|甲方|乙方|服务内容|付款方式|合同金额|服务费用)/.test(source)
    && !hasCostKeyword
    && !hasTableCostColumns;
  return !looksOnlyContract && (hasCostKeyword || hasTableCostColumns);
}

function extractAmounts(text) {
  const values = [];
  const pattern = /(?:人民币|RMB|￥|¥)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(亿元|亿|万元|万|元)?/g;
  for (const match of text.matchAll(pattern)) {
    const rawText = match[0];
    if (looksLikeDateOrIdentifier(text, match.index || 0, rawText)) continue;
    const raw = Number(match[1].replaceAll(",", ""));
    if (!Number.isFinite(raw)) continue;
    const unit = match[2] || "";
    const amount = unit.includes("亿") ? raw * 100000000 : unit.includes("万") ? raw * 10000 : raw;
    if (amount >= 100) values.push(amount);
  }
  return values.sort((a, b) => b - a);
}

function extractContractAmount(text) {
  const labels = [
    "项目最终优惠总价",
    "最终优惠总价",
    "含税总价",
    "合同金额",
    "合同总金额",
    "合同总价",
    "合同价款",
    "合同价",
    "项目金额",
    "项目总价",
    "服务费用总额",
    "服务费总额",
    "服务费用",
    "费用总额",
    "总金额",
    "总价",
    "价款",
    "金额大写",
    "人民币大写"
  ];

  const candidates = [];
  for (const label of labels) {
    for (const match of text.matchAll(new RegExp(label, "g"))) {
      const start = Math.max(0, match.index - 20);
      const snippet = text.slice(start, match.index + 220);
      for (const amount of extractAmountCandidates(snippet)) {
        candidates.push({ ...amount, score: amount.score + labelScore(label) });
      }
    }
  }

  if (!candidates.length) {
    for (const amount of extractAmountCandidates(text.slice(0, 5000))) {
      candidates.push(amount);
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  const best = candidates[0];
  if (best && best.value < 1000) {
    const plausible = candidates.find((item) => item.value >= 10000 && item.score >= best.score - 80);
    if (plausible) return plausible.value;
  }
  return candidates[0]?.value || 0;
}

function extractAmountCandidates(text) {
  const candidates = [];
  const pattern = /(?:人民币|RMB|￥|¥)?\s*([0-9][0-9,]*(?:\.[0-9]+)?|[壹贰叁肆伍陆柒捌玖拾佰仟万亿零一二三四五六七八九十百千万两]+)\s*(亿元|亿|万元|万|元|圆)?/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].trim();
    if (!raw || looksLikeDateOrIdentifier(text, match.index || 0, raw)) continue;
    const value = parseMoney(raw);
    if (!value || value < 100) continue;

    const unit = match[2] || "";
    const context = text.slice(Math.max(0, (match.index || 0) - 30), (match.index || 0) + raw.length + 30);
    const hasMoneyUnit = Boolean(unit || /人民币|RMB|￥|¥|元|圆|万|亿/.test(raw));
    const hasContractContext = /(合同|价款|总价|总额|金额|费用|服务费|付款|回款|含税|不含税|优惠总价|合计)/.test(context);
    const hasStrongContractContext = /合同总金额|合同金额|合同总价|合同价款|合同价|含税总价|项目最终优惠总价|最终优惠总价/.test(context);
    const hasWeakContractContext = /服务费用总额|项目总价|项目金额|总金额|总价|合计\/月|合计/.test(context);
    const isDistractor = /首付款|预付款|尾款|余款|分期|阶段款|保证金|押金|税额|税金|增值税|不含税|单价|小计|预算|执行预算|预估预算|付款比例|质保金|违约金/.test(context);
    const hasTotalLabelContext = /合计|总价|总金额|优惠总价|合同价|合同金额/.test(context);
    const noUnitLongNumber = /^\d{7,}$/.test(raw.replace(/[^\d]/g, "")) && !hasMoneyUnit && !hasTotalLabelContext;
    if (noUnitLongNumber && !hasContractContext) continue;
    if (isDistractor && !hasStrongContractContext) continue;

    candidates.push({
      value,
      raw,
      score: (hasStrongContractContext ? 160 : hasWeakContractContext ? 95 : hasContractContext ? 45 : 0)
        + (hasMoneyUnit ? 80 : 0)
        + (value >= 10000 ? 30 : 0)
        + (value >= 1000000 ? 25 : 0)
        - (value < 1000 && !hasMoneyUnit ? 70 : 0)
        - (isDistractor ? 90 : 0)
        - (noUnitLongNumber ? 120 : 0)
    });
  }
  return candidates;
}

function labelScore(label) {
  if (/合同总金额|合同金额|合同价款|合同总价|含税总价|项目最终优惠总价|最终优惠总价/.test(label)) return 120;
  if (/项目金额|项目总价|服务费总额|总金额|总价|合计/.test(label)) return 80;
  return 60;
}

function looksLikeDateOrIdentifier(text, index, raw) {
  const compact = raw.replace(/\s/g, "");
  const before = text.slice(Math.max(0, index - 12), index);
  const after = text.slice(index + raw.length, index + raw.length + 12);
  const around = `${before}${raw}${after}`;
  const numeric = compact.replace(/[^\d]/g, "");

  if (/^\d{4}$/.test(numeric) && (/^\s*年/.test(after) || /[-/.]\d{1,2}/.test(after) || /第.*$/.test(before) || /年度/.test(after))) return true;
  if (!/万|亿|元|圆|人民币|RMB|￥|¥/.test(around) && /^\D*\d{4}\s*[-/.年]\s*\d{1,2}/.test(`${raw}${after}`)) return true;
  if (/^\D*\d{1,2}\s*月\s*\d{1,2}/.test(`${raw}${after}`)) return true;
  if (!/万|亿|元|圆|人民币|RMB|￥|¥/.test(around) && /^\D*\d{1,2}\s*[-/.]\s*\d{1,2}/.test(`${raw}${after}`)) return true;
  if (/编号|合同编号|税号|电话|手机|传真|账号|开户行|统一社会信用代码|身份证|日期|签订|年月日/.test(around) && !/金额|价款|总价|费用|人民币|元|万|亿/.test(around)) return true;
  if (/^\d{6,}$/.test(numeric) && !/金额|价款|总价|费用|人民币|元|万|亿/.test(around)) return true;
  if (/^\d{11}$/.test(numeric) && /电话|手机|联系方式|联系人/.test(around)) return true;
  return false;
}

function extractDates(text) {
  const dates = new Set();
  const patterns = [
    /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d{4}年\d{1,2}月/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) dates.add(match[0]);
  }
  return Array.from(dates).slice(0, 8);
}

function extractServicePeriod(text, dates = extractDates(text)) {
  const labels = ["服务期限", "服务期间", "服务周期", "合同期限", "合同有效期", "合作期限", "执行周期", "项目周期", "履行期限"];
  for (const label of labels) {
    for (const match of text.matchAll(new RegExp(label, "g"))) {
      const snippet = text.slice(match.index, match.index + 180);
      const period = findDateRange(snippet);
      if (period) return period;
    }
  }

  return findDateRange(text.slice(0, 5000)) || dates.slice(0, 2).join(" 至 ");
}

function findDateRange(text) {
  const datePattern = "\\d{4}\\s*[-/.年]\\s*\\d{1,2}(?:\\s*[-/.月]\\s*\\d{1,2}\\s*日?)?|\\d{4}\\s*年\\s*\\d{1,2}\\s*月(?:\\s*\\d{1,2}\\s*日?)?|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日";
  const range = new RegExp(`(?:自|从)?\\s*(${datePattern})\\s*(?:起)?\\s*(?:至|到|—|-|~|起至|截至|截止至)\\s*(${datePattern})`);
  const match = text.match(range);
  if (!match) return "";
  return `${cleanDateText(match[1])} 至 ${cleanDateText(match[2])}`;
}

function cleanDateText(value) {
  return String(value).replace(/\s+/g, "");
}

function guessDateByLabels(text, labels) {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index === -1) continue;
    const dates = extractDates(text.slice(index, index + 160));
    if (dates[0]) return dates[0];
  }
  return "";
}

function extractParties(text) {
  const partyA = cleanPartyName(
    guessText(text, ["甲方", "委托方", "采购方", "发包方", "客户名称", "客户"])
  );
  const partyB = cleanPartyName(
    guessText(text, ["乙方", "受托方", "服务方", "承包方", "供应商名称", "服务商"])
  );

  return { partyA, partyB };
}

function cleanPartyName(value) {
  return String(value || "")
    .replace(/^(名称|单位|公司|联系人)\s*[:：]?/, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function guessAmount(text, labels) {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index === -1) continue;
    const amount = extractNearestAmount(text.slice(index + label.length, index + label.length + 80));
    if (amount) return amount;
  }
  return 0;
}

function extractNearestAmount(text) {
  return extractAmountCandidates(text)[0]?.value || 0;
}

function guessText(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*(?:名称|单位)?\\s*[:：]?\\s*([^\\n，,。；;]{2,60})`);
    const match = text.match(pattern);
    if (match) return match[1].replace(/^(为|是|系)/, "").trim();
  }
  return "";
}

function extractSuppliers(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).slice(0, 200);
  for (const line of lines) {
    if (!/(供应商|服务商|制作|媒介|达人|场地|投放|结算|费用)/.test(line)) continue;
    const amount = extractAmounts(line)[0];
    if (!amount) continue;
    rows.push({
      supplier: guessText(line, ["供应商", "服务商"]) || line.slice(0, 16),
      type: /(媒介|投放)/.test(line) ? "媒介投放" : /(达人|KOL|博主)/i.test(line) ? "达人合作" : "项目费用",
      amount,
      status: "待结算"
    });
  }
  return rows.slice(0, 10);
}

function isReimbursementSheet(files = [], text = "") {
  const fileNames = files.map((file) => file.name || "").join(" ");
  const source = `${fileNames}\n${text}`.slice(0, 12000);
  const hasReimbursementTitle = /(项目报销|报销表|报销费用|报销明细|项目报表明细|费用明细)/.test(source);
  const hasEmployeeColumns = /(姓名|员工|申请人|报销人)/.test(source) && /(具体事项|事项|用途|费用明细|金额|备注)/.test(source);
  const hasInternalItems = /(打车|加油|高速|餐费|住宿|道具|物料|场地|快递|办公)/.test(source);
  const hasSupplierSettlement = /(供应商结算|应结|待结算|已结算|供应商付款|服务商结算)/.test(source);
  return (hasReimbursementTitle || hasEmployeeColumns) && hasInternalItems && !hasSupplierSettlement;
}

function extractReimbursementItems(files = []) {
  const rows = parseTableLines(files);
  const items = [];
  let header = null;
  for (const row of rows) {
    const cells = (row.cells || []).map((cell) => String(cell || "").trim());
    if (!cells.some(Boolean)) continue;
    const joined = cells.join(" ");
    const headerIndexes = buildReimbursementColumnMap(cells);
    if (headerIndexes.item >= 0 && headerIndexes.amount >= 0) {
      header = headerIndexes;
      continue;
    }
    if (!header) continue;
    if (/合计|总计|项目成本费用合计/.test(joined)) continue;
    const item = cells[header.item] || "";
    const amount = parseMoney(cells[header.amount]);
    if (!item || !amount) continue;
    const person = header.person >= 0 ? cells[header.person] : "";
    const note = header.note >= 0 ? cells[header.note] : "";
    const category = inferExpenseCategory({ reason: `${item} ${note}`, payee: person }).category;
    items.push({ person, item, amount, note, category });
  }
  return items.slice(0, 80);
}

function buildReimbursementColumnMap(cells = []) {
  const map = { person: -1, item: -1, amount: -1, note: -1 };
  cells.forEach((cell, index) => {
    const text = normalizeHeaderText(cell);
    if (map.person < 0 && /姓名|员工|申请人|报销人/.test(text)) map.person = index;
    if (map.item < 0 && /具体事项|事项|用途|费用明细|费用项目|项目详情/.test(text)) map.item = index;
    if (map.amount < 0 && /金额|费用|报销金额/.test(text)) map.amount = index;
    if (map.note < 0 && /备注|说明/.test(text)) map.note = index;
  });
  return map;
}

function parseProjectDate(text) {
  const match = String(text || "").match(/(20\d{2})[年./-]\s*(\d{1,2})(?:[月./-]\s*(\d{1,2}))?/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] || 1));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthsBetween(year, startMonth, endMonth) {
  const start = Math.max(1, Math.min(12, Number(startMonth)));
  const end = Math.max(start, Math.min(12, Number(endMonth)));
  return Array.from({ length: end - start + 1 }, (_, index) => `${year}-${String(start + index).padStart(2, "0")}`);
}

function inferCoveredMonths(input, fallbackDate = new Date()) {
  const text = String(input || "");
  const months = new Set();
  Array.from(text.matchAll(/(20\d{2})[-年./_ ]\s*(\d{1,2})\s*(?:[-至到~—]\s*(?:(20\d{2})[-年./_ ]\s*)?(\d{1,2}))?\s*月?/g)).forEach((match) => {
    const year = Number(match[1]);
    const startMonth = Number(match[2]);
    const endMonth = Number(match[4] || match[2]);
    monthsBetween(year, startMonth, endMonth).forEach((item) => months.add(item));
  });
  Array.from(text.matchAll(/(?<!\d)(\d{1,2})\s*[-至到~—]\s*(\d{1,2})\s*月/g)).forEach((match) => {
    monthsBetween(fallbackDate.getFullYear(), Number(match[1]), Number(match[2])).forEach((item) => months.add(item));
  });
  Array.from(text.matchAll(/(?<!\d)(\d{1,2})\s*月/g)).forEach((match) => {
    const month = Number(match[1]);
    if (month >= 1 && month <= 12) months.add(`${fallbackDate.getFullYear()}-${String(month).padStart(2, "0")}`);
  });
  return Array.from(months).sort();
}

function projectNamePeriod(project = {}) {
  const text = [
    project.name,
    project.aiSummary,
    project.extractedFields?.servicePeriod,
    project.extractedFields?.summary
  ].filter(Boolean).join(" ");
  const fullYear = text.match(/(20\d{2})年[^，。；;]*?(全年|整年|年度)/);
  if (fullYear) {
    const year = Number(fullYear[1]);
    return [new Date(year, 0, 1), new Date(year, 11, 31)];
  }
  const match = text.match(/(20\d{2})年\s*(\d{1,2})\s*[-至到]\s*(\d{1,2})月/);
  if (!match) return [];
  const year = Number(match[1]);
  return [new Date(year, Number(match[2]) - 1, 1), new Date(year, Number(match[3]), 0)];
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function monthSpan(start, end) {
  return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
}

function projectTimeline(project = {}) {
  const fields = project.extractedFields || {};
  const text = [
    project.paymentDue,
    project.nextMilestone,
    project.aiSummary,
    fields.paymentDue,
    fields.servicePeriod,
    fields.summary,
    project.name
  ].filter(Boolean).join(" ");
  const dates = Array.from(text.matchAll(/20\d{2}[年./-]\s*\d{1,2}(?:[月./-]\s*\d{1,2})?/g)).map((match) => parseProjectDate(match[0])).filter(Boolean);
  const allDates = [...dates, ...projectNamePeriod(project)].sort((a, b) => a - b);
  const start = allDates[0] || null;
  const end = allDates.length > 1 ? allDates[allDates.length - 1] : allDates[0] || null;
  return { text, dates: allDates, start, end };
}

function projectPaymentSchedule(project = {}) {
  const fields = project.extractedFields || {};
  const { text, dates } = projectTimeline(project);
  if (!/季度|每季|按季|季付|季度回款/.test(text)) return null;
  const start = dates[0] || parseProjectDate(fields.servicePeriod || project.nextMilestone || "");
  const end = dates[1] || parseProjectDate(project.paymentDue || "");
  if (!start) return null;
  const months = end && end > start ? monthSpan(start, end) : 12;
  const quarters = Math.max(1, Math.ceil(months / 3));
  const elapsedQuarters = Math.max(0, Math.floor(monthSpan(start, new Date()) / 3));
  const firstQuarterAmount = parseMoney(project.contract) / quarters;
  const billMatch = text.match(/(\d+)\s*个?月[^，。；;]*?(承兑|汇票)/);
  return {
    quarters,
    elapsedQuarters,
    firstQuarterAmount,
    firstQuarterEnd: addMonths(start, 3),
    secondQuarterEnd: addMonths(start, 6),
    billMonths: billMatch ? Number(billMatch[1]) : 0
  };
}

function projectRiskAlerts(project = {}) {
  const contract = parseMoney(project.contract);
  const paid = parseMoney(project.paid);
  const receivable = parseMoney(project.receivable) || Math.max(contract - paid, 0);
  const paymentRate = contract ? paid / contract : 1;
  const breakdown = project.extractedFields?.profitBreakdown || {};
  const executionBudget = parseMoney(project.extractedFields?.executionBudget)
    || parseMoney(breakdown.executionBudget)
    || (project.extractedFields?.profitBreakdown ? 0 : parseMoney(project.costBudget));
  const costUsed = parseMoney(project.costUsed);
  const costRate = executionBudget ? costUsed / executionBudget : 0;
  const alerts = [];

  const timeline = projectTimeline(project);
  const today = new Date();
  const projectDone = /已完成|结案|完成/.test(String(project.status || ""));
  if (timeline.end && today > timeline.end && receivable > 0) {
    alerts.push({
      role: "销售",
      type: "合同回款已逾期",
      severity: "高",
      text: `合同约定节点已到期（${timeline.end.toLocaleDateString("zh-CN")}），截至今日仍待回款 ${receivable}，请销售立即跟进回款。`
    });
  }
  if (timeline.end && today > timeline.end && !projectDone) {
    alerts.push({
      role: "PM",
      type: "合同执行已逾期",
      severity: "高",
      text: `合同服务期/执行节点已到期（${timeline.end.toLocaleDateString("zh-CN")}），但项目状态仍为“${project.status || "未完成"}”，请 PM 核实执行收尾。`
    });
  }
  const schedule = projectPaymentSchedule(project);
  if (schedule && contract && paid < schedule.firstQuarterAmount && schedule.elapsedQuarters >= 2) {
    alerts.push({
      role: "销售",
      type: "季度回款逾期",
      severity: "高",
      text: `项目已执行到第 ${schedule.elapsedQuarters} 个季度，但第 1 季度应回款约 ${Math.round(schedule.firstQuarterAmount)} 尚未到账；请销售立即跟进合同季度回款${schedule.billMonths ? `及 ${schedule.billMonths} 个月汇票周期` : ""}。`
    });
  } else if (schedule && contract && paid < schedule.firstQuarterAmount && schedule.elapsedQuarters >= 1) {
    alerts.push({
      role: "销售",
      type: "季度回款提醒",
      severity: "中",
      text: `第 1 季度已执行完成，应回款约 ${Math.round(schedule.firstQuarterAmount)}；请销售关注合同季度回款${schedule.billMonths ? `及 ${schedule.billMonths} 个月汇票周期` : ""}。`
    });
  } else if (!schedule && contract && receivable > 0 && paymentRate < 0.5) {
    alerts.push({
      role: "销售",
      type: "回款进度过慢",
      severity: "高",
      text: `项目已回款 ${paid}，待回款 ${receivable}，回款进度 ${Math.round(paymentRate * 100)}%，请销售跟进客户付款。`
    });
  }
  if (executionBudget && costUsed >= executionBudget) {
    alerts.push({
      role: "PM",
      type: "执行成本已超支",
      severity: "高",
      text: `执行成本 ${costUsed} 已达到预算上限 ${executionBudget} 的 ${Math.round(costRate * 100)}%，请 PM 立即复盘执行成本。`
    });
  } else if (executionBudget && costRate >= 0.8) {
    alerts.push({
      role: "PM",
      type: "执行成本即将超支",
      severity: "高",
      text: `执行成本 ${costUsed} 已达到预算上限 ${executionBudget} 的 ${Math.round(costRate * 100)}%，请 PM 控制后续支出。`
    });
  }
  const revenue = project.extractedFields?.revenueRecognition || {};
  const quoteRules = revenue.quoteRules || [];
  const hasPm = Boolean(project.pm || project.owner);
  if (quoteRules.length && !hasPm) {
    alerts.push({
      role: "管理层",
      type: "待分配项目PM",
      severity: "中",
      text: `销售已上传报价规则库，AI 已识别 ${quoteRules.length} 条可核销服务项；请总监分配项目 PM。`
    });
  }
  const targetText = monthlyTargetSummaryFromRules(quoteRules);
  const currentMonth = monthKey(new Date());
  const hasVerification = (revenue.verificationRecords || []).some((record) => record.month === currentMonth);
  if (quoteRules.length && targetText && !hasVerification) {
    alerts.push({
      role: "PM",
      type: "本月核销表待上传",
      severity: "中",
      text: `AI 已从报价表识别本月核销目标：${targetText}。请 PM 完成后上传核销表。`
    });
  }
  return alerts;
}

function monthlyTargetSummaryFromRules(rules = []) {
  return rules.map((rule) => {
    if (rule.monthlyTargetText) return rule.monthlyTargetText;
    if (rule.monthlyQuantity) return `${String(rule.serviceName || "").slice(0, 14)}：${formatSmartNumber(rule.monthlyQuantity)}${rule.unit || "项"}/月`;
    const text = `${rule.description || ""} ${rule.serviceName || ""}`;
    const match = text.match(/每月(?:不少于|至少|不低于)?\s*(\d+(?:\.\d+)?)\s*(支|条|篇|次|个|项)/);
    return match ? `${String(rule.serviceName || "").slice(0, 14)}：${match[1]}${match[2]}/月` : "";
  }).filter(Boolean).slice(0, 3).join("；");
}

function inferRisk(values = {}) {
  const contract = parseMoney(values.contract);
  const costBudget = parseMoney(values.costBudget);
  const costUsed = parseMoney(values.costUsed);
  const receivable = parseMoney(values.receivable);
  if (contract && (costUsed / contract > 0.75 || receivable / contract > 0.8)) return "高";
  if (costBudget && costUsed / costBudget > 0.8) return "中";
  return "低";
}
