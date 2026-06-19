import { createHash, createHmac } from "node:crypto";

const endpoint = "ocr.tencentcloudapi.com";
const service = "ocr";
const version = "2018-11-19";

export function tencentOcrConfigured() {
  return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
}

export async function recognizeFileWithTencentOcr(file, options = {}) {
  if (!tencentOcrConfigured()) {
    throw new Error("未配置腾讯云 OCR 密钥，请在 Render Environment 设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY");
  }

  const base64 = file.base64 || "";
  if (!base64) throw new Error("文件缺少 base64 内容，无法调用 OCR");

  const isPdf = options.isPdf ?? isPdfFile(file);
  if (!isPdf) {
    return await recognizePage(base64, { isPdf: false });
  }

  const pageCount = Number(process.env.TENCENT_OCR_PDF_PAGES || 3);
  const texts = [];
  const errors = [];
  for (let page = 1; page <= pageCount; page += 1) {
    try {
      const text = await recognizePage(base64, { isPdf: true, page });
      if (text.trim()) texts.push(`第${page}页\n${text}`);
    } catch (error) {
      errors.push(`第${page}页：${error.message}`);
      if (page === 1) throw error;
      break;
    }
  }

  if (texts.length) return texts.join("\n\n");
  throw new Error(errors.join("；") || "OCR 未识别到文本");
}

function isPdfFile(file) {
  return (file.name || "").toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

async function recognizePage(imageBase64, { isPdf, page = 1 }) {
  const action = process.env.TENCENT_OCR_ACTION || "GeneralAccurateOCR";
  const payload = {
    ImageBase64: imageBase64,
    IsPdf: isPdf,
    PdfPageNumber: isPdf ? page : undefined
  };
  if (!isPdf) delete payload.PdfPageNumber;

  const response = await callTencentApi(action, payload);
  const detections = response.TextDetections || [];
  return detections.map((item) => item.DetectedText || "").filter(Boolean).join("\n");
}

async function callTencentApi(action, payload) {
  const region = process.env.TENCENT_OCR_REGION || "ap-guangzhou";
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const headers = signRequest({
    action,
    body,
    region,
    timestamp,
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY
  });

  const res = await fetch(`https://${endpoint}`, {
    method: "POST",
    headers,
    body
  });
  const data = await res.json().catch(() => ({}));
  const response = data.Response || {};
  if (!res.ok || response.Error) {
    const code = response.Error?.Code || res.status;
    const message = response.Error?.Message || res.statusText || "OCR 请求失败";
    throw new Error(`${code}: ${message}`);
  }
  return response;
}

function signRequest({ action, body, region, timestamp, secretId, secretKey }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = sha256(body);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmacHex(secretSigning, stringToSign);
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "Content-Type": "application/json; charset=utf-8",
    Host: endpoint,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": version,
    "X-TC-Region": region
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}
