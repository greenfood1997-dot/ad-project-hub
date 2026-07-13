function nextTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeProjectTask(task, index = 0) {
  if (Array.isArray(task)) {
    const progress = Math.max(0, Math.min(100, Number(task[1] || 0)));
    return {
      id: task[2] || `legacy-task-${index}`,
      title: String(task[0] || `任务 ${index + 1}`).trim(),
      progress,
      status: progress >= 100 ? "done" : progress > 0 ? "doing" : "todo",
      owner: "",
      dueDate: "",
      note: "",
      updatedAt: ""
    };
  }
  const progress = Math.max(0, Math.min(100, Number(task?.progress || 0)));
  return {
    id: task?.id || `legacy-task-${index}`,
    title: String(task?.title || task?.name || `任务 ${index + 1}`).trim(),
    progress,
    status: task?.status || (progress >= 100 ? "done" : progress > 0 ? "doing" : "todo"),
    owner: task?.owner || "",
    dueDate: task?.dueDate || "",
    note: task?.note || "",
    archivedAt: task?.archivedAt || "",
    archivedBy: task?.archivedBy || "",
    createdAt: task?.createdAt || "",
    createdBy: task?.createdBy || "",
    updatedAt: task?.updatedAt || "",
    updatedBy: task?.updatedBy || ""
  };
}

function syncProjectProgressFromTasks(project) {
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  project.tasks = tasks;
  const activeTasks = tasks.filter((task) => !task.archivedAt);
  const values = activeTasks.map((task) => Number(task.progress || 0)).filter(Number.isFinite);
  const progress = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  project.progress = progress;
  project.extractedFields = {
    ...(project.extractedFields || {}),
    taskProgress: progress,
    taskSummary: {
      total: activeTasks.length,
      archived: tasks.filter((task) => task.archivedAt).length,
      done: activeTasks.filter((task) => task.status === "done" || Number(task.progress || 0) >= 100).length,
      doing: activeTasks.filter((task) => task.status === "doing").length,
      todo: activeTasks.filter((task) => task.status === "todo").length,
      updatedAt: new Date().toISOString()
    }
  };
  return progress;
}

function taskDueInfo(task = {}, now = new Date()) {
  if (!task.dueDate || task.archivedAt || Number(task.progress || 0) >= 100 || task.status === "done") {
    return { active: false, tone: "done", label: "无需提醒", daysLeft: null };
  }
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return { active: false, tone: "none", label: "未设置有效截止时间", daysLeft: null };
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const daysLeft = Math.ceil((dueStart - todayStart) / 86400000);
  if (daysLeft < 0) return { active: true, tone: "overdue", label: `已逾期 ${Math.abs(daysLeft)} 天`, daysLeft };
  if (daysLeft === 0) return { active: true, tone: "today", label: "今天截止", daysLeft };
  if (daysLeft <= 2) return { active: true, tone: "soon", label: `${daysLeft} 天后截止`, daysLeft };
  return { active: false, tone: "normal", label: `${daysLeft} 天后截止`, daysLeft };
}

function syncProjectTaskDueNotificationsAfterUpdate(db, project = {}, user = {}, at = new Date().toISOString()) {
  db.systemNotifications = db.systemNotifications || [];
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const activeTaskIds = new Set(tasks.filter((task) => taskDueInfo(task, new Date(at)).active).map((task) => task.id));
  for (const notice of db.systemNotifications) {
    const sameProject = notice.projectId === project.id || notice.projectName === project.name;
    if (!sameProject || notice.type !== "project-task-due" || notice.status !== "待处理") continue;
    if (activeTaskIds.has(notice.sourceId)) continue;
    notice.status = "已处理";
    notice.handledAt = at;
    notice.handledBy = user.id || "";
    notice.handledByName = user.name || "";
    notice.note = "任务已完成、归档或截止风险解除，系统自动处理任务提醒。";
    notice.updatedAt = at;
  }
}

