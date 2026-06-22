import { createHash, createHmac } from "node:crypto";

const endpoint = "ocr.tencentcloudapi.com";
const service = "ocr";
const version = "2018-11-19";

export function tencentOcrConfigured() {
  return Boolean(envValue("TENCENT_SECRET_ID") && envValue("TENCENT_SECRET_KEY"));
}

export async function recognizeFileWithTencentOcr(file, options = {}) {
  const result = await recognizeFileWithTencentOcrDetailed(file, options);
  return result.text;
}

export async function recognizeFileWithTencentOcrDetailed(file, options = {}) {
  if (!tencentOcrConfigured()) {
    throw new Error("未配置腾讯云 OCR 密钥，请在 Render Environment 设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY");
  }
  logTencentOcrCredentialShape();

  const base64 = file.base64 || "";
  if (!base64) throw new Error("文件缺少 base64 内容，无法调用 OCR");

  const isPdf = options.isPdf ?? isPdfFile(file);
  if (!isPdf) {
    return await recognizePage(base64, { isPdf: false });
  }

  const pageCount = resolvePdfPageCount(file, options);
  const texts = [];
  const tableRows = [];
  const errors = [];
  for (let page = 1; page <= pageCount; page += 1) {
    try {
      console.log(`[OCR] ${file.name || "file"}: recognizing PDF page ${page}/${pageCount}`);
      const result = await recognizePage(base64, { isPdf: true, page });
      console.log(`[OCR] ${file.name || "file"}: page ${page} returned ${result.text.length} characters`);
      if (result.text.trim()) texts.push(`第${page}页\n${result.text}`);
      tableRows.push(...result.tableRows.map((row) => ({ ...row, sheetName: `OCR第${page}页` })));
    } catch (error) {
      errors.push(`第${page}页：${error.message}`);
      if (page === 1) throw error;
      break;
    }
  }

  if (texts.length) return { text: texts.join("\n\n"), tableRows };
  throw new Error(errors.join("；") || "OCR 未识别到文本");
}

function isPdfFile(file) {
  return (file.name || "").toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

async function recognizePage(imageBase64, { isPdf, page = 1 }) {
  const action = envValue("TENCENT_OCR_ACTION") || "GeneralAccurateOCR";
  const payload = {
    ImageBase64: imageBase64,
    IsPdf: isPdf,
    PdfPageNumber: isPdf ? page : undefined
  };
  if (!isPdf) delete payload.PdfPageNumber;

  const response = await callTencentApi(action, payload);
  const detections = response.TextDetections || [];
  console.log(`[OCR] Tencent ${action}${isPdf ? ` page ${page}` : ""}: ${detections.length} text detections`);
  return {
    text: detections.map((item) => item.DetectedText || "").filter(Boolean).join("\n"),
    tableRows: detectionsToTableRows(detections)
  };
}

function resolvePdfPageCount(file = {}, options = {}) {
  const explicit = Number(options.pageCount || envValue("TENCENT_OCR_PDF_PAGES"));
  if (explicit > 0) return explicit;
  const parsed = Number(file.pageCount || file.pages || options.pdfPages || 0);
  return parsed > 0 ? parsed : 20;
}

function detectionsToTableRows(detections = []) {
  const words = detections
    .map((item) => {
      const polygon = item.Polygon || [];
      const xs = polygon.map((point) => Number(point.X || 0));
      const ys = polygon.map((point) => Number(point.Y || 0));
      return {
        text: String(item.DetectedText || "").trim(),
        x: xs.length ? Math.min(...xs) : 0,
        y: ys.length ? Math.min(...ys) : 0,
        height: ys.length ? Math.max(...ys) - Math.min(...ys) : 12
      };
    })
    .filter((item) => item.text);
  words.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const word of words) {
    const tolerance = Math.max(8, word.height * 0.7);
    const line = lines.find((item) => Math.abs(item.y - word.y) <= tolerance);
    if (line) {
      line.items.push(word);
      line.y = (line.y + word.y) / 2;
    } else {
      lines.push({ y: word.y, items: [word] });
    }
  }

  return lines
    .sort((a, b) => a.y - b.y)
    .map((line) => ({
      cells: line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
    }))
    .filter((row) => row.cells.length);
}

async function callTencentApi(action, payload) {
  const region = envValue("TENCENT_OCR_REGION") || "ap-guangzhou";
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const headers = signRequest({
    action,
    body,
    region,
    timestamp,
    secretId: envValue("TENCENT_SECRET_ID"),
    secretKey: envValue("TENCENT_SECRET_KEY")
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

function envValue(key) {
  return String(process.env[key] || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

let credentialShapeLogged = false;

function logTencentOcrCredentialShape() {
  if (credentialShapeLogged) return;
  credentialShapeLogged = true;
  const secretId = envValue("TENCENT_SECRET_ID");
  const secretKey = envValue("TENCENT_SECRET_KEY");
  console.log(`[OCR] Tencent credentials loaded: SecretId=${maskSecretId(secretId)}, SecretKeyLength=${secretKey.length}`);
}

function maskSecretId(value) {
  if (!value) return "empty";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
