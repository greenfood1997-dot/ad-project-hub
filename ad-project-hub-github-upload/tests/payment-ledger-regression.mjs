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
  systemNotifications: [
    {
      id: "notice-receivable-payment",
      type: "project-receivable-risk",
      title: "项目回款需要跟进",
      projectId: "p-payment",
      projectName: "回款测试项目",
      status: "待处理",
      actionView: "project-detail"
    }
  ],
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

  const pendingScript = await ok("POST", "/api/collections/suggest", "u-sales", {
    projectId: "p-payment",
    style: "像微信私聊，先同步再轻轻推进"
  });
  assert(pendingScript.id && pendingScript.success === null, "可先生成一条待复核的催收话术");
  const pendingFollowUpScript = await ok("POST", "/api/collections/suggest", "u-sales", {
    projectId: "p-payment",
    style: "二次跟进测试"
  });
  await ok("POST", "/api/collections/outcome", "u-sales", {
    id: pendingFollowUpScript.id,
    success: false,
    score: 2,
    outcome: "客户暂未回复",
    nextFollowUpAt: "2026-07-12",
    nextAction: "补齐发票和对账单后再次提醒"
  });
  const stateAfterFollowUp = await ok("GET", "/api/state", "u-admin");
  assert(stateAfterFollowUp.systemNotifications.some((item) => item.type === "collection-follow-up" && item.sourceId === pendingFollowUpScript.id && item.status === "待处理"), "待优化催收应形成待处理二次跟进提醒");

  const financePayment = await ok("POST", "/api/payments", "u-finance", {
    projectId: "p-payment",
    amount: 50000,
    payer: "回款客户",
    method: "承兑到账",
    note: "财务确认到账"
  });
  assert(financePayment.project?.paid === 100000 && financePayment.project?.receivable === 0, "财务也应能确认到账并更新项目");
  const stateAfterFullPayment = await ok("GET", "/api/state", "u-admin");
  assert(!stateAfterFullPayment.systemNotifications.some((item) => item.id === "notice-receivable-payment" && item.status === "待处理"), "待回款清零后回款风险待办不应继续出现在待处理列表");
  assert(!stateAfterFullPayment.systemNotifications.some((item) => item.type === "collection-follow-up" && item.sourceId === pendingFollowUpScript.id && item.status === "待处理"), "待回款清零后二次催收跟进待办应自动关闭");
  const syncedScript = stateAfterFullPayment.collectionScripts.find((item) => item.id === pendingScript.id);
  assert(syncedScript?.autoResolvedByPayment === true && syncedScript.success === true && /完成回款/.test(syncedScript.outcome || ""), "待回款清零后未复核催收话术应自动标记为待复核成功样本");

  const voided = await ok("POST", "/api/payments/void", "u-finance", {
    id: financePayment.payment.id,
    reason: "客户流水录错，作废重记"
  });
  assert(voided.payment.status === "已作废" && voided.payment.voidReason.includes("录错"), "财务应能作废回款并记录原因");
  assert(voided.project?.paid === 50000 && voided.project?.receivable === 50000, "作废回款后项目已回款和待回款应回滚");
  const voidedRevenue = voided.project?.extractedFields?.revenueRecognition;
  assert(voidedRevenue?.recognizedUnpaid === 40000, "作废回款后核销未回款金额应重新同步");
  assert(voidedRevenue?.verificationRecords?.[1]?.paymentStatus === "部分回款", "作废后第二条核销应回到部分回款");
  const stateAfterVoidingPayment = await ok("GET", "/api/state", "u-admin");
  const rolledBackScript = stateAfterVoidingPayment.collectionScripts.find((item) => item.id === pendingScript.id);
  assert(rolledBackScript?.autoResolvedByPayment === false && rolledBackScript.success === false && /重新跟进/.test(rolledBackScript.outcome || ""), "作废回款后自动成功的催收样本应回滚为需重新跟进");

  await denied("POST", "/api/payments/void", "u-member", {
    id: financePayment.payment.id,
    reason: "普通成员越权作废"
  }, "普通执行成员不应作废回款");

  await denied("POST", "/api/payments/void", "u-other-sales", {
    id: financePayment.payment.id,
    reason: "无关销售越权作废"
  }, "无关销售不应作废非自己项目回款");

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
    amount: 90000
  }, "超过合同金额过多的回款应被拦截");

  const stateAfterVoid = await ok("GET", "/api/state", "u-admin");
  assert(stateAfterVoid.payments.some((item) => item.id === financePayment.payment.id && item.status === "已作废"), "作废回款仍应保留在流水中");
  assert(stateAfterVoid.systemNotifications.some((item) => item.type === "project-receivable-risk" && item.projectId === "p-payment" && item.status === "待处理"), "作废回款后应出现待处理回款风险待办");
  assert(stateAfterVoid.auditLogs.some((item) => item.type === "payment" && item.action === "void"), "作废回款应写入审计记录");

  console.log("payment ledger regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
