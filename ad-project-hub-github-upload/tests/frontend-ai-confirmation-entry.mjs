import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("confirmAction: context.confirmAction || null"), "AI assistant request should send confirmAction when user confirms");
assert(source.includes("pendingAction: result.pendingAction || null"), "AI messages should keep pending actions instead of auto-writing");
assert(source.includes('if (data.action === "task-created") await context.onDone?.()'), "AI-created tasks should refresh project state after confirmation");
assert(source.includes("function amountFromText(text)") && source.includes("报销|票据|审批"), "frontend AI helper should keep expense and approval language available");
assert(source.includes("function DashboardAiPanel") && source.includes("function AiWorkbench"), "both AI entry surfaces should exist");
assert(source.includes("确认提交") && source.includes("已取消，未提交"), "AI assistant should show confirm/cancel actions before writing");
assert(source.includes("confirmPending(message)") && source.includes("AI 已按你的确认提交审批，审批列表已刷新。"), "AI assistant should submit only after explicit confirmation and report refreshed approvals");
assert(source.includes("const [approvalFocusId, setApprovalFocusId]"), "dashboard should keep an approval focus target after AI creates approval");
assert(source.includes("onApprovalCreated={(approval) => {"), "AI surfaces should receive an approval-created navigation callback");
assert(source.includes('setActiveView("approvals")') && source.includes('setActiveSubView("待我审批")'), "AI-created approvals should navigate into approval workbench");
assert(source.includes("if (result.approval) onApprovalCreated?.(result.approval);"), "AI confirmation should pass the created approval to navigation");
assert(source.includes("focusApprovalId={approvalFocusId}") && source.includes("onFocusConsumed={() => setApprovalFocusId(\"\")}"), "approval workbench should receive and consume focused approval id");
assert(source.includes('function ApprovalFunds({ projects, approvals, selected, session, subView, setSubView, focusApprovalId = "", onFocusConsumed, onDone, onNotice })'), "approval workbench should accept focused approval props");
assert(source.includes("setSelectedApprovalKey(target.id)") && source.includes("setSubView(target.category || \"待我审批\")"), "approval workbench should select the AI-created approval");
assert(source.includes("function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated, onSelectProject, onNavigate, collapsed = false, onToggleCollapsed })"), "dashboard AI panel should receive real upload, navigation, and collapse callbacks");
assert(source.includes("const [dashboardAiCollapsed, setDashboardAiCollapsed]") && source.includes("overview-layout ${dashboardAiCollapsed ? \"ai-collapsed\" : \"\"}") && source.includes("onToggleCollapsed={() => setDashboardAiCollapsed((value) => !value)}"), "dashboard should keep an AI panel collapsed state and let the layout expand");
assert(source.includes("ai-activity-panel collapsed") && source.includes("ai-collapsed-button") && source.includes("展开 AI 助手") && source.includes("收起 AI 助手"), "dashboard AI panel should render collapsed and expanded controls");
assert(source.includes("async function handleAiFileDrop(event)") && source.includes("event.dataTransfer?.files") && source.includes("Promise.all(picked.map(fileToPayload))"), "AI panels should accept dropped files and convert them for upload");
assert(source.includes("AI 读取文件失败：${error.message}"), "AI drag upload should explain local file read failures");
assert(source.includes("function inferAiDropUploadType(files = [])") && source.includes("verification-sheet") && source.includes("quote-sheet") && source.includes("cost-sheet"), "AI dropped files should infer upload type from filenames");
assert(source.includes("onUpload?.(uploadType, target, payloads)") && source.includes("已接收 ${payloads.length} 个文件，并打开上传预览。确认前不会写入项目。"), "AI dropped files should open the real upload preview with prefilled files");
assert(source.includes('onDrop={handleAiFileDrop}') && source.includes('onDragOver={(event) => event.preventDefault()}'), "AI panels should wire drag-and-drop handlers");
assert(source.includes("function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated"), "main AI workbench should receive a real upload action and approval navigation callback");
assert(source.includes("function buildAiFilingAction(result = {}, query = \"\", projects = [], selected = null)") && source.includes('result.action !== "filing-guidance"'), "AI filing guidance should become a structured frontend action");
assert(source.includes("function AiFilingActions({ action, onOpen })") && source.includes("选择要归档的项目") && source.includes("打开上传"), "AI filing guidance should render project choices and upload action buttons");
assert(source.includes("filingAction: buildAiFilingAction(result, query, projects, selected)") && source.includes("message.filingAction && <AiFilingActions"), "AI messages should keep filing actions and render them");
assert(source.includes("function buildAiNavigationActions(query = \"\", projects = [], selected = null, session = {})") && source.includes("function AiNavigationActions({ actions = [], onOpen })"), "AI answers should create clickable navigation action cards");
assert(source.includes("navActions: buildAiNavigationActions(query, projects, selected, session)") && source.includes("message.navActions && <AiNavigationActions"), "AI messages should render next-step navigation actions");
assert(source.includes("function openAiAction(action = {}, projectId = \"\")") && source.includes('setProjectFocus(action.focus || "progress")'), "AI navigation actions should open real OA sections");
assert(source.includes('/核销|月度|确认收入/.test(text)') && source.includes('"verification-sheet"') && source.includes('"quote-sheet"') && source.includes('"create-project"'), "AI filing action should infer upload type from natural-language file intent");
assert(source.includes("uploadTypeLabel") && source.includes("月度核销表") && source.includes("合同报价表") && source.includes("执行成本表"), "AI filing card should show the inferred upload type label");
assert(source.includes("function handleFilingAction(action, projectId = \"\")") && source.includes("onSelectProject?.(target.id)") && source.includes("onUpload?.(uploadType"), "AI filing action should select a project and open real upload with inferred type");
assert(source.includes("当前账号不能创建新项目，已改为给「${target.name}」打开项目文件上传") && source.includes("canCreateProjectRole(session)"), "AI filing action should downgrade create-project intent for roles without project creation permission");
assert(source.includes("已为「${targetName}」打开${action?.uploadTypeLabel || \"项目文件\"}上传，AI 会先预览识别，确认后才写入项目。"), "AI filing action should explain preview-before-write upload behavior");
assert(source.includes('onUpload={(type = selected ? "cost-sheet" : "create-project", targetProject = selected) => openUpload(type, targetProject)}'), "AI surfaces should open the real upload dialog with project-aware target");
assert(source.includes("const [uploadTargetProject, setUploadTargetProject]") && source.includes("selected={uploadTargetProject || selected}"), "upload dialog should immediately receive the AI-selected project");
assert(source.includes("<UploadCloud size={14} />上传文件") && source.includes("<UploadCloud size={14} />让 AI 识别项目文件"), "AI surfaces should expose visible upload buttons");
assert(source.includes('<button type="button" className="ghost" onClick={() => onUpload?.()}>上传</button>'), "AI chat input should provide a direct upload button");
assert(styles.includes(".ai-confirm-actions"), "AI confirmation controls should have styles");
assert(styles.includes(".ai-filing-actions") && styles.includes(".ai-project-options"), "AI filing action cards should have styles");
assert(styles.includes(".overview-layout.ai-collapsed") && styles.includes("grid-template-columns: minmax(0, 1fr) 72px"), "collapsed AI layout should free dashboard width");
assert(styles.includes(".ai-panel-toggle") && styles.includes(".ai-collapsed-button") && styles.includes(".ai-activity-panel.collapsed"), "AI collapse controls should have dedicated styles");
assert(styles.includes(".ai-drop-hint") && styles.includes("border: 1px dashed #c7d2fe"), "AI drag upload hint should have dedicated styles");

console.log("frontend ai confirmation entry passed");
