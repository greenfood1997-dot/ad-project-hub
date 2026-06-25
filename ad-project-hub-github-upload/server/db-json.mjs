import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dataDir, dbFile } from "./config.mjs";
import { defaultDb } from "./default-db.mjs";

export async function ensureJsonDb() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbFile)) await writeJsonDb(defaultDb);
}

export async function readJsonDb() {
  await ensureJsonDb();
  const raw = JSON.parse(await readFile(dbFile, "utf8"));
  return {
    ...defaultDb,
    ...raw,
    settings: { ...defaultDb.settings, ...(raw.settings || {}) },
    users: raw.users || defaultDb.users,
    projects: raw.projects || [],
    clientProfiles: raw.clientProfiles || [],
    suppliers: raw.suppliers || [],
    supplierProfiles: raw.supplierProfiles || [],
    approvals: raw.approvals || [],
    payments: raw.payments || [],
    collectionScripts: raw.collectionScripts || [],
    feishuEvents: raw.feishuEvents || [],
    feishuProjectBindings: raw.feishuProjectBindings || [],
    feishuPendingFiles: raw.feishuPendingFiles || [],
    files: raw.files || raw.uploads || [],
    parseJobs: raw.parseJobs || [],
    alertUpdates: raw.alertUpdates || [],
    comments: raw.comments || [],
    auditLogs: raw.auditLogs || []
  };
}

export async function writeJsonDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbFile, JSON.stringify(db, null, 2));
}
