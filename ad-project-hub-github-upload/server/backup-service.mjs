import { arrayCount } from "./service-utils.mjs";

function redactSecretValue(value) {
  if (value === null || value === undefined || value === "") return value;
  return "[已脱敏]";
}

function redactSettingsForBackup(settings = {}) {
  const clone = JSON.parse(JSON.stringify(settings || {}));
  const secretKeys = new Set([
    "API Key",
    "apiKey",
    "appSecret",
    "app_secret",
    "secret",
    "Secret",
    "secretAccessKey",
    "accessKeySecret",
    "tenantAccessToken",
    "verificationToken",
    "webhookUrl",
    "mockFileBase64"
  ]);
  function walk(target) {
    if (!target || typeof target !== "object") return;
    for (const [key, value] of Object.entries(target)) {
      if (secretKeys.has(key) || /secret|token|key|webhook/i.test(key)) {
        target[key] = redactSecretValue(value);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  }
  walk(clone);
  return clone;
}

const BACKUP_FILE_PAYLOAD_KEYS = new Set([
  "base64",
  "dataUrl",
  "buffer",
  "binary",
  "bytes",
  "mockFileBase64"
]);

function sanitizeBackupData(value) {
  if (Array.isArray(value)) return value.map(sanitizeBackupData);
  if (!value || typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (BACKUP_FILE_PAYLOAD_KEYS.has(key)) continue;
    safe[key] = sanitizeBackupData(item);
  }
  return safe;
}

export function exportBackupSnapshot(db, user) {
  const safeUsers = (db.users || []).map((item) => {
    const { pin, pinHash, ...rest } = item;
    return rest;
  });
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: { id: user.id, name: user.name, role: user.role },
    app: "ad-project-hub",
    format: "safe-backup-v1",
    counts: {
      users: safeUsers.length,
      projects: (db.projects || []).length,
      approvals: (db.approvals || []).length,
      payments: (db.payments || []).length,
      suppliers: (db.suppliers || []).length,
      files: (db.files || []).length,
      parseJobs: (db.parseJobs || []).length,
      notifications: (db.systemNotifications || []).length
    },
    data: {
      users: safeUsers,
      projects: sanitizeBackupData(db.projects || []),
      approvals: sanitizeBackupData(db.approvals || []),
      payments: sanitizeBackupData(db.payments || []),
      suppliers: sanitizeBackupData(db.suppliers || []),
      supplierProfiles: sanitizeBackupData(db.supplierProfiles || []),
      clientProfiles: sanitizeBackupData(db.clientProfiles || []),
      collectionScripts: sanitizeBackupData(db.collectionScripts || []),
      files: sanitizeBackupData(db.files || []),
      parseJobs: sanitizeBackupData(db.parseJobs || []),
      comments: sanitizeBackupData(db.comments || []),
      alertUpdates: sanitizeBackupData(db.alertUpdates || []),
      systemNotifications: sanitizeBackupData(db.systemNotifications || []),
      feishuProjectBindings: sanitizeBackupData(db.feishuProjectBindings || []),
      feishuEvents: sanitizeBackupData(db.feishuEvents || []),
      feishuPendingFiles: sanitizeBackupData(db.feishuPendingFiles || []),
      auditLogs: sanitizeBackupData(db.auditLogs || []),
      settings: redactSettingsForBackup(db.settings || {})
    }
  };
}

const BACKUP_COLLECTIONS = [
  "users",
  "projects",
  "approvals",
  "payments",
  "suppliers",
  "supplierProfiles",
  "clientProfiles",
  "collectionScripts",
  "files",
  "parseJobs",
  "comments",
  "alertUpdates",
  "systemNotifications",
  "feishuProjectBindings",
  "feishuEvents",
  "feishuPendingFiles",
  "auditLogs"
];

const BACKUP_DIFF_LABELS = {
  users: "成员",
  projects: "项目",
  approvals: "审批",
  payments: "回款",
  suppliers: "供应商结算",
  supplierProfiles: "供应商档案",
  clientProfiles: "客户档案",
  collectionScripts: "催收话术",
  files: "文件批次",
  parseJobs: "解析任务",
  comments: "评论",
  alertUpdates: "预警处理",
  systemNotifications: "系统待办",
  feishuProjectBindings: "飞书群绑定",
  feishuEvents: "飞书事件",
  feishuPendingFiles: "飞书待确认文件",
  auditLogs: "审计日志"
};

function backupRestoreDiff(currentCounts = {}, backupCounts = {}) {
  const items = BACKUP_COLLECTIONS.map((key) => {
    const current = Number(currentCounts[key] || 0);
    const backup = Number(backupCounts[key] || 0);
    const delta = backup - current;
    return {
      key,
      label: BACKUP_DIFF_LABELS[key] || key,
      current,
      backup,
      delta,
      direction: delta > 0 ? "increase" : delta < 0 ? "decrease" : "same"
    };
  });
  const changed = items.filter((item) => item.delta !== 0);
  return {
    items,
    changed,
    changedCount: changed.length,
    increases: changed.filter((item) => item.delta > 0).length,
    decreases: changed.filter((item) => item.delta < 0).length,
    summary: changed.length
      ? changed.slice(0, 5).map((item) => `${item.label}${item.delta > 0 ? "+" : ""}${item.delta}`).join("，")
      : "备份数量与当前 OA 基本一致"
  };
}

function parseBackupInput(body = {}) {
  const source = body.backup ?? body.text ?? body.json ?? body;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) throw new Error("请粘贴备份 JSON 后再校验");
    return JSON.parse(trimmed);
  }
  if (source && typeof source === "object") return source;
  throw new Error("请粘贴备份 JSON 后再校验");
}

