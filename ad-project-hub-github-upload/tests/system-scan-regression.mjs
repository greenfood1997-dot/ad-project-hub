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

async function call(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  return { status: res.statusCode, payload: res.json() };
}

async function ok(method, path, userId, body) {
  const result = await call(method, path, userId, body);
  if (result.status >= 400 || result.payload.ok === false) {
    throw new Error(`${method} ${path} failed: ${result.payload.error || result.status}`);
  }
  return result.payload.data ?? result.payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const daysLater = (days) => new Date(now.getTime() + days * 86400000).toISOString();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
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
    members: { items: [{ userId: "u-member", email: "member@company.local", name: "执行", project: "滞后项目" }] }
  },
  projects: [
    {
      id: "p-unassigned",
      name: "待分派项目",
      owner: "待分派",
      pm: "待分派",
      status: "AI解析中",
      createdAt: daysAgo(2),
      contract: 100000,
      paid: 0,
      receivable: 100000,
      progress: 10,
      extractedFields: { revenueRecognition: { quoteRules: [{ serviceName: "视频", amount: 100000 }] } }
    },
    {
      id: "p-lag",
      name: "滞后项目",
      owner: "管理员",
      pm: "管理员",
      sales: "销售",
      status: "执行中",
      startDate: daysAgo(20),
      endDate: daysLater(10),
      contract: 200000,
      paid: 20000,
      receivable: 180000,
      paymentDue: "本月底回款",
      progress: 20,
      costBudget: 50000,
      costUsed: 52000,
      tasks: [
        { id: "task-overdue", title: "逾期脚本确认", owner: "执行成员", dueDate: daysAgo(1), progress: 40, status: "doing" },
        { id: "task-done-old", title: "已完成旧任务", owner: "执行成员", dueDate: daysAgo(2), progress: 100, status: "done" }
      ]
    },
    {
      id: "p-ok",
      name: "正常项目",
      owner: "管理员",
      pm: "管理员",
      status: "执行中",
      startDate: daysAgo(3),
      endDate: daysLater(30),
      contract: 10000,
      paid: 10000,
      receivable: 0,
      progress: 30
    },
    {
      id: "p-verification",
      name: "核销待上传项目",
      owner: "管理员",
      pm: "管理员",
      status: "执行中",
      startDate: daysAgo(5),
      endDate: daysLater(20),
      contract: 120000,
      paid: 0,
      receivable: 120000,
      progress: 40,
      extractedFields: {
        revenueRecognition: {
          quoteRules: [{ serviceName: "短视频发布", monthlyQuantity: 6, unit: "条", amount: 120000 }],
          verificationRecords: []
        }
      }
    },
    {
      id: "p-verification-done",
      name: "核销已上传项目",
      owner: "管理员",
      pm: "管理员",
      status: "执行中",
      startDate: daysAgo(5),
      endDate: daysLater(20),
      contract: 80000,
      paid: 0,
      receivable: 80000,
      progress: 40,
      extractedFields: {
        revenueRecognition: {
          quoteRules: [{ serviceName: "图文发布", monthlyQuantity: 4, unit: "篇", amount: 80000 }],
          verificationRecords: [{ month: currentMonth, amount: 20000 }]
        }
      }
    }
  ],
  approvals: [
    {
      id: "approval-stale-real-status",
      type: "reimbursement",
      typeLabel: "报销",
      projectId: "p-lag",
      projectName: "滞后项目",
      amount: 3600,
      status: "待PM确认",
      currentRole: "pm",
      createdAt: daysAgo(2),
      steps: [
        { key: "pm", label: "PM确认", role: "pm", status: "current" },
        { key: "finance", label: "财务处理", role: "finance", status: "pending" }
      ]
    },
    {
      id: "approval-withdrawn",
      type: "reimbursement",
      typeLabel: "报销",
      projectId: "p-lag",
      projectName: "滞后项目",
      amount: 100,
      status: "已撤回",
      currentRole: "",
      createdAt: daysAgo(3),
      steps: []
    }
  ],
  payments: [],
  collectionScripts: [],
  suppliers: [
    { id: "supplier-pending-1", projectId: "p-lag", project: "滞后项目", supplier: "拍摄供应商", type: "拍摄", amount: 18000, status: "待结算" },
    { id: "supplier-pending-2", projectId: "p-lag", project: "滞后项目", supplier: "道具供应商", type: "道具", amount: 5000, status: "待结算" },
    { id: "supplier-rejected", projectId: "p-lag", project: "滞后项目", supplier: "驳回供应商", type: "审批停止", amount: 7000, status: "审批已驳回" },
    { id: "supplier-withdrawn", projectId: "p-lag", project: "滞后项目", supplier: "撤回供应商", type: "审批停止", amount: 6000, status: "审批已撤回" },
    { id: "supplier-paid", projectId: "p-ok", project: "正常项目", supplier: "已付供应商", type: "制作", amount: 9000, status: "已付款" }
  ],
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

  const denied = await call("POST", "/api/system/scan", "u-member", {});
  assert(denied.status === 403 || denied.payload.ok === false, "普通员工不能手动触发全局扫描");

  const disabledScheduler = await ok("POST", "/api/settings", "u-admin", {
    type: "product",
    values: {
      "自动巡检间隔毫秒": "120000",
      "关闭自动巡检": "true"
    }
  });
  assert(disabledScheduler.scheduler?.enabled === false && disabledScheduler.scheduler?.intervalMs === 120000, "保存关闭自动巡检后应立即重载调度器为关闭状态");
  const disabledHealth = await ok("GET", "/api/health", "u-admin");
  assert(disabledHealth.scheduler?.enabled === false, "健康检查应显示关闭后的定时巡检状态");
  const enabledScheduler = await ok("POST", "/api/settings", "u-admin", {
    type: "product",
    values: {
      "自动巡检间隔毫秒": "180000",
      "关闭自动巡检": ""
    }
  });
  assert(enabledScheduler.scheduler?.enabled === true && enabledScheduler.scheduler?.intervalMs === 180000, "保存开启自动巡检后应立即按新间隔重载调度器");

  const scan = await ok("POST", "/api/system/scan", "u-admin", {});
  const types = new Set(scan.notifications.map((item) => item.type));
  assert(types.has("project-assignment"), "扫描应生成待分派提醒");
  assert(types.has("project-progress-lag"), "扫描应生成进度滞后提醒");
  assert(types.has("project-task-due"), "扫描应生成任务临期/逾期提醒");
  assert(types.has("project-cost-overrun"), "扫描应生成项目成本超预算提醒");
  assert(types.has("project-receivable-risk"), "扫描应生成回款跟进提醒");
  assert(types.has("supplier-settlement-pending"), "扫描应生成供应商待结算提醒");
  assert(types.has("verification-sheet-missing"), "扫描应生成本月核销表待上传提醒");
  assert(types.has("company-cash-runway"), "扫描应生成现金流安全线提醒");
  assert(types.has("approval-stale"), "扫描应识别待PM确认等真实审批状态的超时提醒");
  assert(scan.notifications.some((item) => item.type === "approval-stale" && item.sourceId === "approval-stale-real-status" && item.recipients?.includes("pm")), "超时审批提醒应指向当前处理角色");
  assert(scan.notifications.some((item) => item.type === "project-task-due" && item.sourceId === "task-overdue" && /已逾期/.test(item.text)), "逾期未完成任务应生成任务待办");
  assert(!scan.notifications.some((item) => item.type === "project-task-due" && item.sourceId === "task-done-old"), "已完成任务不应生成逾期提醒");
  assert(!scan.notifications.some((item) => item.sourceId === "approval-withdrawn"), "已撤回审批不应生成超时提醒");
  assert(scan.notifications.some((item) => item.type === "verification-sheet-missing" && item.projectId === "p-verification" && /短视频发布/.test(item.text)), "核销提醒应引用报价表识别的月度目标");
  assert(!scan.notifications.some((item) => item.type === "verification-sheet-missing" && item.projectId === "p-verification-done"), "本月已有核销记录的项目不应重复提醒");
  assert(scan.notifications.some((item) => item.type === "supplier-settlement-pending" && item.projectId === "p-lag" && /23,000/.test(item.text) && item.recipients?.includes("finance")), "供应商待结算提醒应聚合项目金额并提醒财务");
  assert(!scan.notifications.some((item) => item.type === "supplier-settlement-pending" && item.projectId === "p-lag" && /36,000|驳回供应商|撤回供应商/.test(item.text)), "审批已驳回/撤回的供应商结算不应继续进入待付款提醒");
  assert(scan.notifications.some((item) => item.type === "project-cost-overrun" && item.projectId === "p-lag" && /104%/.test(item.text) && item.recipients?.includes("finance")), "成本超预算提醒应写明预算使用率并提醒财务");
  assert(!scan.notifications.some((item) => item.type === "supplier-settlement-pending" && item.projectId === "p-ok"), "已付款供应商不应生成待结算提醒");
  assert(scan.notifications.some((item) => /危险！你快倒闭啦/.test(item.title)), "现金流少于3个月时应使用危险文案");

  const state = await ok("GET", "/api/state", "u-admin");
  assert(state.systemNotifications.length >= 4, "扫描结果应进入 /api/state 待办");

  const financeState = await ok("GET", "/api/state", "u-finance");
  assert(financeState.systemNotifications.some((item) => item.type === "company-cash-runway"), "财务应看到现金流提醒");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.systemNotifications.every((item) => item.projectName === "滞后项目" || item.projectId === "p-lag"), "员工只应看到自己项目相关提醒");

  console.log("system scan regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
