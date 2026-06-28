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

function costFile(name = "权限测试成本.csv") {
  return {
    name,
    type: "text/csv",
    category: "execution-cost",
    text: "项目,费用类型,金额\n员工可见项目,交通,88"
  };
}

const baseDb = {
  users: [
    { id: "u-shareholder", name: "股东", email: "owner@company.local", role: "shareholder", department: "管理层", status: "active", pin: "123456", feishuOpenId: "ou_owner" },
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456", feishuOpenId: "ou_admin" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456", feishuOpenId: "ou_finance" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456", feishuOpenId: "ou_pm" },
    { id: "u-member", name: "执行小伙伴", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456", feishuOpenId: "ou_member" },
    { id: "u-outsider", name: "无关员工", email: "outsider@company.local", role: "member", department: "执行部", status: "active", pin: "123456", feishuOpenId: "ou_outsider" }
  ],
  settings: {
    feishu: { appId: "cli_mock_app", appSecret: "cli_mock_secret", mockSend: "true" },
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行小伙伴", role: "member", department: "执行部", project: "员工可见项目" },
        { userId: "u-outsider", email: "outsider@company.local", name: "无关员工", role: "member", department: "执行部", project: "外部项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-visible",
      name: "员工可见项目",
      client: "A客户",
      owner: "项目经理",
      pm: "项目经理",
      sales: "销售",
      department: "项目部",
      status: "执行中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      costUsed: 10000,
      costs: [["交通", 1000]]
    },
    {
      id: "p-hidden",
      name: "员工不可见项目",
      client: "B客户",
      owner: "另一个经理",
      pm: "另一个经理",
      sales: "另一个销售",
      department: "另一个部门",
      status: "执行中",
      contract: 500000,
      paid: 0,
      receivable: 500000,
      costUsed: 20000,
      costs: [["制作", 20000]]
    }
  ],
  suppliers: [
    { id: "s-visible", project: "员工可见项目", supplier: "可见供应商", type: "交通", amount: 1000, status: "待结算" },
    { id: "s-hidden", project: "员工不可见项目", supplier: "隐藏供应商", type: "制作", amount: 20000, status: "待结算" }
  ],
  approvals: [],
  payments: [],
  collectionScripts: [],
  clientProfiles: [],
  supplierProfiles: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [],
  systemNotifications: [
    { id: "n-visible", status: "待处理", projectId: "p-visible", projectName: "员工可见项目", recipients: ["member"], title: "可见待办" },
    { id: "n-hidden", status: "待处理", projectId: "p-hidden", projectName: "员工不可见项目", recipients: ["member"], title: "隐藏待办" }
  ],
  files: [],
  parseJobs: [],
  comments: [],
  alertUpdates: [],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const ownerState = await ok("GET", "/api/state", "u-shareholder");
  assert(ownerState.projects.length === 2, "股东应看到全部项目");
  assert(ownerState.users.length === 6, "股东应看到成员列表");
  assert(ownerState.settings.feishu?.appSecret === "cli_mock_secret", "股东应能读取完整飞书配置用于后台维护");

  const adminState = await ok("GET", "/api/state", "u-admin");
  assert(adminState.projects.length === 2, "管理员应看到全部项目");
  assert(adminState.users.length === 6, "管理员应看到成员列表");
  assert(adminState.settings.feishu?.appSecret === "cli_mock_secret", "管理员应能读取完整飞书配置用于后台维护");

  const financeState = await ok("GET", "/api/state", "u-finance");
  assert(financeState.projects.length === 2, "财务应能看到全部项目经营数据");
  assert(financeState.users.length === 0, "财务不应读取后台成员列表");
  assert(!financeState.settings.feishu?.appSecret, "财务不应收到飞书密钥");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.projects.length === 1 && memberState.projects[0].id === "p-visible", "普通员工只能看到自己绑定项目");
  assert(memberState.suppliers.length === 1 && memberState.suppliers[0].supplier === "可见供应商", "普通员工只能看到自己项目供应商");
  assert(memberState.systemNotifications.length >= 1 && memberState.systemNotifications.every((item) => item.projectId === "p-visible" || item.projectName === "员工可见项目"), "普通员工只能看到自己项目待办");
  assert(memberState.users.length === 0, "普通员工不应看到成员管理数据");
  assert(!memberState.settings.feishu?.appSecret, "普通员工不应收到飞书密钥");

  await denied("GET", "/api/members", "u-member", undefined, "普通员工不应访问成员接口");
  await denied("GET", "/api/project-assignments", "u-member", undefined, "普通员工不应访问项目分派接口");
  await denied("POST", "/api/settings", "u-member", { type: "product", values: { companyName: "越权公司" } }, "普通员工不应保存后台设置");
  await denied("POST", "/api/projects", "u-member", { values: { "项目名称": "越权新项目" }, files: [] }, "普通员工不应新建项目");

  const ownPreview = await ok("POST", "/api/projects/upload-preview", "u-member", {
    type: "cost-sheet",
    id: "p-visible",
    files: [costFile()]
  });
  assert(ownPreview.canConfirm === true, "普通员工应能预览自己项目文件");

  const ownUpload = await ok("POST", "/api/projects/cost-sheet", "u-member", {
    id: "p-visible",
    files: [costFile()]
  });
  assert(ownUpload.parseJob?.projectId === "p-visible", "普通员工应能向自己项目上传成本表");

  const ownTask = await ok("POST", "/api/project-tasks", "u-member", {
    projectId: "p-visible",
    title: "员工自己的任务",
    owner: "执行小伙伴",
    progress: 20,
    status: "doing"
  });
  assert(ownTask.task?.title === "员工自己的任务", "普通员工应能更新自己项目任务");

  const ownApproval = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-visible",
    type: "reimbursement",
    amount: 66,
    reason: "自己项目交通费",
    payee: "执行小伙伴"
  });
  assert(ownApproval.projectId === "p-visible", "普通员工应能提交自己项目审批");

  await denied("POST", "/api/projects/upload-preview", "u-member", { type: "cost-sheet", id: "p-hidden", files: [costFile()] }, "普通员工不应预览非自己项目文件");
  await denied("POST", "/api/projects/cost-sheet", "u-member", { id: "p-hidden", files: [costFile()] }, "普通员工不应向非自己项目上传成本表");
  await denied("POST", "/api/project-tasks", "u-member", { projectId: "p-hidden", title: "越权任务" }, "普通员工不应更新非自己项目任务");
  await denied("POST", "/api/approvals", "u-member", { projectId: "p-hidden", type: "reimbursement", amount: 1, reason: "越权" }, "普通员工不应提交非自己项目审批");
  await denied("POST", "/api/payments", "u-member", { projectId: "p-visible", amount: 1 }, "普通员工不应记录回款");
  await denied("POST", "/api/collections/suggest", "u-member", { projectId: "p-visible", style: "越权催收" }, "普通员工不应生成催收话术");
  await denied("POST", "/api/suppliers/rate", "u-member", { supplier: "隐藏供应商", score: 5 }, "普通员工不应评价不可见供应商");
  await denied("POST", "/api/clients/profile", "u-member", { client: "B客户", likes: "越权" }, "普通员工不应维护不可见客户档案");

  const outsiderState = await ok("GET", "/api/state", "u-outsider");
  assert(outsiderState.projects.length === 0, "无关员工不应看到未绑定项目");

  console.log("permission boundary regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
