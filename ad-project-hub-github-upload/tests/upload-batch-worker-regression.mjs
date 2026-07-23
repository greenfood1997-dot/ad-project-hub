import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createUploadBatch, claimUploadBatch, finishUploadBatchFile, hydrateStoredFile } from "../server/upload-batch-service.mjs";

const db = { parseJobs: [] };
const batch = createUploadBatch(db, {
  type: "verification-sheet",
  id: "p1",
  projectName: "测试项目",
  files: [{ name: "核销表.pdf", size: 100, storageUrl: "https://example.test/file.pdf" }, { name: "佐证.pptx", size: 200, storageUrl: "https://example.test/file.pptx" }]
}, { id: "u1" });

assert.equal(batch.status, "queued");
const first = claimUploadBatch(db);
assert.equal(first.batchIndex, 0);
finishUploadBatchFile(db, first, { ...first.file, text: "核销金额 100 元" });
const second = claimUploadBatch(db);
assert.equal(second.batchIndex, 1);
const ready = finishUploadBatchFile(db, second, { ...second.file, text: "佐证金额 100 元" });
assert.equal(ready.status, "ready");
assert.equal(ready.progress, 90);
assert.equal(ready.files.every((file) => file.taskStatus === "completed"), true);

let fetchAttempts = 0;
const server = createServer((req, res) => {
  fetchAttempts += 1;
  if (fetchAttempts === 1) {
    res.destroy();
    return;
  }
  res.writeHead(200, { "content-type": "application/pdf" });
  res.end("durable-object");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const hydrated = await hydrateStoredFile({ localStoragePath: "uploads/missing.pdf", storageUrl: `http://127.0.0.1:${port}/file.pdf` });
assert.equal(hydrated.buffer.toString(), "durable-object");
assert.equal(hydrated.base64, undefined, "background hydration should not create another large base64 copy");
assert.equal(fetchAttempts, 2, "transient object storage fetch failures should be retried");
server.close();

console.log("upload batch worker regression passed");
