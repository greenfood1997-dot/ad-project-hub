import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { objectStorageReady } from "../server/storage-settings.mjs";
import { testObjectStorage } from "../server/services.mjs";

const configured = { provider: "s3", bucket: "oa", accessKeyId: "id", secretAccessKey: "secret" };
assert.equal(objectStorageReady(configured), true);
assert.equal(objectStorageReady({ ...configured, mockUpload: true }), false, "mock upload must never satisfy production readiness");
assert.equal(objectStorageReady({ ...configured, mockUpload: "true" }), false);

const db = { settings: { storage: {} }, auditLogs: [] };
const localOnly = await testObjectStorage(db, {}, { id: "u-admin", name: "管理员" });
assert.equal(localOnly.ok, false, "local Render disk must not pass the object storage test");
assert.equal(localOnly.remoteStored, false);
assert(localOnly.warning.includes("Render 本地文件"));

const service = await readFile(new URL("../server/upload-storage-service.mjs", import.meta.url), "utf8");
const inline = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");
for (const [label, source] of [["split", service], ["production", inline]]) {
  assert(source.includes("生产环境禁止模拟对象存储上传"), `${label} upload path must reject production mocks`);
  assert(source.includes("仅本地暂存，远程上传失败"), `${label} upload path must expose remote failure truthfully`);
}

console.log("object storage truth regression passed");
