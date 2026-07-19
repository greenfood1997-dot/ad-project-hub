import { readFile } from "node:fs/promises";

const adminSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/ProjectCleanupPanel.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/admin-settings.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(adminSource.includes('const ProjectCleanupPanel = React.lazy(() => import("./ProjectCleanupPanel.jsx"))'), "admin settings should lazy-load project cleanup");
assert(adminSource.includes('api("/api/projects/delete"'), "project cleanup should call the real delete API");
assert(adminSource.includes("const [deletingProject, setDeletingProject]"), "project cleanup should keep a deletion loading state");
assert(adminSource.includes("项目「${project.name}」及关联记录已删除"), "project cleanup should explain the completed cascade deletion");
assert(panelSource.includes("误建项目清理") && panelSource.includes("永久删除此项目"), "project cleanup should have a clearly named destructive action");
assert(!panelSource.includes("confirmName") && !panelSource.includes("请输入完整项目名"), "project cleanup should not require retyping the selected project name");
assert(panelSource.includes("window.confirm") && panelSource.includes("此操作不可恢复"), "project cleanup should keep one explicit destructive confirmation");
assert(panelSource.includes("关联记录") && panelSource.includes("审计记录"), "project cleanup should explain scope and audit retention before deletion");
assert(styles.includes(".project-cleanup-panel") && styles.includes(".project-cleanup-impact"), "project cleanup should have dedicated responsive styles");

console.log("frontend project cleanup entry passed");
