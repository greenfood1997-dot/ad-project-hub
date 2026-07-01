import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("adminRouteMap"), "app shell should map admin deep links to backend tabs");
assert(source.includes('"admin:product": "product"'), "admin:product should open product settings");
assert(source.includes('"admin:assignments": "assignments"'), "admin:assignments should open project assignment");
assert(source.includes('const canManageAssignments = ["shareholder", "admin", "director"].includes(session?.role)') || source.includes('const canManageAssignments = ["shareholder", "admin", "director"].includes(session.role)'), "directors should be allowed to open project assignment");
assert(source.includes('view === "admin:assignments" && canManageAssignments'), "app shell should allow director assignment deep links without opening full admin settings");
assert(source.includes('{isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "members"') && source.includes('{isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "ai"') && source.includes('{isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "product"'), "member, AI, and product settings should remain admin-only");
assert(source.includes('{canManageAssignments && <button type="button" className={`admin-nav-link ${adminTab === "assignments"'), "assignment tab should be visible to directors");
assert(source.includes("loadAssignmentMembers") && source.includes('api("/api/project-assignments/members")'), "director assignment page should load safe assignment member candidates");
assert(source.includes('setView("admin:product")'), "integration buttons should navigate admins to product settings");
assert(source.includes('setView("admin:assignments")'), "assignment notifications should open project assignment directly");
assert(source.includes("飞书未配置，请联系管理员接入机器人。"), "non-admin Feishu button should show a useful status message");
assert(source.includes("企业微信未配置，请联系管理员接入。"), "non-admin WeCom button should show a useful status message");
assert(source.includes("function settingNextStep(type)"), "product settings should provide next-step guidance after saving typed settings");
assert(source.includes("在下方飞书机器人面板自测事件地址") && source.includes("同步飞书通讯录"), "Feishu save feedback should guide bot setup validation");
assert(source.includes("新提交的备用金、报销和供应商付款会按新阈值流转"), "approval rule save feedback should explain future approval behavior");
assert(source.includes("产品设置已保存。回到员工端后，侧边栏和上传提醒会按新名称/提示展示。"), "product setting save feedback should explain visible effect");
assert(source.includes("const leftCount = Math.max(pendingFiles.filter((file) => file.status === \"待确认\").length - 1, 0)"), "Feishu pending file actions should report remaining pending file count");
assert(source.includes("当前还剩 ${leftCount} 个待确认文件"), "Feishu pending file action feedback should tell admins the remaining queue size");
assert(source.includes('>{handlingId === item.id ? "处理中" : "驳回"}</button>'), "Feishu pending file reject button should show loading text while handling");

console.log("frontend admin routing entry passed");
