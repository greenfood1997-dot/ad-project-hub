import { nextFileId } from "./service-utils.mjs";

export function validateAiSettings(values, { normalizeAiSettings }) {
  const normalized = normalizeAiSettings(values);
  if (!normalized["API Key"]) throw new Error("请先填写 API Key");
  if (!normalized["Base URL"]) throw new Error("请先填写 Base URL");
  if (!normalized["模型名称"]) throw new Error("请先选择服务商，系统会自动匹配模型名称");
  try {
    new URL(normalized["Base URL"]);
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  return normalized;
}

export async function testAiSettings(values, deps) {
  const normalized = validateAiSettings(values, deps);
  const baseUrl = normalized["Base URL"].replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${normalized["API Key"]}` },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`AI 服务返回 ${res.status}`);
    }
    return {
      provider: normalized["服务商"] || "OpenAI 兼容接口",
      model: normalized["模型名称"] || "",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 服务连接超时，请检查 Base URL 或网络");
    throw new Error(`AI 配置校验失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveSetting(db, type, values, user, deps) {
  if (type === "companyFinance") return saveCompanyFinance(db, values, user, deps);
  const current = db.settings?.[type] || {};
  const safeValues = type === "aiService" && !String(values?.["API Key"] || "").trim()
    ? Object.fromEntries(Object.entries(values || {}).filter(([key]) => key !== "API Key"))
    : values;
  const candidate = type === "aiService" ? { ...current, ...safeValues } : safeValues;
  const checked = type === "aiService" ? await testAiSettings(candidate, deps) : null;
  const normalized = type === "aiService" ? validateAiSettings(candidate, deps) : values;
  const saved = { ...current, ...normalized, connection: checked, savedAt: new Date().toISOString(), savedBy: user.id };
  db.settings[type] = saved;
  db.auditLogs.unshift({ type: "settings", target: type, user: user.name, at: saved.savedAt });
  return saved;
}

export function saveCompanyFinance(db, values = {}, user = {}, deps = {}) {
  db.settings = db.settings || {};
  const current = db.settings.companyFinance || {};
  const number = (key) => Math.max(0, Number(values[key] ?? current[key] ?? 0) || 0);
  const monthlyFixedCost =
    number("monthlyLaborCost") +
    number("monthlyRent") +
    number("monthlyLoan") +
    number("monthlyInterest") +
    number("monthlyOtherCost");
  const currentCash = number("currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置现金流参数"
    : runwayMonths < 3
      ? "危险！你快倒闭啦！需要收缩现金流"
      : runwayMonths < 6
        ? "现金偏紧，需要控制支出并加快回款"
        : "现金安全线达标，可以稳健推进";
  const saved = {
    ...current,
    currentCash,
    monthlyLaborCost: number("monthlyLaborCost"),
    monthlyRent: number("monthlyRent"),
    monthlyLoan: number("monthlyLoan"),
    monthlyInterest: number("monthlyInterest"),
    monthlyOtherCost: number("monthlyOtherCost"),
    monthlyFixedCost,
    safetyReserve,
    runwayMonths,
    gap,
    runwayLabel,
    note: String(values.note || current.note || "").trim(),
    savedAt: new Date().toISOString(),
    savedBy: user.id || "",
    savedByName: user.name || ""
  };
  db.settings.companyFinance = saved;
  db.auditLogs.unshift({
    type: "finance",
    target: "companyFinance",
    action: "save-cash-runway",
    user: user.name,
    at: saved.savedAt,
    meta: {
      monthlyFixedCost,
      currentCash,
      runwayMonths: Number(runwayMonths.toFixed(2)),
      gap
    }
  });
  deps.syncCompanyCashRunwayNotificationAfterSave?.(db, saved, user);
  return saved;
}

export async function refreshInterestRate(db, user) {
  const current = db.settings?.interestRate || {};
  const fetched = await fetchLatestLprRate().catch((error) => ({
    ok: false,
    error: error.message,
    annualRate: Number(current.annualRate || current.fallbackRate || 3.45)
  }));
  const saved = {
    source: "latest_lpr",
    term: "1Y",
    annualRate: fetched.annualRate,
    spread: Number(current.spread || 0),
    fallbackRate: Number(current.fallbackRate || 3.45),
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    status: fetched.ok ? "已刷新" : "使用兜底利率",
    note: fetched.ok
      ? `已从中国货币网匹配 1 年期 LPR：${fetched.annualRate}%`
      : `联网刷新失败，继续使用兜底利率：${fetched.error || "未知错误"}`
  };
  Object.assign(saved, {
    "利率来源": saved.source,
    "年化利率": saved.annualRate,
    "公司加点": saved.spread,
    "兜底利率": saved.fallbackRate
  });
  db.settings.interestRate = saved;
  db.auditLogs.unshift({ type: "settings", target: "interestRate", user: user.name, at: saved.updatedAt });
  return saved;
}

async function fetchLatestLprRate() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://www.chinamoney.com.cn/chinese/bklpr/", {
      headers: { "user-agent": "ad-project-hub/1.0" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`中国货币网返回 ${res.status}`);
    const html = await res.text();
    const annualRate = parseLprRate(html);
    if (!annualRate) throw new Error("未识别到 1 年期 LPR");
    return { ok: true, annualRate };
  } finally {
    clearTimeout(timer);
  }
}

function parseLprRate(text) {
  const compact = String(text || "").replace(/\s+/g, " ");
  const oneYearMatch = compact.match(/1\s*年期[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/i)
    || compact.match(/一年期[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/i);
  if (oneYearMatch) return Number(oneYearMatch[1]);
  const rates = [...compact.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 20);
  return rates[0] || 0;
}

export async function recordFiles(db, body, user, deps = {}) {
  const now = new Date().toISOString();
  const files = await deps.normalizeUploadedFiles(Array.isArray(body.files) ? body.files : [], body.type || body.category || "file", user, now, db.settings?.storage || {});
  const upload = { id: body.id || nextFileId("upload"), files, projectId: body.projectId || "", projectName: body.projectName || "", user: user.name, at: now };
  db.files.unshift(upload);
  db.auditLogs.unshift({ type: "upload", target: upload.projectName || "未命名项目", count: files.length, user: user.name, at: now });
  return upload;
}

export async function testObjectStorage(db, values = {}, user = {}, deps = {}) {
  const now = new Date().toISOString();
  const settings = { ...(db.settings?.storage || {}), ...(values || {}) };
  const fileName = `oa-storage-test-${now.slice(0, 10)}.txt`;
  const content = `ad-project-hub object storage test\n${now}\n`;
  const [file] = await deps.normalizeUploadedFiles([{
    name: fileName,
    type: "text/plain",
    size: Buffer.byteLength(content),
    base64: Buffer.from(content, "utf8").toString("base64")
  }], "storage-test", user, now, settings);
  const ok = Boolean(file.storageUrl || file.localStorageUrl) && !file.storageRemoteError;
  db.auditLogs.unshift({
    type: "settings",
    target: "storage",
    action: "test-object-storage",
    user: user.name,
    at: now,
    meta: {
      ok,
      provider: file.storageProvider || settings.provider || "local",
      storageStatus: file.storageStatus || "",
      storageUrl: file.storageUrl || "",
      localStorageUrl: file.localStorageUrl || "",
      error: file.storageRemoteError || ""
    }
  });
  return {
    ok,
    provider: file.storageProvider || settings.provider || "local",
    storageStatus: file.storageStatus || "",
    storageUrl: file.storageUrl || "",
    localStorageUrl: file.localStorageUrl || "",
    storagePath: file.storagePath || "",
    localStoragePath: file.localStoragePath || "",
    storageRemoteError: file.storageRemoteError || "",
    fileName,
    testedAt: now
  };
}
