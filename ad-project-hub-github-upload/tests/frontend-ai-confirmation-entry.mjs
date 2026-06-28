import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("confirmAction: context.confirmAction || null"), "AI assistant request should send confirmAction when user confirms");
assert(source.includes("pendingAction: result.pendingAction || null"), "AI messages should keep pending actions instead of auto-writing");
assert(source.includes("function DashboardAiPanel") && source.includes("function AiWorkbench"), "both AI entry surfaces should exist");
assert(source.includes("确认提交") && source.includes("已取消，未提交"), "AI assistant should show confirm/cancel actions before writing");
assert(source.includes("confirmPending(message)") && source.includes("AI 已按你的确认提交审批"), "AI assistant should submit only after explicit confirmation");
assert(source.includes("function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice })"), "dashboard AI panel should receive a real upload action");
assert(source.includes("function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice })"), "main AI workbench should receive a real upload action");
assert(source.includes('onUpload={() => openUpload(selected ? "cost-sheet" : "create-project")}'), "AI surfaces should open the real upload dialog with project-aware type");
assert(source.includes("<UploadCloud size={14} />上传文件") && source.includes("<UploadCloud size={14} />让 AI 识别项目文件"), "AI surfaces should expose visible upload buttons");
assert(source.includes('<button type="button" className="ghost" onClick={onUpload}>上传</button>'), "AI chat input should provide a direct upload button");
assert(styles.includes(".ai-confirm-actions"), "AI confirmation controls should have styles");

console.log("frontend ai confirmation entry passed");
