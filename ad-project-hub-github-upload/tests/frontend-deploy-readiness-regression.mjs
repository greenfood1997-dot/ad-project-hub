import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deployReadinessActions } from "../src/utils/deployReadiness.js";

const actions = deployReadinessActions({
  version: "old-build",
  renderBuildCommand: false,
  noPrestartBuild: false,
  startOpensPortOnly: false,
  aiEnv: { apiKey: false },
  ocrEnv: { secretId: false, secretKey: false },
  storageMode: "json",
  nodeEnv: "production",
  scheduler: { enabled: false }
}, [], "new-build");

assert.equal(actions.length, 4);
assert.equal(actions[0].title, "先重新部署最新代码");
assert(actions[0].text.includes("页面版本 new-build，服务端版本 old-build"));
assert.equal(actions[1].title, "检查 Render 构建/启动命令");
assert.equal(actions[2].title, "补 AI 环境变量或后台 Key");
assert.equal(actions[3].title, "扫描件上传前先配 OCR");

const databaseAction = deployReadinessActions({
  version: "new-build",
  renderBuildCommand: true,
  noPrestartBuild: true,
  startOpensPortOnly: true,
  aiEnv: { apiKey: true },
  ocrEnv: { secretId: true, secretKey: true },
  storageMode: "json",
  nodeEnv: "production",
  scheduler: { enabled: false }
}, [], "new-build");
assert.equal(databaseAction[0].title, "生产环境建议接 PostgreSQL");
assert.equal(databaseAction[1].title, "需要主动提醒就开启后台巡检");

const ready = deployReadinessActions({
  version: "new-build",
  renderBuildCommand: true,
  noPrestartBuild: true,
  startOpensPortOnly: true,
  aiEnv: { apiKey: true },
  ocrEnv: { secretId: true, secretKey: true },
  databaseUrl: "postgres://example",
  scheduler: { enabled: true }
}, [{ ok: true }, { ok: true }], "new-build");
assert.equal(ready[0].title, "可以进行真实上传测试");

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const adminShellSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
assert(mainSource.includes("productionPersistenceReady") && mainSource.includes("Render 上长期使用必须接 PostgreSQL"), "main health checklist should require production persistence readiness");
assert(adminShellSource.includes("productionPersistenceReady") && adminShellSource.includes("生产数据库已启用 PostgreSQL"), "admin health checklist should require production persistence readiness");
assert(adminShellSource.includes("filePersistenceReady") && adminShellSource.includes("原始文件存储"), "admin health checklist should require original file persistence readiness");
assert(adminShellSource.includes('import { deployReadinessActions } from "./utils/deployReadiness.js";'), "admin shell should import shared deploy readiness helper");
assert(adminShellSource.includes("deployReadinessActions(deployHealth || {}, deployCheckItems, buildVersion)"), "admin shell should pass current build version into deploy readiness helper");
assert(!mainSource.includes("function deployReadinessActions(") && !adminShellSource.includes("function deployReadinessActions("), "frontend should not redefine deployReadinessActions");

console.log("frontend deploy readiness regression passed");
