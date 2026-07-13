import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/IntegrationSettingsPanel.jsx", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../server/scheduler.mjs", import.meta.url), "utf8");
const deployHealth = await readFile(new URL("../src/DeployHealthPanel.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(panel.includes("自动外部提醒") && panel.includes("开启高风险自动提醒"), "settings should make automatic notification opt-in and high-risk only");
assert(panel.includes("飞书私聊") && panel.includes("企业微信机器人"), "settings should let admins choose delivery channels");
assert(panel.includes("既有待办仍留在 OA，避免重复打扰同事"), "settings should explain the anti-spam behavior");
assert(panel.includes("automaticNotificationStatus") && admin.includes("高风险待办仍会保留在 OA"), "settings should explain missing channel configuration before enabling delivery");
assert(admin.includes("const [alertSettings, setAlertSettings]"), "admin shell should keep real auto-notification settings state");
assert(admin.includes("automaticNotificationStatus") && admin.includes("飞书 App ID / Secret") && admin.includes("企业微信 Webhook"), "admin shell should derive real channel readiness feedback");
assert(scheduler.includes("dispatchNewHighSeverityNotifications") && scheduler.includes("const newNotices"), "scheduled scans should dispatch only newly created notices");
assert(deployHealth.includes("最近自动提醒") && deployHealth.includes("scheduler?.lastAutomaticDelivery"), "deploy health should show the latest automatic delivery result");

console.log("frontend automatic notification entry passed");
