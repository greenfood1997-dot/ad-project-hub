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

const csvFile = {
  name: "飞书可见成本.csv",
  type: "text/csv",
  size: 128,
  base64: Buffer.from("项目,费用类型,金额\n飞书可见项目,交通,88", "utf8").toString("base64"),
  text: "项目,费用类型,金额\n飞书可见项目,交通,88",
  source: "feishu-mock"
};

const contractFile = {
  name: "飞书新项目合同.txt",
  type: "text/plain",
  size: 64,
  base64: Buffer.from("项目名称：飞书新项目\n合同金额：10000", "utf8").toString("base64"),
  text: "项目名称：飞书新项目\n合同金额：10000",
  source: "feishu-mock"
};

const referenceFile = {
  name: "飞书项目资料.txt",
  type: "text/plain",
  size: 32,
  base64: Buffer.from("客户补充资料", "utf8").toString("base64"),
  text: "客户补充资料",
  source: "feishu-mock"
};

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-pm", name: "可见项目PM", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider-pm", name: "外部PM", email: "outsider-pm@company.local", role: "pm", department: "外部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", project: "飞书可见项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "飞书可见项目", client: "飞书客户", owner: "可见项目PM", pm: "可见项目PM", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "飞书隐藏项目", client: "隐藏客户", owner: "隐藏PM", pm: "隐藏PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  feishuPendingFiles: [
    {
      id: "pending-visible",
      eventId: "event-visible",
      chatId: "oc_visible",
      chatName: "飞书可见项目群",
      projectId: "p-visible",
      projectName: "飞书可见项目",
      uploadType: "cost-sheet",
      file: csvFile,
      preview: { fileName: csvFile.name, uploadType: "cost-sheet", projectName: "飞书可见项目", canConfirm: true },
      status: "待确认",
      createdAt: "2026-06-28T00:00:00.000Z"
    },
    {
      id: "pending-hidden",
      eventId: "event-hidden",
      chatId: "oc_hidden",
      chatName: "飞书隐藏项目群",
      projectId: "p-hidden",
      projectName: "飞书隐藏项目",
      uploadType: "cost-sheet",
      file: csvFile,
      preview: { fileName: csvFile.name, uploadType: "cost-sheet", projectName: "飞书隐藏项目", canConfirm: true },
      status: "待确认",
      createdAt: "2026-06-28T00:00:00.000Z"
    },
    {
      id: "pending-unmatched",
      eventId: "event-unmatched",
      chatId: "oc_unmatched",
      chatName: "未匹配项目群",
      projectId: "",
      projectName: "",
      uploadType: "create-project",
      file: contractFile,
      preview: { fileName: contractFile.name, uploadType: "create-project", projectName: "", canConfirm: true },
      status: "待确认",
      createdAt: "2026-06-28T00:00:00.000Z"
    },
    {
      id: "pending-reference",
      eventId: "event-reference",
      chatId: "oc_visible",
      chatName: "飞书可见项目群",
      projectId: "p-visible",
      projectName: "飞书可见项目",
      uploadType: "file-reference",
      file: referenceFile,
      preview: { fileName: referenceFile.name, uploadType: "file-reference", projectName: "飞书可见项目", canConfirm: true },
      status: "待确认",
      createdAt: "2026-06-28T00:00:00.000Z"
    }
  ],
  feishuEvents: [],
  feishuProjectBindings: [],
  projectsCreated: [],
  suppliers: [],
  supplierProfiles: [],
  clientProfiles: [],
  approvals: [],
  payments: [],
  collectionScripts: [],
  files: [],
  parseJobs: [],
  comments: [],
  auditLogs: [],
  alertUpdates: [],
  systemNotifications: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const memberState = await ok("GET", "/api/state", "u-member");
  const memberPendingIds = memberState.feishuPendingFiles.map((item) => item.id);
  assert(memberPendingIds.includes("pending-visible"), "成员应能看到自己项目飞书待确认文件");
  assert(!memberPendingIds.includes("pending-hidden"), "成员不应看到隐藏项目飞书待确认文件");
  assert(!memberPendingIds.includes("pending-unmatched"), "成员不应看到未匹配项目飞书待确认文件");

  await denied("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "pending-hidden",
    action: "confirm"
  }, "PM 不应处理不可见项目飞书文件");

  await denied("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "pending-unmatched",
    action: "confirm"
  }, "PM 不应处理未匹配项目飞书文件");

  const confirmedVisible = await ok("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "pending-visible",
    action: "confirm",
    note: "确认可见项目成本"
  });
  assert(confirmedVisible.status === "已确认入库", "PM 应能确认自己项目飞书文件");

  const confirmedReference = await ok("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "pending-reference",
    action: "confirm",
    note: "确认普通资料归档"
  });
  assert(confirmedReference.status === "已确认入库", "PM 应能确认自己项目普通飞书资料");

  const confirmedUnmatched = await ok("POST", "/api/integrations/feishu/pending-files/action", "u-admin", {
    id: "pending-unmatched",
    action: "confirm",
    note: "管理员确认新项目合同"
  });
  assert(confirmedUnmatched.status === "已确认入库", "管理员应能确认未匹配的新项目文件");

  const adminState = await ok("GET", "/api/state", "u-admin");
  const visibleProject = adminState.projects.find((project) => project.id === "p-visible");
  assert(visibleProject.files?.some((file) => file.name === "飞书项目资料.txt"), "普通飞书资料确认后应进入项目文件");
  assert(adminState.files.some((item) => item.projectId === "p-visible" && item.files?.some((file) => file.name === "飞书项目资料.txt")), "普通飞书资料确认后应进入全局文件记录");
  assert(adminState.projects.some((project) => project.name.includes("飞书新项目合同")), "管理员确认未匹配新项目文件后应创建项目");
  assert(adminState.auditLogs.some((item) => item.type === "upload" && item.action === "feishu-file-reference"), "普通飞书资料归档应写入上传审计日志");
  assert(adminState.auditLogs.some((item) => item.type === "feishu" && item.action === "confirm-pending-file"), "飞书确认动作应写入审计日志");

  console.log("feishu pending permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
