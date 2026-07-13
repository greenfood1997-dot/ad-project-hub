import { arrayCount, money, nextFileId, parseMoney, splitLines, textIncludes } from "./service-utils.mjs";
import { currentApprovalStep, inferExpenseCategory } from "./approval-flow.mjs";
import { answerAiAssistant as answerAiAssistantCore } from "./assistant-service.mjs";
import { supplierLibrary } from "./supplier-service.mjs";
import { clientLibrary } from "./client-service.mjs";
import { persistLocalUploadFile } from "./upload-storage-service.mjs";
import { extractFileContent } from "./file-extraction-service.mjs";
import { recordProjectPayment as recordProjectPaymentCore, voidProjectPayment as voidProjectPaymentCore } from "./payment-service.mjs";
import { archiveProjectTask as archiveProjectTaskCore, normalizeProjectTask, taskDueInfo, upsertProjectTask as upsertProjectTaskCore } from "./project-task-service.mjs";
import { recordFiles as recordFilesCore, refreshInterestRate as refreshInterestRateCore, saveCompanyFinance as saveCompanyFinanceCore, saveSetting as saveSettingCore, testAiSettings as testAiSettingsCore, testObjectStorage as testObjectStorageCore, validateAiSettings as validateAiSettingsCore } from "./settings-service.mjs";
import { dispatchNewHighSeverityNotifications as dispatchNewHighSeverityNotificationsCore, notificationRecipientsForRole, projectCostPressure, projectTimeHealth, scanSystemNotifications as scanSystemNotificationsCore, sendSystemNotificationToFeishu as sendSystemNotificationToFeishuCore, sendSystemNotificationToWechat as sendSystemNotificationToWechatCore, updateSystemNotification as updateSystemNotificationCore, upsertSystemNotification } from "./notification-service.mjs";
import { feishuPendingFiles, feishuProjectBindings, getFeishuTenantAccessToken, handleFeishuEvent as handleFeishuEventCore, handleFeishuPendingFile as handleFeishuPendingFileCore, saveFeishuProjectBinding } from "./feishu-service.mjs";
import { actOnApproval as actOnApprovalCore, createApproval as createApprovalCore, findProjectForSupplierSettlement, updateSupplierSettlement as updateSupplierSettlementCore, withdrawApproval as withdrawApprovalCore } from "./approval-service.mjs";
import { analyzeAndApplyProjectFiles as analyzeAndApplyProjectFilesCore, applyParsedFields as applyParsedFieldsCore, createParseJob, fileReference, markParseJobFailed, normalizeUploadedFiles as normalizeUploadedFilesCore, uploadedFileKey } from "./project-parse-service.mjs";
import { assertUniqueProject, deleteProject as deleteProjectCore, findMatchingProjectForCostSheet, hasContractLikeFile, normalizeProjectText, projectToValues, removeCreatedProject, similarity, syncProjectProfit as syncProjectProfitCore } from "./project-lifecycle-service.mjs";
export { exportBackupSnapshot, restoreBackupSnapshot, validateBackupSnapshot } from "./backup-service.mjs";
export { clientLibrary, saveClientProfile } from "./client-service.mjs";
export { collectionLibrary, saveCollectionOutcome, suggestCollectionScript } from "./collection-service.mjs";
export { addComment, archiveComment, archiveFileRecord, updateAlert } from "./project-activity-service.mjs";
export { rateSupplier, supplierCsv, supplierLibrary } from "./supplier-service.mjs";

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
    costBudget: 0,
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
    extractedFields: {},
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
      const reimbursementCategorySummary = Array.from(reimbursementItems.reduce((map, item) => {
        const category = item.category || "其他";
        map.set(category, Number(map.get(category) || 0) + Number(item.amount || 0));
        return map;
      }, new Map()).entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
      preview.sections.push({
        title: "员工报销/项目报销明细",
        rows: reimbursementItems.slice(0, 12).map((item) => ({
          name: `${item.person ? `${item.person} · ` : ""}${item.item}`,
          amount: item.amount,
          status: item.category
        })),
        total: reimbursementTotal
      });
      preview.sections.push({
        title: "报销类目汇总",
        rows: reimbursementCategorySummary.map((item) => ({
          name: item.category,
          amount: item.amount,
          status: "类目合计"
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
  else warnings.push(`已识别合同金额 ${money(contract)}，请和合同总价/最终优惠总价核对后再确认入库。`);
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
  return recordProjectPaymentCore(db, body, user, { inferRisk, projectRiskAlerts });
}

export function voidProjectPayment(db, body, user) {
  return voidProjectPaymentCore(db, body, user, { inferRisk, projectRiskAlerts });
}

export function upsertProjectTask(db, body, user) {
  return upsertProjectTaskCore(db, body, user, { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate });
}

export function archiveProjectTask(db, body, user) {
  return archiveProjectTaskCore(db, body, user, { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate });
}

export function deleteProject(db, body, user) {
  return deleteProjectCore(db, body, user);
}

function syncProjectProfit(project, executionBudget = 0) {
  return syncProjectProfitCore(project, executionBudget, { calculateProfitBreakdown, profitMargin });
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

function parseServiceDeps() {
  return {
    analyzeProjectFiles,
    calculateProfitBreakdown,
    extractFileContent,
    inferRisk,
    nextFileId,
    persistLocalUploadFile,
    profitMargin,
    projectRiskAlerts,
    shouldUseOcrForPdf
  };
}

async function normalizeUploadedFiles(files, category, user, now, storageSettings = {}) {
  return normalizeUploadedFilesCore(files, category, user, now, storageSettings, parseServiceDeps());
}

async function analyzeAndApplyProjectFiles(db, project, job) {
  return analyzeAndApplyProjectFilesCore(db, project, job, parseServiceDeps());
}

function applyParsedFields(db, project, job, parsed) {
  return applyParsedFieldsCore(db, project, job, parsed, parseServiceDeps());
}

export function validateAiSettings(values) {
  return validateAiSettingsCore(values, { normalizeAiSettings });
}

export async function testAiSettings(values) {
  return testAiSettingsCore(values, { normalizeAiSettings });
}

export async function saveSetting(db, type, values, user) {
  return saveSettingCore(db, type, values, user, { normalizeAiSettings, syncCompanyCashRunwayNotificationAfterSave });
}

export function saveCompanyFinance(db, values = {}, user = {}) {
  return saveCompanyFinanceCore(db, values, user, { syncCompanyCashRunwayNotificationAfterSave });
}

export async function refreshInterestRate(db, user) {
  return refreshInterestRateCore(db, user);
}

export async function recordFiles(db, body, user) {
  return recordFilesCore(db, body, user, { normalizeUploadedFiles });
}

export async function testObjectStorage(db, values = {}, user = {}) {
  return testObjectStorageCore(db, values, user, { normalizeUploadedFiles });
}

export function scanSystemNotifications(db, user = { id: "system", name: "系统扫描" }) {
  return scanSystemNotificationsCore(db, user, {
    currentApprovalStep,
    monthKey,
    monthlyTargetSummaryFromRules,
    normalizeProjectTask,
    pendingSupplierRowsForProject,
    taskDueInfo
  });
}

export function updateSystemNotification(db, body, user) {
  return updateSystemNotificationCore(db, body, user);
}

export async function sendSystemNotificationToFeishu(db, body, user) {
  return sendSystemNotificationToFeishuCore(db, body, user, { getFeishuTenantAccessToken });
}

export async function sendSystemNotificationToWechat(db, body, user) {
  return sendSystemNotificationToWechatCore(db, body, user);
}

export async function dispatchNewHighSeverityNotifications(db, notices, user) {
  return dispatchNewHighSeverityNotificationsCore(db, notices, user, { getFeishuTenantAccessToken });
}

function assistantServiceDeps() {
  return {
    createApproval,
    postAi,
    resolveAiSettings,
    upsertProjectTask
  };
}

export async function answerAiAssistant(db, body, user, scopedDb) {
  return answerAiAssistantCore(db, body, user, scopedDb, assistantServiceDeps());
}

function approvalServiceDeps() {
  return {
    supplierLibrary,
    syncApprovalNotificationAfterAction,
    syncProjectHealthNotificationsAfterUpdate,
    syncSupplierSettlementNotificationAfterUpdate
  };
}

export function createApproval(db, body, user) {
  return createApprovalCore(db, body, user);
}

export function actOnApproval(db, body, user) {
  return actOnApprovalCore(db, body, user, approvalServiceDeps());
}

export function withdrawApproval(db, body, user) {
  return withdrawApprovalCore(db, body, user, approvalServiceDeps());
}

export function updateSupplierSettlement(db, body, user) {
  return updateSupplierSettlementCore(db, body, user, approvalServiceDeps());
}

export { feishuPendingFiles, feishuProjectBindings, getFeishuTenantAccessToken, saveFeishuProjectBinding };

function feishuServiceDeps() {
  return {
    createProject,
    projectRiskAlerts,
    syncFeishuPendingNotificationAfterAction,
    uploadProjectCostSheet,
    uploadProjectQuoteSheet,
    uploadProjectVerificationSheet
  };
}

export async function handleFeishuEvent(db, payload, user = { id: "system", name: "飞书机器人", role: "system" }) {
  return handleFeishuEventCore(db, payload, user, feishuServiceDeps());
}

export async function handleFeishuPendingFile(db, body, user) {
  return handleFeishuPendingFileCore(db, body, user, feishuServiceDeps());
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

async function analyzeProjectFiles(aiSettings, values, files, interestRateSettings) {
  const extractedFiles = await Promise.all(files.map((file) => extractFileContent(file, { shouldUseOcrForPdf })));
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
      content: "你是广告项目经营中台的文件解析和自动归档助手。你要把合同、报价单、执行表、排期表、供应商结算表中的关键信息归类到项目中台。只返回 JSON，不要 Markdown。字段包括 projectName, client, partyA, partyB, contract, paid, receivable, advancePayment, advanceInterest, executionCost, executionBudget, internalLabor, overhead, costBudget, costUsed, servicePeriod, nextMilestone, paymentDue, risk, summary, costs, suppliers, tasks, archiveTags, confidence, missingFields, hasCostSheet。金额返回数字，日期保留原文。遇到合同约定按季度/每季/季付/季度回款，或付款后附带承兑汇票、汇票期限、兑付周期时，必须把完整付款方式写入 paymentDue 或 summary，例如“按季度回款，项目完成并验收合格后支付6个月承兑汇票”。项目利润口径固定为：项目总金额 - 实时执行支出 - 项目垫款 - 垫款利息 - 内部人力 - 公摊费用（水电、办公室租金及其他公摊）= 项目利润。executionBudget 是项目预留预算上限，通常来自合同金额占比；执行表中的执行支出请写入 executionCost。只有文件明确是成本表、供应商结算表、费用明细表时，hasCostSheet 才为 true，并尽量返回 advancePayment、advanceInterest、executionCost、internalLabor、overhead；合同或报价单中的合同金额、服务费用、付款金额不要写入成本字段。costs 为 [科目, 金额]；suppliers 为对象数组，含 supplier,type,amount,status；tasks 为 [节点, 进度百分比]。"
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
