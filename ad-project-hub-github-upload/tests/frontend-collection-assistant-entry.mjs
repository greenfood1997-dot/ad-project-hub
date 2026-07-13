import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('label: "催收助手"'), "navigation should expose collection assistant");
assert(source.includes("function CollectionAssistant({ projects = [], scripts = [], session, onOpenProjectPayments, onUploadVerification"), "frontend should render collection assistant with navigation actions");
assert(source.includes("function collectionFollowUpQueue(projects = [], scripts = [])"), "collection assistant should compute a real follow-up priority queue");
assert(source.includes("followUpStatus === \"待跟进\"") && source.includes("receivableRate") && source.includes("urgentByPaymentDue"), "collection priority queue should use follow-up plans, receivable pressure, and payment due text");
assert(source.includes('/api/collections/suggest"'), "collection assistant should generate scripts through backend");
assert(source.includes('/api/collections/outcome"'), "collection assistant should record outcomes through backend");
assert(source.includes("setFocusedScriptId(data.id || \"\")"), "collection assistant should focus the newly generated script");
assert(source.includes("话术已生成并保存，催收记录已刷新："), "collection assistant should report refreshed script records after generation");
assert(source.includes("await onDone();"), "collection assistant should await refreshed state after generation");
assert(source.includes('collection-history-row ${focusedScriptId === item.id ? "fresh" : ""}'), "collection history should highlight the newly generated script");
assert(styles.includes(".collection-history-row.fresh"), "newly generated collection history row should have highlight styles");
assert(source.includes("我的成功率"), "collection assistant should show personal success rate");
assert(source.includes("const followUpQueue = collectionFollowUpQueue(projects, scripts)") && source.includes("今天先跟进"), "collection assistant should show today's follow-up priority panel");
assert(source.includes("按回款压力和下次跟进时间排序") && source.includes("setSelectedId(item.project.id)") && source.includes("待收占比"), "collection priority cards should explain and select the target project");
assert(source.includes("暂无回款跟进队列") && source.includes("如果实际已有收入确认但未出现待回款"), "empty collection priority queue should expose useful next steps");
assert(source.includes("我的说话风格"), "collection assistant should allow salesperson style input");
assert(source.includes("有效话术参考"), "collection assistant should show successful team script reference");
assert(source.includes("onOpenProjectPayments={(project = selected) =>") && source.includes("setProjectFocus(\"payments\")"), "collection assistant should navigate to real project payment records");
assert(source.includes("onUploadVerification={(project = selected) => openUpload(\"verification-sheet\", project)}"), "collection assistant should open real verification upload");
assert(source.includes("这个项目当前没有待回款") && source.includes("查看回款记录") && source.includes("上传核销表"), "collection assistant should expose actions when selected project has no receivable");
assert(source.includes("生成第一条") && source.includes("还没有当前项目的话术"), "empty current script state should offer first script generation");
assert(source.includes("还没有成功样本") && source.includes("去看项目回款") && source.includes("canGenerateSelected && <button type=\"button\" className=\"primary tiny\" onClick={generateScript}"), "empty successful script reference should offer generation and payment actions");
assert(source.includes("collection-history-empty") && source.includes("暂无话术记录") && source.includes("可以先为待回款项目生成第一条话术") && source.includes("上传核销表"), "empty collection history should expose generation, payment, and verification actions");
assert(source.includes("有效") && source.includes("待优化"), "collection assistant should record script outcomes");
assert(source.includes("更像人说话") || source.includes("像人说话"), "collection assistant should focus on human-sounding copy");
assert(source.includes("setFocusedScriptId(record.id)") && source.includes("催收记录和团队学习样本已刷新："), "recording collection outcome should refresh and focus the learning sample");
assert(source.includes("followUpForm(record") && source.includes("nextFollowUpAt") && source.includes("nextAction"), "collection assistant should capture next follow-up plan when marking a script as needing optimization");
assert(source.includes("collectionFollowUpForm(record") && source.includes("待优化并提醒"), "project detail collection records should capture next follow-up reminders");
assert(source.includes("已记录为有效话术，回款记录和团队学习样本已刷新。") && source.includes("已记录为待优化话术，并创建下次跟进待办"), "project detail collection outcomes should report refreshed payment records and follow-up reminders");
assert(source.includes("collection-follow-up") && source.includes("已打开催收助手"), "collection follow-up notifications should route to the collection assistant");
assert(source.includes("const [copyingScriptId") && source.includes("async function copyScript(record)") && source.includes("navigator.clipboard.writeText(record.script || \"\")"), "collection assistant should copy scripts to clipboard");
assert(source.includes("function collectionLedgerRows(scripts = [], projects = [])") && source.includes("话术内容") && source.includes("是否有效") && source.includes("下次跟进时间"), "collection assistant should build a CSV ledger with scripts, outcome, and follow-up fields");
assert(source.includes("const [exportingCollection") && source.includes("async function exportCollectionLedger()") && source.includes("downloadCsv(\"催收话术记录.csv\", collectionLedgerRows(scripts, projects))"), "collection assistant should export collection script history as CSV");
assert(source.includes("导出话术") && source.includes("催收话术记录 CSV 已导出：${scripts.length} 条。") && source.includes("当前还没有可导出的催收记录，请先生成话术或记录跟进结果。"), "collection export should show an action, empty notice, and success notice");
assert(source.includes("const [copyingCollectionId") && source.includes("async function copyCollectionScript(record)") && source.includes("催收话术已复制："), "project detail collection scripts should copy to clipboard");
assert(source.includes("复制话术") && source.includes("复制中") && source.includes("复制失败，请手动选中话术复制。"), "collection copy actions should expose copy/loading/failure feedback");
assert(source.includes("const [savingOutcomeId") && source.includes("setSavingOutcomeId(record.id)") && source.includes('setSavingOutcomeId("")'), "collection assistant should track per-script outcome saving state");
assert(source.includes("const [savingCollectionOutcomeId") && source.includes("setSavingCollectionOutcomeId(record.id)") && source.includes('setSavingCollectionOutcomeId("")'), "project detail collection records should track per-script saving state");
assert(source.includes('disabled={savingOutcomeId === item.id}') && source.includes('disabled={savingCollectionOutcomeId === item.id}'), "collection outcome buttons should only disable the active script");
assert(source.includes('savingOutcomeId === item.id ? "记录中" : "有效"') && source.includes('savingOutcomeId === item.id ? "记录中" : "待优化并提醒"'), "collection assistant should show recording copy while saving");
assert(source.includes('savingCollectionOutcomeId === item.id ? "记录中" : "有效"') && source.includes('savingCollectionOutcomeId === item.id ? "记录中" : "待优化并提醒"'), "project detail collection records should show recording copy while saving");
assert(source.includes("催收话术已生成并保存到回款记录区："), "project detail collection generation should report refreshed payment area");
assert(source.includes('setLocalFocusTarget("payments")'), "project detail collection generation should return to the payment section");
assert(styles.includes(".collection-action-empty") && styles.includes(".collection-action-empty strong"), "collection actionable empty states should have styles");
assert(styles.includes(".collection-priority-panel") && styles.includes(".collection-priority-panel button") && styles.includes(".collection-priority-panel button b"), "collection priority panel should have dedicated styles");
assert(styles.includes(".collection-follow-up-form") && styles.includes(".collection-follow-up-note"), "collection follow-up plan and note should have styles");

console.log("frontend collection assistant entry passed");
