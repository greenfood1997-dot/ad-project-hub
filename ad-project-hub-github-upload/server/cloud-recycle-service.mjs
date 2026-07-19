import { deleteStoredObject } from "./upload-storage-service.mjs";

export const CLOUD_RECYCLE_RETENTION_DAYS = 30;
const RECYCLE_KEY = "__cloudRecycleBin";

function recycleState(db) {
  db.settings ||= {};
  db.settings[RECYCLE_KEY] ||= { items: [] };
  db.settings[RECYCLE_KEY].items ||= [];
  return db.settings[RECYCLE_KEY];
}

export function projectRecycleSnapshot(db, project, isProjectRecord, user, at = new Date().toISOString()) {
  const collections = ["parseJobs", "files", "suppliers", "payments", "approvals", "collectionScripts", "comments", "alertUpdates", "systemNotifications", "feishuProjectBindings", "feishuPendingFiles", "feishuEvents"];
  const records = Object.fromEntries(collections.map((key) => [key, (db[key] || []).filter(isProjectRecord)]));
  const files = [
    ...(project.files || []),
    ...records.files.flatMap((upload) => upload.files || [])
  ];
  const uniqueFiles = Array.from(new Map(files.filter((file) => file.storagePath).map((file) => [`${file.storageProvider || ""}:${file.storagePath}`, file])).values());
  const expiresAt = new Date(Date.parse(at) + CLOUD_RECYCLE_RETENTION_DAYS * 86400000).toISOString();
  const item = {
    id: `recycle-${project.id}-${Date.now()}`,
    project,
    records,
    files: uniqueFiles,
    deletedAt: at,
    expiresAt,
    deletedBy: user.id,
    deletedByName: user.name,
    status: "retained"
  };
  recycleState(db).items.unshift(item);
  return item;
}

export function listCloudRecycleBin(db) {
  return recycleState(db).items.map((item) => ({
    id: item.id,
    projectId: item.project?.id,
    projectName: item.project?.name,
    fileCount: item.files?.length || 0,
    deletedAt: item.deletedAt,
    expiresAt: item.expiresAt,
    deletedByName: item.deletedByName,
    status: item.status,
    lastError: item.lastError || ""
  }));
}

export function restoreRecycledProject(db, body, user) {
  const item = recycleState(db).items.find((entry) => entry.id === body.id);
  if (!item || item.status !== "retained") throw new Error("回收站项目不存在或已永久删除");
  if ((db.projects || []).some((project) => project.id === item.project.id || project.name === item.project.name)) throw new Error("同名或同 ID 项目已存在，不能直接恢复");
  db.projects ||= [];
  db.projects.unshift(item.project);
  for (const [key, records] of Object.entries(item.records || {})) {
    db[key] ||= [];
    db[key].unshift(...records);
  }
  recycleState(db).items = recycleState(db).items.filter((entry) => entry.id !== item.id);
  db.auditLogs ||= [];
  db.auditLogs.unshift({ type: "project", target: item.project.name, action: "restore", user: user.name, at: new Date().toISOString() });
  return { id: item.project.id, name: item.project.name };
}

function activeStoragePaths(db) {
  const files = [
    ...(db.projects || []).flatMap((project) => project.files || []),
    ...(db.files || []).flatMap((upload) => upload.files || [])
  ];
  return new Set(files.map((file) => file.storagePath).filter(Boolean));
}

export async function purgeExpiredCloudRecycleBin(db, now = new Date()) {
  const activePaths = activeStoragePaths(db);
  const state = recycleState(db);
  let deleted = 0;
  let failed = 0;
  for (const item of state.items) {
    if (item.status !== "retained" || Date.parse(item.expiresAt) > now.getTime()) continue;
    try {
      for (const file of item.files || []) {
        if (!file.storagePath || activePaths.has(file.storagePath)) continue;
        await deleteStoredObject(file, db.settings?.storage || {});
      }
      item.status = "purged";
      item.purgedAt = now.toISOString();
      item.lastError = "";
      deleted += 1;
      db.auditLogs ||= [];
      db.auditLogs.unshift({ type: "cloud-file", target: item.project?.name || item.id, action: "purge", user: "后台定时巡检", at: item.purgedAt });
    } catch (error) {
      item.lastError = error.message;
      item.lastAttemptAt = now.toISOString();
      failed += 1;
    }
  }
  state.items = state.items.filter((item) => item.status !== "purged");
  return { deleted, failed, retained: state.items.length };
}
