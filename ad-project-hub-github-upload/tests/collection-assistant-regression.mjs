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
    { id: "u-sales-new", name: "新销售", email: "new-sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-sales-other", name: "无关销售", email: "other-sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-sales-best", name: "高转化销售", email: "best-sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行", email: "member@company.local", role: "member", department: "项目部", status: "active", pin: "123456" }
  ],
  projects: [
    {
      id: "p-collection",
      name: "催收项目",
      client: "捷途汽车",
      contract: 100000,
      paid: 20000,
      receivable: 80000,
      paymentDue: "尾款节点",
      status: "执行中",
      nextMilestone: "阶段交付材料已整理",
      sales: "新销售",
      pm: "项目经理"
    }
  ],
  clientProfiles: [
    {
      client: "捷途汽车",
      likes: ["真实场景", "执行路径清楚"],
      dislikes: [],
      pitfalls: ["不要空概念"],
      handoffNote: "客户要先看依据",
      contactStyle: "自然但要推进"
    }
  ],
  collectionScripts: [
    {
      id: "collection-best",
      projectId: "p-old",
      projectName: "旧项目",
      client: "捷途汽车",
      salesName: "高转化销售",
      style: "温和但推进",
      script: "先同步交付，再确认付款节点。",
      outcome: "客户当天确认付款流程",
      success: true,
      score: 5,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    }
  ],
  approvals: [],
  payments: [],
  suppliers: [],
  supplierProfiles: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [],
  systemNotifications: [],
  files: [],
  parseJobs: [],
  comments: [],
  alertUpdates: [],
  auditLogs: [],
  settings: {}
};

try {
  await writeFile(dbFile, JSON.stringify(baseDb, null, 2));

  const memberDenied = await call("POST", "/api/collections/suggest", "u-member", {
    projectId: "p-collection",
    style: "越权"
  });
  assert(memberDenied.status === 403 || memberDenied.payload.ok === false, "普通员工不能生成催收话术");

  const script = await ok("POST", "/api/collections/suggest", "u-sales-new", {
    projectId: "p-collection",
    style: "像微信私聊，别太硬"
  });
  assert(script.projectId === "p-collection", "催收话术应绑定项目");
  assert(/像微信私聊/.test(script.style), "催收话术应保留销售自己的风格");
  assert(/真实场景/.test(script.script), "催收话术应融合客户偏好");
  assert(/不要空概念/.test(script.script), "催收话术应避开客户雷区");
  assert(/高转化销售/.test(script.script), "新销售话术应参考团队高成功率话术");

  await denied("POST", "/api/collections/outcome", "u-sales-other", {
    id: script.id,
    success: false,
    score: 1,
    outcome: "越权标记"
  }, "无关销售不应修改别人的催收结果");

  const outcome = await ok("POST", "/api/collections/outcome", "u-sales-new", {
    id: script.id,
    success: true,
    score: 5,
    outcome: "客户已回复并确认付款流程"
  });
  assert(outcome.success === true && /客户已回复/.test(outcome.outcome), "催收结果应可记录");

  const pmOutcome = await ok("POST", "/api/collections/outcome", "u-pm", {
    id: script.id,
    success: true,
    score: 5,
    outcome: "PM 复核客户已确认付款流程"
  });
  assert(/PM 复核/.test(pmOutcome.outcome), "项目 PM 应能复核自己项目催收结果");

  const library = await ok("GET", "/api/collections", "u-sales-new");
  const newRow = library.find((item) => item.id === script.id);
  assert(newRow?.successRateNote?.includes("新销售 已记录 1 次，成功 1 次"), "催收库应展示销售自己的成功记录");

  console.log("collection assistant regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
