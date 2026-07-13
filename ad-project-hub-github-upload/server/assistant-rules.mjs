import { money, textIncludes } from "./service-utils.mjs";

export function findAssistantProject(query, projects = [], selectedProjectId = "") {
  const text = String(query || "");
  return projects.find((project) => textIncludes(text, project.name) || textIncludes(text, project.client))
    || projects.find((project) => project.id === selectedProjectId)
    || projects[0]
    || null;
}

export function amountFromAssistantText(text) {
  const value = String(text || "");
  const matches = [...value.matchAll(/([¥￥])?\s*(\d[\d,]*(?:\.\d+)?)\s*(万|元|块|人民币|rmb)?/gi)];
  const explicit = matches.find((match) => match[1] || match[3]);
  if (explicit) {
    const amount = Number(explicit[2].replace(/,/g, ""));
    return explicit[3]?.toLowerCase() === "万" ? amount * 10000 : amount;
  }
  const contextual = value.match(/(?:金额|报销|费用|花了|支出|备用金)\s*(\d+(?:\.\d+)?)/);
  return contextual ? Number(contextual[1]) : 0;
}

export function assistantApprovalTypeFromText(text = "") {
  const value = String(text || "");
  if (/备用金|预算/.test(value)) return "petty_cash";
  if (/报销|票据|发票|打车|出租|网约车|滴滴|油费|停车|过路|高速|交通|车费|餐费|盒饭|午餐|晚餐|餐饮|住宿|酒店|道具|物料|场地|影棚|达人|kol|koc|制作|拍摄|剪辑|投放|快递|物流|办公|杂费/.test(value)) return "reimbursement";
  return "";
}

export function assistantFilingIntentFromText(text = "") {
  const value = String(text || "");
  return /(上传|归档|登记到|统计到|放到|记到|录到|导入|入库)/.test(value)
    || /(报销表|票据文件|发票文件|费用表|成本表|报价表|核销表|合同文件|表格|文件)/.test(value);
}

export function parseAssistantTaskDraft(query = "", user = {}) {
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

export function assistantPendingActionMatches(actual = {}, expected = {}, fields = []) {
  if (!actual || actual.kind !== expected.kind) return false;
  return fields.every((field) => String(actual[field] ?? "") === String(expected[field] ?? ""));
}

export function simpleProjectHealth(project = {}) {
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

export function assistantRunway(settings = {}) {
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

export function assistantMetrics(scopedDb = {}) {
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

export function assistantProjectContext(project = {}) {
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

export function assistantSafeSettings(settings = {}) {
  return {
    companyFinance: settings.companyFinance ? assistantRunway(settings) : null,
    approvalRules: settings.approvalRules || null
  };
}