export function validateBackupSnapshot(db, body = {}, user = {}) {
  let backup;
  try {
    backup = parseBackupInput(body);
  } catch {
    return {
      ok: false,
      dryRunOnly: true,
      error: "备份 JSON 格式无法解析，请确认粘贴的是完整导出的 .json 文件。",
      warnings: ["本次只是校验，不会写入或恢复任何 OA 数据。"]
    };
  }

  const warnings = ["本次只是校验/恢复预演，不会写入、覆盖或恢复任何 OA 数据。"];
  const data = backup?.data && typeof backup.data === "object" ? backup.data : {};
  const counts = {};
  const currentCounts = {};
  for (const key of BACKUP_COLLECTIONS) {
    counts[key] = arrayCount(data[key]);
    currentCounts[key] = arrayCount(db[key]);
    if (!Array.isArray(data[key])) warnings.push(`备份缺少 ${key} 列表，后续不能直接用于完整恢复。`);
  }

  const expectedCounts = backup?.counts && typeof backup.counts === "object" ? backup.counts : {};
  for (const [key, expected] of Object.entries(expectedCounts)) {
    const mappedKey = key === "notifications" ? "systemNotifications" : key;
    if (mappedKey in counts && Number(expected) !== counts[mappedKey]) {
      warnings.push(`${key} 数量与备份 counts 不一致：counts=${expected}，实际=${counts[mappedKey]}。`);
    }
  }

  const settingsText = JSON.stringify(data.settings || {});
  if (/cli_mock_secret|123456|sk-|AKIA|secretAccessKey|webhook/i.test(settingsText) && !settingsText.includes("[已脱敏]")) {
    warnings.push("备份设置里可能包含未脱敏密钥，请不要直接分享或上传到公开仓库。");
  }
  if (!backup?.exportedAt) warnings.push("备份缺少导出时间 exportedAt。");
  if (!backup?.exportedBy?.name) warnings.push("备份缺少导出人信息 exportedBy。");

  const ok = backup?.format === "safe-backup-v1" && Array.isArray(data.projects);
  if (backup?.format !== "safe-backup-v1") warnings.push("备份版本不是 safe-backup-v1，暂不建议用于恢复。");
  if (!Array.isArray(data.projects)) warnings.push("备份缺少 projects 项目列表。");
  const diff = backupRestoreDiff(currentCounts, counts);

  return {
    ok,
    dryRunOnly: true,
    canRestoreLater: ok,
    format: backup?.format || "",
    exportedAt: backup?.exportedAt || "",
    exportedBy: backup?.exportedBy || null,
    checkedAt: new Date().toISOString(),
    checkedBy: { id: user.id, name: user.name, role: user.role },
    counts,
    currentCounts,
    diff,
    warnings
  };
}

