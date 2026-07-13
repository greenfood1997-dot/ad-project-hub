import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function EmployeeProjectOverview"), "employee dashboard component should exist");
assert(source.includes("onOpenProject={(focus = \"progress\") =>") && source.includes('setActiveSubView("我的项目")'), "employee dashboard actions should jump into the real project workspace");
assert(source.includes("setProjectFocus(focus)") && source.includes("已打开我的项目进度区，可以新增任务或更新完成度。"), "employee dashboard should deep-link to project detail sections with feedback");
assert(source.includes("employee-task-empty") && source.includes("新增项目任务") && source.includes("上传项目材料") && source.includes("提交报销/备用金"), "empty employee tasks should expose real next-step buttons");
assert(source.includes('onOpenProject?.("progress")') && source.includes('onOpenProject?.("files")') && source.includes('onOpenProject?.("approvals")'), "employee task and material actions should target progress, files, and approvals");
assert(source.includes("去文件区") && source.includes("去审批区") && source.includes("上传文件"), "employee material reminders should provide actionable routing");
assert(source.includes('employee-grid ${projects.length <= 1 ? "single-project" : ""}') && source.includes("projects.length > 1 &&") && source.includes("我的项目列表"), "single-project employee dashboard should hide the duplicated project list");
assert(source.includes("function EmptyProjectState({ isManagement, isAdmin, canManageAssignments, canCreateProject") && source.includes("onAssignments={() => setView(\"admin:assignments\")"), "empty project state should route assignment-capable roles to real project assignment");
assert(source.includes("canManageAssignments && <button type=\"button\" className=\"ghost\" onClick={onAssignments}") && source.includes("项目分派</button>"), "empty project state should expose project assignment without requiring full admin access");
assert(styles.includes(".employee-task-empty") && styles.includes(".compact-list .button-row"), "employee dashboard actions should have compact layout styles");
assert(styles.includes(".employee-grid.single-project"), "single-project employee dashboard should have a dedicated layout class");

console.log("frontend employee dashboard actions entry passed");
