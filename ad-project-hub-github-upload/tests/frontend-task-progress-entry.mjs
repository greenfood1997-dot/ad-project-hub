import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function ProjectDetail"), "project detail should exist");
assert(source.includes("function taskDueInfo") && source.includes("今天截止") && source.includes("已逾期"), "frontend should classify task due status");
assert(source.includes("const [taskForm") && source.includes("savingTaskForm") && source.includes("completingTaskId") && source.includes("const [focusedTaskId"), "project detail should keep real task form and per-task focus state");
assert(source.includes("function taskLedgerRows(project = {}, tasks = [])") && source.includes("是否归档"), "task ledger export should build readable task CSV rows with archived state");
assert(source.includes("const [exportingTaskLedger, setExportingTaskLedger]") && source.includes("function exportTaskLedger()"), "project detail should keep task ledger export state and action");
assert(source.includes("downloadCsv(filename, taskLedgerRows(project, allProjectTasks))"), "task export should include all current project task records");
assert(source.includes("当前项目还没有任务节点，请先新增任务或使用模板预填。") && source.includes("任务台账 CSV 已导出"), "task export should explain empty and success states");
assert(source.includes('apiRequest("/api/project-tasks"') || source.includes("apiRequest('/api/project-tasks'"), "project detail should submit tasks to backend");
assert(source.includes('apiRequest("/api/project-tasks/archive"') && source.includes("function archiveTask"), "project detail should archive mistaken tasks through a real backend action");
assert(source.includes("projectTasks = (project.tasks || []).map(normalizeTask)"), "project detail should render tasks from real project data");
assert(source.includes(".filter((task) => !task.archivedAt)"), "project detail should hide archived tasks from active progress rows");
assert(source.includes("const result = await apiRequest(\"/api/project-tasks\"") && source.includes("setFocusedTaskId(taskKey)"), "task actions should focus the task returned by backend");
assert(source.includes("任务已标记完成，项目进度已刷新到 ${nextProgress}%。") && source.includes("任务已保存，项目进度已刷新到 ${nextProgress}%。"), "task actions should tell user the refreshed project progress number");
assert(source.includes("任务已归档，项目进度已刷新到 ${nextProgress}%。"), "task archive should tell user the refreshed project progress number");
assert(source.includes("setTaskForm({ title: \"\", owner: session.name || \"\", dueDate: \"\", progress: 0, note: \"\" })"), "task form should reset after save");
assert(source.includes("placeholder=\"新增交付节点 / 任务\"") && source.includes("placeholder=\"负责人\"") && source.includes("placeholder=\"截止时间\"") && source.includes("placeholder=\"进度%\""), "task form should collect title, owner, due date, and progress");
assert(source.includes('action: "complete"') && source.includes("已完成"), "task rows should expose complete action");
assert(source.includes('savingTaskForm ? "保存中" : "新增任务"'), "new task submit should show saving copy");
assert(source.includes("setCompletingTaskId(completingKey)") && source.includes('setCompletingTaskId("")'), "complete action should track the active task row");
assert(source.includes('completingTaskId === (task.id || task.title) ? "完成中" : "完成"'), "complete button should show per-task loading copy");
assert(source.includes("const [archivingTaskId") && source.includes('archivingTaskId === (task.id || task.title) ? "归档中" : "归档"'), "archive button should show per-task loading copy");
assert(source.includes("await onDone()"), "task save should await refresh before showing progress feedback");
assert(source.includes('task-row ${task.status} ${dueInfo?.tone || ""} ${focusedTaskId === (task.id || task.title) ? "fresh" : ""}'), "task rows should highlight the newly saved or completed task");
assert(source.includes("task-due-badge") && source.includes("dueInfo.label") && source.includes("dueInfo?.tone"), "task rows should show due/overdue badges");
assert(source.includes("project-task-due") && source.includes("请更新临期/逾期任务"), "task due notifications should focus the project progress area");
assert(source.includes("project.progress") && source.includes("项目进度"), "frontend should show project progress based on backend state");
assert(source.includes("projectHealth(project)") && source.includes("完成度"), "frontend should compare project completion with time progress");
assert(source.includes("function prepareTaskTemplate") && source.includes("已预填「${template.title}」任务，请确认负责人和截止时间后保存。"), "empty task state should prefill common project task templates without auto-saving");
assert(source.includes("const taskTemplates = [") && source.includes("首轮方案 / 脚本确认") && source.includes("核销 / 回款跟进"), "task templates should cover common ad project workflow steps");
assert(source.includes("task-template-empty") && source.includes("暂无执行任务") && source.includes("taskTemplates.map"), "empty task state should expose clickable task template actions");
assert(source.includes("导出任务") && source.includes("<FileSpreadsheet size={14} />"), "project progress section should expose a task ledger export button");
assert(styles.includes(".task-row.fresh"), "focused task row should have highlight styles");
assert(styles.includes(".task-row.overdue") && styles.includes(".task-due-badge.overdue"), "task due and overdue rows should have styles");
assert(styles.includes(".task-template-empty"), "task template empty state should have compact styles");

console.log("frontend task progress entry passed");