function mergeRestoredUsers(currentUsers = [], backupUsers = []) {
  const currentById = new Map((currentUsers || []).map((item) => [item.id, item]));
  const restoredIds = new Set();
  const restored = (backupUsers || []).map((item) => {
    const { pin: ignoredPin, pinHash: ignoredPinHash, ...safeItem } = item || {};
    const current = currentById.get(safeItem.id);
    restoredIds.add(safeItem.id);
    if (!current) {
      return { ...safeItem, status: "disabled", mustChangePin: true };
    }
    const auth = {};
    if (current.pinHash) auth.pinHash = current.pinHash;
    else if (current.pin) auth.pin = current.pin;
    return {
      ...safeItem,
      ...auth,
      status: current.status || safeItem.status || "active",
      mustChangePin: Boolean(current.mustChangePin)
    };
  });
  for (const current of currentUsers || []) {
    if (!restoredIds.has(current.id)) restored.push({ ...current });
  }
  return restored;
}

function restoreSettingValue(currentValue, backupValue) {
  if (backupValue === "[已脱敏]") return currentValue;
  if (Array.isArray(backupValue)) return backupValue.map((item, index) => restoreSettingValue(currentValue?.[index], item));
  if (backupValue && typeof backupValue === "object") {
    const merged = { ...(currentValue && typeof currentValue === "object" ? currentValue : {}) };
    for (const [key, value] of Object.entries(backupValue)) {
      merged[key] = restoreSettingValue(merged[key], value);
    }
    return merged;
  }
  return backupValue;
}

function mergeRestoredSettings(currentSettings = {}, backupSettings = {}) {
  const restored = { ...(currentSettings || {}) };
  for (const [key, value] of Object.entries(backupSettings || {})) {
    restored[key] = restoreSettingValue(restored[key], value);
  }
  return restored;
}

export function restoreBackupSnapshot(db, body = {}, user = {}) {
  const confirmText = String(body.confirmText || body.confirm || "").trim();
  if (confirmText !== "确认恢复OA备份") throw new Error("请输入确认恢复OA备份，系统才会执行恢复。");
  const backup = parseBackupInput(body);
  const validation = validateBackupSnapshot(db, backup, user);
  if (!validation.ok) throw new Error(validation.error || "备份校验未通过，不能恢复。");
  const data = backup.data || {};
  const beforeCounts = {};
  const afterCounts = {};
  for (const key of BACKUP_COLLECTIONS) beforeCounts[key] = arrayCount(db[key]);

  db.users = mergeRestoredUsers(db.users || [], data.users || []);
  for (const key of BACKUP_COLLECTIONS.filter((item) => item !== "users" && item !== "auditLogs")) {
    db[key] = Array.isArray(data[key]) ? data[key] : [];
  }
  db.settings = mergeRestoredSettings(db.settings || {}, data.settings || {});
  db.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];

  const at = new Date().toISOString();
  db.auditLogs.unshift({
    type: "backup",
    target: "safe-backup-v1",
    action: "restore",
    user: user.name,
    meta: {
      restoredBy: user.id,
      exportedAt: backup.exportedAt || "",
      exportedBy: backup.exportedBy || null,
      beforeCounts,
      backupCounts: validation.counts,
      diff: validation.diff
    },
    at
  });

  for (const key of BACKUP_COLLECTIONS) afterCounts[key] = arrayCount(db[key]);
  return {
    ok: true,
    restored: true,
    restoredAt: at,
    restoredBy: { id: user.id, name: user.name, role: user.role },
    format: backup.format,
    exportedAt: backup.exportedAt || "",
    exportedBy: backup.exportedBy || null,
    counts: afterCounts,
    beforeCounts,
    diff: backupRestoreDiff(beforeCounts, afterCounts),
    warnings: [
      "恢复已完成。出于安全原因，备份里的 PIN、API Key、Webhook、Secret 等脱敏字段不会凭空恢复；系统会保留当前环境已有密钥。",
      ...validation.warnings.filter((item) => !/不会写入|不会恢复|不会覆盖/.test(item))
    ]
  };
}
