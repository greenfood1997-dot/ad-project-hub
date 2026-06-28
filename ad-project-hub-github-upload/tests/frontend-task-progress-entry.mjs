import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function ProjectDetail"), "project detail should exist");
assert(source.includes("const [taskForm") && source.includes("savingTask"), "project detail should keep real task form state");
assert(source.includes('apiRequest("/api/project-tasks"') || source.includes("apiRequest('/api/project-tasks'"), "project detail should submit tasks to backend");
assert(source.includes("projectTasks = (project.tasks || []).map(normalizeTask)"), "project detail should render tasks from real project data");
assert(source.includes("任务已标记完成，项目进度已更新") && source.includes("任务已保存，项目进度已更新"), "task actions should tell user that project progress updates");
assert(source.includes("setTaskForm({ title: \"\", owner: session.name || \"\", dueDate: \"\", progress: 0, note: \"\" })"), "task form should reset after save");
assert(source.includes("placeholder=\"新增交付节点 / 任务\"") && source.includes("placeholder=\"负责人\"") && source.includes("placeholder=\"截止时间\"") && source.includes("placeholder=\"进度%\""), "task form should collect title, owner, due date, and progress");
assert(source.includes('action: "complete"') && source.includes("已完成"), "task rows should expose complete action");
assert(source.includes("project.progress") && source.includes("项目进度"), "frontend should show project progress based on backend state");
assert(source.includes("projectHealth(project)") && source.includes("完成度"), "frontend should compare project completion with time progress");

console.log("frontend task progress entry passed");