function taskDeps(deps = {}) {
  const { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate } = deps;
  if (typeof projectRiskAlerts !== "function" || typeof syncProjectHealthNotificationsAfterUpdate !== "function") {
    throw new Error("任务服务缺少项目风险或健康通知依赖");
  }
  return { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate };
}

export function upsertProjectTask(db, body, user, deps = {}) {
  const { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate } = taskDeps(deps);
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const taskId = body.taskId || body.task?.id || "";
  let existingIndex = tasks.findIndex((task) => task.id === taskId);
  const rawProgress = body.progress ?? body.task?.progress;
  const action = body.action || "";
  if (existingIndex < 0 && action === "complete" && !body.title && !body.task?.title) {
    existingIndex = tasks.findIndex((task) => !task.archivedAt && task.status !== "done" && Number(task.progress || 0) < 100);
  }
  const nextProgress = action === "complete"
    ? 100
    : rawProgress !== undefined && rawProgress !== ""
      ? Math.max(0, Math.min(100, Number(rawProgress)))
      : existingIndex >= 0 ? tasks[existingIndex].progress : 0;
  const nextStatus = action === "complete"
    ? "done"
    : body.status || body.task?.status || (nextProgress >= 100 ? "done" : nextProgress > 0 ? "doing" : "todo");
  const candidate = {
    ...(existingIndex >= 0 ? tasks[existingIndex] : {}),
    id: existingIndex >= 0 ? tasks[existingIndex].id : nextTaskId(),
    title: String(body.title || body.task?.title || body.task?.name || (existingIndex >= 0 ? tasks[existingIndex].title : "")).trim(),
    owner: String(body.owner || body.task?.owner || (existingIndex >= 0 ? tasks[existingIndex].owner : "")).trim(),
    dueDate: String(body.dueDate || body.task?.dueDate || (existingIndex >= 0 ? tasks[existingIndex].dueDate : "")).trim(),
    note: String(body.note || body.task?.note || (existingIndex >= 0 ? tasks[existingIndex].note : "")).trim(),
    progress: nextProgress,
    status: nextStatus,
    createdAt: existingIndex >= 0 ? tasks[existingIndex].createdAt : at,
    createdBy: existingIndex >= 0 ? tasks[existingIndex].createdBy : user.id,
    updatedAt: at,
    updatedBy: user.id
  };
  if (!candidate.title) throw new Error("请填写任务名称");
  if (existingIndex >= 0) tasks[existingIndex] = candidate;
  else tasks.unshift(candidate);
  project.tasks = tasks;
  syncProjectProgressFromTasks(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  db.auditLogs.unshift({
    type: "task",
    target: project.name,
    action: existingIndex >= 0 ? "update" : "create",
    user: user.name,
    meta: { taskId: candidate.id, title: candidate.title, progress: candidate.progress, status: candidate.status },
    at
  });
  syncProjectHealthNotificationsAfterUpdate(db, project, user);
  syncProjectTaskDueNotificationsAfterUpdate(db, project, user, at);
  return { project, task: candidate };
}

export function archiveProjectTask(db, body, user, deps = {}) {
  const { projectRiskAlerts, syncProjectHealthNotificationsAfterUpdate } = taskDeps(deps);
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const taskId = body.taskId || body.id || "";
  const tasks = (project.tasks || []).map(normalizeProjectTask);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("任务不存在");
  const at = new Date().toISOString();
  task.archivedAt = at;
  task.archivedBy = user.id;
  task.updatedAt = at;
  task.updatedBy = user.id;
  project.tasks = tasks;
  syncProjectProgressFromTasks(project);
  project.alerts = projectRiskAlerts(project);
  project.updatedAt = at;
  db.auditLogs.unshift({
    type: "task",
    target: project.name,
    action: "archive",
    user: user.name,
    meta: { taskId: task.id, title: task.title, reason: String(body.reason || "").trim() },
    at
  });
  syncProjectHealthNotificationsAfterUpdate(db, project, user);
  syncProjectTaskDueNotificationsAfterUpdate(db, project, user, at);
  return { project, task };
}

export { normalizeProjectTask, taskDueInfo };
