import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  const payload = res.json();
  return { status: res.statusCode, payload };
}

async function ok(method, path, userId, body) {
  const result = await call(method, path, userId, body);
  if (result.status >= 400 || result.payload.ok === false) {
    throw new Error(`${method} ${path} as ${userId} failed: ${result.payload.error || result.status}`);
  }
  return result.payload.data ?? result.payload;
}

async function denied(method, path, userId, body, message) {
  const result = await call(method, path, userId, body);
  if (result.status < 400 && result.payload.ok !== false) {
    throw new Error(message);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "外部成员", email: "outsider@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", department: "执行部", project: "预警可见项目" },
        { userId: "u-outsider", email: "outsider@company.local", name: "外部成员", role: "member", department: "执行部", project: "预警隐藏项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-alert-visible",
      name: "预警可见项目",
      client: "可见客户",
      owner: "项目经理",
      pm: "项目经理",
      status: "执行中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      progress: 20
    },
    {
      id: "p-alert-hidden",
      name: "预警隐藏项目",
      client: "隐藏客户",
      owner: "外部 PM",
      pm: "外部 PM",
      status: "执行中",
      contract: 50000,
      paid: 0,
      receivable: 50000,
      progress: 10
    }
  ],
  systemNotifications: [
    { id: "n-visible", status: "待处理", projectId: "p-alert-visible", projectName: "预警可见项目", recipients: ["member"], title: "可见项目待办", type: "project-progress-lag" },
    { id: "n-hidden", status: "待处理", projectId: "p-alert-hidden", projectName: "预警隐藏项目", recipients: ["member"], title: "隐藏项目待办", type: "project-progress-lag" },
    { id: "n-company", status: "待处理", recipients: ["finance"], title: "公司现金流待办", type: "company-cash-runway" }
  ],
  alertUpdates: [],
  auditLogs: [],
  approvals: [],
  payments: [],
  suppliers: [],
  clientProfiles: [],
  supplierProfiles: [],
  collectionScripts: [],
  files: [],
  parseJobs: [],
  comments: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.systemNotifications.some((item) => item.id === "n-visible"), "成员应能看到自己项目待办");
  assert(memberState.systemNotifications.every((item) => item.projectId === "p-alert-visible" || item.projectName === "预警可见项目"), "成员只能看到自己项目相关待办");

  const handledVisibleNotice = await ok("POST", "/api/notifications/action", "u-member", {
    id: "n-visible",
    action: "resolve",
    note: "执行已处理"
  });
  assert(handledVisibleNotice.status === "已处理", "成员应能处理自己项目待办");

  await denied("POST", "/api/notifications/action", "u-member", {
    id: "n-hidden",
    action: "resolve"
  }, "成员不能处理隐藏项目待办");

  await denied("POST", "/api/notifications/action", "u-member", {
    id: "n-company",
    action: "resolve"
  }, "普通成员不能处理公司级待办");

  const ownAlert = await ok("POST", "/api/alerts/update", "u-pm", {
    project: "预警可见项目",
    action: "resolve",
    note: "PM 已处理项目预警"
  });
  assert(ownAlert.project === "预警可见项目" && ownAlert.action === "resolve", "PM 应能处理自己可见项目预警");

  await denied("POST", "/api/alerts/update", "u-pm", {
    project: "预警隐藏项目",
    action: "resolve",
    note: "越权处理"
  }, "PM 不能处理不可见项目预警");

  await denied("POST", "/api/alerts/update", "u-member", {
    project: "预警可见项目",
    action: "resolve"
  }, "普通成员没有处理预警接口角色权限");

  await denied("POST", "/api/alerts/update", "u-pm", {
    action: "resolve",
    note: "公司级预警"
  }, "PM 不能处理公司级预警");

  const companyAlert = await ok("POST", "/api/alerts/update", "u-finance", {
    action: "resolve",
    note: "财务已处理现金流提醒"
  });
  assert(companyAlert.action === "resolve" && !companyAlert.project, "财务应能处理公司级预警");

  const adminState = await ok("GET", "/api/state", "u-admin");
  assert(adminState.alertUpdates.some((item) => item.project === "预警可见项目"), "项目预警处理应进入记录");
  assert(adminState.alertUpdates.some((item) => item.note === "财务已处理现金流提醒"), "公司级预警处理应进入记录");
  assert(adminState.auditLogs.some((item) => item.type === "notification" && item.target === "可见项目待办"), "待办处理应进入审计日志");
  assert(adminState.auditLogs.some((item) => item.type === "alert" && item.target === "预警可见项目"), "项目预警处理应进入审计日志");

  console.log("alert notification permission regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
