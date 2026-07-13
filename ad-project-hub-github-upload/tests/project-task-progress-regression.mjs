import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const daysLater = (days) => new Date(now.getTime() + days * 86400000).toISOString();

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
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "无关员工", email: "outsider@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", department: "执行部", project: "任务进度项目" },
        { userId: "u-outsider", email: "outsider@company.local", name: "无关员工", role: "member", department: "执行部", project: "其他项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-task",
      name: "任务进度项目",
      client: "任务客户",
      owner: "项目经理",
      pm: "项目经理",
      status: "执行中",
      progress: 10,
      startDate: daysAgo(20),
      endDate: daysLater(10),
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      costUsed: 10000,
      tasks: [
        { id: "task-existing", title: "已有任务", owner: "项目经理", progress: 20, status: "doing", dueDate: "2026-07-01", note: "已有节点" }
      ],
      extractedFields: {}
    },
    {
      id: "p-hidden-task",
      name: "隐藏任务项目",
      client: "隐藏客户",
      owner: "其他 PM",
      pm: "其他 PM",
      status: "执行中",
      progress: 0,
      contract: 50000,
      paid: 0,
      receivable: 50000,
      tasks: []
    }
  ],
  approvals: [],
  payments: [],
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
      id: "notice-task-progress-lag",
      key: "project-progress-lag::p-task",
      type: "project-progress-lag",
      title: "项目进度滞后",
      text: "任务进度项目进度落后。",
      severity: "中",
      role: "pm",
      recipients: ["pm"],
      projectId: "p-task",
      projectName: "任务进度项目",
      source: "project-scanner",
      sourceId: "p-task",
      actionLabel: "看项目",
      actionView: "project-detail",
      status: "待处理",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "notice-task-due-second",
      key: "project-task-due::p-task::task-second-fixed",
      type: "project-task-due",
      title: "项目任务即将截止",
      text: "拍摄执行任务即将截止。",
      severity: "中",
      role: "pm",
      recipients: ["pm"],
      projectId: "p-task",
      projectName: "任务进度项目",
      source: "task-scanner",
      sourceId: "task-second-fixed",
      actionLabel: "看任务",
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

  const first = await ok("POST", "/api/project-tasks", "u-pm", {
    projectId: "p-task",
    title: "脚本确认",
    owner: "执行成员",
    dueDate: "2026-07-05",
    progress: 60,
    status: "doing",
    note: "客户看第一版"
  });
  assert(first.task?.title === "脚本确认", "PM 应能新增项目任务");
  assert(first.project?.progress === 40, "新增任务后项目进度应按任务平均值更新");
  assert(first.project?.extractedFields?.taskSummary?.total === 2, "任务摘要应统计任务总数");
  assert(first.project?.extractedFields?.taskSummary?.doing === 2, "任务摘要应统计进行中任务");

  const second = await ok("POST", "/api/project-tasks", "u-member", {
    projectId: "p-task",
    taskId: "task-second-fixed",
    title: "拍摄执行",
    owner: "执行成员",
    dueDate: "2026-07-08",
    progress: 30,
    status: "doing",
    note: "已排期"
  });
  assert(second.project?.progress === 37, "员工新增自己项目任务后项目进度应重新计算");

  const completed = await ok("POST", "/api/project-tasks", "u-member", {
    projectId: "p-task",
    taskId: second.task.id,
    action: "complete"
  });
  assert(completed.task?.progress === 100 && completed.task?.status === "done", "任务完成动作应把任务推进到 100%");
  assert(completed.project?.progress === 60, "完成任务后项目总进度应重新计算");
  assert(completed.project?.extractedFields?.taskSummary?.done === 1, "任务摘要应统计已完成任务");
  let persisted = JSON.parse(await readFile(dbFile, "utf8"));
  assert(persisted.systemNotifications.some((item) => item.id === "notice-task-progress-lag" && item.status === "已处理" && /项目完成度已追到/.test(item.note || "")), "任务推进后项目不再滞后时旧进度待办应自动处理");
  assert(persisted.systemNotifications.some((item) => item.id === "notice-task-due-second" && item.status === "已处理" && /任务已完成/.test(item.note || "")), "任务完成后旧任务临期待办应自动处理");

  const archived = await ok("POST", "/api/project-tasks/archive", "u-pm", {
    projectId: "p-task",
    taskId: first.task.id,
    reason: "误建任务"
  });
  assert(archived.task?.archivedAt, "任务归档应保留归档时间");
  assert(archived.project?.progress === 60, "归档任务后项目进度应只按未归档任务计算");
  assert(archived.project?.extractedFields?.taskSummary?.total === 2, "任务摘要应只统计未归档任务");
  assert(archived.project?.extractedFields?.taskSummary?.archived === 1, "任务摘要应统计已归档任务数量");

  const state = await ok("GET", "/api/state", "u-admin");
  const project = state.projects.find((item) => item.id === "p-task");
  assert(project.progress === 60, "大盘状态应读取任务同步后的项目进度");
  assert(project.tasks.length === 3, "大盘状态应包含新增任务");
  assert(project.tasks.some((task) => task.id === first.task.id && task.archivedAt), "归档任务应留在后台记录中");
  assert(project.tasks.some((task) => task.id === second.task.id && task.updatedBy === "u-member"), "任务应保留更新人信息");
  assert(state.auditLogs.some((item) => item.type === "task" && item.action === "archive"), "归档任务应写入审计记录");
  assert(state.auditLogs.filter((item) => item.type === "task").length >= 4, "新增/完成/归档任务应写入审计记录");

  await denied("POST", "/api/project-tasks", "u-outsider", {
    projectId: "p-task",
    title: "越权任务",
    progress: 10
  }, "无关员工不应更新非自己项目任务");

  await denied("POST", "/api/project-tasks/archive", "u-outsider", {
    projectId: "p-task",
    taskId: "task-existing"
  }, "无关员工不应归档非自己项目任务");

  await denied("POST", "/api/project-tasks", "u-member", {
    projectId: "p-task",
    title: "",
    progress: 10
  }, "空任务名称应被拦截");

  console.log("project task progress regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
