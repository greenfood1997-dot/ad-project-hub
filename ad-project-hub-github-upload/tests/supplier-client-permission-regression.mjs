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
    { id: "p-visible", name: "可见供应商项目", client: "可见客户", owner: "项目经理", pm: "项目经理", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000, costBudget: 13000, costUsed: 10000, margin: 90, costs: [["前期成本", 10000]] },
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
  systemNotifications: [
    {
      id: "notice-visible-supplier-pending",
      key: "supplier-settlement-pending::p-visible",
      type: "supplier-settlement-pending",
      title: "供应商待结算",
      text: "可见供应商项目还有供应商待结算。",
      severity: "中",
      role: "finance",
      recipients: ["finance", "pm"],
      projectId: "p-visible",
      projectName: "可见供应商项目",
      source: "supplier-scanner",
      sourceId: "p-visible",
      actionLabel: "看供应商结算",
      actionView: "project-detail",
      status: "待处理",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "notice-visible-cost-pressure",
      key: "project-cost-pressure::p-visible",
      type: "project-cost-pressure",
      title: "项目成本接近预算",
      text: "可见供应商项目成本接近预算。",
      severity: "中",
      role: "pm",
      recipients: ["pm", "finance"],
      projectId: "p-visible",
      projectName: "可见供应商项目",
      source: "cost-scanner",
      sourceId: "p-visible",
      actionLabel: "看成本压力",
      actionView: "project-detail",
      status: "待处理",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
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
  assert(rated.ratings?.[0]?.comment === "配合稳定" && rated.ratings?.[0]?.user === "执行成员", "供应商评分接口应返回最新评分记录供前端高亮");

  const closeoutRated = await ok("POST", "/api/suppliers/rate", "u-member", {
    supplier: "可见制作供应商",
    project: "可见供应商项目",
    score: 3,
    market: "结案成本复盘",
    comment: "结案复盘：最大支出占比偏高，下次需提前比价。"
  });
  assert(closeoutRated.ratings?.[0]?.market === undefined || closeoutRated.ratings?.[0]?.comment.includes("结案复盘"), "结案复盘应能沉淀为供应商评分记录");
  assert(closeoutRated.market === "结案成本复盘", "结案复盘应能更新供应商合作市场/类型");
  assert(closeoutRated.riskTags?.includes("报价需比价"), "供应商评价出现需比价/报价偏高时应沉淀为风险标签");
  assert(["先比价", "谨慎使用"].includes(closeoutRated.recommendationAction), "供应商风险信号应转成可执行选择建议");
  assert(/建议|确认|合作|比价|供应商/.test(closeoutRated.selectionAdvice || ""), "供应商画像应返回可解释的选择建议");

  const invoiceRiskRated = await ok("POST", "/api/suppliers/rate", "u-member", {
    supplier: "可见制作供应商",
    project: "可见供应商项目",
    score: 2,
    market: "制作",
    comment: "发票慢，交付也有逾期，下次重要项目谨慎使用。"
  });
  assert(invoiceRiskRated.riskTags?.includes("发票/结算偏慢"), "供应商发票慢应沉淀为风险标签");
  assert(invoiceRiskRated.riskTags?.includes("交付时效风险"), "供应商交付逾期应沉淀为风险标签");
  assert(invoiceRiskRated.riskLevel === "高" && invoiceRiskRated.recommendationAction === "谨慎使用", "高风险供应商应提示谨慎使用");

  await denied("POST", "/api/suppliers/settlement", "u-member", {
    id: "s-visible",
    status: "已付款",
    note: "普通成员越权付款"
  }, "普通成员不应更新供应商付款状态");

  const paid = await ok("POST", "/api/suppliers/settlement", "u-pm", {
    id: "s-visible",
    status: "已付款",
    note: "已转账，待发票"
  });
  assert(paid.settlement.status === "已付款", "PM 应能把自己项目供应商标记为已付款");
  assert(paid.settlement.paidAt && paid.settlement.paymentNote === "已转账，待发票", "供应商付款应记录付款时间和备注");
  assert(paid.settlement.costAppliedAt && paid.project?.costUsed === 11000, "手动标记供应商已付款应同步一次项目成本");
  assert(paid.supplier.paidCount >= 1, "更新结算后供应商画像应刷新已付款数量");
  let persisted = JSON.parse(await readFile(dbFile, "utf8"));
  assert(persisted.systemNotifications.some((item) => item.id === "notice-visible-supplier-pending" && item.status === "已处理"), "项目供应商全部已付款后旧待结算待办应自动处理");

  const paidAgain = await ok("POST", "/api/suppliers/settlement", "u-pm", {
    id: "s-visible",
    status: "已付款",
    note: "重复点击不应重复入账"
  });
  assert(paidAgain.project === null || paidAgain.project?.costUsed === 11000, "重复标记已付款不应重复增加项目成本");

  await denied("POST", "/api/suppliers/settlement", "u-pm", {
    id: "s-hidden",
    status: "已付款",
    note: "越权付款"
  }, "PM 不应更新不可见项目供应商结算");

  const pending = await ok("POST", "/api/suppliers/settlement", "u-finance", {
    id: "s-visible",
    status: "待结算",
    note: "发票未到，退回待结算"
  });
  assert(pending.settlement.status === "待结算" && !pending.settlement.paidAt, "财务应能退回待结算并清空付款时间");
  assert(!pending.settlement.costAppliedAt && pending.project?.costUsed === 10000, "退回待结算应回滚手动结算同步的项目成本");
  persisted = JSON.parse(await readFile(dbFile, "utf8"));
  assert(persisted.systemNotifications.some((item) => item.id === "notice-visible-supplier-pending" && item.status === "待处理" && /退回待结算/.test(item.reopenReason || "")), "供应商退回待结算后旧待办应自动恢复");
  assert(persisted.systemNotifications.some((item) => item.id === "notice-visible-cost-pressure" && item.status === "已处理" && /成本使用率/.test(item.note || "")), "退回待结算回滚成本后低于阈值时成本压力待办应自动处理");

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

  const closeoutClientProfile = await ok("POST", "/api/clients/profile", "u-member", {
    append: true,
    client: "可见客户",
    pitfalls: "结案后仍有待回款，下次合同需明确回款节点。",
    handoffNote: "结案复盘：最大支出来自制作供应商，下次同类项目提前锁价。"
  });
  assert(closeoutClientProfile.pitfalls.includes("不要空概念"), "结案复盘追加客户雷区时不应覆盖原有雷区");
  assert(closeoutClientProfile.pitfalls.includes("结案后仍有待回款，下次合同需明确回款节点。"), "结案复盘应能沉淀到客户雷区");
  assert(/结案复盘/.test(closeoutClientProfile.handoffNote || ""), "结案复盘应能沉淀到客户交接备注");
  assert(closeoutClientProfile.handoffPackage?.title === "可见客户 PM 自动交接包", "客户档案应返回 PM 自动交接包");
  assert(closeoutClientProfile.handoffPackage?.activeProjectCount === 1, "客户交接包应统计在执行项目");
  assert(closeoutClientProfile.handoffPackage?.receivableProjects?.[0]?.amount === 80000, "客户交接包应包含重点待回款项目");
  assert(closeoutClientProfile.handoffPackage?.firstActions?.some((item) => /优先跟进回款/.test(item)), "客户交接包应生成接手优先动作");
  assert(closeoutClientProfile.handoffPackage?.mustAvoid?.some((item) => /不要空概念/.test(item)), "客户交接包应包含客户雷区");

  await denied("POST", "/api/clients/profile", "u-member", {
    client: "隐藏客户",
    likes: "越权"
  }, "成员不应维护隐藏客户档案");

  const adminExport = await call("GET", "/api/suppliers/export", "u-admin");
  assert(String(adminExport.payload).includes("可见制作供应商") && String(adminExport.payload).includes("隐藏投放供应商"), "管理员导出应包含全量供应商");
  assert(String(adminExport.payload).includes("付款时间") && String(adminExport.payload).includes("付款备注"), "供应商导出应包含付款时间和备注");
  const state = await ok("GET", "/api/state", "u-admin");
  assert(state.auditLogs.some((item) => item.type === "supplier" && item.action === "settlement-paid"), "供应商付款更新应进入审计日志");

  console.log("supplier client permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
