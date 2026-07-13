import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function request() {
  return {
    method: "GET",
    url: "/api/state",
    headers: { "x-user-id": "u-admin" },
    async *[Symbol.asyncIterator]() {}
  };
}

function response() {
  return {
    statusCode: 0,
    writeHead(status) { this.statusCode = status; },
    end() {}
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await writeFile(dbFile, JSON.stringify({
    users: [{ id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", status: "active", pin: "123456" }],
    settings: {}, projects: [], clientProfiles: [], suppliers: [], supplierProfiles: [], approvals: [], payments: [],
    collectionScripts: [], feishuEvents: [], feishuProjectBindings: [], feishuPendingFiles: [], systemNotifications: [],
    files: [], parseJobs: [], alertUpdates: [], comments: [], auditLogs: []
  }, null, 2));

  await handleApi(request(), response());
  const once = JSON.parse(await readFile(dbFile, "utf8"));
  await handleApi(request(), response());
  const twice = JSON.parse(await readFile(dbFile, "utf8"));

  assert(once.auditLogs.length === 1, "首次打开状态页应执行一次系统巡检");
  assert(twice.auditLogs.length === once.auditLogs.length, "短时间内重复刷新状态页不应重复巡检和写库");
  console.log("state scan cooldown regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
