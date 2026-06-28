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
  let result;
  try {
    result = await call(method, path, userId, body);
  } catch (error) {
    return { status: 500, payload: { ok: false, error: error.message } };
  }
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
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "外部成员", email: "outsider@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", department: "执行部", project: "动态测试项目" },
        { userId: "u-outsider", email: "outsider@company.local", name: "外部成员", role: "member", department: "执行部", project: "隐藏动态项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-activity",
      name: "动态测试项目",
      client: "动态客户",
      owner: "项目经理",
      pm: "项目经理",
      status: "执行中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      progress: 20,
      tasks: []
    },
    {
      id: "p-hidden-activity",
      name: "隐藏动态项目",
      client: "隐藏客户",
      owner: "外部 PM",
      pm: "外部 PM",
      status: "执行中",
      contract: 50000,
      paid: 0,
      receivable: 50000,
      progress: 10,
      tasks: []
    }
  ],
  comments: [
    { project: "隐藏动态项目", body: "隐藏项目评论", user: "外部成员", at: "2026-06-27T00:00:00.000Z" }
  ],
  auditLogs: [
    { type: "settings", target: "feishu", action: "update-secret", user: "管理员", at: "2026-06-27T00:00:00.000Z" },
    { type: "payment", target: "隐藏动态项目", action: "record", user: "外部成员", at: "2026-06-27T00:01:00.000Z" }
  ],
  approvals: [],
  payments: [],
  suppliers: [],
  clientProfiles: [],
  supplierProfiles: [],
  collectionScripts: [],
  files: [],
  parseJobs: [],
  alertUpdates: [],
  systemNotifications: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const comment = await ok("POST", "/api/comments", "u-member", {
    project: "动态测试项目",
    body: "客户已确认脚本方向，明天补报价附件"
  });
  assert(comment.body.includes("客户已确认脚本方向"), "成员应能记录自己项目动态");

  const task = await ok("POST", "/api/project-tasks", "u-member", {
    projectId: "p-activity",
    title: "补齐报价附件",
    owner: "执行成员",
    progress: 40,
    note: "客户确认后补附件"
  });
  assert(task.task?.title === "补齐报价附件", "任务动作应产生项目审计日志");

  const payment = await ok("POST", "/api/payments", "u-pm", {
    projectId: "p-activity",
    amount: 1000,
    payer: "动态客户",
    method: "银行转账",
    note: "首期款"
  });
  assert(payment.payment?.amount === 1000, "回款动作应产生项目审计日志");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.projects.length === 1 && memberState.projects[0].id === "p-activity", "成员只能看到自己项目");
  assert(memberState.comments.some((item) => item.project === "动态测试项目" && item.body.includes("客户已确认")), "成员应能看到自己项目评论");
  assert(memberState.comments.every((item) => item.project === "动态测试项目"), "成员不能看到隐藏项目评论");
  assert(memberState.auditLogs.some((item) => item.type === "comment" && item.target === "动态测试项目"), "成员应看到自己项目评论审计日志");
  assert(memberState.auditLogs.some((item) => item.type === "task" && item.target === "动态测试项目"), "成员应看到自己项目任务审计日志");
  assert(memberState.auditLogs.some((item) => item.type === "payment" && item.target === "动态测试项目"), "成员应看到自己项目回款审计日志");
  assert(memberState.auditLogs.every((item) => item.target === "动态测试项目" || item.projectName === "动态测试项目" || item.projectId === "p-activity"), "成员审计日志必须限制在自己项目内");
  assert(!memberState.auditLogs.some((item) => item.type === "settings"), "成员不应看到后台设置审计日志");

  await denied("POST", "/api/comments", "u-outsider", {
    project: "动态测试项目",
    body: "越权评论"
  }, "无关成员不应记录不可见项目动态");

  const adminState = await ok("GET", "/api/state", "u-admin");
  assert(adminState.comments.some((item) => item.project === "隐藏动态项目"), "管理员应能看到全部项目评论");
  assert(adminState.auditLogs.some((item) => item.type === "settings"), "管理员应能看到后台设置审计日志");

  console.log("project activity audit regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
