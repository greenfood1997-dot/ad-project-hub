import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { rootDir } from "./config.mjs";
import { hmacBuffer, hmacHex, nextFileId, sha256Hex } from "./service-utils.mjs";

function safeFileName(name = "file") {
  const ext = extname(String(name || "")).slice(0, 12);
  const base = String(name || "file")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "file";
  return `${base}${ext || ""}`;
}

export function storageObjectKey(file = {}, category = "file", now = new Date().toISOString(), settings = {}) {
  const prefix = String(settings.pathPrefix || settings.prefix || "ad-project-hub").replace(/^\/+|\/+$/g, "");
  const day = now.slice(0, 10);
  const id = file.id || nextFileId();
  return [prefix, day, `${id}-${safeFileName(file.name || "upload")}`].filter(Boolean).join("/");
}

function s3Enabled(settings = {}) {
  const provider = String(settings.provider || "").toLowerCase();
  return Boolean(settings.bucket && (settings.endpoint || provider.includes("s3") || provider.includes("r2") || provider.includes("minio")) && settings.accessKeyId && settings.secretAccessKey);
}

function s3PublicUrl(settings = {}, objectKey = "") {
  const base = String(settings.publicBaseUrl || "").replace(/\/+$/, "");
  if (base) return `${base}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const endpoint = String(settings.endpoint || "").replace(/\/+$/, "");
  if (!endpoint) return "";
  return `${endpoint}/${settings.bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

function s3RequestTarget(settings = {}, objectKey = "") {
  const endpointUrl = new URL(String(settings.endpoint || `https://${settings.bucket}.s3.${settings.region || "us-east-1"}.amazonaws.com`).replace(/\/+$/, ""));
  const pathStyle = settings.pathStyle === true || settings.pathStyle === "true" || endpointUrl.hostname.includes("r2.cloudflarestorage.com") || endpointUrl.hostname.includes("localhost") || endpointUrl.hostname.includes("127.0.0.1");
  const canonicalUri = `/${[pathStyle ? settings.bucket : "", objectKey].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`;
  const host = pathStyle ? endpointUrl.host : `${settings.bucket}.${endpointUrl.host}`;
  return { endpointUrl, canonicalUri, host };
}

function awsEncode(value = "") {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function createPresignedUpload(file = {}, category = "file", settings = {}, expiresSeconds = 600) {
  if (!s3Enabled(settings)) throw new Error("对象存储未配置，无法生成直传地址");
  const now = new Date();
  const objectKey = storageObjectKey(file, category, now.toISOString(), settings);
  const { endpointUrl, canonicalUri, host } = s3RequestTarget(settings, objectKey);
  const region = String(settings.region || "us-east-1");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${settings.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(60, Math.min(Number(expiresSeconds) || 600, 900))),
    "X-Amz-SignedHeaders": "host"
  };
  const canonicalQuery = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join("&");
  const canonicalRequest = ["PUT", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmacBuffer(hmacBuffer(hmacBuffer(hmacBuffer(`AWS4${settings.secretAccessKey}`, date), region), "s3"), "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);
  return {
    uploadUrl: `${endpointUrl.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    objectKey,
    storageUrl: s3PublicUrl(settings, objectKey),
    storageProvider: settings.provider || "s3-compatible",
    expiresIn: Number(params["X-Amz-Expires"])
  };
}

export async function downloadStoredObject(file = {}, settings = {}) {
  if (!s3Enabled(settings) || !file.storagePath) throw new Error("对象存储下载配置不完整");
  const { url, headers } = s3SignedHeaders({ settings, objectKey: file.storagePath, method: "GET" });
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`对象存储读取失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function s3SignedHeaders({ settings = {}, objectKey = "", buffer = Buffer.alloc(0), contentType = "application/octet-stream", method = "PUT", now = new Date() }) {
  const endpointUrl = new URL(String(settings.endpoint || `https://${settings.bucket}.s3.${settings.region || "us-east-1"}.amazonaws.com`).replace(/\/+$/, ""));
  const region = String(settings.region || "us-east-1");
  const service = "s3";
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const pathStyle = settings.pathStyle === true || settings.pathStyle === "true" || endpointUrl.hostname.includes("r2.cloudflarestorage.com") || endpointUrl.hostname.includes("localhost") || endpointUrl.hostname.includes("127.0.0.1");
  const canonicalUri = `/${[pathStyle ? settings.bucket : "", objectKey].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`;
  const host = pathStyle ? endpointUrl.host : `${settings.bucket}.${endpointUrl.host}`;
  const payloadHash = sha256Hex(buffer);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmacBuffer(hmacBuffer(hmacBuffer(hmacBuffer(`AWS4${settings.secretAccessKey}`, date), region), service), "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);
  return {
    url: `${endpointUrl.protocol}//${host}${canonicalUri}`,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": contentType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  };
}

export async function deleteStoredObject(file = {}, settings = {}) {
  const objectKey = String(file.storagePath || "").trim();
  if (!objectKey) return { deleted: false, reason: "missing-storage-path" };
  if (file.storageProvider === "local") {
    if (!objectKey.startsWith("uploads/")) throw new Error("拒绝删除 uploads 目录以外的本地文件");
    await unlink(join(rootDir, objectKey)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return { deleted: true, provider: "local", objectKey };
  }
  if (!s3Enabled(settings)) throw new Error("对象存储未配置，暂不能执行云端永久删除");
  const { url, headers } = s3SignedHeaders({ settings, objectKey, method: "DELETE" });
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`对象存储删除失败：${res.status} ${text.slice(0, 160)}`);
  }
  return { deleted: true, provider: file.storageProvider || "s3-compatible", objectKey };
}

async function uploadToS3CompatibleStorage(file = {}, buffer, category = "file", now = new Date().toISOString(), settings = {}) {
  const objectKey = storageObjectKey(file, category, now, settings);
  const publicUrl = s3PublicUrl(settings, objectKey);
  const mockUpload = settings.mockUpload === true || settings.mockUpload === "true";
  if (mockUpload) {
    if (process.env.NODE_ENV === "production") throw new Error("生产环境禁止模拟对象存储上传");
    return { storageUrl: publicUrl || `s3://${settings.bucket}/${objectKey}`, storagePath: objectKey, storageProvider: settings.provider || "s3-compatible", storageStatus: "已上传对象存储", storageMocked: true };
  }
  const contentType = fileContentType(file);
  const { url, headers } = s3SignedHeaders({ settings, objectKey, buffer, contentType });
  const res = await fetch(url, { method: "PUT", headers, body: buffer });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`对象存储上传失败：${res.status} ${text.slice(0, 160)}`);
  }
  return { storageUrl: publicUrl || url, storagePath: objectKey, storageProvider: settings.provider || "s3-compatible", storageStatus: "已上传对象存储" };
}

function fileContentType(file = {}) {
  const extension = extname(String(file.name || "")).toLowerCase();
  const types = {
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".csv": "text/csv; charset=utf-8"
  };
  return types[extension] || file.type || "application/octet-stream";
}

export async function persistLocalUploadFile(file = {}, category = "file", now = new Date().toISOString(), storageSettings = {}) {
  if (file.storageUrl || file.storagePath) return file;
  if (!file.base64 && !file.buffer) return { ...file, storageStatus: file.storageStatus || "仅记录文件信息" };
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(String(file.base64 || ""), "base64");
  if (!buffer.length) return { ...file, storageStatus: "仅记录文件信息" };
  const day = now.slice(0, 10);
  const id = file.id || nextFileId();
  const folder = join(rootDir, "uploads", day);
  await mkdir(folder, { recursive: true });
  const name = `${id}-${safeFileName(file.name || "upload")}`;
  const diskPath = join(folder, name);
  await writeFile(diskPath, buffer);
  const { base64, buffer: rawBuffer, ...fileReference } = file;
  const localRecord = {
    ...fileReference,
    id,
    storageUrl: `/uploads/${day}/${encodeURIComponent(name)}`,
    storagePath: `uploads/${day}/${name}`,
    storageProvider: "local",
    storageStatus: "已持久化",
    category: file.category || category,
    size: file.size || buffer.length
  };
  if (!s3Enabled(storageSettings)) return localRecord;
  try {
    const remote = await uploadToS3CompatibleStorage(localRecord, buffer, category, now, storageSettings);
    return { ...localRecord, ...remote, localStorageUrl: localRecord.storageUrl, localStoragePath: localRecord.storagePath };
  } catch (error) {
    return { ...localRecord, storageStatus: "仅本地暂存，远程上传失败", storageRemoteError: error.message };
  }
}
