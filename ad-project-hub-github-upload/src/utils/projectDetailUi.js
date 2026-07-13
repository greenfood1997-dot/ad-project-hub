import { canWriteProjectRole } from "./permissions.js";

export function actionItemKey(item = {}) {
  return `${item.title || "行动项"}:${item.text || ""}`;
}

export function parseJobTone(job = {}) {
  const status = String(job.status || "");
  if (/失败/.test(status)) return "failed";
  if (/完成/.test(status) || Number(job.progress || 0) >= 100) return "done";
  if (/重新|解析中|进行中/.test(status) || Number(job.progress || 0) > 0) return "running";
  return "waiting";
}

export function canArchiveComment(session = {}, item = {}) {
  return canWriteProjectRole(session) || item.userId === session.id || item.user === session.name;
}
