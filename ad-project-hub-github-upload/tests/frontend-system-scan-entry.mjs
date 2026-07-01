import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('apiRequest("/api/system/scan"'), "frontend should call /api/system/scan");
assert(source.includes("立即巡检"), "notification drawer should expose the manual scan button");
assert(source.includes("巡检中"), "manual scan button should show loading state");
assert(source.includes("canScan={isManagement}"), "manual scan button should be limited to management roles in UI");
assert(source.includes("setNotificationsOpen(true)"), "manual scan should keep/open notification drawer after scan");
assert(source.includes('item.actionView === "management:cash"') && source.includes('setActiveView("management")') && source.includes('setActiveSubView("现金流压力")'), "cashflow notifications should open the management cashflow cockpit");
assert(source.includes("const [projectFocus") && source.includes('setProjectFocus("files")') && source.includes('setProjectFocus(item.type === "project-receivable-risk" ? "payments" : "progress")'), "project notifications should focus the relevant project detail section");
assert(source.includes('id="project-files-section"') && source.includes('id="project-payments-section"') && source.includes('id="project-progress-section"'), "project detail should expose scroll targets for files, payments, and progress");
assert(source.includes("scrollIntoView({ behavior: \"smooth\", block: \"start\" })"), "project detail focus should scroll to the target section");
assert(source.includes("setNotificationsOpen(false)"), "opening a notification target should close the drawer");
assert(source.includes("const [handlingNotificationId, setHandlingNotificationId]"), "notification drawer should keep per-item handling state");
assert(source.includes("setHandlingNotificationId(item.id)") && source.includes('setHandlingNotificationId("")'), "notification actions should disable only the item being handled and reset afterwards");
assert(source.includes("const leftCount = Math.max(systemNotifications.length - 1, 0)") && source.includes("当前还剩 ${leftCount} 条待办"), "notification action result should tell user the remaining todo count");
assert(source.includes("handlingId={handlingNotificationId}") && source.includes('disabled={handlingId === item.id}') && source.includes("处理中"), "notification drawer buttons should show per-item loading");
assert(source.includes("const [sendingNotificationId, setSendingNotificationId]"), "notification drawer should keep per-item Feishu sending state");
assert(source.includes("setSendingNotificationId(item.id)") && source.includes('setSendingNotificationId("")'), "Feishu sending should disable only the active notification and reset afterwards");
assert(source.includes("sendingFeishuId={sendingNotificationId}") && source.includes('disabled={sendingFeishuId === item.id}') && source.includes("发送中"), "Feishu send button should show per-item loading");
assert(source.includes("飞书通知未找到可发送对象，请检查成员飞书绑定。"), "Feishu send result should explain empty recipient cases");

console.log("frontend system scan entry passed");
