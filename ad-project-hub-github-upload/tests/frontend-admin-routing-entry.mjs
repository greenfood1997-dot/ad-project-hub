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

console.log("frontend admin routing entry passed");
