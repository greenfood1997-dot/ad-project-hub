export const EXPENSE_CATEGORIES = ["拍摄交通", "餐饮", "住宿", "道具", "场地", "达人/KOL", "制作", "投放", "快递", "办公杂费", "其他"];

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

export function inferExpenseCategory(body = {}) {
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

export function approvalRuleNumber(rules = {}, key, fallback) {
  const value = Number(rules[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function approvalSteps(type, amount = 0, rules = {}) {
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

export function currentApprovalStep(approval) {
  return (approval.steps || []).find((step) => step.status === "current");
}

export function approvalHandlerLabel(role = "") {
  if (role === "pm") return "PM / 项目负责人";
  if (role === "director") return "项目总监";
  if (role === "finance") return "财务";
  if (role === "owner") return "老板 / 股东";
  return "审批负责人";
}

export function approvalNextActionHint(approval = {}) {
  if (approval.status === "已完成") return "审批已完成，财务影响已写入项目。";
  if (approval.status === "已驳回") return "审批已驳回，可按意见补充后重新提交。";
  if (approval.status === "已撤回") return "审批已撤回，不会继续流转。";
  const step = currentApprovalStep(approval);
  if (!step) return "等待提交或流程已结束。";
  return `当前轮到${approvalHandlerLabel(step.role)}处理「${step.label}」。`;
}

export function enrichApprovalRuntimeFields(approval = {}, at = new Date().toISOString()) {
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

export function syncApprovalSteps(approval, action, user) {
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

export function canRoleHandleApproval(userRole, currentRole) {
  if (["shareholder", "admin"].includes(userRole)) return true;
  if (currentRole === "pm") return ["pm", "director"].includes(userRole);
  if (currentRole === "director") return userRole === "director";
  if (currentRole === "finance") return userRole === "finance";
  if (currentRole === "owner") return userRole === "shareholder";
  return false;
}
