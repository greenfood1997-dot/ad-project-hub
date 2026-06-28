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
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm", name: "可见项目PM", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-hidden-member", name: "隐藏成员", email: "hidden@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", project: "可见审批项目" },
        { userId: "u-hidden-member", email: "hidden@company.local", name: "隐藏成员", role: "member", project: "隐藏审批项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "可见审批项目", client: "A客户", owner: "可见项目PM", pm: "可见项目PM", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "隐藏审批项目", client: "B客户", owner: "隐藏PM", pm: "隐藏PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  approvals: [],
  suppliers: [],
  payments: [],
  collectionScripts: [],
  clientProfiles: [],
  supplierProfiles: [],
  files: [],
  parseJobs: [],
  comments: [],
  auditLogs: [],
  alertUpdates: [],
  systemNotifications: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const visibleApproval = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-visible",
    type: "reimbursement",
    amount: 300,
    payee: "执行成员",
    reason: "可见项目报销"
  });

  const hiddenApproval = await ok("POST", "/api/approvals", "u-hidden-member", {
    projectId: "p-hidden",
    type: "reimbursement",
    amount: 300,
    payee: "隐藏成员",
    reason: "隐藏项目报销"
  });

  await denied("POST", "/api/approvals/action", "u-pm", {
    id: hiddenApproval.id,
    action: "approve",
    note: "越权处理"
  }, "PM 不应处理不可见项目审批");

  const pmApproved = await ok("POST", "/api/approvals/action", "u-pm", {
    id: visibleApproval.id,
    action: "approve",
    note: "自己项目 PM 确认"
  });
  assert(pmApproved.projectId === "p-visible", "PM 应能处理自己可见项目审批");

  const adminRejected = await ok("POST", "/api/approvals/action", "u-admin", {
    id: hiddenApproval.id,
    action: "reject",
    note: "管理员驳回隐藏项目审批"
  });
  assert(adminRejected.status === "已驳回", "管理员仍应能处理全局审批");

  const state = await ok("GET", "/api/state", "u-admin");
  assert(state.auditLogs.some((item) => item.type === "approval" && item.action === "reject" && item.target === "隐藏审批项目"), "审批处理应写入审计日志");

  console.log("approval action permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
