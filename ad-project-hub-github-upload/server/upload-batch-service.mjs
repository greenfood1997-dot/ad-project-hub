import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rootDir } from "./config.mjs";
import { extractFileContent } from "./file-extraction-service.mjs";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function batchId() {
  return `UB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function publicBatch(job = {}) {
  return {
    id: job.id,
    type: job.sourceValues?.type || "",
    projectId: job.projectId || "",
    projectName: job.projectName || "",
    status: job.status,
    progress: job.progress,
    files: (job.files || []).map(({ base64, dataUrl, ...file }) => file),
    error: job.extractedFields?.error || "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

export function createUploadBatch(db, body, user) {
  const now = new Date().toISOString();
  const files = (body.files || []).map((file, index) => ({
    ...file,
    batchIndex: index,
    taskStatus: "queued",
    attempts: 0,
    error: ""
  }));
  if (!files.length) throw new Error("请先上传文件");
  const job = {
    id: batchId(),
    projectId: body.id || null,
    projectName: body.projectName || "待确认上传批次",
    status: "queued",
    progress: 5,
    steps: [
      { name: "文件上传", status: "完成" },
      { name: "内容提取/OCR", status: "等待" },
      { name: "整批预览", status: "等待" }
    ],
    files,
    sourceValues: { type: body.type, values: body.values || {}, userId: user.id },
    extractedFields: { leaseUntil: "", error: "" },
    createdAt: now,
    updatedAt: now
  };
  db.parseJobs = db.parseJobs || [];
  db.parseJobs.unshift(job);
  return publicBatch(job);
}

export function uploadBatchForUser(db, id, user) {
  const job = (db.parseJobs || []).find((item) => item.id === id && item.id.startsWith("UB-"));
  if (!job || job.sourceValues?.userId !== user.id) throw new Error("上传批次不存在或无权查看");
  return publicBatch(job);
}

export function claimUploadBatch(db) {
  const now = Date.now();
  const job = (db.parseJobs || []).find((item) => item.id.startsWith("UB-") && (
    item.status === "queued" ||
    (item.status === "processing" && Date.parse(item.extractedFields?.leaseUntil || 0) < now)
  ));
  if (!job) return null;
  const file = (job.files || []).find((item) => item.taskStatus === "queued" || (item.taskStatus === "processing" && Date.parse(item.leaseUntil || 0) < now));
  if (!file) return null;
  const leaseUntil = new Date(now + LEASE_MS).toISOString();
  file.taskStatus = "processing";
  file.leaseUntil = leaseUntil;
  file.attempts = Number(file.attempts || 0) + 1;
  job.status = "processing";
  job.extractedFields = { ...(job.extractedFields || {}), leaseUntil };
  job.steps[1].status = "进行中";
  job.updatedAt = new Date(now).toISOString();
  return { batchId: job.id, batchIndex: file.batchIndex, file: { ...file } };
}

export function uploadBatchIsClaimable(item, now = Date.now()) {
  return item.id?.startsWith("UB-") && (
    item.status === "queued" ||
    (item.status === "processing" && Date.parse(item.extractedFields?.leaseUntil || 0) < now)
  );
}

export function claimUploadBatchJob(job) {
  return claimUploadBatch({ parseJobs: [job] });
}

export async function hydrateStoredFile(file = {}) {
  if (file.buffer || file.base64) return file;
  const localPath = file.localStoragePath || (file.storageProvider === "local" ? file.storagePath : "");
  if (localPath) {
    try {
      const buffer = await readFile(join(rootDir, localPath));
      return { ...file, buffer };
    } catch (error) {
      if (!/^https?:\/\//i.test(file.storageUrl || "")) throw error;
      // Render local disks are ephemeral; fall back to durable object storage after a restart.
    }
  }
  if (/^https?:\/\//i.test(file.storageUrl || "")) {
    const response = await fetch(file.storageUrl);
    if (!response.ok) throw new Error(`对象存储读取失败：${response.status}`);
    return { ...file, buffer: Buffer.from(await response.arrayBuffer()) };
  }
  throw new Error("文件没有可恢复的存储地址");
}

export async function processClaimedUploadFile(claim) {
  console.log(`[UPLOAD-BATCH] ${claim.batchId} file ${claim.batchIndex + 1}: loading ${claim.file.name || "unnamed file"}`);
  const hydrated = await hydrateStoredFile(claim.file);
  console.log(`[UPLOAD-BATCH] ${claim.batchId} file ${claim.batchIndex + 1}: extracting ${claim.file.name || "unnamed file"}`);
  const result = await extractFileContent(hydrated, {
    shouldUseOcrForPdf(text = "") {
      const normalized = String(text).trim();
      if (!normalized) return true;
      return !/\d[\d,.]*\s*(?:元|万元|人民币)/.test(normalized) && !/\d{4}[年\-/]\d{1,2}/.test(normalized);
    }
  });
  console.log(`[UPLOAD-BATCH] ${claim.batchId} file ${claim.batchIndex + 1}: completed ${result.extractionStatus || "content extraction"}`);
  return result;
}

export function finishUploadBatchFile(db, claim, result, error = null) {
  const job = (db.parseJobs || []).find((item) => item.id === claim.batchId);
  const file = job?.files?.find((item) => item.batchIndex === claim.batchIndex);
  if (!job || !file) return null;
  if (error) {
    file.error = error.message;
    file.taskStatus = file.attempts < MAX_ATTEMPTS ? "queued" : "failed";
  } else {
    const { base64, buffer, dataUrl, ...reference } = result;
    Object.assign(file, reference, { taskStatus: "completed", error: "", leaseUntil: "" });
  }
  const completed = job.files.filter((item) => item.taskStatus === "completed").length;
  const failed = job.files.filter((item) => item.taskStatus === "failed").length;
  const pending = job.files.length - completed - failed;
  job.progress = Math.min(90, 10 + Math.round((completed / job.files.length) * 80));
  job.status = pending ? "queued" : failed ? "failed" : "ready";
  job.steps[1].status = pending ? "进行中" : failed ? "失败" : "完成";
  job.steps[2].status = job.status === "ready" ? "等待确认" : "等待";
  job.extractedFields = { ...(job.extractedFields || {}), leaseUntil: "", error: failed ? `${failed} 个文件解析失败` : "" };
  job.updatedAt = new Date().toISOString();
  return publicBatch(job);
}

export function finishUploadBatchJob(job, claim, result, error = null) {
  return finishUploadBatchFile({ parseJobs: [job] }, claim, result, error);
}
