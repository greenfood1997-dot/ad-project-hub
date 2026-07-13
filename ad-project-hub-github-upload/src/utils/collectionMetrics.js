export function collectionFollowUpQueue(projects = [], scripts = [], now = new Date()) {
  return projects
    .filter((project) => Number(project.receivable || 0) > 0)
    .map((project) => {
      const projectScripts = scripts.filter((item) => item.projectId === project.id || item.projectName === project.name);
      const pendingScript = projectScripts.find((item) => item.followUpStatus === "待跟进" || item.nextFollowUpAt || item.nextAction);
      const nextDate = pendingScript?.nextFollowUpAt || "";
      const dateValue = nextDate ? new Date(nextDate) : null;
      const overdue = dateValue && !Number.isNaN(dateValue.valueOf()) && dateValue < new Date(now.toISOString().slice(0, 10));
      const dueSoon = dateValue && !Number.isNaN(dateValue.valueOf()) && !overdue && dateValue <= new Date(now.getTime() + 2 * 86400000);
      const receivableRate = Number(project.contract || 0) ? Math.round((Number(project.receivable || 0) / Number(project.contract || 1)) * 100) : 0;
      const urgentByPaymentDue = /逾期|超期|已到期|尾款|月底|本周|今天|明天/.test(String(project.paymentDue || ""));
      const score = (overdue ? 80 : dueSoon ? 55 : 0)
        + (urgentByPaymentDue ? 35 : 0)
        + Math.min(45, Math.round(receivableRate / 2))
        + (Number(project.receivable || 0) >= 100000 ? 12 : 0);
      const status = overdue ? "已逾期" : dueSoon ? "近期跟进" : urgentByPaymentDue ? "节点敏感" : receivableRate >= 50 ? "高待收" : "待跟进";
      const nextAction = pendingScript?.nextAction
        || (urgentByPaymentDue ? "围绕回款节点温和确认付款流程，并主动补齐对账/发票资料。" : "先同步交付进展，再确认客户财务需要哪些材料。");
      return { project, pendingScript, score, status, nextFollowUpAt: nextDate, nextAction, receivableRate };
    })
    .sort((a, b) => b.score - a.score || Number(b.project.receivable || 0) - Number(a.project.receivable || 0))
    .slice(0, 6);
}
