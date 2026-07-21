import { mutateDb } from "./db.mjs";
import { claimUploadBatch, finishUploadBatchFile, processClaimedUploadFile } from "./upload-batch-service.mjs";

let running = false;
let timer = null;

export async function runUploadBatchWorkerOnce() {
  if (running) return false;
  running = true;
  try {
    const claim = await mutateDb((db) => claimUploadBatch(db));
    if (!claim) return false;
    let result;
    let error;
    try {
      result = await processClaimedUploadFile(claim);
    } catch (caught) {
      error = caught;
      console.error(`[UPLOAD-BATCH] ${claim.batchId} file ${claim.batchIndex}: ${caught.message}`);
    }
    await mutateDb((db) => finishUploadBatchFile(db, claim, result, error));
    return true;
  } finally {
    running = false;
  }
}

export function startUploadBatchWorker() {
  if (timer) return;
  timer = setInterval(() => runUploadBatchWorkerOnce().catch((error) => console.error(`[UPLOAD-BATCH] worker: ${error.message}`)), 2000);
  timer.unref?.();
  setTimeout(() => runUploadBatchWorkerOnce().catch((error) => console.error(`[UPLOAD-BATCH] startup: ${error.message}`)), 1000).unref?.();
}
