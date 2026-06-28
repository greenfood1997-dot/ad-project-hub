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
    text() {
      return Buffer.concat(this.chunks).toString("utf8");
    },
    json() {
      const text = this.text();
      return text ? JSON.parse(text) : {};
    }
  };
}

async function call(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  const text = res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }
  return { status: res.statusCode, headers: res.headers, payload };
}

async function ok(method, path, userId, body) {
  const result = await call(method, path, userId, body);
  if (result.status >= 400 || result.payload?.ok === false) {
    throw new Error(`${method} ${path} as ${userId} failed: ${result.payload?.error || result.status}`);
  }
  return result.payload?.data ?? result.payload;
}

async function denied(method, path, userId, body, message) {
  const result = await call(method, path, userId, body);
  if (result.status < 400 && result.payload?.ok !== false) {
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
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "无关成员", email: "outsider@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", project: "可见供应商项目" },
        { userId: "u-outsider", email: "outsider@company.local", name: "无关成员", role: "member", project: "隐藏供应商项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "可见供应商项目", client: "可见客户", owner: "项目经理", pm: "项目经理", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "隐藏供应商项目", client: "隐藏客户", owner: "其他PM", pm: "其他PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  suppliers: [
    { id: "s-visible", project: "可见供应商项目", supplier: "可见制作供应商", type: "制作", amount: 1000, status: "待结算" },
    { id: "s-hidden", project: "隐藏供应商项目", supplier: "隐藏投放供应商", type: "投放", amount: 9000, status: "待结算" }
  ],
  supplierProfiles: [
    { supplier: "可见制作供应商", market: "制作", ratings: [], updatedAt: "" },
    { supplier: "隐藏投放供应商", market: "投放", ratings: [], updatedAt: "" }
  ],
  clientProfiles: [],
  approvals: [],
  payments: [],
  collectionScripts: [],
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

  const memberSuppliers = await ok("GET", "/api/suppliers", "u-member");
  assert(memberSuppliers.some((item) => item.supplier === "可见制作供应商"), "成员应能看到自己项目供应商");
  assert(memberSuppliers.every((item) => item.supplier !== "隐藏投放供应商"), "成员不应看到隐藏供应商画像");

  const memberExport = await call("GET", "/api/suppliers/export", "u-member");
  assert(memberExport.status === 200, "成员应能导出自己范围内供应商 CSV");
  assert(String(memberExport.payload).includes("可见制作供应商"), "成员导出应包含可见供应商");
  assert(!String(memberExport.payload).includes("隐藏投放供应商"), "成员导出不应泄露隐藏供应商");

  const rated = await ok("POST", "/api/suppliers/rate", "u-member", {
    supplier: "可见制作供应商",
    score: 5,
    market: "制作",
    comment: "配合稳定"
  });
  assert(rated.averageRating === 5, "成员应能评价自己项目供应商");

  await denied("POST", "/api/suppliers/rate", "u-member", {
    supplier: "隐藏投放供应商",
    score: 5,
    comment: "越权评价"
  }, "成员不应评价隐藏供应商");

  const clientProfile = await ok("POST", "/api/clients/profile", "u-member", {
    client: "可见客户",
    likes: "真实场景",
    pitfalls: "不要空概念"
  });
  assert(clientProfile.client === "可见客户" && clientProfile.likes.includes("真实场景"), "成员应能维护自己项目客户偏好");

  await denied("POST", "/api/clients/profile", "u-member", {
    client: "隐藏客户",
    likes: "越权"
  }, "成员不应维护隐藏客户档案");

  const adminExport = await call("GET", "/api/suppliers/export", "u-admin");
  assert(String(adminExport.payload).includes("可见制作供应商") && String(adminExport.payload).includes("隐藏投放供应商"), "管理员导出应包含全量供应商");

  console.log("supplier client permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
