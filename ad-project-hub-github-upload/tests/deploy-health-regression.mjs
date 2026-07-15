import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const scheduler = await readFile(new URL("../server/scheduler.mjs", import.meta.url), "utf8");
const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const render = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(api.includes("function deployHealthPayload()"), "/api/health should use a deploy health payload helper");
assert(api.includes("noPrestartBuild: true"), "health payload should confirm prestart build is not used");
assert(api.includes('rootDirectory: "ad-project-hub-github-upload"'), "health payload should expose the required Render root directory");
assert(api.includes('buildCommand: "npm install && npm run build"'), "health payload should expose the required Render build command");
assert(api.includes('startCommand: "npm start"'), "health payload should expose the required Render start command");
assert(api.includes("AI_API_KEY") && api.includes("AI_BASE_URL") && api.includes("AI_MODEL"), "health payload should expose AI env presence");
assert(api.includes("TENCENT_SECRET_ID") && api.includes("TENCENT_SECRET_KEY") && api.includes("TENCENT_OCR_REGION"), "health payload should expose Tencent OCR env presence");
assert(api.includes('databaseUrl: envConfigured("DATABASE_URL")'), "health payload should expose whether DATABASE_URL is configured without leaking the value");
assert(api.includes("deployedCommit: process.env.RENDER_GIT_COMMIT"), "health payload should expose the Render deployed commit when available");
assert(api.includes("const storageMode = dbMode()") && api.includes("storageMode,"), "health payload should expose the resolved storage mode for deployment diagnosis");
assert(api.includes("productionPersistenceReady: storageMode === \"postgres\" && envConfigured(\"DATABASE_URL\")"), "health payload should expose an explicit production persistence readiness flag");
assert(api.includes("objectStorageConfigured") && api.includes("filePersistenceReady"), "health payload should expose original file persistence readiness");
assert(api.includes("scheduler: getSchedulerStatus()"), "health payload should expose background scheduler status");
assert(server.includes("startSystemScheduler()"), "server startup should start the system scheduler");
assert(scheduler.includes("setInterval(runScheduledScan") && scheduler.includes("scanSystemNotifications"), "scheduler should run system scans on an interval");
assert(scheduler.includes("status.running") && scheduler.includes("SYSTEM_SCAN_INTERVAL_MS") && scheduler.includes("SYSTEM_SCAN_DISABLED"), "scheduler should prevent overlapping scans and support env controls");
assert(scheduler.includes("export async function reloadSystemScheduler()") && scheduler.includes("clearInterval(timer)") && api.includes("reloadSystemScheduler"), "saving scheduler-related settings should reload the live scheduler");
assert(api.includes('["product", "scheduler"].includes(body.type)') && api.includes("scheduler }"), "settings API should return refreshed scheduler status after product/scheduler settings save");
assert(api.includes("restoreBackupSnapshot(db, body") && api.includes("const scheduler = await reloadSystemScheduler()") && api.includes("data: { ...data, scheduler }"), "backup restore should reload and return the live scheduler status");
assert(source.includes("DeployHealthPanel") && source.includes("const deployCheckItems = ["), "frontend should render the deploy health checklist");
assert(source.includes("后台定时巡检") && source.includes("自动巡检间隔毫秒") && source.includes("关闭自动巡检"), "frontend should expose scheduler health and product settings");
assert(!pkg.scripts.prestart, "package.json must not define prestart for Render");
assert(pkg.scripts.start === "node server.mjs", "npm start should open the Node server only");
assert(render.includes("buildCommand: npm install && npm run build"), "render.yaml should use the single Render build command");
assert(render.includes("startCommand: npm start"), "render.yaml should start with npm start");

console.log("deploy health regression passed");
