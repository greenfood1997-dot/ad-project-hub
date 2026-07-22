import { mutateUploadBatch, readDb } from "./db.mjs";
import { claimUploadBatchJob, finishUploadBatchJob, processClaimedUploadFile, uploadBatchIsClaimable } from "./upload-batch-service.mjs";

let running = false;
let timer = null;

export async function runUploadBatchWorkerOnce() {
  if (running) return false;
  running = true;
  try {
    const snapshot = await readDb();
    const now = Date.now();
    const hasWork = (snapshot.parseJobs || []).some((item) => uploadBatchIsClaimable(item, now));
    if (!hasWork) return false;
    const claim = await mutateUploadBatch((job) => uploadBatchIsClaimable(job, now), claimUploadBatchJob);
    if (!claim) return false;
    let result;
    let error;
    try {
      result = await processClaimedUploadFile(claim);
    } catch (caught) {
      error = caught;
      console.error(`[UPLOAD-BATCH] ${claim.batchId} file ${claim.batchIndex}: ${caught.message}`);
    }
    await mutateUploadBatch((job) => job.id === claim.batchId, (job) => finishUploadBatchJob(job, claim, result, error));
    return true;
  } finally {
    running = false;
  }
}

export function startUploadBatchWorker() {
  if (timer) return;
  timer = setInterval(() => runUploadBatchWorkerOnce().catch((error) => console.error(`[UPLOAD-BATCH] worker: ${error.message}`)), 5000);
  timer.unref?.();
  setTimeout(() => runUploadBatchWorkerOnce().catch((error) => console.error(`[UPLOAD-BATCH] startup: ${error.message}`)), 1000).unref?.();
}
