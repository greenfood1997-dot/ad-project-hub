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

async function api(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  const payload = res.json();
  if (res.statusCode >= 400 || payload.ok === false) {
    throw new Error(`${method} ${path} failed: ${payload.error || res.statusCode}`);
  }
  return payload.data ?? payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行同事", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
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
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行同事", role: "member", department: "执行部", project: "AI助手项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-ai-1",
      name: "AI助手项目",
      client: "测试客户",
      owner: "管理员",
      pm: "管理员",
      sales: "销售",
      status: "执行中",
      progress: 48,
      contract: 100000,
      paid: 30000,
      receivable: 70000,
      costUsed: 20000,
      extractedFields: {
        pettyCashBudget: 3000,
        pettyCashUsed: 1200
      },
      costs: [["交通", 1200]]
    },
    {
      id: "p-ai-hidden",
      name: "隐藏管理项目",
      client: "隐藏客户",
      owner: "别人",
      pm: "别人",
      sales: "别人",
      status: "执行中",
      progress: 10,
      contract: 900000,
      paid: 0,
      receivable: 900000,
      costUsed: 10000
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

  const petty = await api("POST", "/api/ai/assistant", "u-member", {
    query: "我的项目备用金还有多少？",
    selectedProjectId: "p-ai-1"
  });
  assert(/剩余/.test(petty.reply) && /1,800/.test(petty.reply), "AI 助手应基于自己项目回答备用金余额");

  const reimbursement = await api("POST", "/api/ai/assistant", "u-member", {
    query: "帮我提交500元报销到AI助手项目",
    selectedProjectId: "p-ai-1"
  });
  assert(reimbursement.action === "approval-confirmation-required", "AI 助手应先要求确认，不能直接创建报销审批");
  assert(reimbursement.pendingAction?.amount === 500, "AI 待确认动作金额应正确");

  const stateBeforeConfirm = await api("GET", "/api/state", "u-member");
  assert(stateBeforeConfirm.approvals.length === 0, "AI 未确认前不应创建审批");

  const confirmedReimbursement = await api("POST", "/api/ai/assistant", "u-member", {
    query: "帮我提交500元报销到AI助手项目",
    selectedProjectId: "p-ai-1",
    confirmAction: reimbursement.pendingAction
  });
  assert(confirmedReimbursement.action === "approval-created", "用户确认后 AI 助手应创建报销审批");
  assert(confirmedReimbursement.approval?.amount === 500, "AI 创建的审批金额应正确");

  const stateAfter = await api("GET", "/api/state", "u-member");
  assert(stateAfter.approvals.length === 1 && stateAfter.approvals[0].amount === 500, "AI 确认创建审批后员工状态应能看到该审批");

  const denied = await api("POST", "/api/ai/assistant", "u-member", {
    query: "公司现金流安全吗？",
    selectedProjectId: "p-ai-1"
  });
  assert(denied.action === "management-denied" && /管理层/.test(denied.reply), "普通员工问公司现金流应被权限挡住");

  const management = await api("POST", "/api/ai/assistant", "u-finance", {
    query: "公司现金流安全吗？"
  });
  assert(management.action === "management-advice" && /危险！你快倒闭啦！需要收缩现金流/.test(management.reply), "财务应能获得现金流安全线建议");

  const memberProjects = await api("POST", "/api/ai/assistant", "u-member", {
    query: "我的项目有哪些？"
  });
  assert(memberProjects.reply.includes("AI助手项目") && !memberProjects.reply.includes("隐藏管理项目"), "AI 助手项目列表应遵守员工项目范围");

  console.log("ai assistant regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
