import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function ProjectDetail"), "project detail should exist");
assert(source.includes("activityItems = ["), "project detail should aggregate activity items");
assert(source.includes("projectComments = comments.filter"), "project detail should read real project comments");
assert(source.includes("projectLogs = auditLogs.filter"), "project detail should read scoped audit logs");
assert(source.includes("项目评论") && source.includes("系统记录"), "activity stream should include comments and system logs");
assert(source.includes("项目回款") && source.includes("供应商结算") && source.includes("AI 解析"), "activity stream should include payments, suppliers, and parse jobs");
assert(source.includes("项目动态") && source.includes("activity-list"), "project detail should render project activity section");
assert(source.includes('apiRequest("/api/comments"') || source.includes("apiRequest('/api/comments'"), "comment form should submit to backend");
assert(source.includes("记录一句项目进展、客户反馈、材料补充或风险提醒"), "comment input should guide real project updates");
assert(source.includes("项目进展已记录"), "comment save should notify user");
assert(source.includes("项目动态会记录上传、解析、审批、评论和系统更新"), "empty activity state should explain tracked events");
assert(source.includes("const [localFocusTarget, setLocalFocusTarget]"), "project detail should keep local focus for post-action navigation");
assert(source.includes("const target = localFocusTarget || focusTarget"), "project detail should combine notification deep-link focus with local workflow focus");
assert(source.includes('setLocalFocusTarget("files")'), "project detail upload completion should focus the files and AI parsing section");
assert(source.includes("文件已处理，已回到文件与 AI 解析区。"), "project detail upload completion should tell user where to inspect results");

console.log("frontend project activity entry passed");
