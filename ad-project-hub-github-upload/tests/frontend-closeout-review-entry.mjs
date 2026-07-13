import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('label: "成本复盘"'), "navigation should expose closeout review");
assert(source.includes('["closeout", "结案复盘"]'), "closeout nav should include project closeout review");
assert(source.includes('["closeout", "支出排行"]'), "closeout nav should include spending ranking");
assert(source.includes("function CloseoutReview"), "frontend should render closeout review component");
assert(source.includes("session={session}") && source.includes("onDone={() => loadState()}"), "dashboard should pass session and reload handler into closeout review");
assert(source.includes("costRows") && source.includes("topCost"), "closeout review should compute cost rows and top cost");
assert(source.includes("topCostShare"), "closeout review should compute top cost share");
assert(source.includes("costContractRate"), "closeout review should compute cost-to-contract rate");
assert(source.includes("suggestedReserve"), "closeout review should compute next-project budget reserve suggestion");
assert(source.includes("成本已接近合同金额") && source.includes("单项支出占比偏高"), "closeout review should generate risk-aware optimization copy");
assert(source.includes("最大支出占比"), "closeout review should show top spending ratio");
assert(source.includes("下次预算建议"), "closeout review should show next budget recommendation");
assert(source.includes("支出排行") && source.includes("占总成本"), "spending ranking should show cost share");
assert(source.includes("预算预留"), "spending optimization should include reserve advice");
assert(source.includes("copyCloseoutSummary"), "closeout review should provide a copyable review summary");
assert(source.includes("复制复盘纪要") && source.includes("复制中"), "closeout review copy action should expose loading copy");
assert(source.includes("navigator.clipboard.writeText(lines.join(\"\\n\"))"), "closeout review should copy structured summary text to clipboard");
assert(source.includes("利润信息：普通成员不可见"), "closeout copied summary should not leak profit to ordinary members");
assert(source.includes("结案复盘纪要已复制，可以发给 PM、财务或管理层讨论。"), "closeout copy should notify the user after success");
assert(source.includes("function closeoutReviewRows({ project = {}, costRows = []") && source.includes("`支出排行 ${index + 1}`") && source.includes("下次预算建议"), "closeout review should build a CSV export with summary, budget advice, and rankings");
assert(source.includes("isManagement ? \"项目利润\" : \"利润信息\"") && source.includes("普通成员不可见"), "closeout CSV should hide profit fields from ordinary members");
assert(source.includes("const [exportingCloseout") && source.includes("async function exportCloseoutReview()") && source.includes("downloadCsv(`${project.name || \"项目\"}-结案成本复盘.csv`, closeoutReviewRows({"), "closeout review should export the current project review as CSV");
assert(source.includes("导出复盘") && source.includes("结案成本复盘 CSV 已导出：${project.name}。"), "closeout review should show an export action and success notice");
assert(source.includes("function openCostFiles()") && source.includes("已打开项目文件与 AI 解析区，可以补上传成本表、报价表或核销表。"), "closeout review should jump back to project file parsing for missing cost/verification materials");
assert(source.includes("function uploadCloseoutMaterial(type = \"cost-sheet\")") && source.includes("已为「${project.name}」打开${type === \"verification-sheet\" ? \"核销表\" : \"成本表\"}上传"), "closeout review should open real cost/verification upload flows");
assert(source.includes("function openPaymentReview()") && source.includes("已打开回款记录区，可以生成催收话术或记录回款。"), "closeout review should jump to project payment follow-up");
assert(source.includes("function openSupplierReview()") && source.includes("已从结案复盘打开供应商画像："), "closeout review should deep-link the top spend source to supplier profile");
assert(source.includes("function openRanking()") && source.includes("已切到支出排行，先看最大支出和预算预留建议。"), "closeout review should switch to spending ranking from the summary");
assert(source.includes("补成本/核销资料") && source.includes("查看最大支出来源") && source.includes("跟进待回款"), "closeout review should expose concrete next-step buttons");
assert(source.includes("onUpload={(type = \"cost-sheet\", targetProject = selected) => openUpload(type, targetProject)}"), "dashboard should wire closeout material upload to the real upload dialog");
assert(source.includes("上传成本表") && source.includes("上传核销表") && source.includes('uploadCloseoutMaterial("verification-sheet")'), "closeout review should expose direct cost and verification upload buttons");
assert(source.includes("closeout-cost-empty") && source.includes("暂无成本明细") && source.includes("打开文件区") && source.includes("复制复盘草稿"), "closeout ranking empty state should expose upload, project file, and copy-draft actions");
assert(source.includes("生成催收建议") && source.includes("已打开催收助手：${selected.name} 当前待回款"), "closeout ranking should open the real collection assistant when receivables remain");
assert(source.includes("const [closeoutNote, setCloseoutNote]") && source.includes("function markProjectClosed()"), "closeout review should include a real project closeout action");
assert(source.includes('"/api/projects/update"') && source.includes('"项目状态": "已完成"') && source.includes('"结案时间": closedAt') && source.includes('"结案复盘备注": closeoutNote'), "closeout action should persist completed status, closed time, and closeout note");
assert(source.includes("确认项目结案") && source.includes("更新结案备注") && source.includes("归档中"), "closeout action should expose clear button states");
assert(source.includes("项目已标记结案") && source.includes("成本复盘备注已写入项目审计"), "closeout action should notify after persistence");
assert(source.includes("const [savingLearning, setSavingLearning]") && source.includes("function saveCloseoutToClientMemory") && source.includes('"/api/clients/profile"') && source.includes("append: true"), "closeout review should append lessons into client profiles without overwriting existing handoff notes");
assert(source.includes("function saveCloseoutToSupplierMemory") && source.includes('"/api/suppliers/rate"'), "closeout review should persist supplier lessons through the supplier rating API");
assert(source.includes("沉淀到客户档案") && source.includes("沉淀到供应商库") && source.includes("沉淀中"), "closeout review should expose memory-saving actions with loading copy");
assert(source.includes("已沉淀到客户档案：${client}") && source.includes("已沉淀到供应商库：${topCost.name}"), "closeout memory actions should notify users after saving");
assert(source.includes('onOpenProjectSection={(target, message) =>') && source.includes('setProjectFocus(target)'), "dashboard should wire closeout actions back into project detail sections");
assert(source.includes("onNotice={setNotice}"), "dashboard should pass notice handler into closeout review");
assert(styles.includes(".closeout-head"), "closeout action header should have dedicated layout styles");
assert(styles.includes(".closeout-actions") && styles.includes(".closeout-next-actions"), "closeout next-step actions should have dedicated layout styles");
assert(styles.includes(".closeout-cost-empty"), "closeout empty cost state should have dedicated styles");
assert(styles.includes(".closeout-complete-box") && styles.includes(".closeout-complete-box textarea"), "closeout complete action should have dedicated styles");
assert(styles.includes(".closeout-memory-actions"), "closeout memory action buttons should have dedicated styles");

console.log("frontend closeout review entry passed");
