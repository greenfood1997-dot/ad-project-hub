import { mutateDb, readDb } from "./db.mjs";
import { scanSystemNotifications } from "./services.mjs";
import { purgeExpiredCloudRecycleBin } from "./cloud-recycle-service.mjs";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

const status = {
  enabled: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  running: false,
  lastRunAt: "",
  lastFinishedAt: "",
  lastError: "",
  runCount: 0,
  activeNotifications: 0
};

let timer = null;

function configuredInterval(settings = {}) {
  const raw = Number(process.env.SYSTEM_SCAN_INTERVAL_MS || settings.scheduler?.systemScanIntervalMs || settings.product?.systemScanIntervalMs || settings.product?.["自动巡检间隔毫秒"] || DEFAULT_INTERVAL_MS);
  return Math.max(MIN_INTERVAL_MS, Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS);
}

function schedulerDisabled(settings = {}) {
  const value = process.env.SYSTEM_SCAN_DISABLED ?? settings.scheduler?.systemScanDisabled ?? settings.product?.systemScanDisabled ?? settings.product?.["关闭自动巡检"];
  return value === true || value === "true" || value === "1";
}

async function runScheduledScan() {
  if (status.running || !status.enabled) return;
  status.running = true;
  status.lastRunAt = new Date().toISOString();
  try {
    const result = await mutateDb(async (db) => ({
      notifications: scanSystemNotifications(db, { id: "system-scheduler", name: "后台定时巡检" }),
      recycle: await purgeExpiredCloudRecycleBin(db)
    }));
    status.activeNotifications = (result.notifications || []).filter((item) => item.status === "待处理").length;
    status.recycle = result.recycle;
    status.runCount += 1;
    status.lastError = "";
  } catch (error) {
    status.lastError = error.message;
  } finally {
    status.running = false;
    status.lastFinishedAt = new Date().toISOString();
  }
}

export async function startSystemScheduler() {
  const db = await readDb().catch(() => ({ settings: {} }));
  const settings = db.settings || {};
  status.intervalMs = configuredInterval(settings);
  status.enabled = !schedulerDisabled(settings);
  if (!status.enabled || timer) return getSchedulerStatus();
  timer = setInterval(runScheduledScan, status.intervalMs);
  timer.unref?.();
  setTimeout(runScheduledScan, 2500).unref?.();
  return getSchedulerStatus();
}

export async function reloadSystemScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return startSystemScheduler();
}

export function getSchedulerStatus() {
  return { ...status };
}
