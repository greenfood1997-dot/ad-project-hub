const IDEMPOTENT_PATHS = new Set(["/api/payments", "/api/approvals", "/api/projects/cost-sheet"]);
const idempotencyKeys = new Map();

function financialIdempotencyKey(path, session, options = {}) {
  if (String(options.method || "GET").toUpperCase() !== "POST" || !IDEMPOTENT_PATHS.has(path)) return "";
  const fingerprint = `${session.id || "anonymous"}:${path}:${String(options.body || "")}`;
  const now = Date.now();
  const existing = idempotencyKeys.get(fingerprint);
  if (existing && now - existing.createdAt < 30000) return existing.key;
  const key = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
  idempotencyKeys.set(fingerprint, { key, createdAt: now });
  if (idempotencyKeys.size > 100) {
    for (const [item, value] of idempotencyKeys) if (now - value.createdAt >= 30000) idempotencyKeys.delete(item);
  }
  return key;
}

export async function apiRequest(path, session, options = {}) {
  const idempotencyKey = financialIdempotencyKey(path, session, options);
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token || ""}`,
      "x-user-id": session.id,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await res.json();
  if (!payload.ok) {
    const error = new Error(payload.error || "请求失败");
    error.data = payload.data;
    throw error;
  }
  return payload.data;
}

export async function downloadFile(path, session, filename) {
  const res = await fetch(path, {
    headers: {
      authorization: `Bearer ${session.token || ""}`,
      "x-user-id": session.id,
    },
  });
  if (!res.ok) throw new Error("导出失败，请稍后再试");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        name: file.name,
        size: file.size,
        type: file.type,
        base64: dataUrl.split(",")[1] || "",
      });
    };
    reader.onerror = () => reject(new Error("文件读取失败，请重试"));
    reader.readAsDataURL(file);
  });
}

export function uploadedFileKey(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.type || ""}`;
}
