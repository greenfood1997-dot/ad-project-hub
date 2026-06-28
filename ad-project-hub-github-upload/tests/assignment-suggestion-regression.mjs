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

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm-free", name: "空闲PM", email: "pm-free@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm-busy", name: "忙碌PM", email: "pm-busy@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-sales", name: "销售", email: "sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-member-a", name: "执行A", email: "a@company.local", role: "member", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member-b", name: "执行B", email: "b@company.local", role: "member", department: "内容部", status: "active", pin: "123456" },
    { id: "u-other-director", name: "外部总监", email: "other-director@company.local", role: "director", department: "外部部门", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-pm-busy", name: "忙碌PM", contact: "pm-busy@company.local", role: "PM", department: "项目部", project: "旧项目1" },
        { userId: "u-pm-busy", name: "忙碌PM", contact: "pm-busy@company.local", role: "PM", department: "项目部", project: "旧项目2" }
      ]
    }
  },
  projects: [
    { id: "p-target", name: "新签项目", client: "汽车客户", department: "项目部", status: "筹备中", pm: "待分派", sales: "" },
    { id: "p-old-1", name: "旧项目1", client: "客户1", department: "项目部", status: "执行中", pm: "忙碌PM", sales: "销售" },
    { id: "p-old-2", name: "旧项目2", client: "客户2", department: "项目部", status: "执行中", pm: "忙碌PM", sales: "销售" },
    { id: "p-hidden", name: "外部项目", client: "外部客户", department: "外部部门", status: "筹备中", pm: "待分派", sales: "" }
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

  const denied = await call("GET", "/api/project-assignments/suggestions?projectId=p-target", "u-member-a");
  assert(denied.status === 403 || denied.payload.ok === false, "普通员工不能读取全局分派建议");
  const deniedMembers = await call("GET", "/api/project-assignments/members", "u-member-a");
  assert(deniedMembers.status === 403 || deniedMembers.payload.ok === false, "普通员工不能读取分派候选成员");

  const directorMembers = await ok("GET", "/api/project-assignments/members", "u-director");
  assert(directorMembers.some((item) => item.id === "u-pm-free"), "总监应能读取分派候选成员");
  assert(directorMembers.every((item) => !Object.prototype.hasOwnProperty.call(item, "pin")), "分派候选成员不应暴露 PIN");
  assert(directorMembers.every((item) => item.status !== "disabled"), "分派候选成员只返回启用成员");

  const directorAssignments = await ok("GET", "/api/project-assignments", "u-director");
  assert(directorAssignments.some((item) => item.id === "p-target"), "总监应能看到自己部门项目分派列表");
  assert(!directorAssignments.some((item) => item.id === "p-hidden"), "总监不应看到外部部门项目分派列表");

  const suggestions = await ok("GET", "/api/project-assignments/suggestions?projectId=p-target", "u-admin");
  assert(suggestions.projectId === "p-target", "建议应归属目标项目");
  assert(suggestions.pmCandidates[0]?.id === "u-pm-free", "空闲 PM 应排在忙碌 PM 前面");
  assert(suggestions.memberCandidates.some((item) => item.id === "u-member-a"), "应推荐执行成员");
  assert(suggestions.recommended.pmId === "u-pm-free", "推荐 PM 应写入 recommended");
  assert((suggestions.recommended.memberIds || []).length > 0, "应给出推荐执行成员 ID");

  const directorSuggestions = await ok("GET", "/api/project-assignments/suggestions?projectId=p-target", "u-director");
  assert(directorSuggestions.recommended.pmId === "u-pm-free", "总监也应能读取项目分派建议");

  const hiddenSuggestion = await call("GET", "/api/project-assignments/suggestions?projectId=p-hidden", "u-director");
  assert(hiddenSuggestion.status === 403 || hiddenSuggestion.payload.ok === false, "总监不应读取不可见项目分派建议");

  const directorAssignment = await ok("POST", "/api/project-assignments", "u-director", {
    projectId: "p-target",
    pmId: "u-pm-free",
    salesId: "u-sales",
    memberIds: ["u-member-a"],
    department: "项目部"
  });
  assert(directorAssignment.project.pm === "空闲PM" && directorAssignment.project.sales === "销售", "总监应能保存项目分派");

  const hiddenAssignment = await call("POST", "/api/project-assignments", "u-director", {
    projectId: "p-hidden",
    pmId: "u-pm-free",
    salesId: "u-sales",
    memberIds: ["u-member-a"],
    department: "外部部门"
  });
  assert(hiddenAssignment.status === 403 || hiddenAssignment.payload.ok === false, "总监不应保存不可见项目分派");

  console.log("assignment suggestion regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
