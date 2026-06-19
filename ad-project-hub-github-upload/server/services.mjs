export function createProject(db, values, files, user) {
  if (!values?.["项目名称"] && !files.length) throw new Error("请填写项目名称或先上传合同/执行表");
  const now = new Date().toISOString();
  const contract = Number(values["合同金额"] || 0);
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
  const parseJob = createParseJob(project, files, {}, values);
  db.projects.unshift(project);
  db.parseJobs.unshift(parseJob);
  db.auditLogs.unshift({ type: "project", target: project.name, action: "create", user: user.name, at: now });
  return { project, parseJob };
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

export async function advanceParseJob(db, idOrProjectId) {
  const job = db.parseJobs.find((item) => item.id === idOrProjectId || item.projectId === idOrProjectId);
  if (!job) throw new Error("解析任务不存在");
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
      job.status = "解析中";
      job.steps = setStepStatus(job.steps, "字段识别", "进行中");
      const parsed = await analyzeProjectFiles(db.settings?.aiService, job.sourceValues || {}, job.files || []);
      applyParsedFields(db, project, job, parsed);
    }
  }

  return job;
}

function setStepStatus(steps, name, status) {
  return steps.map((step) => step.name === name ? { ...step, status } : step);
}

function applyParsedFields(db, project, job, parsed) {
  const contract = Number(project.contract || parsed.contract || 0);
  const costBudget = Number(parsed.costBudget || 0);
  const costUsed = Number(parsed.costUsed || 0);
  const paid = Number(parsed.paid || 0);
  const receivable = Number(parsed.receivable || Math.max(contract - paid, 0));
  const oldName = project.name;

  Object.assign(project, {
    name: project.name.startsWith("待解析合同-") && parsed.projectName ? parsed.projectName : project.name,
    client: project.client || parsed.client || "",
    contract,
    costBudget,
    costUsed,
    paid,
    receivable,
    status: "解析完成",
    risk: parsed.risk || inferRisk({ contract, costBudget, costUsed, receivable }),
    aiSummary: parsed.summary || "文件已解析，结构化字段已同步到项目台账。",
    nextMilestone: parsed.nextMilestone || parsed.servicePeriod || "",
    paymentDue: parsed.paymentDue || "",
    margin: contract ? Math.max(0, Math.round(((contract - costUsed) / contract) * 100)) : 0,
    tasks: parsed.tasks || [],
    costs: parsed.costs || [],
    extractedFields: parsed
  });

  job.projectName = project.name;
  job.status = "已完成";
  job.progress = 100;
  job.extractedFields = parsed;
  job.updatedAt = new Date().toISOString();
  job.steps = job.steps.map((step) => ({ ...step, status: "完成" }));

  for (const supplier of parsed.suppliers || []) {
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

export function validateAiSettings(values) {
  const normalized = normalizeAiSettings(values);
  if (!normalized["API Key"]) throw new Error("请先填写 API Key");
  if (!normalized["Base URL"]) throw new Error("请先填写 Base URL");
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
  const checked = type === "aiService" ? await testAiSettings(values) : null;
  const normalized = type === "aiService" ? validateAiSettings(values) : values;
  const saved = { ...normalized, connection: checked, savedAt: new Date().toISOString(), savedBy: user.id };
  db.settings[type] = saved;
  db.auditLogs.unshift({ type: "settings", target: type, user: user.name, at: saved.savedAt });
  return saved;
}

export function recordFiles(db, body, user) {
  const now = new Date().toISOString();
  const files = Array.isArray(body.files) ? body.files : [];
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
  const providerText = `${normalized["服务商"] || ""}${normalized["Base URL"] || ""}${normalized["模型名称"] || ""}`.toLowerCase();
  const looksDeepSeek = providerText.includes("deepseek") || (!normalized["Base URL"] && normalized["API Key"] && !providerText.includes("openai"));

  if (looksDeepSeek) {
    normalized["服务商"] = "DeepSeek";
    normalized["Base URL"] = normalized["Base URL"] || "https://api.deepseek.com";
    normalized["模型名称"] = normalized["模型名称"] || "deepseek-chat";
  }

  if ((normalized["服务商"] || "").includes("GPT") && !normalized["Base URL"]) {
    normalized["Base URL"] = "https://api.openai.com/v1";
  }

  normalized["Base URL"] = (normalized["Base URL"] || "").replace(/\/$/, "");
  return normalized;
}

async function analyzeProjectFiles(aiSettings, values, files) {
  const extractedFiles = await Promise.all(files.map(extractFileContent));
  const text = extractedFiles
    .map((file) => `文件：${file.name}\n类型：${file.type || "unknown"}\n提取状态：${file.extractionStatus}\n${file.text || ""}`)
    .join("\n\n")
    .slice(0, 50000);
  const fallback = inferFieldsFromText(values, text, extractedFiles);

  if (!text.trim() || !aiSettings?.["API Key"]) return fallback;

  try {
    const ai = normalizeAiSettings(aiSettings);
    const res = await fetch(`${ai["Base URL"].replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ai["API Key"]}`
      },
      body: JSON.stringify({
        model: ai["模型名称"] || "deepseek-chat",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是广告项目经营中台的文件解析和自动归档助手。你要把合同、报价单、执行表、排期表、供应商结算表中的关键信息归类到项目中台。只返回 JSON，不要 Markdown。字段包括 projectName, client, contract, paid, receivable, costBudget, costUsed, servicePeriod, nextMilestone, paymentDue, risk, summary, costs, suppliers, tasks, archiveTags, confidence, missingFields。金额返回数字，日期保留原文。costs 为 [科目, 金额]；suppliers 为对象数组，含 supplier,type,amount,status；tasks 为 [节点, 进度百分比]。"
          },
          {
            role: "user",
            content: `表单字段：${JSON.stringify(values)}\n\n请从以下上传文件内容中抽取并自动归档项目经营字段，同步项目进度、回款进度、成本科目和供应商费用：\n${text}`
          }
        ]
      })
    });
    if (!res.ok) throw new Error(`AI 服务返回 ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return normalizeParsedFields({ ...fallback, ...parseJsonObject(content) }, values, files);
  } catch (error) {
    return {
      ...fallback,
      summary: `${fallback.summary} AI 解析未完成，已使用本地规则抽取。原因：${error.message}`
    };
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
      return { ...file, text: parsed.text || "", extractionStatus: parsed.text ? "PDF 文本提取成功" : "PDF 未提取到文本，可能是扫描件" };
    }

    if (lowerName.endsWith(".docx") || type.includes("wordprocessingml")) {
      const mammoth = await import("mammoth");
      const parsed = await mammoth.extractRawText({ buffer });
      return { ...file, text: parsed.value || "", extractionStatus: parsed.value ? "Word 文本提取成功" : "Word 未提取到文本" };
    }

    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsm") || type.includes("spreadsheet")) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const text = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `工作表：${sheetName}\n${csv}`;
      }).join("\n\n");
      return { ...file, text, extractionStatus: text ? "Excel 表格提取成功" : "Excel 未提取到表格内容" };
    }

    if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".tsv") || type.startsWith("text/")) {
      return { ...file, text: buffer.toString("utf8"), extractionStatus: "文本文件读取成功" };
    }

    return fallback;
  } catch (error) {
    return { ...fallback, extractionStatus: `文件内容提取失败：${error.message}` };
  }
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function inferFieldsFromText(values, text, files) {
  const amounts = extractAmounts(text);
  const dates = extractDates(text);
  const contract = Number(values["合同金额"] || amounts[0] || 0);
  const paid = guessAmount(text, ["已回款", "已付款", "首付款", "预付款", "已收款"]) || 0;
  const costUsed = guessAmount(text, ["成本", "费用", "执行费用", "供应商", "应结"]) || 0;
  const client = values["客户 / 品牌"] || guessText(text, ["客户", "品牌", "甲方"]) || "";
  const projectName = values["项目名称"] || guessText(text, ["项目名称", "项目", "合同名称"]) || "";
  const suppliers = extractSuppliers(text);

  return normalizeParsedFields({
    projectName,
    client,
    contract,
    paid,
    receivable: contract ? Math.max(contract - paid, 0) : 0,
    costBudget: costUsed,
    costUsed,
    servicePeriod: dates.slice(0, 2).join(" 至 "),
    nextMilestone: dates[0] || "",
    paymentDue: dates[1] || dates[0] || "",
    risk: inferRisk({ contract, costBudget: costUsed, costUsed, receivable: contract - paid }),
    summary: files.length
      ? `已读取 ${files.length} 个文件，抽取到 ${amounts.length} 个金额字段、${dates.length} 个日期字段。`
      : "未上传文件，等待解析。",
    costs: costUsed ? [["文件识别费用", costUsed]] : [],
    suppliers,
    tasks: dates.length ? dates.slice(0, 4).map((date, index) => [`节点 ${index + 1}：${date}`, index === 0 ? 30 : 0]) : []
  }, values, files);
}

function normalizeParsedFields(parsed, values, files) {
  const contract = Number(parsed.contract || values["合同金额"] || 0);
  const paid = Number(parsed.paid || 0);
  const costUsed = Number(parsed.costUsed || 0);
  return {
    ...parsed,
    projectName: parsed.projectName || values["项目名称"] || "",
    client: parsed.client || values["客户 / 品牌"] || "",
    contract,
    paid,
    receivable: Number(parsed.receivable ?? Math.max(contract - paid, 0)),
    costBudget: Number(parsed.costBudget || costUsed || 0),
    costUsed,
    risk: parsed.risk || inferRisk({ contract, costBudget: parsed.costBudget, costUsed, receivable: parsed.receivable }),
    summary: parsed.summary || `已完成 ${files.length} 个文件的结构化解析。`,
    costs: Array.isArray(parsed.costs) ? parsed.costs.map(normalizePair).filter(Boolean) : [],
    suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizePair).filter(Boolean) : [],
    archiveTags: Array.isArray(parsed.archiveTags) ? parsed.archiveTags : [],
    confidence: parsed.confidence || "",
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : []
  };
}

function normalizePair(item) {
  if (Array.isArray(item)) return [String(item[0] || "未命名"), Number(item[1] || 0)];
  if (item && typeof item === "object") return [String(item.name || item.type || "未命名"), Number(item.value || item.amount || item.progress || 0)];
  return null;
}

function extractAmounts(text) {
  const values = [];
  const pattern = /(?:人民币|RMB|￥|¥)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(万元|万|元)?/g;
  for (const match of text.matchAll(pattern)) {
    const raw = Number(match[1].replaceAll(",", ""));
    if (!Number.isFinite(raw)) continue;
    const unit = match[2] || "";
    const amount = unit.includes("万") ? raw * 10000 : raw;
    if (amount >= 100) values.push(amount);
  }
  return values.sort((a, b) => b - a);
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

function guessAmount(text, labels) {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index === -1) continue;
    const amount = extractAmounts(text.slice(index, index + 120))[0];
    if (amount) return amount;
  }
  return 0;
}

function guessText(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:：]?\\s*([^\\n，,。；;]{2,40})`);
    const match = text.match(pattern);
    if (match) return match[1].trim();
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

function inferRisk({ contract = 0, costBudget = 0, costUsed = 0, receivable = 0 }) {
  if (contract && (costUsed / contract > 0.75 || receivable / contract > 0.8)) return "高";
  if (costBudget && costUsed / costBudget > 0.8) return "中";
  return "低";
}
