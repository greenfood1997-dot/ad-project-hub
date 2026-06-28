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
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-other-director", name: "外部总监", email: "other-director@company.local", role: "director", department: "外部部门", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-other-pm", name: "外部PM", email: "other-pm@company.local", role: "pm", department: "外部部门", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    aiService: { "服务商": "mock", "API Key": "mock", "Base URL": "mock://local", "模型名称": "mock" },
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", project: "可操作项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-visible",
      name: "可操作项目",
      client: "A客户",
      owner: "项目经理",
      pm: "项目经理",
      sales: "销售",
      department: "项目部",
      status: "执行中",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      files: [{ name: "可操作合同.txt", text: "合同金额 100000", type: "text/plain", size: 20 }]
    },
    {
      id: "p-hidden",
      name: "隐藏项目",
      client: "B客户",
      owner: "外部PM",
      pm: "外部PM",
      sales: "外部销售",
      department: "外部部门",
      status: "执行中",
      contract: 200000,
      paid: 0,
      receivable: 200000,
      files: [{ name: "隐藏合同.txt", text: "合同金额 200000", type: "text/plain", size: 20 }]
    }
  ],
  parseJobs: [
    { id: "job-visible", projectId: "p-visible", projectName: "可操作项目", status: "已完成", progress: 100, files: [{ name: "可操作合同.txt", text: "合同金额 100000", type: "text/plain", size: 20 }], steps: [], extractedFields: {} },
    { id: "job-hidden", projectId: "p-hidden", projectName: "隐藏项目", status: "已完成", progress: 100, files: [{ name: "隐藏合同.txt", text: "合同金额 200000", type: "text/plain", size: 20 }], steps: [], extractedFields: {} }
  ],
  files: [
    { id: "file-visible", projectId: "p-visible", projectName: "可操作项目", files: [{ name: "可见归档.pdf" }] },
    { id: "file-hidden", projectId: "p-hidden", projectName: "隐藏项目", files: [{ name: "隐藏归档.pdf" }] }
  ],
  suppliers: [
    { id: "supplier-visible", projectId: "p-visible", project: "可操作项目", name: "可见供应商" },
    { id: "supplier-hidden", projectId: "p-hidden", project: "隐藏项目", name: "隐藏供应商" }
  ],
  supplierProfiles: [],
  clientProfiles: [],
  approvals: [
    { id: "approval-visible", projectId: "p-visible", projectName: "可操作项目", status: "待PM审批" },
    { id: "approval-hidden", projectId: "p-hidden", projectName: "隐藏项目", status: "待PM审批" }
  ],
  payments: [
    { id: "payment-visible", projectId: "p-visible", projectName: "可操作项目", amount: 1000 },
    { id: "payment-hidden", projectId: "p-hidden", projectName: "隐藏项目", amount: 2000 }
  ],
  collectionScripts: [
    { id: "collection-visible", projectId: "p-visible", projectName: "可操作项目", text: "可见项目催收" },
    { id: "collection-hidden", projectId: "p-hidden", projectName: "隐藏项目", text: "隐藏项目催收" }
  ],
  feishuEvents: [
    { id: "feishu-event-visible", projectId: "p-visible", projectName: "可操作项目", status: "已接收" },
    { id: "feishu-event-hidden", projectId: "p-hidden", projectName: "隐藏项目", status: "已接收" }
  ],
  feishuProjectBindings: [
    { id: "binding-visible", chatId: "chat-visible", projectId: "p-visible", projectName: "可操作项目" },
    { id: "binding-hidden", chatId: "chat-hidden", projectId: "p-hidden", projectName: "隐藏项目" }
  ],
  feishuPendingFiles: [
    { id: "pending-visible", projectId: "p-visible", projectName: "可操作项目", status: "待确认", file: { name: "可见飞书文件.xlsx" } },
    { id: "pending-hidden", projectId: "p-hidden", projectName: "隐藏项目", status: "待确认", file: { name: "隐藏飞书文件.xlsx" } }
  ],
  systemNotifications: [
    { id: "notice-visible", projectId: "p-visible", projectName: "可操作项目", status: "待处理", title: "可见项目提醒" },
    { id: "notice-hidden", projectId: "p-hidden", projectName: "隐藏项目", status: "待处理", title: "隐藏项目提醒" }
  ],
  comments: [
    { id: "comment-visible", project: "可操作项目", content: "可见项目评论" },
    { id: "comment-hidden", project: "隐藏项目", content: "隐藏项目评论" }
  ],
  alertUpdates: [
    { id: "alert-visible", project: "可操作项目", status: "已更新" },
    { id: "alert-hidden", project: "隐藏项目", status: "已更新" }
  ],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const updated = await ok("POST", "/api/projects/update", "u-pm", {
    id: "p-visible",
    values: { "项目名称": "可操作项目", "项目状态": "推进中", "下一节点": "补充脚本" }
  });
  assert(updated.status === "推进中", "PM 应能更新自己项目");

  await denied("POST", "/api/projects/update", "u-pm", {
    id: "p-hidden",
    values: { "项目状态": "越权修改" }
  }, "PM 不应更新不可见项目");

  await denied("POST", "/api/projects/reparse", "u-pm", {
    id: "p-hidden"
  }, "PM 不应重新解析不可见项目");

  const reparsed = await ok("POST", "/api/projects/reparse", "u-pm", {
    id: "p-visible"
  });
  assert(reparsed.parseJob?.projectId === "p-visible", "PM 应能重新解析自己项目并返回解析任务");

  await denied("POST", "/api/projects/delete", "u-other-director", {
    id: "p-visible"
  }, "外部总监不应删除不可见项目");

  const deleted = await ok("POST", "/api/projects/delete", "u-director", {
    id: "p-visible"
  });
  assert(deleted.id === "p-visible", "本部门总监应能删除可见项目");

  const state = await ok("GET", "/api/state", "u-admin");
  assert(!state.projects.some((project) => project.id === "p-visible"), "删除项目后不应再出现在项目列表");
  assert(state.projects.some((project) => project.id === "p-hidden"), "删除可见项目不应影响隐藏项目");
  const removedCollections = ["parseJobs", "files", "suppliers", "payments", "approvals", "collectionScripts", "comments", "alertUpdates", "systemNotifications", "feishuProjectBindings", "feishuPendingFiles", "feishuEvents"];
  for (const key of removedCollections) {
    assert(!state[key].some((item) => item.projectId === "p-visible" || item.projectName === "可操作项目" || item.project === "可操作项目"), `删除项目后 ${key} 不应残留可见项目数据`);
    assert(state[key].some((item) => item.projectId === "p-hidden" || item.projectName === "隐藏项目" || item.project === "隐藏项目"), `删除可见项目不应误删 ${key} 的隐藏项目数据`);
  }
  assert(state.auditLogs.some((item) => item.type === "project" && item.action === "delete" && item.target === "可操作项目"), "项目删除应进入审计日志");

  console.log("project operation permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
