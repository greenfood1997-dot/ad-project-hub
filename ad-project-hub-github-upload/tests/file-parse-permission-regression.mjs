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
    { id: "u-admin", name: "管理员", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行小伙伴", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "无关成员", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", name: "执行小伙伴", role: "member", project: "可见拍摄项目" },
        { userId: "u-outsider", name: "无关成员", role: "member", project: "隐藏拍摄项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "可见拍摄项目", client: "A客户", owner: "项目经理", pm: "项目经理", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "隐藏拍摄项目", client: "B客户", owner: "其他PM", pm: "其他PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  files: [],
  parseJobs: [
    {
      id: "job-visible",
      projectId: "p-visible",
      projectName: "可见拍摄项目",
      status: "解析中",
      progress: 25,
      files: [{ name: "可见合同.pdf", size: 100 }],
      steps: [
        { name: "读取文件", status: "完成" },
        { name: "识别内容", status: "进行中" },
        { name: "提取字段", status: "等待" },
        { name: "同步项目", status: "等待" }
      ],
      extractedFields: {}
    },
    {
      id: "job-hidden",
      projectId: "p-hidden",
      projectName: "隐藏拍摄项目",
      status: "解析中",
      progress: 25,
      files: [{ name: "隐藏合同.pdf", size: 100 }],
      steps: [
        { name: "读取文件", status: "完成" },
        { name: "识别内容", status: "进行中" },
        { name: "提取字段", status: "等待" },
        { name: "同步项目", status: "等待" }
      ],
      extractedFields: {}
    }
  ],
  suppliers: [],
  approvals: [],
  payments: [],
  collectionScripts: [],
  clientProfiles: [],
  supplierProfiles: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [],
  systemNotifications: [],
  comments: [],
  alertUpdates: [],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const recorded = await ok("POST", "/api/files/record", "u-pm", {
    projectName: "可见拍摄项目",
    files: [{ name: "拍摄排期.xlsx", type: "application/vnd.ms-excel", size: 128 }]
  });
  assert(recorded.projectId === "p-visible", "文件记录应补齐归属项目 ID");
  assert(recorded.projectName === "可见拍摄项目", "文件记录应使用可见项目名称");
  assert(recorded.files.length === 1, "文件记录应保存文件列表");

  await denied("POST", "/api/files/record", "u-pm", {
    projectName: "隐藏拍摄项目",
    files: [{ name: "隐藏资料.xlsx", size: 128 }]
  }, "PM 不应登记不可见项目文件");
  await denied("POST", "/api/files/record", "u-member", {
    projectName: "可见拍摄项目",
    files: [{ name: "成员资料.xlsx", size: 128 }]
  }, "普通成员不应直接调用文件记录写接口");

  const progressed = await ok("POST", "/api/parse-jobs/progress", "u-member", { id: "job-visible" });
  assert(progressed.projectId === "p-visible" && progressed.progress === 50, "成员应能推进自己项目的解析进度");

  await denied("POST", "/api/parse-jobs/progress", "u-member", { id: "job-hidden" }, "成员不应推进不可见项目解析任务");
  await denied("POST", "/api/parse-jobs/progress", "u-outsider", { projectId: "p-visible" }, "无关成员不应推进未绑定项目解析任务");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.files.every((item) => item.projectId === "p-visible"), "成员状态只应返回自己项目文件");
  assert(memberState.parseJobs.every((item) => item.projectId === "p-visible"), "成员状态只应返回自己项目解析任务");

  console.log("file parse permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
