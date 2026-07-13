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

async function replaceApprovalId(oldId, newId) {
  const current = JSON.parse(await readFile(dbFile, "utf8"));
  current.approvals = (current.approvals || []).map((item) => item.id === oldId ? { ...item, id: newId } : item);
  await writeFile(dbFile, JSON.stringify(current, null, 2));
  return newId;
}

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456" },
    { id: "u-pm", name: "可见项目PM", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-finance", name: "财务", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行成员", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-hidden-member", name: "隐藏成员", email: "hidden@company.local", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "执行成员", role: "member", project: "可见审批项目" },
        { userId: "u-hidden-member", email: "hidden@company.local", name: "隐藏成员", role: "member", project: "隐藏审批项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "可见审批项目", client: "A客户", owner: "可见项目PM", pm: "可见项目PM", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "隐藏审批项目", client: "B客户", owner: "隐藏PM", pm: "隐藏PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  approvals: [],
  suppliers: [],
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
      id: "notice-visible-approval-stale",
      key: "approval-stale::p-visible::approval-visible-stale",
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: "可见项目报销等待 PM 处理。",
      severity: "中",
      role: "management",
      recipients: ["pm"],
      projectId: "p-visible",
      projectName: "可见审批项目",
      source: "approval",
      sourceId: "approval-visible-stale",
      actionLabel: "看审批",
      actionView: "approvals",
      status: "待处理",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "notice-withdraw-approval-stale",
      key: "approval-stale::p-visible::approval-withdraw-stale",
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: "备用金审批等待 PM 处理。",
      severity: "中",
      role: "management",
      recipients: ["pm"],
      projectId: "p-visible",
      projectName: "可见审批项目",
      source: "approval",
      sourceId: "approval-withdraw-stale",
      actionLabel: "看审批",
      actionView: "approvals",
      status: "待处理",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "notice-hidden-approval-stale",
      key: "approval-stale::p-hidden::approval-hidden-stale",
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: "隐藏项目审批等待处理。",
      severity: "中",
      role: "management",
      recipients: ["pm"],
      projectId: "p-hidden",
      projectName: "隐藏审批项目",
      source: "approval",
      sourceId: "approval-hidden-stale",
      actionLabel: "看审批",
      actionView: "approvals",
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

  const visibleApproval = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-visible",
    type: "reimbursement",
    amount: 300,
    payee: "执行成员",
    reason: "可见项目报销"
  });
  visibleApproval.id = await replaceApprovalId(visibleApproval.id, "approval-visible-stale");
  assert(visibleApproval.currentStepLabel === "PM确认" && visibleApproval.currentHandlerLabel === "PM / 项目负责人", "新审批应带当前处理人提示");
  assert(visibleApproval.nextActionHint?.includes("PM / 项目负责人") && visibleApproval.slaDueAt && visibleApproval.slaStatus === "正常", "新审批应带下一步和 SLA 提示");

  const withdrawableApproval = await ok("POST", "/api/approvals", "u-member", {
    projectId: "p-visible",
    type: "petty_cash",
    amount: 500,
    payee: "执行成员",
    reason: "金额写错需要撤回"
  });
  withdrawableApproval.id = await replaceApprovalId(withdrawableApproval.id, "approval-withdraw-stale");

  const hiddenApproval = await ok("POST", "/api/approvals", "u-hidden-member", {
    projectId: "p-hidden",
    type: "reimbursement",
    amount: 300,
    payee: "隐藏成员",
    reason: "隐藏项目报销"
  });
  hiddenApproval.id = await replaceApprovalId(hiddenApproval.id, "approval-hidden-stale");

  await denied("POST", "/api/approvals/action", "u-pm", {
    id: hiddenApproval.id,
    action: "approve",
    note: "越权处理"
  }, "PM 不应处理不可见项目审批");

  await denied("POST", "/api/approvals/withdraw", "u-hidden-member", {
    id: visibleApproval.id,
    reason: "越权撤回"
  }, "非提交人不应撤回可见项目里别人的审批");

  const withdrawn = await ok("POST", "/api/approvals/withdraw", "u-member", {
    id: withdrawableApproval.id,
    reason: "金额写错，撤回重提"
  });
  assert(withdrawn.status === "已撤回", "提交人应能撤回自己的待审批");
  assert(withdrawn.withdrawnBy === "u-member" && withdrawn.withdrawnAt, "撤回应保留撤回人和时间");
  assert(withdrawn.logs?.[0]?.action === "withdraw" && withdrawn.logs?.[0]?.note === "金额写错，撤回重提", "撤回意见应写入审批日志");
  assert(withdrawn.slaStatus === "已结束" && /撤回/.test(withdrawn.nextActionHint || ""), "撤回后审批应显示流程已结束");

  await denied("POST", "/api/approvals/action", "u-pm", {
    id: withdrawableApproval.id,
    action: "approve",
    note: "不能处理已撤回审批"
  }, "已撤回审批不应继续审批");

  const pmApproved = await ok("POST", "/api/approvals/action", "u-pm", {
    id: visibleApproval.id,
    action: "approve",
    note: "自己项目 PM 确认"
  });
  assert(pmApproved.projectId === "p-visible", "PM 应能处理自己可见项目审批");
  assert(pmApproved.logs?.[0]?.note === "自己项目 PM 确认", "审批处理意见应写入审批日志");
  assert(pmApproved.currentStepLabel && pmApproved.nextActionHint && pmApproved.slaStatus, "审批推进后仍应刷新当前处理人和 SLA 提示");

  const adminRejected = await ok("POST", "/api/approvals/action", "u-admin", {
    id: hiddenApproval.id,
    action: "reject",
    note: "管理员驳回隐藏项目审批"
  });
  assert(adminRejected.status === "已驳回", "管理员仍应能处理全局审批");
  assert(adminRejected.logs?.[0]?.note === "管理员驳回隐藏项目审批", "审批驳回意见应写入审批日志");

  await denied("POST", "/api/approvals/withdraw", "u-hidden-member", {
    id: hiddenApproval.id,
    reason: "已经驳回不能撤回"
  }, "已结束审批不应撤回");

  const state = await ok("GET", "/api/state", "u-admin");
  assert(state.auditLogs.some((item) => item.type === "approval" && item.action === "reject" && item.target === "隐藏审批项目"), "审批处理应写入审计日志");
  assert(state.auditLogs.some((item) => item.type === "approval" && item.action === "withdraw" && item.target === "可见审批项目"), "审批撤回应写入审计日志");
  const persisted = JSON.parse(await readFile(dbFile, "utf8"));
  assert(persisted.systemNotifications.some((item) => item.id === "notice-visible-approval-stale" && item.status === "已处理"), "审批推进后旧超时待办应自动处理");
  assert(persisted.systemNotifications.some((item) => item.id === "notice-withdraw-approval-stale" && item.status === "已处理" && /撤回/.test(item.note || "")), "审批撤回后旧超时待办应自动处理并写明撤回");
  assert(persisted.systemNotifications.some((item) => item.id === "notice-hidden-approval-stale" && item.status === "已处理"), "审批驳回后旧超时待办应自动处理");

  console.log("approval action permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
