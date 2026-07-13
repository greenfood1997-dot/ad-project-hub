export const approvalAdminHandleRoles = ["shareholder", "admin"];
export const approvalPmStepHandleRoles = ["pm", "director"];
export const approvalWithdrawManageRoles = ["shareholder", "admin", "director"];

export function currentApprovalStepInfo(approval = {}) {
  return (approval.steps || []).find((step) => step.status === "current") || null;
}

export function canHandleApproval(session = {}, approval = {}) {
  if (!approval.id || !String(approval.status || "").includes("待")) return false;
  if (approvalAdminHandleRoles.includes(session.role)) return true;
  const step = currentApprovalStepInfo(approval);
  if (!step) return false;
  if (step.role === "pm") return approvalPmStepHandleRoles.includes(session.role);
  if (step.role === "director") return session.role === "director";
  if (step.role === "finance") return session.role === "finance";
  return false;
}

export function canWithdrawApproval(session = {}, approval = {}) {
  if (!approval.id || !String(approval.status || "").includes("待")) return false;
  return approval.applicantId === session.id || approvalWithdrawManageRoles.includes(session.role);
}

export function approvalRuntimeInfo(approval = {}) {
  const step = currentApprovalStepInfo(approval);
  const waitHours = Number(approval.waitHours || 0);
  return {
    stepLabel: approval.currentStepLabel || step?.label || approval.status || "等待提交",
    handler: approval.currentHandlerLabel || (step?.role === "pm" ? "PM / 项目负责人" : step?.role === "director" ? "项目总监" : step?.role === "finance" ? "财务" : step?.role === "owner" ? "老板 / 股东" : "审批负责人"),
    waitText: String(approval.status || "").includes("待") ? `已等待 ${waitHours} 小时` : approval.status || "流程已结束",
    slaText: approval.slaStatus === "已超时" ? "已超时" : approval.slaStatus === "即将超时" ? "即将超时" : approval.slaDueAt ? `建议 ${new Date(approval.slaDueAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 前处理` : "流程已结束",
    tone: approval.slaStatus === "已超时" ? "danger" : approval.slaStatus === "即将超时" ? "warn" : "ok",
    hint: approval.nextActionHint || "审批会按流程自动流转到下一步。"
  };
}

export function approvalPriorityQueue(approvals = [], session = {}) {
  return approvals
    .filter((approval) => approval.id && String(approval.status || "").includes("待"))
    .map((approval) => {
      const runtime = approvalRuntimeInfo(approval);
      const actionable = canHandleApproval(session, approval);
      const amount = Number(approval.amount || 0);
      const score = (actionable ? 80 : 0)
        + (runtime.tone === "danger" ? 70 : runtime.tone === "warn" ? 45 : 0)
        + Math.min(35, Math.round(amount / 1000))
        + Math.min(24, Number(approval.waitHours || 0));
      const reason = actionable
        ? `轮到你处理，${runtime.waitText}，${runtime.slaText}`
        : `${runtime.handler}处理中，${runtime.waitText}，${runtime.slaText}`;
      return { approval, runtime, actionable, score, reason };
    })
    .sort((a, b) => b.score - a.score || Number(b.approval.amount || 0) - Number(a.approval.amount || 0))
    .slice(0, 5);
}
