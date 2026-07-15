import assert from "node:assert/strict";
import {
  exportBackupSnapshot,
  restoreBackupSnapshot
} from "../server/services.mjs";
import {
  exportBackupSnapshot as exportSplitBackupSnapshot,
  restoreBackupSnapshot as restoreSplitBackupSnapshot
} from "../server/backup-service.mjs";

const collections = [
  "approvals", "payments", "suppliers", "supplierProfiles", "clientProfiles",
  "collectionScripts", "comments", "alertUpdates", "systemNotifications",
  "feishuProjectBindings", "feishuEvents", "auditLogs"
];

function fixture() {
  const db = {
    users: [
      { id: "u-admin", name: "管理员", role: "admin", status: "active", pinHash: "scrypt:existing", mustChangePin: false },
      { id: "u-current", name: "当前成员", role: "execution", status: "active", pin: "654321" }
    ],
    projects: [{
      id: "p-1",
      name: "安全备份项目",
      files: [{ name: "合同.pdf", base64: "contract-secret", dataUrl: "data:application/pdf;base64,secret", storageUrl: "https://storage.example/contract.pdf", text: "合同金额 1870700" }]
    }],
    files: [{ id: "f-1", name: "发票.pdf", base64: "invoice-secret", storagePath: "oa/f-1.pdf" }],
    parseJobs: [{ id: "j-1", input: { dataUrl: "data:text/plain;base64,secret" }, tableRows: [["金额", 100]] }],
    feishuPendingFiles: [{ id: "ff-1", binary: "secret", storageProvider: "s3" }],
    settings: { ai: { apiKey: "sk-secret", model: "test" }, storage: { secretAccessKey: "storage-secret", bucket: "oa" } }
  };
  for (const key of collections) db[key] ||= [];
  return db;
}

for (const [label, exportSnapshot, restoreSnapshot] of [
  ["production", exportBackupSnapshot, restoreBackupSnapshot],
  ["split", exportSplitBackupSnapshot, restoreSplitBackupSnapshot]
]) {
  const db = fixture();
  const backup = exportSnapshot(db, db.users[0]);
  const serialized = JSON.stringify(backup);

  assert(!serialized.includes("scrypt:existing"), `${label}: backup must not contain PIN hashes`);
  assert(!serialized.includes("contract-secret"), `${label}: backup must strip nested Base64 payloads`);
  assert(!serialized.includes("invoice-secret"), `${label}: backup must strip file Base64 payloads`);
  assert(!serialized.includes("data:application"), `${label}: backup must strip data URLs`);
  assert.equal(backup.data.projects[0].files[0].storageUrl, "https://storage.example/contract.pdf");
  assert.equal(backup.data.files[0].storagePath, "oa/f-1.pdf");
  assert.equal(backup.data.parseJobs[0].tableRows[0][1], 100);
  assert.equal(backup.data.settings.ai.apiKey, "[已脱敏]");
  assert.equal(backup.data.settings.storage.secretAccessKey, "[已脱敏]");
  assert.equal(backup.filePayloadPolicy, "metadata-and-storage-references-only");

  backup.data.files[0].base64 = "legacy-restored-secret";
  backup.data.projects[0].files[0].dataUrl = "data:application/pdf;base64,legacy-secret";

  backup.data.users = [
    { id: "u-admin", name: "恢复管理员", role: "admin", status: "active", pin: "123456", pinHash: "backup-hash" },
    { id: "u-restored", name: "备份新增成员", role: "execution", status: "active", pin: "123456", pinHash: "backup-hash" }
  ];
  restoreSnapshot(db, { backup, confirmText: "确认恢复OA备份" }, db.users[0]);

  const admin = db.users.find((item) => item.id === "u-admin");
  const currentOnly = db.users.find((item) => item.id === "u-current");
  const restored = db.users.find((item) => item.id === "u-restored");
  assert.equal(admin.pinHash, "scrypt:existing", `${label}: current authentication must survive restore`);
  assert.equal(admin.pin, undefined);
  assert(currentOnly, `${label}: current users absent from backup must not be deleted`);
  assert.equal(currentOnly.pin, "654321");
  assert.equal(restored.status, "disabled", `${label}: new restored users must require admin activation`);
  assert.equal(restored.mustChangePin, true);
  assert.equal(restored.pin, undefined);
  assert.equal(restored.pinHash, undefined);
  assert(!JSON.stringify(db).includes("legacy-restored-secret"), `${label}: restore must discard legacy Base64 payloads`);
  assert(!JSON.stringify(db).includes("data:application/pdf"), `${label}: restore must discard legacy data URLs`);
}

console.log("backup safety regression passed");
