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
    { id: "u-sales", name: "销售成员", email: "sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务成员", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-other-sales", name: "无关销售", email: "other-sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", department: "执行部", project: "回款测试项目" },
        { userId: "u-other-sales", email: "other-sales@company.local", name: "无关销售", role: "sales", department: "销售部", project: "其他项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-payment",
      name: "回款测试项目",
      client: "回款客户",
      owner: "销售成员",
      pm: "项目经理",
      sales: "销售成员",
      status: "执行中",
      risk: "中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      costBudget: 60000,
      costUsed: 30000,
      costs: [["制作", 20000], ["差旅", 10000]],
      extractedFields: {
        revenueRecognition: {
          recognizedRevenue: 90000,
          recognizedUnpaid: 70000,
          verificationRecords: [
            { item: "首期核销", amount: 40000, paymentStatus: "未回款" },
            { item: "二期核销", amount: 50000, paymentStatus: "未回款" }
          ]
        }
      }
    },
    {
      id: "p-other",
      name: "其他项目",
      client: "其他客户",
      owner: "其他人",
      pm: "其他 PM",
      sales: "其他销售",
      status: "执行中",
      contract: 50000,
      paid: 0,
      receivable: 50000
    }
  ],
  payments: [],
  approvals: [],
  suppliers: [],
  clientProfiles: [],
  supplierProfiles: [],
  collectionScripts: [],
  files: [],
  parseJobs: [],
  comments: [],
  alertUpdates: [],
  auditLogs: [],
  systemNotifications: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const firstPayment = await ok("POST", "/api/payments", "u-sales", {
    projectId: "p-payment",
    amount: 30000,
    payer: "回款客户",
    method: "银行转账",
    note: "首期补款"
  });
  assert(firstPayment.payment?.amount === 30000, "销售应能记录自己项目回款");
  assert(firstPayment.project?.paid === 50000, "记录回款后项目已回款应增加");
  assert(firstPayment.project?.receivable === 50000, "记录回款后项目待回款应减少");

  const syncedRevenue = firstPayment.project?.extractedFields?.revenueRecognition;
  assert(syncedRevenue?.recognizedUnpaid === 40000, "回款后核销已确认未回款金额应同步减少");
  assert(syncedRevenue?.verificationRecords?.[0]?.paymentStatus === "已回款", "第一条核销收入应同步为已回款");
  assert(syncedRevenue?.verificationRecords?.[1]?.paymentStatus === "部分回款", "第二条核销收入应同步为部分回款");
  assert(syncedRevenue?.verificationRecords?.[1]?.unpaidAmount === 40000, "第二条核销收入未回款金额应正确计算");

  const stateAfterFirst = await ok("GET", "/api/state", "u-admin");
  const projectAfterFirst = stateAfterFirst.projects.find((item) => item.id === "p-payment");
  assert(projectAfterFirst.paid === 50000 && projectAfterFirst.receivable === 50000, "大盘状态应读到更新后的回款数据");
  assert(stateAfterFirst.payments.length === 1 && stateAfterFirst.payments[0].recordedByName === "销售成员", "回款流水应进入真实台账");
  assert(stateAfterFirst.auditLogs.some((item) => item.type === "payment" && item.target === "回款测试项目"), "回款应写入审计记录");

  const financePayment = await ok("POST", "/api/payments", "u-finance", {
    projectId: "p-payment",
    amount: 10000,
    payer: "回款客户",
    method: "承兑到账",
    note: "财务确认到账"
  });
  assert(financePayment.project?.paid === 60000 && financePayment.project?.receivable === 40000, "财务也应能确认到账并更新项目");

  await denied("POST", "/api/payments", "u-member", {
    projectId: "p-payment",
    amount: 1
  }, "普通执行成员不应记录回款");

  await denied("POST", "/api/payments", "u-other-sales", {
    projectId: "p-payment",
    amount: 1
  }, "无关销售不应给非自己项目记录回款");

  await denied("POST", "/api/payments", "u-sales", {
    projectId: "p-payment",
    amount: 50000
  }, "超过合同金额过多的回款应被拦截");

  console.log("payment ledger regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
