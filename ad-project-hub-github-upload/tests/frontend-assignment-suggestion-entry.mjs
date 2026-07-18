import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/ProjectAssignmentPanel.jsx", import.meta.url), "utf8");
const assignmentStyles = await readFile(new URL("../src/assignment.css", import.meta.url), "utf8");
const permissionsSource = await readFile(new URL("../src/utils/permissions.js", import.meta.url), "utf8");
const source = `${mainSource}\n${panelSource}\n${permissionsSource}`;
const styles = assignmentStyles;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("/api/project-assignments/suggestions?projectId="), "assignment panel should call suggestions API");
assert(source.includes("AI 分派建议"), "assignment panel should show AI suggestion card");
assert(source.includes("一键套用推荐"), "assignment panel should allow applying recommendations");
assert(source.includes("SuggestionColumn"), "assignment panel should render recommendation columns");
assert(source.includes("assignmentPreview"), "assignment panel should compute a save preview");
assert(source.includes("本次将保存"), "assignment panel should show what will be saved before submit");
assert(source.includes("function assignmentLedgerRows(assignments = [])"), "assignment panel should have a CSV ledger row builder");
assert(source.includes('"项目名称"') && source.includes('"PM"') && source.includes('"销售"') && source.includes('"执行成员"') && source.includes('"执行人数"'), "assignment ledger should export project staffing fields");
assert(source.includes("const [exportingAssignments") && source.includes("async function exportAssignmentLedger"), "assignment panel should manage assignment export state");
assert(source.includes("当前没有可导出的项目分派，请先上传合同创建项目。"), "assignment export should explain empty state");
assert(source.includes("项目分派表 CSV 已导出：${assignments.length} 个项目。"), "assignment export should report success");
assert(source.includes("assignmentLedgerRows(assignments)") && source.includes("导出分派表"), "assignment panel should expose a real export button");
assert(source.includes("<FileSpreadsheet size={14} />{exportingAssignments ? \"导出中\" : \"导出分派表\"}"), "assignment export button should use spreadsheet icon and loading copy");
assert(source.includes("项目分派已保存并刷新：PM"), "assignment save should report refreshed assignment result");
assert(source.includes("已套用 AI 分派建议：PM"), "applying suggestion should report who was applied");
assert(source.includes("员工端现在会按这里看到自己的项目"), "assignment save should explain employee-side visibility changed");
assert(source.includes("async function loadSuggestions") && source.includes("AI 分派建议已刷新，可以一键套用或手动调整。"), "assignment panel should allow manually refreshing AI suggestions");
assert(source.includes("刷新建议") && source.includes("刷新中"), "assignment suggestion card should expose refresh loading copy");
assert(source.includes("function ProjectAssignmentPanel({ api, members, assignments, onReload, onCreateProject, onOpenMembers, onSyncFeishuContacts"), "assignment panel should receive create-project, member, and Feishu actions from admin shell");
assert(source.includes("还没有可分派的项目") && source.includes("上传合同创建项目") && source.includes("onClick={onCreateProject}"), "empty assignment state should open the real project creation upload flow");
assert(source.includes('onCreateProject={() => setView("app:create-project")}'), "admin assignment page should route empty project creation back into the app upload flow");
assert(source.includes('onOpenMembers={() => setAdminTab("members")}') && source.includes("onSyncFeishuContacts={syncFeishuContacts}"), "admin assignment page should wire member management and Feishu sync into assignment empty states");
assert(source.includes("assignment-suggestion-empty") && source.includes("暂无推荐数据") && source.includes("同步飞书通讯录") && source.includes("打开成员管理"), "empty assignment suggestions should expose real next-step actions");
assert(source.includes("suggestion-empty-candidate") && source.includes("先补成员角色、部门或飞书身份") && source.includes("成员</button>"), "empty suggestion columns should help fill missing candidates");
assert(source.includes('if (view !== "app:create-project") return;') && source.includes('openUpload("create-project")'), "project dashboard should auto-open create-project upload from admin assignment empty state");
assert(source.includes("const [focusedProjectId") && source.includes("setFocusedProjectId(selected.id)"), "assignment save should focus the saved project row");
assert(source.includes('focusedProjectId === project.id ? "fresh" : ""'), "assignment list should visually mark the refreshed project");
assert(styles.includes(".assignment-preview"), "assignment save preview should have dedicated styles");
assert(styles.includes(".assignment-list .project-row.fresh"), "assignment refreshed project row should have highlight styles");
assert(styles.includes(".assignment-suggestion-empty") && styles.includes(".suggestion-empty-candidate"), "assignment empty suggestion states should have dedicated styles");
assert(source.includes("assignment-accordion-trigger") && source.includes('aria-expanded={open}'), "assignment projects should use the same expandable accordion interaction as product settings");
assert(source.includes('aria-pressed={checked}') && source.includes("toggleMember(member.id)"), "execution members should use reliable toggle buttons instead of form-styled checkboxes");
assert(styles.includes(".member-check.selected") && styles.includes(".assignment-accordion.open"), "expanded projects and selected execution members should have visible states");
assert(!panelSource.includes('type="checkbox"'), "the active assignment component should not use globally overridden checkbox inputs");
assert(source.includes('assignmentPmCandidateRoles = ["pm", "director", "admin", "member"]'), "ordinary active members should be eligible for PM assignment when the company uses flexible roles");

console.log("frontend assignment suggestion entry passed");
