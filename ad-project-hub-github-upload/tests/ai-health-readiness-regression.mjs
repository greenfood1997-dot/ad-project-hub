import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deployReadinessActions } from "../src/utils/deployReadiness.js";

const healthyDatabaseAi = deployReadinessActions({
  version: "same",
  renderBuildCommand: true,
  noPrestartBuild: true,
  startOpensPortOnly: true,
  insecureDefaultAccountCount: 0,
  aiEnv: { apiKey: false, databaseConfigured: true },
  ocrEnv: { secretId: true, secretKey: true },
  databaseUrl: true,
  storageMode: "postgres",
  nodeEnv: "production",
  productionPersistenceReady: true,
  filePersistenceReady: true,
  scheduler: { enabled: true }
}, [], "same");

assert.equal(healthyDatabaseAi.some((item) => item.title === "补 AI 环境变量或后台 Key"), false);

const apiSource = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
assert(apiSource.includes('databaseConfigured: Boolean(db.settings?.aiService?.["API Key"])'));
assert(adminSource.includes("aiSettings.configured") && adminSource.includes("Render 兜底未配置"));
assert(!apiSource.includes('"API Key": db.settings?.aiService'), "health endpoint must never expose the stored key");

console.log("AI health readiness regression passed");
