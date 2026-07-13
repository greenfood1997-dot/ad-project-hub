export function normalizeTask(task, index = 0) {
  if (Array.isArray(task)) {
    const progress = Number(task[1] || 0);
    return {
      id: task[2] || `task-${index}`,
      title: task[0] || `任务 ${index + 1}`,
      progress,
      status: progress >= 100 ? "done" : progress > 0 ? "doing" : "todo",
      owner: "",
      dueDate: "",
      note: ""
    };
  }
  const progress = Number(task?.progress || 0);
  return {
    id: task?.id || `task-${index}`,
    title: task?.title || task?.name || `任务 ${index + 1}`,
    progress,
    status: task?.status || (progress >= 100 ? "done" : progress > 0 ? "doing" : "todo"),
    owner: task?.owner || "",
    dueDate: task?.dueDate || "",
    note: task?.note || "",
    archivedAt: task?.archivedAt || "",
    archivedBy: task?.archivedBy || "",
    updatedAt: task?.updatedAt || ""
  };
}

export function taskDueInfo(task = {}, now = new Date()) {
  if (!task.dueDate || task.archivedAt || Number(task.progress || 0) >= 100 || task.status === "done") return null;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const daysLeft = Math.ceil((dueStart - todayStart) / 86400000);
  if (daysLeft < 0) return { tone: "overdue", label: `已逾期 ${Math.abs(daysLeft)} 天` };
  if (daysLeft === 0) return { tone: "today", label: "今天截止" };
  if (daysLeft <= 2) return { tone: "soon", label: `${daysLeft} 天后截止` };
  return { tone: "normal", label: `${daysLeft} 天后截止` };
}

export function normalizeCostRow(row, index = 0) {
  if (!row) return { name: `成本 ${index + 1}`, value: 0 };
  if (typeof row === "string") return { name: row, value: 0 };
  if (Array.isArray(row)) {
    return {
      name: row[0] || `成本 ${index + 1}`,
      value: Number(row[1] || 0)
    };
  }
  const name = row.name || row.type || row.category || row.subject || row.supplier || row.item || row["费用项"] || row["成本项"] || row["项目"] || `成本 ${index + 1}`;
  const value = Number(row.value ?? row.amount ?? row.cost ?? row.price ?? row["金额"] ?? row["费用"] ?? 0) || 0;
  return { ...row, name, value };
}

export function averageProgress(tasks = []) {
  const values = tasks.map((task) => Number(Array.isArray(task) ? task[1] : task.progress)).filter(Number.isFinite);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function inferTimeProgress(project = {}, now = new Date()) {
  const startRaw = project.startDate || project.createdAt || project.extractedFields?.serviceStart || project.extractedFields?.contractDate;
  const endRaw = project.endDate || project.extractedFields?.serviceEnd || project.paymentDue;
  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : null;
  if (start && !Number.isNaN(start.getTime()) && end && !Number.isNaN(end.getTime()) && end > start) {
    const total = end - start;
    const elapsed = now.getTime() - start.getTime();
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }

  const text = `${project.extractedFields?.servicePeriod || ""} ${project.nextMilestone || ""}`;
  const years = [...text.matchAll(/20\d{2}/g)].map((match) => Number(match[0]));
  if (years.length < 2) return 35;
  const fallbackStart = new Date(`${years[0]}-01-01`).getTime();
  const fallbackEnd = new Date(`${years[1]}-12-31`).getTime();
  const nowValue = now.getTime();
  if (!Number.isFinite(fallbackStart) || !Number.isFinite(fallbackEnd) || fallbackEnd <= fallbackStart) return 35;
  return Math.max(0, Math.min(100, Math.round(((nowValue - fallbackStart) / (fallbackEnd - fallbackStart)) * 100)));
}

export function projectHealth(project = {}, now = new Date()) {
  const timeProgress = inferTimeProgress(project, now);
  const completion = Number(project.progress || averageProgress(project.tasks));
  const delta = completion - timeProgress;
  if (delta <= -12) return { label: "滞后", tone: "danger", timeProgress, completion, text: `完成度低于时间进度 ${Math.abs(delta)}%，建议本周补齐关键交付和核销材料。` };
  if (delta >= 12) return { label: "超前", tone: "good", timeProgress, completion, text: "项目推进快于合同时间，可提前准备下月核销和客户确认材料。" };
  return { label: "正常", tone: "ok", timeProgress, completion, text: "项目节奏基本匹配合同时间，建议保持当前节奏并及时归档材料。" };
}
