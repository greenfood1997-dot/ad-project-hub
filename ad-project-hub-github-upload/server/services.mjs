import { recognizeFileWithTencentOcr, tencentOcrConfigured } from "./tencent-ocr.mjs";

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
      await applyInitialQuoteSheets(db, project, files, user, now);
      assertUniqueProject(db, projectToValues(project), project.files || files, project.contract, project.id);
    } catch (error) {
      removeCreatedProject(db, project.id, parseJob.id);
      throw error;
    }
  }

  return { project, parseJob };
}

export function updateProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");

  const values = body.values || {};
  const oldName = project.name;
  const nextName = String(values["项目名称"] || project.name || "").trim();
  const nextClient = String(values["客户 / 品牌"] || project.client || "").trim();
  const nextOwner = String(values["负责人"] || project.owner || "").trim();
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
  project.contract = contract;
  project.paid = paid;
  project.receivable = Math.max(contract - paid, 0);
  project.extractedFields = {
    ...(project.extractedFields || {}),
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

export function deleteProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");

  db.projects = (db.projects || []).filter((item) => item.id !== project.id);
  db.parseJobs = (db.parseJobs || []).filter((item) => item.projectId !== project.id);
  db.files = (db.files || []).filter((item) => item.projectId !== project.id && item.projectName !== project.name);
  db.suppliers = (db.suppliers || []).filter((item) => item.projectId !== project.id && item.project !== project.name);
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

export function supplierCsv(db) {
  const header = "供应商,归属项目,费用类型,应结金额,状态\n";
  const rows = db.suppliers.map((item) => [item.supplier, item.project, item.type, item.amount, item.status]
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  return header + rows.join("\n");
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

  if (!text.trim() || !aiSettings?.["API Key"]) return fallback;

  try {
    const ai = normalizeAiSettings(aiSettings);
    const data = await requestAiJson(ai, values, text);
    const content = data.choices?.[0]?.message?.content || "{}";
    return normalizeParsedFields(mergeParsedFields(fallback, parseJsonObject(content)), values, files, interestRateSettings);
  } catch (error) {
    return {
      ...fallback,
      summary: `${fallback.summary} AI 解析未完成，已使用本地规则抽取。原因：${error.message}`
    };
  }
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
          const ocrText = await recognizeFileWithTencentOcr(file, { isPdf: true });
          console.log(`[OCR] ${name}: Tencent OCR returned ${ocrText.length} characters`);
          return {
            ...file,
            text: ocrText,
            extractionStatus: ocrText.trim() ? `${reason}，已使用腾讯云 OCR 识别` : "腾讯云 OCR 未识别到文本"
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
  for (const row of parseTableLines(files)) {
    const cells = row.cells;
    if (cells.length < 6) continue;
    if (/服务类别|服务内容|详细描述/.test(cells.join(""))) continue;
    const unitPrice = parseMoney(cells[6]);
    const totalAmount = parseMoney(cells[7]);
    const quantity = parseMoney(cells[4]);
    const unit = cells[5] || "";
    if (!unitPrice || !totalAmount || !quantity) continue;
    const serviceName = cells[2] || cells[1] || cells[3] || "";
    if (!serviceName || /^(合计|备注|项目最终优惠)/.test(serviceName)) continue;
    rules.push({
      id: `QR-${rules.length + 1}`,
      category: cells[0] || cells[1] || "",
      serviceName,
      description: cells[3] || "",
      quantity,
      unit,
      unitPrice,
      totalAmount,
      remainingQuantity: quantity,
      recognitionMethod: /(支|条|篇|次|个|项)/.test(unit) ? "按数量核销" : "按金额核销",
      sourceFile: row.file,
      confidence: "规则识别"
    });
  }
  return rules;
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
    const month = inferVerificationMonth([{ name: row.file, text: line }]);
    const quantityMatch = line.match(/(\d+(?:\.\d+)?)\s*(支|条|篇|次|个|项)/);
    const amount = guessAmount(line, ["核销金额", "本月核销", "确认收入", "核销收入", "结算金额", "验收金额", "金额", "小计", "收入"]) || 0;
    const quantity = quantityMatch ? Number(quantityMatch[1]) : parseMoney(cells.find((cell) => /^\d+(\.\d+)?$/.test(cell)) || 0);
    if (!quantity && !amount) continue;
    items.push({
      serviceName: cells.slice(0, Math.min(cells.length, 4)).join(" "),
      quantity,
      unit: quantityMatch?.[2] || "",
      amount,
      month,
      sourceFile: row.file,
      rawText: line
    });
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
  const normalized = cells.map(normalizeHeaderText).join(" ");
  const hasService = /(服务|内容|项目|资源|达人|账号|平台|刊例|报价)/.test(normalized);
  const hasMetric = /(数量|条数|篇数|次数|支数|本月|核销|确认|收入|金额|结算|验收|小计)/.test(normalized);
  return hasService && hasMetric;
}

function buildVerificationColumnMap(cells = []) {
  const normalized = cells.map(normalizeHeaderText);
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
    service: findHeaderIndex(normalized, [/服务.*(内容|项目|名称|类别)?/, /项目.*(内容|名称)/, /资源.*(名称|位)/, /达人|账号|平台/, /刊例|报价项/]),
    description: findHeaderIndex(normalized, [/详细|描述|备注|说明/]),
    quantity: monthlyQuantity >= 0 ? monthlyQuantity : findHeaderIndex(normalized, [/核销.*(数量|条数|篇数|次数|支数)/, /本月.*(数量|条数|篇数|次数|支数)/, /(条数|篇数|次数|支数)$/]),
    unit: findHeaderIndex(normalized, [/单位|计量/]),
    amount: monthlyAmount >= 0 ? monthlyAmount : findHeaderIndex(normalized, [/核销.*(金额|收入|费用)/, /确认.*(收入|金额|费用)/, /结算.*金额/, /验收.*金额/]),
    month: findHeaderIndex(normalized, [/月份|月度|周期|期间|日期|时间|[一二三四五六七八九十\d]+月/]),
    hasMonthlyAmount: monthlyAmount >= 0,
    hasMonthlyQuantity: monthlyQuantity >= 0,
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
    month: inferVerificationMonth([{ name: row.file, text: `${monthText} ${line}` }]),
    sourceFile: row.file,
    rawText: line
  };
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
    const amount = item.amount || Math.round(quantity * Number(best.rule.unitPrice || 0));
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
      status: canReplace ? "置换待确认" : overLimit || lowConfidence ? "待复核" : "自动通过",
      reason: canReplace
        ? "核销数量超过本类目剩余额度，但合同内其他类目仍有可置换余额，需总监确认置换"
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
