import { parseMoney } from "./service-utils.mjs";

export function deleteProject(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const isProjectRecord = (item = {}) => {
    const names = [item.projectName, item.project, item.targetProject, item.relatedProject, item.chatName].filter(Boolean).map(String);
    return item.projectId === project.id || names.includes(project.name);
  };

  db.projects = (db.projects || []).filter((item) => item.id !== project.id);
  db.__deletedProjectIds = [...new Set([...(db.__deletedProjectIds || []), project.id])];
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
  if (db.settings?.members?.items) {
    db.settings.members.items = db.settings.members.items.filter((item) => !isProjectRecord(item));
  }
  const at = new Date().toISOString();
  db.auditLogs.unshift({ type: "project", target: project.name, action: "delete", user: user.name, at });
  return { id: project.id, name: project.name };
}

export function syncProjectProfit(project, executionBudget = 0, deps = {}) {
  const { calculateProfitBreakdown, profitMargin } = deps;
  if (typeof calculateProfitBreakdown !== "function") throw new Error("项目服务缺少依赖：calculateProfitBreakdown");
  if (typeof profitMargin !== "function") throw new Error("项目服务缺少依赖：profitMargin");

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

export function hasContractLikeFile(files = [], parsed = {}) {
  if (parseMoney(parsed.contract) || parsed.partyA || parsed.partyB) return true;
  return files.some((file) => {
    const source = `${file.name || ""}\n${file.text || ""}`;
    return /(合同|协议|甲方|乙方|委托方|受托方|合同金额|服务费用|付款方式)/.test(source)
      && !/(成本表|利润测算|执行支出|人力|公摊|月度成本|供应商结算)/.test(file.name || "");
  });
}

export function assertUniqueProject(db, values = {}, files = [], contract = 0, ignoreProjectId = "") {
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

export function projectToValues(project) {
  return {
    "项目名称": project.name || "",
    "客户 / 品牌": project.client || "",
    "合同金额": project.contract || 0
  };
}

export function removeCreatedProject(db, projectId, parseJobId) {
  db.projects = (db.projects || []).filter((item) => item.id !== projectId);
  db.parseJobs = (db.parseJobs || []).filter((item) => item.id !== parseJobId && item.projectId !== projectId);
  db.files = (db.files || []).filter((item) => item.projectId !== projectId);
  db.suppliers = (db.suppliers || []).filter((item) => item.projectId !== projectId);
  db.auditLogs = (db.auditLogs || []).filter((item) => !(item.type === "project" && item.action === "create"));
}

export function findMatchingProjectForCostSheet(db, parsed = {}, files = []) {
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

export function normalizeProjectText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

export function similarity(a, b) {
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
