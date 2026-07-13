import { averageProgress, inferTimeProgress, normalizeTask } from "./projectMetrics.js";

export function normalizeProject(project = {}) {
  const contract = Number(project.contract || 0);
  const paid = Number(project.paid || 0);
  const receivable = Number(project.receivable || Math.max(contract - paid, 0));
  const costBudget = Number(project.costBudget || project.cost_budget || 0);
  const costUsed = Number(project.costUsed || project.cost_used || 0);
  const tasks = Array.isArray(project.tasks) && project.tasks.length
    ? project.tasks.map(normalizeTask)
    : [["资料归档", project.files?.length ? 100 : 35], ["月度执行", 42], ["核销确认", 18]].map(normalizeTask);
  const progress = Number(project.progress || averageProgress(tasks) || inferTimeProgress(project));
  return {
    ...project,
    brand: project.brand || project.extractedFields?.brand || project.client || "",
    sales: project.sales || project.extractedFields?.sales || "待确认",
    pm: project.pm || project.extractedFields?.pm || project.owner || "待分派",
    contract,
    paid,
    receivable,
    costBudget,
    costUsed,
    progress,
    margin: Number(project.margin || 0),
    aiSummary: project.aiSummary || project.ai_summary || "AI 已建立项目档案，可继续上传合同、报价表、成本表和核销表完善项目数据。",
    alerts: Array.isArray(project.alerts) ? project.alerts : [],
    tasks,
    costs: Array.isArray(project.costs) && project.costs.length ? project.costs : [["待归集成本", costUsed]],
    pettyCashBudget: Number(project.pettyCashBudget ?? project.extractedFields?.pettyCashBudget ?? project.extractedFields?.projectPettyCashBudget ?? 20000),
    pettyCashUsed: Number(project.pettyCashUsed ?? project.extractedFields?.pettyCashUsed ?? project.extractedFields?.projectPettyCashUsed ?? Math.min(costUsed * 0.12, 12000)),
    nextMilestone: project.nextMilestone || project.next_milestone || "等待 AI 巡检生成下一节点",
    paymentDue: project.paymentDue || project.payment_due || "待确认回款节点"
  };
}
