import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function makeReq(method, path, userId, body = undefined) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url: path,
    headers: {
      "x-user-id": userId,
      "content-type": "application/json"
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    }
  };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    json() {
      const text = Buffer.concat(this.chunks).toString("utf8");
      return text ? JSON.parse(text) : {};
    }
  };
}

async function call(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  return { status: res.statusCode, payload: res.json() };
}

async function ok(method, path, userId, body) {
  const result = await call(method, path, userId, body);
  if (result.status >= 400 || result.payload.ok === false) {
    throw new Error(`${method} ${path} failed: ${result.payload.error || result.status}`);
  }
  return result.payload.data ?? result.payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const daysLater = (days) => new Date(now.getTime() + days * 86400000).toISOString();

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    companyFinance: {
      currentCash: "100000",
      monthlyLaborCost: "50000",
      monthlyRent: "10000",
      monthlyLoan: "5000",
      monthlyInterest: "1000",
      monthlyOtherCost: "4000"
    },
    members: { items: [{ userId: "u-member", email: "member@company.local", name: "执行", project: "滞后项目" }] }
  },
  projects: [
    {
      id: "p-unassigned",
      name: "待分派项目",
      owner: "待分派",
      pm: "待分派",
      status: "AI解析中",
      createdAt: daysAgo(2),
      contract: 100000,
      paid: 0,
      receivable: 100000,
      progress: 10,
      extractedFields: { revenueRecognition: { quoteRules: [{ serviceName: "视频", amount: 100000 }] } }
    },
    {
      id: "p-lag",
      name: "滞后项目",
      owner: "管理员",
      pm: "管理员",
      sales: "销售",
      status: "执行中",
      startDate: daysAgo(20),
      endDate: daysLater(10),
      contract: 200000,
      paid: 20000,
      receivable: 180000,
      paymentDue: "本月底回款",
      progress: 20
    },
    {
      id: "p-ok",
      name: "正常项目",
      owner: "管理员",
      pm: "管理员",
      status: "执行中",
      startDate: daysAgo(3),
      endDate: daysLater(30),
      contract: 10000,
      paid: 10000,
      receivable: 0,
      progress: 30
    }
  ],
  approvals: [],
  payments: [],
  collectionScripts: [],
  suppliers: [],
  clientProfiles: [],
  supplierProfiles: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [],
  systemNotifications: [],
  files: [],
  parseJobs: [],
  comments: [],
  alertUpdates: [],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(baseDb, null, 2));

  const denied = await call("POST", "/api/system/scan", "u-member", {});
  assert(denied.status === 403 || denied.payload.ok === false, "普通员工不能手动触发全局扫描");

  const scan = await ok("POST", "/api/system/scan", "u-admin", {});
  const types = new Set(scan.notifications.map((item) => item.type));
  assert(types.has("project-assignment"), "扫描应生成待分派提醒");
  assert(types.has("project-progress-lag"), "扫描应生成进度滞后提醒");
  assert(types.has("project-receivable-risk"), "扫描应生成回款跟进提醒");
  assert(types.has("company-cash-runway"), "扫描应生成现金流安全线提醒");
  assert(scan.notifications.some((item) => /危险！你快倒闭啦/.test(item.title)), "现金流少于3个月时应使用危险文案");

  const state = await ok("GET", "/api/state", "u-admin");
  assert(state.systemNotifications.length >= 4, "扫描结果应进入 /api/state 待办");

  const financeState = await ok("GET", "/api/state", "u-finance");
  assert(financeState.systemNotifications.some((item) => item.type === "company-cash-runway"), "财务应看到现金流提醒");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.systemNotifications.every((item) => item.projectName === "滞后项目" || item.projectId === "p-lag"), "员工只应看到自己项目相关提醒");

  console.log("system scan regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
