import { nextFileId as defaultNextFileId, parseMoney } from "./service-utils.mjs";

// Project parse jobs, upload file normalization, and parsed-field write-back helpers.
function parseDeps(deps = {}) {
  return {
    nextFileId: deps.nextFileId || defaultNextFileId,
    persistLocalUploadFile: deps.persistLocalUploadFile,
    extractFileContent: deps.extractFileContent,
    shouldUseOcrForPdf: deps.shouldUseOcrForPdf,
    analyzeProjectFiles: deps.analyzeProjectFiles,
    calculateProfitBreakdown: deps.calculateProfitBreakdown,
    inferRisk: deps.inferRisk,
    profitMargin: deps.profitMargin,
    projectRiskAlerts: deps.projectRiskAlerts
  };
}

function requireParseDep(deps, key) {
  if (typeof deps[key] !== "function") throw new Error(`解析服务缺少依赖：${key}`);
  return deps[key];
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


export function uploadedFileKey(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.type || ""}`;
}


export function fileReference(file = {}) {
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

export async function normalizeUploadedFiles(files, category, user, now, storageSettings = {}, rawDeps = {}) {
  const deps = parseDeps(rawDeps);
  requireParseDep(deps, "persistLocalUploadFile");
  requireParseDep(deps, "extractFileContent");
  return Promise.all((Array.isArray(files) ? files : []).map(async (file) => {
    const withId = { ...file, id: file.id || deps.nextFileId() };
    const stored = await deps.persistLocalUploadFile(withId, category, now, storageSettings);
    const shouldExtract = stored.base64 && (/\.(xlsx|xls|xlsm)$/i.test(stored.name || "") || String(stored.type || "").includes("spreadsheet"));
    const extracted = shouldExtract || !stored.text ? await deps.extractFileContent(stored, { shouldUseOcrForPdf: deps.shouldUseOcrForPdf }) : stored;
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

export function markParseJobFailed(job, error) {
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

export async function analyzeAndApplyProjectFiles(db, project, job, rawDeps = {}) {
  const deps = parseDeps(rawDeps);
  requireParseDep(deps, "analyzeProjectFiles");
  requireParseDep(deps, "calculateProfitBreakdown");
  requireParseDep(deps, "inferRisk");
  requireParseDep(deps, "profitMargin");
  requireParseDep(deps, "projectRiskAlerts");
  job.status = "解析中";
  job.progress = Math.max(job.progress || 0, 50);
  job.steps = setStepStatus(job.steps, "字段识别", "进行中");
  job.updatedAt = new Date().toISOString();

  const parsed = await deps.analyzeProjectFiles(db.settings?.aiService, job.sourceValues || {}, job.files || [], db.settings?.interestRate);
  applyParsedFields(db, project, job, parsed, deps);
}

export function applyParsedFields(db, project, job, parsed, rawDeps = {}) {
  const deps = parseDeps(rawDeps);
  requireParseDep(deps, "calculateProfitBreakdown");
  requireParseDep(deps, "inferRisk");
  requireParseDep(deps, "profitMargin");
  requireParseDep(deps, "projectRiskAlerts");
  const existingExtractedFields = project.extractedFields || {};
  const existingRevenueRecognition = existingExtractedFields.revenueRecognition || {};
  const parsedContract = parseMoney(parsed.contract);
  const existingContract = parseMoney(project.contract);
  const hasCostSheet = Boolean(parsed.hasCostSheet);
  const contract = hasCostSheet ? (existingContract || parsedContract) : (parsedContract || existingContract);
  const profitBreakdown = hasCostSheet ? deps.calculateProfitBreakdown(contract, parsed) : null;
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
    risk: deps.inferRisk({ contract, costBudget, costUsed, receivable }),
    aiSummary: parsed.summary || "文件已解析，结构化字段已同步到项目台账。",
    nextMilestone: parsed.nextMilestone || parsed.servicePeriod || parsed.deliveryDate || "",
    paymentDue: parsed.paymentDue || "",
    margin: contract ? deps.profitMargin(contract, contract - costUsed) : 0,
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
  project.alerts = deps.projectRiskAlerts(project);

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

export function mergeProjectExtractedFields(existing = {}, parsed = {}, options = {}) {
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

