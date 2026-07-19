import assert from "node:assert/strict";
import { deleteProject } from "../server/services.mjs";
import { listCloudRecycleBin, restoreRecycledProject } from "../server/cloud-recycle-service.mjs";

const project = { id: "P-RECYCLE", name: "回收站测试项目", files: [{ id: "f1", name: "合同.pdf", storagePath: "hub/f1.pdf", storageProvider: "s3-compatible" }] };
const db = {
  settings: {}, projects: [project], parseJobs: [], files: [], suppliers: [], payments: [], approvals: [], collectionScripts: [], comments: [], alertUpdates: [], systemNotifications: [], feishuProjectBindings: [], feishuPendingFiles: [], feishuEvents: [], auditLogs: []
};
const actor = { id: "admin", name: "管理员" };
const deleted = deleteProject(db, { id: project.id }, actor);
assert.equal(deleted.retainedDays, 30);
assert.equal(db.projects.length, 0);
const [item] = listCloudRecycleBin(db);
assert.equal(item.projectName, project.name);
assert.equal(item.fileCount, 1);
assert.ok(Date.parse(item.expiresAt) - Date.parse(item.deletedAt) === 30 * 86400000);
restoreRecycledProject(db, { id: item.id }, actor);
assert.equal(db.projects[0].name, project.name);
assert.equal(listCloudRecycleBin(db).length, 0);
assert.ok(db.auditLogs.some((log) => log.action === "restore"));

console.log("cloud recycle regression passed");
