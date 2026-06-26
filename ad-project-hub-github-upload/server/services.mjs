import { recognizeFileWithTencentOcr, recognizeFileWithTencentOcrDetailed, tencentOcrConfigured } from "./tencent-ocr.mjs";

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
  const files = await normalizeUploadedFiles(body.files || [], category, user, now);
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
    if (Array.isArray(parsed.suppliers) && parsed.suppliers.length) {
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
  project.contract = contract;
  project.paid = paid;
  project.receivable = Math.max(contract - paid, 0);
  project.extractedFields = {
    ...(project.extractedFields || {}),
    pm: project.pm,
    sales: project.sales,
    executionBudgetRatio,
    executionBudget
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

  db.auditLogs.unshift({ type: "project", target: project.name, action: "update", user: user.name, at: project.updatedAt });
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
    createdAt: task?.createdAt || "",
    createdBy: task?.createdBy || "",
    updatedAt: task?.updatedAt || "",
    updatedBy: task?.updatedBy || ""
  };
}

function syncProjectProgressFromTasks(project) {
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  project.tasks = tasks;
  const values = tasks.map((task) => Number(task.progress || 0)).filter(Number.isFinite);
  const progress = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  project.progress = progress;
  project.extractedFields = {
    ...(project.extractedFields || {}),
    taskProgress: progress,
    taskSummary: {
      total: tasks.length,
      done: tasks.filter((task) => task.status === "done" || Number(task.progress || 0) >= 100).length,
      doing: tasks.filter((task) => task.status === "doing").length,
      todo: tasks.filter((task) => task.status === "todo").length,
      updatedAt: new Date().toISOString()
    }
  };
  return progress;
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
  return { project, task: candidate };
}

export function deleteProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");

  db.projects = (db.projects || []).filter((item) => item.id !== project.id);
  db.parseJobs = (db.parseJobs || []).filter((item) => item.projectId !== project.id);
  db.files = (db.files || []).filter((item) => item.projectId !== project.id && item.projectName !== project.name);
  db.suppliers = (db.suppliers || []).filter((item) => item.projectId !== project.id && item.project !== project.name);
  db.payments = (db.payments || []).filter((item) => item.projectId !== project.id && item.projectName !== project.name);
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
    if (project) await analyzeAndApplyProjectFiles(db, project, job);
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
  await analyzeAndApplyProjectFiles(db, project, job);
  db.auditLogs.unshift({ type: "project", target: project.name, action: "reparse", user: user.name, at: now });
  return { project, parseJob: job };
}

