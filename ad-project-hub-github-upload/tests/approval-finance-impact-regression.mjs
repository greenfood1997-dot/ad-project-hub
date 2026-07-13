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

async function approveToDone(id) {
  const pmStep = await ok("POST", "/api/approvals/action", "u-pm", { id, action: "approve", note: "PM确认" });
  assert(pmStep.status.includes("待") || pmStep.status === "已完成", "PM 通过后审批应推进");
  let current = pmStep;
  if (current.currentRole === "director") {
    current = await ok("POST", "/api/approvals/action", "u-director", { id, action: "approve", note: "总监通过" });
  }
  if (current.currentRole === "finance") {
    current = await ok("POST", "/api/approvals/action", "u-finance", { id, action: "approve", note: "财务处理" });
  }
  if (current.currentRole === "owner") {
    current = await ok("POST", "/api/approvals/action", "u-admin", { id, action: "approve", note: "老板线通过" });
  }
  assert(current.status === "已完成", "审批应完成");
  return current;
}

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务成员", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-other-member", name: "外部成员", email: "other@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    approvalRules: {
      pettyCashDirectorLimit: 3000,
      financeRequiredAmount: 1000,
      ownerRequiredAmount: 10000
    },
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", department: "执行部", project: "审批测试项目" },
        { userId: "u-other-member", email: "other@company.local", name: "外部成员", role: "member", department: "执行部", project: "其他项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-approval",
      name: "审批测试项目",
      client: "审批客户",
      owner: "项目经理",
      pm: "项目经理",
      sales: "销售成员",
      status: "执行中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      costUsed: 10000,
      margin: 90,
      costs: [["前期成本", 10000]],
      extractedFields: {
        pettyCashBudget: 1000,
        pettyCashUsed: 200
      }
    },
    {
      id: "p-other",
      name: "其他项目",
      client: "其他客户",
      owner: "其他人",
      pm: "其他 PM",
      status: "执行中",
      contract: 50000,
      paid: 0,
      receivable: 50000
    }
  ],
  approvals: [],
  suppliers: [
    {
      id: "supplier-pending-light",
      supplier: "灯光供应商",
      projectId: "p-approval",
      project: "审批测试项目",
      type: "拍摄灯光费用",
      amount: 8000,
      status: "待结算"
    }
  ],
  payments: [],
  collectionScripts: [],
  clientProfiles: [],
  supplierProfiles: [],
  files: [],
  parseJobs: [],
  comments: [],
  auditLogs: [],
  alertUpdates: [],
  systemNotifications: [
    {
      id: "notice-supplier-pending-approval",
      key: "supplier-settlement-pending::p-approval",
      type: "supplier-settlement-pending",
      title: "供应商待结算",
      text: "审批测试项目仍有供应商待结算",
      severity: "中",
      recipients: ["finance"],
      projectId: "p-approval",
      projectName: "审批测试项目",
      source: "supplier-scanner",
      sourceId: "p-approval",
      actionLabel: "看供应商",
      actionView: "project-detail",
      status: "待处理"
    }
  ],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const pettyCash = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-approval",
    type: "petty_cash",
    amount: 3000,
    payee: "执行成员",
    reason: "拍摄备用金"
  });
  assert(pettyCash.status === "待PM确认" && pettyCash.currentRole === "pm", "项目备用金应先到 PM 确认");
  assert(pettyCash.steps.some((step) => step.key === "director"), "达到备用金总监审批线应包含总监审批");
  assert(!pettyCash.steps.some((step) => step.key === "owner"), "未达到老板审批线不应包含老板审批");
  assert(Number(pettyCash.ruleSnapshot.pettyCashDirectorLimit) === 3000, "审批应保存当时使用的规则快照");
  await denied("POST", "/api/approvals/action", "u-member", { id: pettyCash.id, action: "approve" }, "普通成员不能审批自己的备用金");
  const completedPettyCash = await approveToDone(pettyCash.id);
  assert(completedPettyCash.appliedAt, "完成的备用金审批应标记已入账");

  let state = await ok("GET", "/api/state", "u-admin");
  let project = state.projects.find((item) => item.id === "p-approval");
  assert(project.pettyCashBudget === 4000, "备用金审批完成后项目备用金预算应增加");
  assert(project.pettyCashUsed === 200, "备用金预算增加不应直接增加已用备用金");

  const reimbursement = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-approval",
    type: "reimbursement",
    amount: 600,
    payee: "执行成员",
    reason: "交通报销"
  });
  assert(reimbursement.expenseCategory === "拍摄交通" && reimbursement.expenseCategorySource === "ai-rule", "报销创建后应按说明自动归类");
  assert(!reimbursement.steps.some((step) => step.key === "director"), "1000 元以内报销应跳过总监");
  assert(!reimbursement.steps.some((step) => step.key === "owner"), "小额报销不应进入老板审批");
  const completedReimbursement = await approveToDone(reimbursement.id);
  assert(completedReimbursement.status === "已完成", "报销应完成");

  state = await ok("GET", "/api/state", "u-admin");
  project = state.projects.find((item) => item.id === "p-approval");
  assert(project.pettyCashUsed === 800, "报销完成后项目备用金已用应增加");
  assert(project.costUsed === 10600, "报销完成后项目成本应增加");
  assert(project.costs.some((row) => row[0] === "员工报销-拍摄交通" && row[1] === 600), "报销完成后成本明细应按类目增加员工报销");

  const manualCategoryReimbursement = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-approval",
    type: "reimbursement",
    amount: 320,
    payee: "执行成员",
    reason: "项目杂项采购",
    expenseCategory: "道具"
  });
  assert(manualCategoryReimbursement.expenseCategory === "道具" && manualCategoryReimbursement.expenseCategorySource === "manual", "手动选择报销类目应优先保存");
  await approveToDone(manualCategoryReimbursement.id);
  state = await ok("GET", "/api/state", "u-admin");
  project = state.projects.find((item) => item.id === "p-approval");
  assert(project.costs.some((row) => row[0] === "员工报销-道具" && row[1] === 320), "手动类目报销完成后应按手动类目写入成本");

  const supplierPayment = await ok("POST", "/api/approvals", "u-pm", {
    projectId: "p-approval",
    type: "supplier_payment",
    amount: 8000,
    payee: "灯光供应商",
    reason: "拍摄灯光费用"
  });
  assert(supplierPayment.steps[0].label === "PM发起", "供应商付款流程应显示 PM 发起");
  assert(supplierPayment.steps.some((step) => step.key === "director"), "供应商付款应经过总监");
  assert(!supplierPayment.steps.some((step) => step.key === "owner"), "未达到老板审批线的供应商付款不应经过老板");
  await denied("POST", "/api/approvals/action", "u-finance", { id: supplierPayment.id, action: "approve" }, "财务不能越过 PM/总监提前处理供应商付款");
  const completedSupplierPayment = await approveToDone(supplierPayment.id);
  assert(completedSupplierPayment.status === "已完成", "供应商付款应完成");

  state = await ok("GET", "/api/state", "u-admin");
  project = state.projects.find((item) => item.id === "p-approval");
  assert(project.costUsed === 18920, "供应商付款完成后项目成本应增加");
  assert(project.costs.some((row) => row[0] === "灯光供应商" && row[1] === 8000), "供应商付款应进入项目成本明细");
  const lightSupplierRows = state.suppliers.filter((item) => item.supplier === "灯光供应商" && item.project === "审批测试项目");
  assert(lightSupplierRows.length === 1, "供应商付款审批应优先更新已有待结算行，不能重复新增供应商流水");
  assert(lightSupplierRows[0].status === "已付款" && lightSupplierRows[0].approvalId === supplierPayment.id, "供应商付款完成后应更新供应商台账为已付款");
  const persistedAfterSupplierPayment = JSON.parse(await readFile(dbFile, "utf8"));
  assert(persistedAfterSupplierPayment.systemNotifications.some((item) => item.id === "notice-supplier-pending-approval" && item.status === "已处理"), "供应商付款审批完成后旧供应商待结算待办应自动处理");

  const rejectedSupplierPayment = await ok("POST", "/api/approvals", "u-pm", {
    projectId: "p-approval",
    type: "supplier_payment",
    amount: 1200,
    payee: "临时器材供应商",
    reason: "临时器材费用"
  });
  let currentDb = JSON.parse(await readFile(dbFile, "utf8"));
  currentDb.suppliers.unshift({
    id: "supplier-reject-linked",
    supplier: "临时器材供应商",
    projectId: "p-approval",
    project: "审批测试项目",
    type: "临时器材费用",
    amount: 1200,
    status: "审批中",
    approvalId: rejectedSupplierPayment.id
  });
  await writeFile(dbFile, JSON.stringify(currentDb, null, 2));
  const rejectedSupplierByDirector = await ok("POST", "/api/approvals/action", "u-director", {
    id: rejectedSupplierPayment.id,
    action: "reject",
    note: "供应商资料不完整"
  });
  assert(rejectedSupplierByDirector.status === "已驳回", "供应商付款审批应能被驳回");
  state = await ok("GET", "/api/state", "u-admin");
  const rejectedLinkedRow = state.suppliers.find((item) => item.id === "supplier-reject-linked");
  assert(rejectedLinkedRow.status === "审批已驳回" && /供应商资料不完整/.test(rejectedLinkedRow.paymentNote || ""), "供应商付款审批驳回后绑定结算行应停止待付款状态");

  const withdrawnSupplierPayment = await ok("POST", "/api/approvals", "u-pm", {
    projectId: "p-approval",
    type: "supplier_payment",
    amount: 1500,
    payee: "撤回测试供应商",
    reason: "重复提交"
  });
  currentDb = JSON.parse(await readFile(dbFile, "utf8"));
  currentDb.suppliers.unshift({
    id: "supplier-withdraw-linked",
    supplier: "撤回测试供应商",
    projectId: "p-approval",
    project: "审批测试项目",
    type: "重复提交",
    amount: 1500,
    status: "审批中",
    approvalId: withdrawnSupplierPayment.id
  });
  await writeFile(dbFile, JSON.stringify(currentDb, null, 2));
  const withdrawnSupplier = await ok("POST", "/api/approvals/withdraw", "u-pm", {
    id: withdrawnSupplierPayment.id,
    note: "重复提交，撤回"
  });
  assert(withdrawnSupplier.status === "已撤回", "供应商付款审批应能撤回");
  state = await ok("GET", "/api/state", "u-admin");
  const withdrawnLinkedRow = state.suppliers.find((item) => item.id === "supplier-withdraw-linked");
  assert(withdrawnLinkedRow.status === "审批已撤回" && /重复提交/.test(withdrawnLinkedRow.paymentNote || ""), "供应商付款审批撤回后绑定结算行应停止待付款状态");

  const ownerApproval = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-approval",
    type: "reimbursement",
    amount: 12000,
    payee: "执行成员",
    reason: "大额制作报销"
  });
  assert(ownerApproval.steps.some((step) => step.key === "owner" && step.label === "老板审批"), "超过老板审批金额应加入老板审批");
  await denied("POST", "/api/approvals/action", "u-finance", { id: ownerApproval.id, action: "approve" }, "财务不能越过 PM/总监提前处理老板线审批");

  const rejected = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-approval",
    type: "reimbursement",
    amount: 500,
    payee: "执行成员",
    reason: "不合规票据"
  });
  const rejectedByPm = await ok("POST", "/api/approvals/action", "u-pm", {
    id: rejected.id,
    action: "reject",
    note: "票据不完整"
  });
  assert(rejectedByPm.status === "已驳回", "审批应能驳回");

  state = await ok("GET", "/api/state", "u-admin");
  project = state.projects.find((item) => item.id === "p-approval");
  assert(project.costUsed === 18920, "驳回审批不应影响项目成本");
  assert(project.pettyCashUsed === 1120, "驳回审批不应影响备用金已用");
  assert(state.auditLogs.filter((item) => item.type === "approval").length >= 7, "审批提交和处理应写入审计记录");

  await denied("POST", "/api/approvals", "u-other-member", {
    projectId: "p-approval",
    type: "reimbursement",
    amount: 1,
    reason: "越权报销"
  }, "无关成员不应为非自己项目提交审批");

  console.log("approval finance impact regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