export async function uploadProjectCostSheet(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const now = new Date().toISOString();
  const files = await normalizeUploadedFiles(body.files || [], "execution-cost", user, now);
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
  const files = await normalizeUploadedFiles(body.files || [], "quote-sheet", user, now);
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

  const quoteFiles = (await normalizeUploadedFiles(candidateFiles, "quote-sheet", user, now))
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
  const files = await normalizeUploadedFiles(body.files || [], "verification-sheet", user, now);
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

async function normalizeUploadedFiles(files, category, user, now) {
  return Promise.all((Array.isArray(files) ? files : []).map(async (file) => {
    const shouldExtract = file.base64 && (/\.(xlsx|xls|xlsm)$/i.test(file.name || "") || String(file.type || "").includes("spreadsheet"));
    const extracted = shouldExtract || !file.text ? await extractFileContent(file) : file;
    const tableRows = extracted.tableRows || file.tableRows || [];
    const tableText = tableRowsToText(tableRows);
    const extractedText = extracted.extractionStatus === "仅记录文件信息" ? "" : extracted.text;
    return {
      ...file,
      text: extractedText || file.text || tableText || extracted.text || "",
      tableRows,
      extractionStatus: extracted.extractionStatus || file.extractionStatus || "",
      category,
      uploadedAt: file.uploadedAt || now,
      uploadedBy: file.uploadedBy || user.id,
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
  const profitBreakdown = hasCostSheet ? calculateProfitBreakdown(contract, parsed) : null;
  const costBudget = hasCostSheet ? (profitBreakdown.executionBudget || parseMoney(project.costBudget)) : parseMoney(project.costBudget);
  const costUsed = hasCostSheet ? profitBreakdown.totalDeduction : parseMoney(project.costUsed);
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
  const current = db.settings?.[type] || {};
  const candidate = type === "aiService" ? { ...current, ...values } : values;
  const checked = type === "aiService" ? await testAiSettings(candidate) : null;
  const normalized = type === "aiService" ? validateAiSettings(candidate) : values;
  const saved = { ...current, ...normalized, connection: checked, savedAt: new Date().toISOString(), savedBy: user.id };
  db.settings[type] = saved;
  db.auditLogs.unshift({ type: "settings", target: type, user: user.name, at: saved.savedAt });
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

export function recordFiles(db, body, user) {
  const now = new Date().toISOString();
  const files = (Array.isArray(body.files) ? body.files : []).map((file) => ({
    ...file,
    uploadedAt: file.uploadedAt || now,
    uploadedBy: file.uploadedBy || user.id
  }));
  const upload = { files, projectName: body.projectName || "", user: user.name, at: now };
  db.files.unshift(upload);
  db.auditLogs.unshift({ type: "upload", target: upload.projectName || "未命名项目", count: files.length, user: user.name, at: now });
  return upload;
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
  const comment = { ...body, user: user.name, at };
  db.comments.unshift(comment);
  db.auditLogs.unshift({ type: "comment", target: body.project, user: user.name, at });
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
  const owner = String(project.owner || "").trim();
  return Boolean(pm && !/待分派|待确认|未分配|暂无/.test(pm)) || Boolean(owner && !/飞书机器人|待分派|待确认|未分配/.test(owner));
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
    if (!["待审批", "待处理", "审批中"].includes(approval.status)) continue;
    const createdAt = approval.createdAt ? new Date(approval.createdAt) : now;
    const hours = Math.max(0, (now - createdAt) / 36e5);
    if (hours < 24) continue;
    const financeRole = approval.currentRole === "finance" || /财务/.test(String(approval.currentRole || ""));
    notifications.push(upsertSystemNotification(db, {
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: `「${approval.projectName || "项目"}」的${approval.typeLabel || approval.type || "审批"} ${approval.amount || 0} 元已等待较久，请${financeRole ? "财务" : "负责人"}及时处理。`,
      severity: hours >= 48 ? "高" : "中",
      role: financeRole ? "finance" : "management",
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

export function updateSystemNotification(db, body, user) {
  const id = String(body?.id || "").trim();
  const action = body?.action === "ignore" ? "已忽略" : "已处理";
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const at = new Date().toISOString();
  item.status = action;
  item.handledAt = at;
  item.handledBy = user.id;
  item.handledByName = user.name;
  item.note = String(body.note || "").trim();
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "notification",
    target: item.title,
    action: body?.action === "ignore" ? "ignore" : "resolve",
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
      role: recipient.role,
      openId: recipient.feishuOpenId || recipient.feishuUserId || "",
      feishuName: recipient.feishuName || recipient.name
    }));
  const targets = recipients.filter((recipient) => recipient.openId);
  if (!targets.length) throw new Error("没有找到已绑定飞书 Open ID 的收件人，请先在成员管理里填写飞书 Open ID。");
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
    results
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

const APPROVAL_LABELS = {
  petty_cash: "项目备用金",
  reimbursement: "报销",
  supplier_payment: "供应商付款"
};

function nextApprovalId() {
  return `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function approvalSteps(type, amount = 0) {
  const base = [
    { key: "submit", label: "员工提交", role: "member", status: "done" },
    { key: "pm", label: "PM确认", role: "pm", status: "current" },
    { key: "director", label: "总监审批", role: "director", status: "todo" },
    { key: "finance", label: "财务处理", role: "finance", status: "todo" },
    { key: "done", label: type === "reimbursement" ? "完成入账" : "完成付款", role: "finance", status: "todo" }
  ];
  if (type === "supplier_payment") base[0].label = "PM发起";
  if (Number(amount) <= 1000 && type === "reimbursement") {
    return base.filter((step) => step.key !== "director");
  }
  return base;
}

function currentApprovalStep(approval) {
  return (approval.steps || []).find((step) => step.status === "current");
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
    project.extractedFields.pettyCashUsed = currentUsed + amount;
    project.costUsed = Number(project.costUsed || 0) + amount;
    const costs = Array.isArray(project.costs) ? project.costs : [];
    const row = costs.find((item) => Array.isArray(item) && item[0] === "员工报销");
    if (row) row[1] = Number(row[1] || 0) + amount;
    else costs.push(["员工报销", amount]);
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
    db.suppliers.unshift({
      supplier: supplierName,
      project: project.name,
      type: approval.reason || "供应商付款",
      amount,
      status: "已付款",
      approvalId: approval.id,
      paidAt: new Date().toISOString()
    });
  }
  project.receivable = Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0);
  project.margin = Number(project.contract || 0)
    ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100)
    : 0;
  project.updatedAt = new Date().toISOString();
  approval.appliedAt = project.updatedAt;
}

export function createApproval(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId);
  if (!project) throw new Error("项目不存在");
  const type = body.type || "reimbursement";
  if (!APPROVAL_LABELS[type]) throw new Error("不支持的审批类型");
  const amount = Number(body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("请填写正确的审批金额");
  const at = new Date().toISOString();
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
    status: "待PM确认",
    currentRole: "pm",
    applicantId: user.id,
    applicantName: user.name,
    applicantRole: user.role,
    createdAt: at,
    updatedAt: at,
    steps: approvalSteps(type, amount),
    logs: [{ action: "submit", user: user.name, role: user.role, note: body.reason || "", at }]
  };
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
  approval.logs = approval.logs || [];
  approval.logs.unshift({
    action,
    user: user.name,
    role: user.role,
    step: step.label,
    note: String(body.note || "").trim(),
    at
  });
  applyApprovedFinanceImpact(db, approval);
  db.auditLogs.unshift({
    type: "approval",
    target: approval.projectName,
    action,
    user: user.name,
    meta: { approvalId: approval.id, approvalType: approval.type, amount: approval.amount, status: approval.status },
    at
  });
  return approval;
}

export function supplierCsv(db) {
  const header = "供应商,归属项目,费用类型,应结金额,状态\n";
  const rows = db.suppliers.map((item) => [item.supplier, item.project, item.type, item.amount, item.status]
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
    return {
      ...profile,
      cooperationCount: rows.length,
      projectCount: projects.length,
      projects,
      types,
      totalAmount,
      paidCount,
      averageRating,
      ratingCount: ratings.length,
      star,
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
  profile.likes = splitLines(body.likes ?? profile.likes);
  profile.dislikes = splitLines(body.dislikes ?? profile.dislikes);
  profile.pitfalls = splitLines(body.pitfalls ?? profile.pitfalls);
  profile.handoffNote = String(body.handoffNote ?? profile.handoffNote ?? "").trim();
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
          return stats.ownTotal ? `${stats.salesName || item.salesName} 已记录 ${stats.ownTotal} 次，成功 ${stats.ownSuccess} 次` : "暂无结果沉淀";
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
  record.updatedAt = at;
  db.auditLogs.unshift({
    type: "collection",
    target: record.projectName,
    action: "outcome",
    user: user.name,
    meta: { scriptId: record.id, success: record.success, score: record.score },
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
    return { ...fallback, extractionStatus: `文件内容提取失败：${error.message}` };
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
  const pattern = /(?:人民币|RMB|￥|¥)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(亿元|亿|万元|万|元)?/g;
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
      const snippet = text.slice(start, match.index + 180);
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
  return candidates[0]?.value || 0;
}

function extractAmountCandidates(text) {
  const candidates = [];
  const pattern = /(?:人民币|RMB|￥|¥)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?|[壹贰叁肆伍陆柒捌玖拾佰仟万亿零一二三四五六七八九十百千万两]+)\s*(亿元|亿|万元|万|元|圆)?/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].trim();
    if (!raw || looksLikeDateOrIdentifier(text, match.index || 0, raw)) continue;
    const value = parseMoney(raw);
    if (!value || value < 100) continue;

    const unit = match[2] || "";
    const context = text.slice(Math.max(0, (match.index || 0) - 30), (match.index || 0) + raw.length + 30);
    const hasMoneyUnit = Boolean(unit || /人民币|RMB|￥|¥|元|圆|万|亿/.test(raw));
    const hasContractContext = /(合同|价款|总价|总额|金额|费用|服务费|付款|回款|含税|不含税)/.test(context);
    const noUnitLongNumber = /^\d{7,}$/.test(raw.replace(/[^\d]/g, "")) && !hasMoneyUnit;
    if (noUnitLongNumber && !hasContractContext) continue;

    candidates.push({
      value,
      raw,
      score: (hasContractContext ? 60 : 0) + (hasMoneyUnit ? 80 : 0) + (value >= 10000 ? 20 : 0) - (noUnitLongNumber ? 120 : 0)
    });
  }
  return candidates;
}

function labelScore(label) {
  if (/合同总金额|合同金额|合同价款|合同总价/.test(label)) return 100;
  if (/项目金额|项目总价|服务费总额|总金额|总价/.test(label)) return 80;
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
