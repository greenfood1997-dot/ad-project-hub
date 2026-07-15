import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  FileText,
  Filter,
  HandCoins,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Minimize2,
  MessageSquareText,
  MessagesSquare,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  UploadCloud,
  UserCog,
  UsersRound,
} from "lucide-react";
import "./styles.css";
import { deployReadinessActions } from "./utils/deployReadiness.js";

const SESSION_KEY = "ad-project-hub-session";
const BUILD_VERSION = "2026-07-08-ai-task-command-pass";
const roleOptions = [
  ["shareholder", "股东"],
  ["admin", "管理员"],
  ["director", "总监"],
  ["pm", "项目经理"],
  ["sales", "销售"],
  ["finance", "财务"],
  ["member", "普通成员"],
  ["viewer", "只读成员"],
];

const managementRoles = ["shareholder", "admin", "director", "finance"];
const projectCreateRoles = ["shareholder", "admin", "director", "pm", "sales"];
const projectWriteRoles = ["shareholder", "admin", "director", "pm", "sales"];
const collectionRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
const feishuPendingHandleRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
const supplierPaymentSubmitRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
const expenseCategories = ["自动识别", "拍摄交通", "餐饮", "住宿", "道具", "场地", "达人/KOL", "制作", "投放", "快递", "办公杂费", "其他"];
const expenseCategoryValues = expenseCategories.filter((item) => item !== "自动识别");

function roleLabel(role) {
  return roleOptions.find(([value]) => value === role)?.[1] || role;
}

function canSeeManagement(session) {
  return managementRoles.includes(session?.role);
}

function canCreateProjectRole(session) {
  return projectCreateRoles.includes(session?.role);
}

function canWriteProjectRole(session) {
  return projectWriteRoles.includes(session?.role);
}

function canUseCollectionRole(session) {
  return collectionRoles.includes(session?.role);
}

function canHandleFeishuPendingRole(session) {
  return feishuPendingHandleRoles.includes(session?.role);
}

function canSubmitSupplierPaymentRole(session) {
  return supplierPaymentSubmitRoles.includes(session?.role);
}

function collectionFollowUpQueue(projects = [], scripts = []) {
  const now = new Date();
  return projects
    .filter((project) => Number(project.receivable || 0) > 0)
    .map((project) => {
      const projectScripts = scripts.filter((item) => item.projectId === project.id || item.projectName === project.name);
      const pendingScript = projectScripts.find((item) => item.followUpStatus === "待跟进" || item.nextFollowUpAt || item.nextAction);
      const nextDate = pendingScript?.nextFollowUpAt || "";
      const dateValue = nextDate ? new Date(nextDate) : null;
      const overdue = dateValue && !Number.isNaN(dateValue.valueOf()) && dateValue < new Date(now.toISOString().slice(0, 10));
      const dueSoon = dateValue && !Number.isNaN(dateValue.valueOf()) && !overdue && dateValue <= new Date(Date.now() + 2 * 86400000);
      const receivableRate = Number(project.contract || 0) ? Math.round((Number(project.receivable || 0) / Number(project.contract || 1)) * 100) : 0;
      const urgentByPaymentDue = /逾期|超期|已到期|尾款|月底|本周|今天|明天/.test(String(project.paymentDue || ""));
      const score = (overdue ? 80 : dueSoon ? 55 : 0)
        + (urgentByPaymentDue ? 35 : 0)
        + Math.min(45, Math.round(receivableRate / 2))
        + (Number(project.receivable || 0) >= 100000 ? 12 : 0);
      const status = overdue ? "已逾期" : dueSoon ? "近期跟进" : urgentByPaymentDue ? "节点敏感" : receivableRate >= 50 ? "高待收" : "待跟进";
      const nextAction = pendingScript?.nextAction
        || (urgentByPaymentDue ? "围绕回款节点温和确认付款流程，并主动补齐对账/发票资料。" : "先同步交付进展，再确认客户财务需要哪些材料。");
      return {
        project,
        pendingScript,
        score,
        status,
        nextFollowUpAt: nextDate,
        nextAction,
        receivableRate
      };
    })
    .sort((a, b) => b.score - a.score || Number(b.project.receivable || 0) - Number(a.project.receivable || 0))
    .slice(0, 6);
}

function approvalTypeOptionsFor(session) {
  return [
    ["reimbursement", "报销"],
    ["petty_cash", "项目备用金"],
    ...(canSubmitSupplierPaymentRole(session) ? [["supplier_payment", "供应商付款"]] : [])
  ];
}

function money(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100000) {
    return `${Number((number / 10000).toFixed(2)).toLocaleString("zh-CN")}万`;
  }
  return number.toLocaleString("zh-CN");
}

function daysFromNow(days = 0) {
  return new Date(Date.now() + Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

function fileSize(value) {
  const number = Number(value || 0);
  if (number >= 1024 * 1024) return `${Number((number / 1024 / 1024).toFixed(1))} MB`;
  if (number >= 1024) return `${Number((number / 1024).toFixed(1))} KB`;
  return `${number} B`;
}

function isSupplierSettlementPayable(item = {}) {
  return !/已付|已结|审批已驳回|审批已撤回/.test(String(item.status || ""));
}

function normalizeTask(task, index = 0) {
  if (Array.isArray(task)) {
    const progress = Number(task[1] || 0);
    return {
      id: task[2] || `task-${index}`,
      title: task[0] || `任务 ${index + 1}`,
      progress,
      status: progress >= 100 ? "done" : progress > 0 ? "doing" : "todo",
      owner: "",
      dueDate: "",
      note: ""
    };
  }
  const progress = Number(task?.progress || 0);
  return {
    id: task?.id || `task-${index}`,
    title: task?.title || task?.name || `任务 ${index + 1}`,
    progress,
    status: task?.status || (progress >= 100 ? "done" : progress > 0 ? "doing" : "todo"),
    owner: task?.owner || "",
    dueDate: task?.dueDate || "",
    note: task?.note || "",
    archivedAt: task?.archivedAt || "",
    archivedBy: task?.archivedBy || "",
    updatedAt: task?.updatedAt || ""
  };
}

function taskDueInfo(task = {}) {
  if (!task.dueDate || task.archivedAt || Number(task.progress || 0) >= 100 || task.status === "done") return null;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const daysLeft = Math.ceil((dueStart - todayStart) / 86400000);
  if (daysLeft < 0) return { tone: "overdue", label: `已逾期 ${Math.abs(daysLeft)} 天` };
  if (daysLeft === 0) return { tone: "today", label: "今天截止" };
  if (daysLeft <= 2) return { tone: "soon", label: `${daysLeft} 天后截止` };
  return { tone: "normal", label: `${daysLeft} 天后截止` };
}

function normalizeCostRow(row, index = 0) {
  if (Array.isArray(row)) {
    return {
      name: row[0] || `成本 ${index + 1}`,
      value: Number(row[1] || 0)
    };
  }
  return {
    name: row?.name || row?.type || row?.category || row?.subject || row?.supplier || `成本 ${index + 1}`,
    value: Number(row?.value ?? row?.amount ?? row?.cost ?? row?.price ?? 0)
  };
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        name: file.name,
        size: file.size,
        type: file.type,
        base64: dataUrl.split(",")[1] || "",
      });
    };
    reader.onerror = () => reject(new Error("文件读取失败，请重试"));
    reader.readAsDataURL(file);
  });
}

function uploadedFileKey(file = {}) {
  return `${file.name || ""}:${file.size || 0}:${file.type || ""}`;
}

const IDEMPOTENT_PATHS = new Set(["/api/payments", "/api/approvals", "/api/projects/cost-sheet"]);
const idempotencyKeys = new Map();

function financialIdempotencyKey(path, session, options = {}) {
  if (String(options.method || "GET").toUpperCase() !== "POST" || !IDEMPOTENT_PATHS.has(path)) return "";
  const fingerprint = `${session.id || "anonymous"}:${path}:${String(options.body || "")}`;
  const now = Date.now();
  const existing = idempotencyKeys.get(fingerprint);
  if (existing && now - existing.createdAt < 30000) return existing.key;
  const key = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
  idempotencyKeys.set(fingerprint, { key, createdAt: now });
  if (idempotencyKeys.size > 100) {
    for (const [item, value] of idempotencyKeys) if (now - value.createdAt >= 30000) idempotencyKeys.delete(item);
  }
  return key;
}

async function apiRequest(path, session, options = {}) {
  const idempotencyKey = financialIdempotencyKey(path, session, options);
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token || ""}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await res.json();
  if (!payload.ok) {
    const error = new Error(payload.error || "请求失败");
    error.data = payload.data;
    throw error;
  }
  return payload.data;
}

function explainUploadError(error) {
  const raw = String(error?.message || error || "识别失败，请稍后重试。");
  const compact = raw.replace(/^Error:\s*/i, "").trim();
  if (/API Key|未检测到 AI Key|请先填写 API Key|401|unauthorized/i.test(compact)) {
    return {
      title: "AI 接入还没配好",
      detail: compact,
      next: "请让管理员到「后台管理 -> AI 接入」保存 API Key；如果线上覆盖后 Key 丢失，也可以在 Render 环境变量配置 AI_API_KEY、AI_BASE_URL、AI_MODEL。"
    };
  }
  if (/Base URL|模型名称|model|404|请求格式|AI 服务返回/i.test(compact)) {
    return {
      title: "AI 服务地址或模型不匹配",
      detail: compact,
      next: "请到「后台管理 -> AI 接入」点一次测试连接，确认 Base URL、模型名称和服务商是一组匹配的配置。"
    };
  }
  if (/超时|timeout|network|Failed to fetch|连接/i.test(compact)) {
    return {
      title: "AI/OCR 连接超时",
      detail: compact,
      next: "先不要重复上传。可以点「缩到后台」等一会儿，再到项目详情的「文件与 AI 解析」刷新或重试解析。"
    };
  }
  if (/过大|too large|Payload|413|body/i.test(compact)) {
    return {
      title: "文件太大，服务端没完整接收",
      detail: compact,
      next: "建议把合同 PDF 压缩到 40MB 以下，或先拆成合同正文/报价表两份再上传。"
    };
  }
  if (/OCR|扫描件|图片合同|未提取到可解析文本|腾讯云/i.test(compact)) {
    return {
      title: "扫描件需要 OCR",
      detail: compact,
      next: "如果是扫描版 PDF 或图片合同，请让管理员在 Render 配置 TENCENT_SECRET_ID、TENCENT_SECRET_KEY；普通可复制文字 PDF 可以继续本地解析。"
    };
  }
  if (/无权限|不能创建新项目|403/i.test(compact)) {
    return {
      title: "当前账号没有这个操作权限",
      detail: compact,
      next: "请切换到自己可见的项目上传，或让 PM/销售/管理员创建项目后再上传成本、报价、核销资料。"
    };
  }
  return {
    title: "这次识别没有完成",
    detail: compact,
    next: "可以先重新预览一次；如果仍失败，到项目详情的「文件与 AI 解析」查看任务状态，或让管理员检查上线健康里的 AI/OCR 配置。"
  };
}

async function downloadFile(path, session, filename) {
  const res = await fetch(path, {
    headers: {
      authorization: `Bearer ${session.token || ""}`,
    },
  });
  if (!res.ok) throw new Error("导出失败，请稍后再试");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows = []) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function projectLedgerRows(projects = [], isManagement = false) {
  const headers = [
    "项目名称",
    "客户/品牌",
    "负责人",
    "PM",
    "销售",
    "状态",
    "风险",
    "合同金额",
    "已回款",
    "待回款",
    "成本预算",
    "已用成本",
    "进度",
    "下一节点",
    "回款节点",
    "开始时间",
    "结束时间",
    "材料状态",
    ...(isManagement ? ["项目利润", "毛利率"] : [])
  ];
  const body = projects.map((project) => {
    const materials = projectMaterialStatus(project, [], []);
    const profit = Number(project.contract || 0) - Number(project.costUsed || 0);
    const margin = project.contract ? `${Math.round((profit / Number(project.contract || 1)) * 100)}%` : "";
    return [
      project.name || "",
      project.client || project.brand || "",
      project.owner || "",
      project.pm || "",
      project.sales || "",
      project.status || "",
      project.risk || "",
      Number(project.contract || 0),
      Number(project.paid || 0),
      Number(project.receivable || 0),
      Number(project.costBudget || 0),
      Number(project.costUsed || 0),
      `${Number(project.progress || 0)}%`,
      project.nextMilestone || "",
      project.paymentDue || "",
      project.startDate || "",
      project.endDate || "",
      materials.missing.length ? `缺：${materials.missing.map((item) => item.label).join("、")}；已完成 ${materials.doneCount}/4` : "关键材料较完整",
      ...(isManagement ? [profit, margin] : [])
    ];
  });
  return [headers, ...body];
}

function assignmentLedgerRows(assignments = []) {
  const headers = [
    "项目名称",
    "客户/品牌",
    "项目状态",
    "部门",
    "PM",
    "销售",
    "执行成员",
    "执行人数",
    "合同金额",
    "已回款",
    "待回款",
    "进度",
    "风险",
    "下一节点",
    "回款节点",
    "开始时间",
    "结束时间"
  ];
  const body = assignments.map((project) => {
    const executionMembers = Array.isArray(project.members) ? project.members.filter(Boolean) : [];
    return [
      project.name || "",
      project.client || project.brand || "",
      project.status || "",
      project.department || "",
      project.pm || "待分派",
      project.sales || "待确认",
      executionMembers.join("、"),
      executionMembers.length,
      Number(project.contract || 0),
      Number(project.paid || 0),
      Number(project.receivable || 0),
      `${Number(project.progress || 0)}%`,
      project.risk || "",
      project.nextMilestone || "",
      project.paymentDue || "",
      project.startDate || "",
      project.endDate || ""
    ];
  });
  return [headers, ...body];
}

function paymentLedgerRows(project = {}, payments = []) {
  const headers = [
    "项目名称",
    "客户/品牌",
    "付款方",
    "回款金额",
    "方式",
    "备注",
    "状态",
    "记录人",
    "到账/记录时间",
    "作废人",
    "作废时间",
    "作废原因"
  ];
  const body = payments.map((payment) => [
    payment.projectName || payment.project || project.name || "",
    project.client || project.brand || payment.client || "",
    payment.payer || payment.client || "",
    Number(payment.amount || 0),
    payment.method || "",
    payment.note || "",
    payment.status || "已记录",
    payment.recordedByName || payment.recordedBy || "",
    payment.receivedAt || payment.createdAt || "",
    payment.voidedByName || "",
    payment.voidedAt || "",
    payment.voidReason || ""
  ]);
  return [headers, ...body];
}

function approvalLedgerRows(approvals = []) {
  const headers = [
    "项目名称",
    "审批类型",
    "报销类目",
    "金额",
    "收款人/用途",
    "申请人",
    "状态",
    "当前处理人",
    "SLA",
    "等待小时",
    "说明",
    "提交时间",
    "更新时间",
    "处理日志"
  ];
  const body = approvals.map((approval) => {
    const runtime = approvalRuntimeInfo(approval);
    const logs = (approval.logs || []).map((log) => {
      const action = log.action === "reject" ? "驳回" : log.action === "approve" ? "通过" : log.action === "withdraw" ? "撤回" : "提交";
      return `${log.user || "处理人"} ${action}${log.note ? `：${log.note}` : ""}`;
    }).join("；");
    return [
      approval.project || approval.projectName || "",
      approval.typeName || approval.typeLabel || approval.category || approval.type || "",
      approval.expenseCategory || "",
      Number(approval.amount || 0),
      approval.payee || approval.scope || approval.reason || "",
      approval.user || approval.applicantName || "",
      approval.status || "",
      runtime.handler || "",
      runtime.slaText || "",
      Number(approval.waitHours || 0),
      approval.scope || approval.reason || "",
      approval.createdAt || approval.submittedAt || approval.appliedAt || "",
      approval.updatedAt || approval.handledAt || "",
      logs
    ];
  });
  return [headers, ...body];
}

function reimbursementSummaryRows(approvals = [], projects = [], month = "") {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const rows = [["月份", "项目名称", "报销类目", "金额", "申请人", "收款人/用途", "说明", "状态", "当前处理人", "提交时间", "完成时间", "处理日志"]];
  approvals.forEach((approval) => {
    const project = projectById.get(approval.projectId) || {};
    const logs = (approval.logs || []).map((log) => `${log.user || "处理人"} ${log.action || ""}${log.note ? `：${log.note}` : ""}`).join("；");
    rows.push([
      month,
      approval.projectName || approval.project || project.name || "",
      approval.expenseCategory || "其他",
      Number(approval.amount || 0),
      approval.applicantName || approval.user || "",
      approval.payee || "",
      approval.reason || approval.scope || "",
      approval.status || "",
      approval.currentHandlerLabel || approvalRuntimeInfo(approval).handler || "",
      approval.createdAt || "",
      approval.completedAt || approval.appliedAt || "",
      logs
    ]);
  });
  return rows;
}

function taskLedgerRows(project = {}, tasks = []) {
  const headers = [
    "项目名称",
    "任务名称",
    "负责人",
    "截止时间",
    "进度",
    "状态",
    "备注",
    "更新时间",
    "更新人",
    "是否归档",
    "归档时间",
    "归档人"
  ];
  const body = tasks.map((task) => [
    project.name || "",
    task.title || "",
    task.owner || "",
    task.dueDate || "",
    `${Number(task.progress || 0)}%`,
    task.status || "",
    task.note || "",
    task.updatedAt || "",
    task.updatedByName || task.updatedBy || "",
    task.archivedAt ? "是" : "否",
    task.archivedAt || "",
    task.archivedByName || task.archivedBy || ""
  ]);
  return [headers, ...body];
}

function activityLedgerRows(project = {}, items = []) {
  const headers = [
    "项目名称",
    "时间",
    "动态类型",
    "内容",
    "关联区域"
  ];
  const body = items.map((item) => [
    project.name || "",
    item.at || "",
    item.title || "",
    item.text || "",
    item.target === "files" ? "文件与 AI 解析" : item.target === "payments" ? "回款/供应商" : item.target === "approvals" ? "审批与成本" : item.target === "progress" ? "执行进度" : "项目动态"
  ]);
  return [headers, ...body];
}

function clientHandoffRows(client = {}) {
  const handoff = client.handoffPackage || {};
  return [
    ["交接字段", "内容"],
    ["客户", client.client || ""],
    ["项目数", `${client.projectCount || 0} 个`],
    ["合同总额", Number(client.totalContract || 0)],
    ["待回款", Number(client.receivable || 0)],
    ["动态记录", `${client.commentCount || 0} 条`],
    ["在执行项目", `${handoff.activeProjectCount || 0} 个`],
    ["最近项目", `${client.latestProject || "待补充"}${client.latestStatus ? `（${client.latestStatus}）` : ""}`],
    ["自动交接摘要", handoff.summary || client.handoffSummary || "待补充"],
    ["接手先做", handoff.firstActions?.join("；") || "先确认项目状态、回款节点和客户雷区"],
    ["重点回款", handoff.receivableProjects?.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") || "暂无待回款"],
    ["最近反馈", handoff.latestFeedback?.join("；") || "暂无可交接反馈"],
    ["客户喜欢", client.likes?.join("；") || "待沉淀"],
    ["客户不喜欢", client.dislikes?.join("；") || "待沉淀"],
    ["雷区", client.pitfalls?.join("；") || "待沉淀"],
    ["沟通风格", client.contactStyle || "待沉淀"],
    ["交接备注", client.handoffNote || client.handoffSummary || "待补充"]
  ];
}

function closeoutReviewRows({ project = {}, costRows = [], topCost = {}, totalCost = 0, topCostShare = 0, costContractRate = 0, suggestedReserve = 0, costWarning = "", closeoutNote = "", isManagement = false }) {
  const rankingRows = (costRows.length ? costRows : [topCost])
    .filter((row) => row?.name)
    .slice(0, 12)
    .map((row, index) => [
      `支出排行 ${index + 1}`,
      row.name || "",
      Number(row.value || 0),
      totalCost ? `${Math.round((Number(row.value || 0) / Number(totalCost || 1)) * 100)}%` : "0%"
    ]);
  return [
    ["复盘字段", "内容", "金额/数值", "占比/说明"],
    ["项目名称", project.name || "", "", ""],
    ["客户/品牌", project.client || project.brand || "", "", ""],
    ["项目状态", project.status || "", "", ""],
    ["结案时间", project.closedAt || project.extractedFields?.closedAt || "待确认", "", ""],
    ["合同金额", "", Number(project.contract || 0), ""],
    ["总成本", "", Number(project.costUsed || totalCost || 0), ""],
    [isManagement ? "项目利润" : "利润信息", isManagement ? "" : "普通成员不可见", isManagement ? Number(project.contract || 0) - Number(project.costUsed || 0) : "", isManagement ? `${project.margin || 0}%` : ""],
    ["最大支出", topCost.name || "待归集成本", Number(topCost.value || 0), `${topCostShare}%`],
    ["成本占合同", "", `${costContractRate}%`, project.contract ? "按合同金额计算" : "合同金额待确认"],
    ["待回款", "", Number(project.receivable || 0), project.receivable > 0 ? "结案后仍需跟进" : "已无待回款"],
    ["下次预算建议", topCost.name || "待归集成本", Number(suggestedReserve || 0), "按最大支出上浮 15%"],
    ["AI 优化建议", costWarning || "", "", ""],
    ["结案复盘备注", closeoutNote || project.closeoutNote || project.extractedFields?.closeoutNote || "", "", ""],
    ...rankingRows
  ];
}

function collectionLedgerRows(scripts = [], projects = []) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const projectByName = new Map(projects.map((project) => [project.name, project]));
  const headers = [
    "项目名称",
    "客户/品牌",
    "待回款",
    "销售",
    "话术风格",
    "话术内容",
    "生成原因",
    "结果",
    "是否有效",
    "下次跟进时间",
    "下一步动作",
    "创建时间",
    "更新时间"
  ];
  const body = scripts.map((script) => {
    const project = projectById.get(script.projectId) || projectByName.get(script.projectName || script.project) || {};
    return [
      script.projectName || script.project || project.name || "",
      project.client || project.brand || script.client || "",
      Number(script.amount ?? project.receivable ?? 0),
      script.salesName || script.sales || "",
      script.tone || script.style || "",
      script.script || "",
      script.reason || "",
      script.outcome || "",
      typeof script.success === "boolean" ? (script.success ? "是" : "否") : "待记录",
      script.nextFollowUpAt || "",
      script.nextAction || "",
      script.createdAt || "",
      script.updatedAt || script.handledAt || ""
    ];
  });
  return [headers, ...body];
}

function managementLedgerRows(metrics = {}, stats = {}, projects = []) {
  const rows = [
    ["经营字段", "内容", "金额/数值", "说明"],
    ["经营建议", metrics.recommendation || "", "", ""],
    ["合同总额", "", Number(stats.contract || 0), ""],
    ["已回款", "", Number(stats.paid || 0), ""],
    ["待回款", "", Number(stats.receivable || 0), `待回款占合同 ${metrics.receivableRate || 0}%`],
    ["总支出", "", Number(metrics.spending || 0), ""],
    ["项目利润", "", Number(metrics.profit || 0), ""],
    ["综合毛利率", "", `${metrics.margin || 0}%`, ""],
    ["进行中项目", "", metrics.activeProjects?.length || 0, ""],
    ["已完成项目", "", metrics.completedProjects?.length || 0, ""],
    ["当前公司现金", "", Number(metrics.runway?.currentCash || 0), ""],
    ["月固定支出", "", Number(metrics.runway?.monthlyFixedCost || 0), "人力 + 租金 + 贷款 + 利息 + 其他"],
    ["6个月安全线", "", Number(metrics.runway?.safetyReserve || 0), ""],
    ["现金可撑", "", metrics.runway?.monthlyFixedCost ? `${Number(metrics.runway.runwayMonths || 0).toFixed(1)}个月` : "待设置", metrics.runway?.runwayLabel || ""],
    ["6个月缺口", "", Number(metrics.runway?.gap || 0), ""],
    ["现金压力总暴露", "", Number(metrics.cashPressureAmount || 0), ""],
    ["待备用金", "", Number(metrics.pendingPettyCash || 0), ""],
    ["待报销", "", Number(metrics.pendingReimbursements || 0), ""],
    ["待供应商付款", "", Number(metrics.pendingSupplierPay || 0), ""],
    ["待处理审批", "", metrics.pendingApprovals?.length || 0, ""],
    ...((metrics.advisorActions || []).map((action, index) => [`AI建议 ${index + 1}`, action, "", ""])),
    ...((metrics.highRiskProjects || projects || []).slice(0, 8).map((project, index) => [
      `优先项目 ${index + 1}`,
      project.name || "",
      Number(project.receivable || 0),
      `风险 ${project.risk || "待判断"}；成本占合同 ${project.costRate ?? ""}%；毛利率 ${project.projectMargin ?? ""}%；动作 ${project.actionLabel || ""} ${project.actionReason || ""}`
    ]))
  ];
  return rows;
}

function feishuPendingLedgerRows(items = []) {
  const headers = [
    "文件名",
    "状态",
    "归属项目",
    "上传类型",
    "飞书群",
    "发送人",
    "预览摘要",
    "备注",
    "创建时间",
    "处理人",
    "处理时间"
  ];
  const body = items.map((item) => [
    item.file?.name || item.preview?.fileName || "飞书文件",
    item.status || "",
    item.projectName || "待匹配项目",
    item.uploadType || "file",
    item.chatName || item.chatId || "",
    item.senderName || "",
    item.preview?.summary || "",
    item.note || "",
    item.createdAt || "",
    item.handledBy || "",
    item.handledAt || ""
  ]);
  return [headers, ...body];
}

function supplierProfileRows(suppliers = []) {
  const headers = [
    "供应商",
    "推荐星级",
    "推荐动作",
    "合作次数",
    "合作项目数",
    "累计金额",
    "已付款次数",
    "内部评分",
    "评分人数",
    "风险等级",
    "风险标签",
    "合作类型",
    "合作项目",
    "推荐原因",
    "选择建议",
    "最近评价",
    "更新时间"
  ];
  const body = suppliers.map((supplier) => {
    const latestRating = (supplier.ratings || [])[0] || {};
    return [
      supplier.supplier || "",
      supplier.star || 1,
      supplier.recommendationAction || "可试用",
      Number(supplier.cooperationCount || 0),
      Number(supplier.projectCount || 0),
      Number(supplier.totalAmount || 0),
      Number(supplier.paidCount || 0),
      supplier.averageRating || "",
      Number(supplier.ratingCount || 0),
      supplier.riskLevel || "低",
      (supplier.riskTags || []).join("、"),
      (supplier.types || []).join("、") || supplier.market || "",
      (supplier.projects || []).join("、"),
      supplier.recommendationReason || "",
      supplier.selectionAdvice || "",
      latestRating.comment || "",
      supplier.updatedAt || latestRating.at || ""
    ];
  });
  return [headers, ...body];
}

function normalizeProject(project) {
  const contract = Number(project.contract || 0);
  const paid = Number(project.paid || 0);
  const receivable = Number(project.receivable || Math.max(contract - paid, 0));
  const costBudget = Number(project.costBudget || project.cost_budget || 0);
  const costUsed = Number(project.costUsed || project.cost_used || 0);
  const tasks = Array.isArray(project.tasks) && project.tasks.length
    ? project.tasks.map(normalizeTask)
    : [["资料归档", project.files?.length ? 100 : 35], ["月度执行", 42], ["核销确认", 18]].map(normalizeTask);
  const progress = Number(project.progress || averageProgress(tasks) || inferTimeProgress(project));
  return {
    ...project,
    brand: project.brand || project.extractedFields?.brand || project.client || "",
    sales: project.sales || project.extractedFields?.sales || "待确认",
    pm: project.pm || project.extractedFields?.pm || project.owner || "待分派",
    contract,
    paid,
    receivable,
    costBudget,
    costUsed,
    progress,
    margin: Number(project.margin || 0),
    aiSummary: project.aiSummary || project.ai_summary || "AI 已建立项目档案，可继续上传合同、报价表、成本表和核销表完善项目数据。",
    alerts: Array.isArray(project.alerts) ? project.alerts : [],
    tasks,
    costs: Array.isArray(project.costs) && project.costs.length ? project.costs : [["待归集成本", costUsed]],
    pettyCashBudget: Number(project.pettyCashBudget ?? project.extractedFields?.pettyCashBudget ?? project.extractedFields?.projectPettyCashBudget ?? 20000),
    pettyCashUsed: Number(project.pettyCashUsed ?? project.extractedFields?.pettyCashUsed ?? project.extractedFields?.projectPettyCashUsed ?? Math.min(costUsed * 0.12, 12000)),
    nextMilestone: project.nextMilestone || project.next_milestone || "等待 AI 巡检生成下一节点",
    paymentDue: project.paymentDue || project.payment_due || "待确认回款节点"
  };
}

function averageProgress(tasks = []) {
  const values = tasks.map((task) => Number(Array.isArray(task) ? task[1] : task.progress)).filter(Number.isFinite);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function inferTimeProgress(project = {}) {
  const text = `${project.extractedFields?.servicePeriod || ""} ${project.nextMilestone || ""}`;
  const years = [...text.matchAll(/20\d{2}/g)].map((match) => Number(match[0]));
  if (years.length < 2) return 35;
  const start = new Date(`${years[0]}-01-01`).getTime();
  const end = new Date(`${years[1]}-12-31`).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 35;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

function projectHealth(project) {
  const timeProgress = inferTimeProgress(project);
  const completion = Number(project.progress || averageProgress(project.tasks));
  const delta = completion - timeProgress;
  if (delta <= -12) return { label: "滞后", tone: "danger", timeProgress, completion, text: `完成度低于时间进度 ${Math.abs(delta)}%，建议本周补齐关键交付和核销材料。` };
  if (delta >= 12) return { label: "超前", tone: "good", timeProgress, completion, text: "项目推进快于合同时间，可提前准备下月核销和客户确认材料。" };
  return { label: "正常", tone: "ok", timeProgress, completion, text: "项目节奏基本匹配合同时间，建议保持当前节奏并及时归档材料。" };
}

function fileKindLabel(source = "") {
  const text = String(source || "").toLowerCase();
  if (/quote|报价/.test(text)) return "报价表";
  if (/verification|核销/.test(text)) return "核销表";
  if (/execution|cost|成本|费用/.test(text)) return "成本表";
  if (/contract|合同/.test(text)) return "合同";
  return "文件";
}

function materialMatches(materialKey, text = "") {
  if (materialKey === "contract") return /合同|contract|协议|甲方|乙方/i.test(text);
  if (materialKey === "quote") return /报价|quote|刊例|报价单|报价表/i.test(text);
  if (materialKey === "cost") return /成本|费用|execution|cost|供应商结算|利润测算/i.test(text);
  if (materialKey === "verification") return /核销|verification|验收|月度/i.test(text);
  return false;
}

function materialStatusLabel(item) {
  if (item.status === "parsed") return "已解析";
  if (item.status === "review") return "需复核";
  if (item.status === "parsing") return "解析中";
  if (item.status === "uploaded") return "已上传";
  return "待补";
}

function projectMaterialStatus(project = {}, files = [], jobs = []) {
  const allFiles = [
    ...(project.files || []),
    ...files,
    ...jobs.flatMap((job) => job.files || [])
  ];
  const extracted = project.extractedFields || {};
  const revenue = extracted.revenueRecognition || {};
  const specs = [
    {
      key: "contract",
      label: "合同",
      uploadType: "create-project",
      parsed: Boolean(project.contract),
      review: Boolean(project.contract) && (!project.client || !project.paymentDue || project.paymentDue === "待确认回款节点"),
      emptyTip: "请上传合同或补充合同金额"
    },
    {
      key: "quote",
      label: "报价表",
      uploadType: "quote-sheet",
      parsed: Boolean(revenue.quoteRules?.length || extracted.quoteRules?.length || extracted.revenueRules?.length),
      review: Boolean(revenue.quoteRules?.length) && !revenue.updatedAt,
      emptyTip: "建议上传报价表，方便后续核销匹配"
    },
    {
      key: "cost",
      label: "成本表",
      uploadType: "cost-sheet",
      parsed: Boolean(project.costUsed || (project.costs || []).some((row) => Number(Array.isArray(row) ? row[1] : row.amount) > 0)),
      review: Boolean(project.costBudget && project.costUsed > project.costBudget),
      emptyTip: "执行成本还不完整，建议补成本表或报销记录"
    },
    {
      key: "verification",
      label: "核销表",
      uploadType: "verification-sheet",
      parsed: Boolean(revenue.verificationRecords?.length || extracted.verifications?.length || extracted.verificationRecords?.length),
      review: Boolean((revenue.verificationRecords || []).some((record) => String(record.status || "").includes("复核"))),
      emptyTip: "月度核销表待补，影响回款判断"
    },
  ];
  const items = specs.map((spec) => {
    const matchedFiles = allFiles.filter((file) => materialMatches(spec.key, `${file.name || ""} ${file.category || ""} ${file.source || ""} ${file.type || ""}`));
    const matchedJobs = jobs.filter((job) => materialMatches(spec.key, `${job.projectName || ""} ${job.status || ""} ${(job.files || []).map((file) => file.name || file.category || "").join(" ")}`));
    const parsing = matchedJobs.some((job) => !/完成|失败/.test(String(job.status || "")) && Number(job.progress || 0) < 100);
    const failed = matchedJobs.some((job) => /失败|错误/.test(String(job.status || "")));
    const status = failed || spec.review
      ? "review"
      : spec.parsed
        ? "parsed"
        : parsing
          ? "parsing"
          : matchedFiles.length
            ? "uploaded"
            : "missing";
    return {
      ...spec,
      done: status === "parsed",
      status,
      statusLabel: materialStatusLabel({ status }),
      files: matchedFiles,
      jobs: matchedJobs,
      tip: status === "missing"
        ? spec.emptyTip
        : status === "uploaded"
          ? "文件已上传，等待 AI 解析或确认入库"
          : status === "parsing"
            ? "AI 正在解析，请稍后刷新查看结果"
            : status === "review"
              ? "已发现需复核信息，请查看解析结果或补充字段"
              : "材料已归档并进入项目数据"
    };
  });
  return {
    items,
    missing: items.filter((item) => item.status === "missing" || item.status === "review"),
    doneCount: items.filter((item) => item.done).length
  };
}

function actionItemKey(item = {}) {
  return `${item.title || "行动项"}:${item.text || ""}`;
}

function projectActionItems({ project, files, jobs, approvals, health, isManagement, feishuPending = [] }) {
  const materials = projectMaterialStatus(project, files, jobs);
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  const receivable = Number(project.receivable || 0);
  const costRate = project.costBudget ? Math.round((Number(project.costUsed || 0) / Number(project.costBudget || 1)) * 100) : 0;
  const actions = [];
  const pendingFeishuCount = feishuPending.filter((item) => item.status === "待确认").length;
  if (pendingFeishuCount) {
    actions.push({
      tone: "warn",
      title: "确认飞书文件",
      text: `${pendingFeishuCount} 个飞书文件等待确认，确认前不会写入项目成本/报价/核销。`
    });
  }
  if (materials.missing.length) {
    actions.push({
      tone: "warn",
      title: `补齐${materials.missing.map((item) => item.label).join("、")}`,
      text: materials.missing[0].tip
    });
  } else {
    actions.push({ tone: "good", title: "关键材料完整", text: "合同、报价、成本和核销材料都有记录，可以进入更细的复盘和回款跟进。" });
  }
  if (health.label === "滞后") actions.push({ tone: "danger", title: "进度需要追赶", text: health.text });
  if (receivable > 0) actions.push({ tone: "warn", title: "跟进项目回款", text: `当前待回款 ${money(receivable)}，回款节点：${project.paymentDue || "待确认"}。` });
  if (pendingApprovals.length) actions.push({ tone: "warn", title: "处理待审批", text: `${pendingApprovals.length} 条审批仍在流程中，可能影响备用金、报销或供应商付款。` });
  if (isManagement && costRate >= 85) actions.push({ tone: "danger", title: "成本接近预算", text: `已使用预算 ${costRate}%，建议冻结非必要新增支出。` });
  return actions.slice(0, 5);
}

function parseJobTone(job = {}) {
  const status = String(job.status || "");
  if (/失败/.test(status)) return "failed";
  if (/完成/.test(status) || Number(job.progress || 0) >= 100) return "done";
  if (/重新|解析中|进行中/.test(status) || Number(job.progress || 0) > 0) return "running";
  return "waiting";
}

function projectAiAdvice({ project, materialStatus, approvals, health, isManagement, feishuPending = [] }) {
  const advice = [];
  const pendingFeishuCount = feishuPending.filter((item) => item.status === "待确认").length;
  if (pendingFeishuCount) {
    advice.push(`先处理 ${pendingFeishuCount} 个飞书待确认文件，避免项目材料已经到群里但还没入库。`);
  }
  if (materialStatus.missing.length) {
    advice.push(`优先补齐${materialStatus.missing.map((item) => item.label).join("、")}，否则后续成本归集、核销和回款判断会不完整。`);
  }
  if (health.label === "滞后") advice.push("当前完成度落后于时间进度，建议 PM 明确本周交付物，并把客户确认材料先归档。");
  if (Number(project.receivable || 0) > 0) advice.push(`待回款 ${money(project.receivable)}，建议销售结合节点「${project.paymentDue || "待确认"}」跟进客户确认。`);
  if (approvals.some((item) => String(item.status || "").includes("待"))) advice.push("项目内仍有待处理审批，可能影响执行备用金、报销或供应商付款。");
  if (isManagement && Number(project.margin || 0) < 25) advice.push("该项目毛利率偏低，管理层应复盘报价、供应商支出和临时追加成本。");
  if (!advice.length) advice.push("项目关键材料和节奏较稳定，可以提前准备下月核销、客户确认和结案复盘材料。");
  return advice.slice(0, 4);
}

function currentApprovalStepInfo(approval = {}) {
  return (approval.steps || []).find((step) => step.status === "current") || null;
}

function canHandleApproval(session = {}, approval = {}) {
  if (!approval.id || !String(approval.status || "").includes("待")) return false;
  if (["shareholder", "admin"].includes(session.role)) return true;
  const step = currentApprovalStepInfo(approval);
  if (!step) return false;
  if (step.role === "pm") return ["pm", "director"].includes(session.role);
  if (step.role === "director") return session.role === "director";
  if (step.role === "finance") return session.role === "finance";
  return false;
}

function canWithdrawApproval(session = {}, approval = {}) {
  if (!approval.id || !String(approval.status || "").includes("待")) return false;
  return approval.applicantId === session.id || ["shareholder", "admin", "director"].includes(session.role);
}

function approvalRuntimeInfo(approval = {}) {
  const step = currentApprovalStepInfo(approval);
  const waitHours = Number(approval.waitHours || 0);
  return {
    stepLabel: approval.currentStepLabel || step?.label || approval.status || "等待提交",
    handler: approval.currentHandlerLabel || (step?.role === "pm" ? "PM / 项目负责人" : step?.role === "director" ? "项目总监" : step?.role === "finance" ? "财务" : step?.role === "owner" ? "老板 / 股东" : "审批负责人"),
    waitText: String(approval.status || "").includes("待") ? `已等待 ${waitHours} 小时` : approval.status || "流程已结束",
    slaText: approval.slaStatus === "已超时" ? "已超时" : approval.slaStatus === "即将超时" ? "即将超时" : approval.slaDueAt ? `建议 ${new Date(approval.slaDueAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 前处理` : "流程已结束",
    tone: approval.slaStatus === "已超时" ? "danger" : approval.slaStatus === "即将超时" ? "warn" : "ok",
    hint: approval.nextActionHint || "审批会按流程自动流转到下一步。"
  };
}

function approvalPriorityQueue(approvals = [], session = {}) {
  return approvals
    .filter((approval) => approval.id && String(approval.status || "").includes("待"))
    .map((approval) => {
      const runtime = approvalRuntimeInfo(approval);
      const actionable = canHandleApproval(session, approval);
      const amount = Number(approval.amount || 0);
      const score = (actionable ? 80 : 0)
        + (runtime.tone === "danger" ? 70 : runtime.tone === "warn" ? 45 : 0)
        + Math.min(35, Math.round(amount / 1000))
        + Math.min(24, Number(approval.waitHours || 0));
      const reason = actionable
        ? `轮到你处理，${runtime.waitText}，${runtime.slaText}`
        : `${runtime.handler}处理中，${runtime.waitText}，${runtime.slaText}`;
      return {
        approval,
        runtime,
        actionable,
        score,
        reason
      };
    })
    .sort((a, b) => b.score - a.score || Number(b.approval.amount || 0) - Number(a.approval.amount || 0))
    .slice(0, 5);
}

function canArchiveComment(session = {}, item = {}) {
  return canWriteProjectRole(session) || item.userId === session.id || item.user === session.name;
}

function operatingSettings(settings = {}) {
  const company = settings.companyFinance || settings.product?.companyFinance || {};
  const number = (key) => Number(company[key] || 0);
  const monthlyFixedCost =
    number("monthlyLaborCost") +
    number("monthlyRent") +
    number("monthlyLoan") +
    number("monthlyInterest") +
    number("monthlyOtherCost");
  const currentCash = number("currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置"
    : runwayMonths >= 6
      ? "安全"
      : runwayMonths >= 3
        ? "谨慎"
        : "危险！你快倒闭啦！需要收缩现金流";
  return { ...company, currentCash, monthlyFixedCost, safetyReserve, runwayMonths, gap, runwayLabel };
}

function calculateRunway(values = {}) {
  const number = (key) => Number(values[key] || 0);
  const monthlyFixedCost =
    number("monthlyLaborCost") +
    number("monthlyRent") +
    number("monthlyLoan") +
    number("monthlyInterest") +
    number("monthlyOtherCost");
  const currentCash = number("currentCash");
  const safetyReserve = monthlyFixedCost * 6;
  const runwayMonths = monthlyFixedCost ? currentCash / monthlyFixedCost : 0;
  const gap = Math.max(safetyReserve - currentCash, 0);
  const runwayLabel = monthlyFixedCost <= 0
    ? "待设置"
    : runwayMonths >= 6
      ? "安全"
      : runwayMonths >= 3
        ? "谨慎"
        : "危险！你快倒闭啦！需要收缩现金流";
  return { currentCash, monthlyFixedCost, safetyReserve, runwayMonths, gap, runwayLabel };
}

function operatingMetrics(projects = [], approvals = [], stats = {}, settings = {}) {
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const completedProjects = projects.filter((project) => project.status === "已完成");
  const spending = projects.reduce((sum, project) => sum + Number(project.costUsed || 0), 0);
  const profit = projects.reduce((sum, project) => sum + (Number(project.contract || 0) - Number(project.costUsed || 0)), 0);
  const margin = stats.contract ? Math.round((profit / stats.contract) * 100) : 0;
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  const pendingPettyCash = pendingApprovals.filter((item) => item.type === "petty_cash").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingReimbursements = pendingApprovals.filter((item) => item.type === "reimbursement").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingSupplierPay = approvals
    .filter((item) => item.type === "supplier_payment" && item.status !== "已完成" && item.status !== "已驳回")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashPressureAmount = Number(stats.receivable || 0) + pendingPettyCash + pendingReimbursements + pendingSupplierPay;
  const receivableRate = stats.contract ? Math.round((Number(stats.receivable || 0) / stats.contract) * 100) : 0;
  const runway = operatingSettings(settings);
  const runwayPenalty = runway.monthlyFixedCost && runway.runwayMonths < 3 ? 30 : runway.monthlyFixedCost && runway.runwayMonths < 6 ? 14 : 0;
  const pressureScore = receivableRate + (pendingApprovals.length * 4) + (margin < 25 ? 20 : 0) + runwayPenalty;
  const pressureLevel = pressureScore >= 70 ? "高" : pressureScore >= 38 ? "中" : "低";
  const highRiskProjects = projects
    .map((project) => {
      const costRate = project.contract ? Math.round((Number(project.costUsed || 0) / Number(project.contract || 1)) * 100) : 0;
      const receivableProjectRate = project.contract ? Math.round((Number(project.receivable || 0) / Number(project.contract || 1)) * 100) : 0;
      const projectMargin = project.contract ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100) : 0;
      const score = (project.risk === "高" ? 35 : project.risk === "中" ? 18 : 0) + costRate + receivableProjectRate + (projectMargin < 25 ? 24 : 0);
      const actionTarget = Number(project.receivable || 0) > 0
        ? "payments"
        : costRate >= 70 || projectMargin < 25
          ? "costs"
          : "progress";
      const actionLabel = actionTarget === "payments"
        ? "跟进回款"
        : actionTarget === "costs"
          ? "看成本"
          : "看进度";
      const actionReason = actionTarget === "payments"
        ? `待回款占比 ${receivableProjectRate}%`
        : actionTarget === "costs"
          ? `成本占合同 ${costRate}% / 毛利率 ${projectMargin}%`
          : `风险等级 ${project.risk || "待判断"}`;
      return { ...project, costRate, receivableProjectRate, projectMargin, score, actionTarget, actionLabel, actionReason };
    })
    .sort((a, b) => b.score - a.score);
  const topRisk = highRiskProjects[0];
  const recommendation = runway.runwayLabel.includes("危险")
    ? "危险！你快倒闭啦！需要收缩现金流"
    : pressureLevel === "高"
      ? "控制现金流，优先催收和暂停低毛利新增支出"
      : pressureLevel === "中"
        ? "稳健推进，控制审批节奏并盯紧回款节点"
        : "可适度拓展，优先复制高毛利和回款快的项目类型";
  const advisorActions = [
    stats.receivable > 0 ? `优先催收待回款最高的项目：${[...highRiskProjects].sort((a, b) => b.receivable - a.receivable)[0]?.name || "暂无"}` : "当前回款压力较低，保持合同归档和核销节奏",
    pendingApprovals.length ? `先处理 ${pendingApprovals.length} 条待审批，避免备用金/报销堆积` : "审批队列清爽，可以把精力放到项目交付和回款",
    runway.monthlyFixedCost ? `现金可撑 ${runway.runwayMonths.toFixed(1)} 个月，6个月安全线缺口 ${money(runway.gap)}` : "请先填写公司现金和月固定支出，才能计算6个月安全线",
    margin < 25 ? "毛利率偏低，新增项目报价要提高执行预算安全线" : "毛利率暂时健康，可复盘高毛利项目打法",
  ];
  return {
    activeProjects,
    completedProjects,
    spending,
    profit,
    margin,
    pendingApprovals,
    pendingPettyCash,
    pendingReimbursements,
    pendingSupplierPay,
    cashPressureAmount,
    receivableRate,
    pressureScore,
    pressureLevel,
    highRiskProjects,
    topRisk,
    recommendation,
    advisorActions,
    runway
  };
}

function findProjectFromText(text, projects = [], selected) {
  const query = String(text || "");
  return projects.find((project) => query.includes(project.name) || (project.client && query.includes(project.client))) || selected || projects[0];
}

function amountFromText(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(万|元)?/);
  if (!match) return 0;
  const number = Number(match[1]);
  return match[2] === "万" ? number * 10000 : number;
}

async function tryCreateAiApproval({ query, session, projects, selected, onDone }) {
  const amount = amountFromText(query);
  if (!amount || !/(提交|申请|登记|报销|备用金)/.test(query)) return "";
  const type = /备用金|预算/.test(query) ? "petty_cash" : /报销|票据/.test(query) ? "reimbursement" : "";
  if (!type) return "";
  const target = findProjectFromText(query, projects, selected);
  if (!target?.id) throw new Error("没有匹配到可登记的项目");
  const data = await apiRequest("/api/approvals", session, {
    method: "POST",
    body: JSON.stringify({
      projectId: target.id,
      type,
      amount,
      payee: session.name,
      reason: query
    })
  });
  await onDone?.();
  return `已帮你提交「${target.name}」的${type === "petty_cash" ? "项目备用金" : "报销"}申请，金额 ${money(amount)}。当前状态：${data.status}。`;
}

function aiReplyFor({ query, session, projects, approvals = [], settings = {}, stats = {}, selected }) {
  const target = findProjectFromText(query, projects, selected);
  if (!target) return "你当前还没有可见项目。可以先让销售或管理员上传合同创建项目，再由总监分派成员。";
  const pettyLeft = Math.max(Number(target.pettyCashBudget || 0) - Number(target.pettyCashUsed || 0), 0);
  if (/备用金|预算/.test(query)) {
    return `「${target.name}」备用金预算 ${money(target.pettyCashBudget)}，已使用 ${money(target.pettyCashUsed)}，当前剩余 ${money(pettyLeft)}。`;
  }
  if (/报销|票据|审批/.test(query)) {
    const projectApprovals = approvals.filter((item) => item.projectId === target.id || item.projectName === target.name);
    if (!projectApprovals.length) return `「${target.name}」当前没有审批记录。你可以说“帮我提交 500 元报销到${target.name}”，我会直接生成审批单。`;
    return `「${target.name}」共有 ${projectApprovals.length} 条审批：${projectApprovals.slice(0, 3).map((item) => `${item.typeLabel || item.type} ${money(item.amount)} ${item.status}`).join("；")}。`;
  }
  if (/回款|收款|催收|待收|尾款|首款/.test(query)) {
    const rate = target.contract ? Math.round((Number(target.paid || 0) / Number(target.contract || 1)) * 100) : 0;
    const advice = target.receivable > 0
      ? `建议销售围绕「${target.paymentDue || "待确认回款节点"}」跟客户确认付款时间，话术可以更像人话：先同步项目已完成/正在推进的节点，再温和确认本期款项安排。`
      : "当前项目没有待回款，可以准备结案资料和复盘。";
    return `「${target.name}」合同 ${money(target.contract)}，已回款 ${money(target.paid)}，待回款 ${money(target.receivable)}，回款率 ${rate}%。${advice}`;
  }
  if (/登记|上传|归档|成本/.test(query)) {
    const matches = projects.filter((project) => query.includes(project.name) || (project.client && query.includes(project.client)));
    if (!matches.length && projects.length > 1) {
      return `我识别到你有 ${projects.length} 个可见项目。为了避免成本记错账，请在上传入口选择项目；如果你直接说项目名，比如“这个统计到${target.name}成本里”，我会按项目匹配。`;
    }
    return `当前匹配项目是「${target.name}」。财务类写入我会优先走审批单，文件归档请用上传入口，避免误改成本数据。`;
  }
  if (/创意|内容|过稿|脚本/.test(query)) {
    return `针对「${target.client || target.name}」，建议先给真实使用场景，再给客户能确认的执行路径，减少空概念。可以把历史反馈继续上传，我会沉淀客户偏好和雷区。`;
  }
  if (/进度|节点|滞后|超前|完成度/.test(query)) {
    const health = projectHealth(target);
    return `「${target.name}」当前完成度 ${health.completion}%，时间进度 ${health.timeProgress}%，AI 判断为${health.label}。${health.text}`;
  }
  if (/现金流|经营|倒闭|安全线|老板|公司/.test(query)) {
    if (!canSeeManagement(session)) return "公司经营和现金流属于管理层可见内容。你可以继续问自己项目的进度、备用金、报销和材料状态。";
    const metrics = operatingMetrics(projects, approvals, stats, settings);
    return `公司经营判断：${metrics.recommendation}。待回款 ${money(stats.receivable)}，待审批 ${metrics.pendingApprovals.length} 条，现金可撑 ${metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)}个月` : "待设置"}，6个月安全线缺口 ${money(metrics.runway.gap)}。`;
  }
  if (/我的项目|有哪些项目/.test(query)) {
    return `你当前可见 ${projects.length} 个项目：${projects.slice(0, 5).map((project) => `${project.name}(${projectHealth(project).label})`).join("、")}。`;
  }
  return `我先按当前项目「${target.name}」理解：进度 ${target.progress}%，下一节点是「${target.nextMilestone}」。你可以问“我的项目备用金还有多少”，也可以说“帮我提交 500 元报销到${target.name}”。`;
}

async function answerAiQuestion(context) {
  const query = String(context.query || "").trim();
  const data = await apiRequest("/api/ai/assistant", context.session, {
    method: "POST",
    body: JSON.stringify({
      query,
      selectedProjectId: context.selected?.id || "",
      confirmAction: context.confirmAction || null
    })
  });
  if (data.action === "approval-created") await context.onDone?.();
  if (data.action === "task-created") await context.onDone?.();
  return data;
}

function LazyChart({ option }) {
  const nodeRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let chart = null;

    async function mountChart() {
      const node = nodeRef.current;
      if (!node) return;
      const echarts = await import("echarts");
      if (disposed || !nodeRef.current) return;
      chart = echarts.init(node);
      chart.setOption(option);
    }

    const onResize = () => chart?.resize();
    mountChart();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [option]);

  return <div className="chart" ref={nodeRef}></div>;
}

function parseNoticeAmount(text = "") {
  const normalized = String(text || "").replace(/,/g, "");
  const wan = normalized.match(/([\d.]+)\s*万/);
  if (wan) return Number(wan[1] || 0) * 10000;
  const yuan = normalized.match(/([\d.]+)\s*元/);
  return yuan ? Number(yuan[1] || 0) : 0;
}

function notificationPriorityQueue(items = []) {
  const typeWeight = {
    "company-cash-runway": 100,
    "project-receivable-risk": 88,
    "approval-stale": 86,
    "project-cost-overrun": 84,
    "project-assignment": 78,
    "supplier-settlement-pending": 74,
    "project-task-due": 70,
    "project-progress-lag": 66,
    "project-cost-pressure": 62,
    "feishu-pending-file": 58,
    "verification-sheet-missing": 52,
    "collection-follow-up": 50
  };
  const now = Date.now();
  return items
    .map((item) => {
      const created = new Date(item.createdAt || item.updatedAt || now).getTime();
      const ageHours = Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 36e5)) : 0;
      const amount = parseNoticeAmount(`${item.text || ""} ${item.title || ""}`);
      const score = (typeWeight[item.type] || 40)
        + (item.severity === "高" ? 45 : item.severity === "中" ? 18 : 0)
        + Math.min(ageHours, 72) * 0.7
        + Math.min(amount / 10000, 30);
      const reason = item.severity === "高"
        ? "高优先级"
        : amount >= 100000
          ? `金额压力 ${money(amount)}`
          : ageHours >= 24
            ? `已等待 ${ageHours} 小时`
            : item.actionLabel || "建议今天处理";
      return { item, score, ageHours, amount, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function ProjectDashboard({ session, view, setView, onLogout }) {
  const [state, setState] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [activeSubView, setActiveSubView] = useState("项目大盘");
  const [openNav, setOpenNav] = useState({ dashboard: true });
  const [selectedId, setSelectedId] = useState("");
  const [projectFocus, setProjectFocus] = useState("");
  const [supplierFocusName, setSupplierFocusName] = useState("");
  const [clientFocusName, setClientFocusName] = useState("");
  const [role, setRole] = useState("全部角色");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMinimized, setUploadMinimized] = useState(false);
  const [uploadInitialType, setUploadInitialType] = useState("create-project");
  const [uploadTargetProject, setUploadTargetProject] = useState(null);
  const [uploadInitialFiles, setUploadInitialFiles] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dashboardAiCollapsed, setDashboardAiCollapsed] = useState(false);
  const [approvalFocusId, setApprovalFocusId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [handlingNotificationId, setHandlingNotificationId] = useState("");
  const [sendingNotificationId, setSendingNotificationId] = useState("");
  const [sendingWechatNotificationId, setSendingWechatNotificationId] = useState("");
  const [notificationLastAction, setNotificationLastAction] = useState(null);
  const [notice, setNotice] = useState("");
  const [exportingProjectLedger, setExportingProjectLedger] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [projectFilters, setProjectFilters] = useState({ risk: "全部风险", status: "全部状态", money: "全部资金", material: "全部材料" });
  const [health, setHealth] = useState(null);
  const isAdmin = ["shareholder", "admin"].includes(session?.role);
  const canManageAssignments = ["shareholder", "admin", "director"].includes(session?.role);
  const isManagement = canSeeManagement(session);
  const canCreateProject = canCreateProjectRole(session);
  const canUseCollection = canUseCollectionRole(session);
  const aiConfigured = Boolean(state?.settings?.aiService?.configured || state?.settings?.aiService?.["API Key"]);
  const feishuConfigured = Boolean(state?.settings?.feishu?.appId && state?.settings?.feishu?.appSecret);
  const wechatConfigured = Boolean(state?.settings?.wechat?.webhookUrl || state?.settings?.wechat?.corpId);
  const projects = useMemo(() => {
    const realProjects = Array.isArray(state?.projects) ? state.projects.map(normalizeProject) : [];
    return realProjects;
  }, [state]);
  const visibleProjects = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return projects.filter((project) => {
      const searchMatched = !query || [project.name, project.client, project.owner, project.pm, project.sales, project.status]
        .some((value) => String(value || "").toLowerCase().includes(query));
      const riskMatched = projectFilters.risk === "全部风险" || project.risk === projectFilters.risk;
      const statusMatched = projectFilters.status === "全部状态" || project.status === projectFilters.status;
      const moneyMatched = projectFilters.money === "全部资金"
        || (projectFilters.money === "有待回款" && Number(project.receivable || 0) > 0)
        || (projectFilters.money === "无待回款" && Number(project.receivable || 0) <= 0);
      const materialStatus = projectMaterialStatus(project, [], []);
      const materialMatched = projectFilters.material === "全部材料"
        || (projectFilters.material === "有材料缺口" && materialStatus.missing.length > 0)
        || (projectFilters.material === "材料较完整" && materialStatus.missing.length === 0);
      return searchMatched && riskMatched && statusMatched && moneyMatched && materialMatched;
    });
  }, [projects, searchText, projectFilters]);
  const hasProjectFilters = searchText.trim() || Object.values(projectFilters).some((value) => !String(value).startsWith("全部"));
  const selected = visibleProjects.find((project) => project.id === selectedId) || visibleProjects[0] || projects[0] || null;
  const systemNotifications = (state?.systemNotifications || []).filter((item) => item.status === "待处理");

  function loadState() {
    return fetch("/api/state", { headers: { authorization: `Bearer ${session.token || ""}` } })
      .then((res) => res.json())
      .then((payload) => {
        if (!payload.ok) throw new Error(payload.error || "读取项目数据失败");
        setState(payload.data);
        const first = payload.data?.projects?.[0];
        if (first?.id && !payload.data.projects.some((project) => project.id === selectedId)) setSelectedId(first.id);
      })
      .catch(() => setState({ projects: [] }));
  }

  useEffect(() => {
    loadState();
  }, [session.id]);

  useEffect(() => {
    if (!view.startsWith("admin")) loadState();
  }, [view]);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((payload) => setHealth(payload?.data || null))
      .catch(() => setHealth({ version: "无法读取", uploadProgress: false, prestartBuild: false }));
  }, []);

  useEffect(() => {
    if (view !== "app:create-project") return;
    setActiveView("dashboard");
    setActiveSubView("项目大盘");
    openUpload("create-project");
    setNotice("已打开新建项目上传，请上传合同或报价表，确认入库后就能回到项目分派。");
    setView("app");
  }, [view]);

  useEffect(() => {
    if (view.startsWith("admin") && uploadOpen) setUploadMinimized(true);
  }, [view, uploadOpen]);

  function openUpload(type = "create-project", targetProject = null, initialFiles = []) {
    if (targetProject?.id) setSelectedId(targetProject.id);
    setUploadTargetProject(targetProject || null);
    setUploadInitialType(type);
    setUploadInitialFiles(Array.isArray(initialFiles) ? initialFiles : []);
    setUploadOpen(true);
    setUploadMinimized(false);
  }

  function updateProjectFilter(field, value) {
    setProjectFilters((current) => ({ ...current, [field]: value }));
  }

  function clearProjectFilters() {
    setSearchText("");
    setProjectFilters({ risk: "全部风险", status: "全部状态", money: "全部资金", material: "全部材料" });
    setNotice("已清空搜索和项目筛选。");
  }

  function exportProjectLedger() {
    if (!visibleProjects.length) {
      setNotice("当前没有可导出的项目，请先清空筛选或上传合同创建项目。");
      return;
    }
    setExportingProjectLedger(true);
    try {
      const filename = `ad-project-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, projectLedgerRows(visibleProjects, isManagement));
      setNotice(`项目台账 CSV 已导出：${visibleProjects.length} 个项目${hasProjectFilters ? "（按当前筛选）" : ""}。`);
    } catch (error) {
      setNotice(error.message || "项目台账导出失败，请稍后再试。");
    } finally {
      setExportingProjectLedger(false);
    }
  }

  function openNotificationQuickAction(action = "") {
    if (action === "assignments" && canManageAssignments) {
      setView("admin:assignments");
      setNotificationsOpen(false);
      setNotice("已打开项目分派，可以检查是否有新项目需要 PM、销售或执行成员。");
      return;
    }
    if (action === "cash" && isManagement) {
      setActiveView("management");
      setActiveSubView("现金流压力");
      setNotificationsOpen(false);
      setNotice("已打开经营舱现金流压力页，可以检查 6 个月现金安全线。");
      return;
    }
    if (action === "create-project" && canCreateProject) {
      openUpload("create-project");
      setNotificationsOpen(false);
      setNotice("已打开新建项目上传，请上传合同或报价表。");
      return;
    }
    if (action === "approvals") {
      setActiveView("approvals");
      setActiveSubView("待我审批");
      setNotificationsOpen(false);
      setNotice("已打开审批工作台，可以提交或处理报销、备用金和供应商付款。");
      return;
    }
    if (action === "upload-file") {
      openUpload(selected ? "cost-sheet" : "create-project", selected);
      setNotificationsOpen(false);
      setNotice(selected ? `已打开「${selected.name}」的项目文件上传。` : "已打开新建项目上传。");
      return;
    }
    setActiveView("dashboard");
    setActiveSubView("我的项目");
    setProjectFocus("progress");
    setNotificationsOpen(false);
    setNotice("已打开我的项目，可以查看进度、文件、审批和回款。");
  }

  async function handleNotification(item, action = "resolve") {
    setHandlingNotificationId(item.id);
    try {
      await apiRequest("/api/notifications/action", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      const leftCount = Math.max(systemNotifications.length - 1, 0);
      setNotificationLastAction({
        id: item.id,
        tone: action === "ignore" ? "muted" : "done",
        text: `${action === "ignore" ? "已忽略" : "已处理"}：${item.title || item.projectName || "待办"}，刷新后还剩 ${leftCount} 条待办。`,
        canReopen: true,
        item
      });
      setNotice(`${action === "ignore" ? "通知已忽略" : "通知已标记处理"}，当前还剩 ${leftCount} 条待办。`);
      await loadState();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setHandlingNotificationId("");
    }
  }

  async function reopenNotification(item) {
    if (!item?.id) return;
    setHandlingNotificationId(item.id);
    try {
      await apiRequest("/api/notifications/action", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id, action: "reopen", note: "误操作后恢复待办" })
      });
      setNotificationLastAction({
        id: item.id,
        tone: "sent",
        text: `已恢复待办：${item.title || item.projectName || "待办"}，它会重新出现在列表里。`,
        canReopen: false,
        item
      });
      setNotice("待办已恢复，可以继续处理。");
      await loadState();
      setNotificationsOpen(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setHandlingNotificationId("");
    }
  }

  async function sendNotificationToFeishu(item) {
    setSendingNotificationId(item.id);
    try {
      const data = await apiRequest("/api/notifications/feishu/send", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id })
      });
      const okCount = (data.results || []).filter((row) => row.ok).length;
      const failCount = (data.results || []).filter((row) => !row.ok).length;
      const missingNames = (data.missingRecipients || []).map((row) => row.name || row.email || row.id).filter(Boolean);
      const totalCount = Number(data.total || (data.results || []).length + missingNames.length);
      const missingText = missingNames.length ? `缺少飞书绑定：${missingNames.slice(0, 4).join("、")}${missingNames.length > 4 ? `等 ${missingNames.length} 人` : ""}。` : "";
      setNotificationLastAction({
        id: item.id,
        tone: failCount || missingNames.length ? "warn" : "sent",
        text: totalCount ? `飞书已发送：${item.title || item.projectName || "待办"} · 成功 ${okCount}/${totalCount} 人。${missingText}` : `飞书未发送：${item.title || item.projectName || "待办"}，请检查成员飞书绑定。`
      });
      setNotice(totalCount ? `飞书通知已发送：成功 ${okCount}/${totalCount} 人。${missingText}` : "飞书通知未找到可发送对象，请检查成员飞书绑定。");
      await loadState();
    } catch (error) {
      const data = error.data || {};
      const missingNames = (data.missingRecipients || []).map((row) => row.name || row.email || row.id).filter(Boolean);
      const missingText = missingNames.length ? `缺少飞书绑定：${missingNames.slice(0, 4).join("、")}${missingNames.length > 4 ? `等 ${missingNames.length} 人` : ""}。` : "";
      setNotificationLastAction({
        id: item.id,
        tone: "warn",
        text: `飞书未发送：${item.title || item.projectName || "待办"}。${missingText || error.message}`
      });
      setNotice(missingText || error.message);
    } finally {
      setSendingNotificationId("");
    }
  }

  async function sendNotificationToWechat(item) {
    setSendingWechatNotificationId(item.id);
    try {
      const data = await apiRequest("/api/notifications/wechat/send", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id })
      });
      setNotificationLastAction({
        id: item.id,
        tone: "sent",
        text: `企业微信已发送：${item.title || item.projectName || "待办"}${data.mocked ? "（模拟）" : ""}。`
      });
      setNotice(`企业微信通知已发送${data.mocked ? "（模拟发送）" : ""}。`);
      await loadState();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSendingWechatNotificationId("");
    }
  }

  async function runSystemScan() {
    setScanning(true);
    try {
      const data = await apiRequest("/api/system/scan", session, { method: "POST", body: JSON.stringify({}) });
      setNotificationLastAction({
        id: "scan",
        tone: "sent",
        text: `智能巡检已完成，生成/更新 ${data.total || 0} 条待处理提醒。`
      });
      setNotice(`智能巡检完成：当前 ${data.total || 0} 条待处理提醒。`);
      await loadState();
      setNotificationsOpen(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setScanning(false);
    }
  }

  function openNotificationTarget(item) {
    if (item.projectId) setSelectedId(item.projectId);
    if (item.actionView === "admin:assignments" && canManageAssignments) {
      setView("admin:assignments");
      setNotice(`已打开项目分派：${item.projectName || item.title || "待分派项目"}。`);
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "approvals") {
      setActiveView("approvals");
      setActiveSubView("待我审批");
      setNotice(`已打开审批工作台：${item.projectName || item.title || "待处理审批"}。`);
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "management:cash" && isManagement) {
      setActiveView("management");
      setActiveSubView("现金流压力");
      setNotice("已打开经营舱现金流压力页，请按 6 个月安全线处理。");
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "collections" && canUseCollection) {
      setActiveView("collections");
      setActiveSubView("催收助手");
      setNotice(`已打开催收助手：${item.projectName || "待跟进项目"}。`);
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "project-files") {
      setActiveView("dashboard");
      setActiveSubView("我的项目");
      setProjectFocus("files");
      setNotice(`已打开「${item.projectName || "项目"}」的文件与 AI 解析区。`);
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "project-detail") {
      setActiveView("dashboard");
      setActiveSubView("我的项目");
      const target = ["project-receivable-risk", "supplier-settlement-pending"].includes(item.type) ? "payments" : "progress";
      setProjectFocus(target);
      setNotice(target === "payments"
        ? `已打开「${item.projectName || "项目"}」的回款流水区。`
        : item.type === "project-task-due"
          ? `已打开「${item.projectName || "项目"}」的任务进度区，请更新临期/逾期任务。`
          : `已打开「${item.projectName || "项目"}」的项目进度区。`);
      setNotificationsOpen(false);
      return;
    }
    setActiveView("dashboard");
    setActiveSubView("我的项目");
    setProjectFocus("");
    setNotice(`已打开相关项目：${item.projectName || item.title || "待办事项"}。`);
    setNotificationsOpen(false);
  }

  function openAiAction(action = {}, projectId = "") {
    const targetId = projectId || action.projectId || selected?.id || visibleProjects[0]?.id || projects[0]?.id || "";
    const target = visibleProjects.find((project) => project.id === targetId) || projects.find((project) => project.id === targetId) || selected;
    if (target?.id) setSelectedId(target.id);
    if (action.view === "approvals") {
      setActiveView("approvals");
      setActiveSubView(action.subView || "待我审批");
      setApprovalFocusId("");
      setNotice(action.notice || `已打开「${target?.name || "当前项目"}」的${action.subView || "审批"}。`);
      return;
    }
    if (action.view === "collections" && canUseCollection) {
      setActiveView("collections");
      setActiveSubView("催收助手");
      setNotice(action.notice || `已打开催收助手：${target?.name || "当前项目"}。`);
      return;
    }
    if (action.view === "management" && isManagement) {
      setActiveView("management");
      setActiveSubView(action.subView || "公司大盘");
      setNotice(action.notice || "已打开经营舱。");
      return;
    }
    setActiveView("dashboard");
    setActiveSubView("我的项目");
    setProjectFocus(action.focus || "progress");
    setNotice(action.notice || `已打开「${target?.name || "当前项目"}」的项目详情。`);
  }

  const stats = useMemo(() => {
    const contract = visibleProjects.reduce((sum, item) => sum + item.contract, 0);
    const used = visibleProjects.reduce((sum, item) => sum + item.costUsed, 0);
    const paid = visibleProjects.reduce((sum, item) => sum + item.paid, 0);
    const receivable = visibleProjects.reduce((sum, item) => sum + item.receivable, 0);
    return { contract, used, paid, receivable };
  }, [visibleProjects]);

  const progressOption = useMemo(() => ({
    tooltip: { trigger: "item" },
    color: ["#3370ff", "#14b8a6", "#f6c453", "#f87171"],
    textStyle: { color: "#4e5969", fontFamily: "Inter, PingFang SC, Microsoft YaHei, Arial, sans-serif", fontSize: 12 },
    series: [
      {
        type: "pie",
        radius: ["54%", "72%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#ffffff", borderWidth: 3 },
        label: { color: "#4e5969", fontSize: 12 },
        labelLine: { lineStyle: { color: "#c9d2e3" } },
        data: [
          { value: visibleProjects.filter((item) => item.status === "执行中").length, name: "执行中" },
          { value: visibleProjects.filter((item) => item.status === "已完成").length, name: "已完成" },
          { value: visibleProjects.filter((item) => item.status === "筹备中" || item.status === "草稿").length, name: "筹备中" },
          { value: visibleProjects.filter((item) => item.risk === "高").length, name: "高风险" },
        ].filter((item) => item.value > 0),
      },
    ],
  }), [visibleProjects]);

  const cashOption = useMemo(() => ({
    grid: { left: 46, right: 14, top: 24, bottom: 32 },
    tooltip: { trigger: "axis" },
    textStyle: { color: "#4e5969", fontFamily: "Inter, PingFang SC, Microsoft YaHei, Arial, sans-serif", fontSize: 12 },
    xAxis: {
      type: "category",
      data: visibleProjects.map((item) => item.client),
      axisLabel: { interval: 0, color: "#6b778c", fontSize: 12 },
      axisLine: { lineStyle: { color: "#d8dee9" } },
      axisTick: { show: false }
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v) => `${v / 10000}万`, color: "#6b778c", fontSize: 12 },
      splitLine: { lineStyle: { color: "#edf1f7" } }
    },
    color: ["#3370ff", "#8fb4ff"],
    series: [
      { name: "已回款", type: "bar", data: visibleProjects.map((item) => item.paid), barMaxWidth: 22, itemStyle: { borderRadius: [5, 5, 0, 0] } },
      { name: "待回款", type: "bar", data: visibleProjects.map((item) => item.receivable), barMaxWidth: 22, itemStyle: { borderRadius: [5, 5, 0, 0] } },
    ],
  }), [visibleProjects]);

  const costOption = useMemo(() => ({
    grid: { left: 66, right: 34, top: 24, bottom: 24 },
    tooltip: { trigger: "axis" },
    textStyle: { color: "#4e5969", fontFamily: "Inter, PingFang SC, Microsoft YaHei, Arial, sans-serif", fontSize: 12 },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { formatter: "{value}%", color: "#6b778c", fontSize: 12 },
      splitLine: { lineStyle: { color: "#edf1f7" } }
    },
    yAxis: {
      type: "category",
      data: visibleProjects.map((item) => item.pm),
      axisLabel: { color: "#6b778c", fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    color: ["#14b8a6"],
    series: [
      {
        type: "bar",
        data: visibleProjects.map((item) => item.costBudget ? Math.round((item.costUsed / item.costBudget) * 100) : 0),
        label: { show: true, position: "right", formatter: "{c}%", color: "#4e5969", fontSize: 12 },
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 6, 6, 0] }
      },
    ],
  }), [visibleProjects]);

  const visibleAlerts = visibleProjects
    .flatMap((project) => {
      const health = projectHealth(project);
      const alerts = project.alerts.length ? project.alerts : [{ role: "PM", type: `进度${health.label}`, text: health.text }];
      return alerts.map((alert) => ({ ...alert, project: project.name }));
    })
    .concat((state?.feishuPendingFiles || [])
      .filter((item) => item.status === "待确认")
      .map((item) => ({
        role: "PM",
        type: "飞书文件待确认",
        severity: "中",
        project: item.projectName || "待匹配项目",
        text: `飞书文件「${item.file?.name || item.preview?.fileName || "未命名文件"}」等待确认入库，确认前不会影响项目成本/报价/核销。`
      })))
    .filter((alert) => role === "全部角色" || alert.role === role);

  const navGroups = [
    {
      key: "dashboard",
      icon: LayoutDashboard,
      label: "项目工作台",
      children: [
        ["dashboard", "项目大盘"],
        ["my-projects", "我的项目"]
      ]
    },
    {
      key: "ai",
      icon: Bot,
      label: "AI 助手"
    },
    {
      key: "approvals",
      icon: BellRing,
      label: "审批与备用金",
      children: [
        ["approvals", "待我审批"],
        ["approvals", "项目备用金"],
        ["approvals", "报销"],
        ["approvals", "供应商付款"]
      ]
    },
    {
      key: "closeout",
      icon: FileSpreadsheet,
      label: "成本复盘",
      children: [
        ["closeout", "结案复盘"],
        ["closeout", "支出排行"]
      ]
    },
    {
      key: "suppliers",
      icon: UsersRound,
      label: "供应商库"
    },
    {
      key: "clients",
      icon: MessageSquareText,
      label: "客户偏好"
    },
    ...(canUseCollection ? [{
      key: "collections",
      icon: MessagesSquare,
      label: "催收助手"
    }] : []),
    ...(isManagement ? [{
      key: "management",
      icon: BarChart3,
      label: "经营舱",
      children: [
        ["management", "公司大盘"],
        ["management", "现金流压力"],
        ["management", "AI 商业顾问"]
      ]
    }] : []),
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">A</div>
          <div>
            <strong>广告项目中台</strong>
            <span>经营 / 执行 / 回款</span>
          </div>
        </div>
        <nav>
          {navGroups.map(({ key, icon: Icon, label, children }) => (
            <div className={`nav-group ${openNav[key] ? "open" : ""}`} key={key}>
              <button
                type="button"
                className={`nav-parent ${activeView === key ? "active" : ""}`}
                onClick={() => {
                  if (children?.length) {
                    setOpenNav((current) => ({ ...current, [key]: !current[key] }));
                    if (activeView !== key) {
                      setActiveView(key);
                      setActiveSubView(children[0][1]);
                    }
                    return;
                  }
                  setActiveView(key);
                  setActiveSubView("");
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                {!!children?.length && <ChevronRight className="nav-caret" size={15} />}
              </button>
              {!!children?.length && <div className="nav-children">
                {children.map(([, child]) => (
                  <button
                    type="button"
                    className={activeView === key && activeSubView === child ? "active" : ""}
                    key={`${key}-${child}`}
                    onClick={() => {
                      setActiveView(key);
                      setActiveSubView(child);
                    }}
                  >
                    {child}
                  </button>
                ))}
              </div>}
            </div>
          ))}
          {canManageAssignments && (
            <button
              type="button"
              className={`nav-admin-entry ${view === "admin" ? "active" : ""}`}
              onClick={() => setView(isAdmin ? "admin" : "admin:assignments")}
            >
              <Settings2 size={18} />{isAdmin ? "后台管理" : "项目分派"}
            </button>
          )}
        </nav>
        <div className="integration">
          <p>{session.name} · {roleLabel(session.role)}</p>
          <button
            type="button"
            className={`deploy-health ${health?.version === BUILD_VERSION ? "ok" : "warn"}`}
            onClick={() => {
              if (isAdmin) {
                setView("admin:product");
                return;
              }
              setNotice(health?.version === BUILD_VERSION
                ? `当前线上版本正确：${BUILD_VERSION}`
                : `当前线上版本可能不是最新。页面版本：${BUILD_VERSION}，服务端版本：${health?.version || "未读取"}。请重新部署或清理旧 dist。`);
            }}
          >
            <CheckCircle2 size={15} />
            <span>{health?.version === BUILD_VERSION ? "版本已更新" : "版本待确认"}</span>
          </button>
          <button type="button" onClick={() => {
            if (isAdmin) {
              setView("admin:product");
              return;
            }
            setNotice(feishuConfigured ? "飞书机器人已配置，群文件会进入待确认队列。" : "飞书未配置，请联系管理员接入机器人。");
          }}><MessageSquareText size={16} />飞书机器人</button>
          <button type="button" onClick={() => {
            if (isAdmin) {
              setView("admin:product");
              return;
            }
            setNotice(wechatConfigured ? "企业微信已配置，可用于通知和协同提醒。" : "企业微信未配置，请联系管理员接入。");
          }}><MessageSquareText size={16} />企业微信</button>
          <button type="button" onClick={onLogout}><LogOut size={16} />退出登录</button>
        </div>
      </aside>

      <main className={activeView === "dashboard" && activeSubView === "项目大盘" ? "dashboard-main" : ""}>
        <header className="topbar">
          <div>
            <h1>项目经营驾驶舱</h1>
            <p>{isManagement ? "公司经营、项目执行、资金压力与 AI 建议集中管理" : "我的项目、备用金、报销、文件归档和内容辅助"}</p>
          </div>
          <div className="actions">
            <div className="search"><Search size={16} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索项目、客户、负责人" /></div>
            <button type="button" className="ghost" onClick={() => setFilterOpen(!filterOpen)}><Filter size={16} />筛选</button>
            <button type="button" className="ghost" disabled={exportingProjectLedger || !visibleProjects.length} onClick={exportProjectLedger}>
              <FileSpreadsheet size={16} />{exportingProjectLedger ? "导出中" : "导出台账"}
            </button>
            <button type="button" className={`ghost notification-trigger ${systemNotifications.length ? "has-items" : ""}`} onClick={() => setNotificationsOpen(true)}>
              <BellRing size={16} />待办
              {systemNotifications.length > 0 && <b>{systemNotifications.length}</b>}
            </button>
            {isAdmin && <button type="button" className="ghost" onClick={() => setView("admin")}><UserCog size={16} />成员管理</button>}
            {isAdmin && <button type="button" className={aiConfigured ? "ghost" : "ghost warning"} onClick={() => setView("admin:ai")}><Bot size={16} />{aiConfigured ? "AI 已接入" : "接入 AI"}</button>}
            {canCreateProject && <button type="button" className="primary" onClick={() => openUpload("create-project")}><Plus size={16} />新建项目</button>}
          </div>
        </header>
        {isAdmin && health?.nodeEnv === "production" && (!health.productionPersistenceReady || !health.filePersistenceReady) && (
          <div className="production-risk-bar">
            <span><AlertTriangle size={16} />当前仍是测试级存储：{!health.productionPersistenceReady ? "业务数据未接 PostgreSQL" : ""}{!health.productionPersistenceReady && !health.filePersistenceReady ? "；" : ""}{!health.filePersistenceReady ? "合同/票据未接对象存储" : ""}</span>
            <button type="button" onClick={() => setView("admin:product")}>去完成生产配置</button>
          </div>
        )}
        {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>知道了</button></div>}
        {notificationsOpen && <NotificationDrawer
          items={systemNotifications}
          onClose={() => setNotificationsOpen(false)}
          onOpenTarget={openNotificationTarget}
          onQuickAction={openNotificationQuickAction}
          onAction={handleNotification}
          onReopen={reopenNotification}
          onSendFeishu={sendNotificationToFeishu}
          onSendWechat={sendNotificationToWechat}
          handlingId={handlingNotificationId}
          sendingFeishuId={sendingNotificationId}
          sendingWechatId={sendingWechatNotificationId}
          lastAction={notificationLastAction}
          onScan={runSystemScan}
          canScan={isManagement}
          canManageAssignments={canManageAssignments}
          canCreateProject={canCreateProject}
          isManagement={isManagement}
          hasProject={Boolean(selected)}
          scanning={scanning}
        />}
        {filterOpen && <div className="filter-panel">
          <div className="filter-group">
            <strong>提醒角色</strong>
            <div>
              <button type="button" className={role === "全部角色" ? "active" : ""} onClick={() => setRole("全部角色")}>全部提醒</button>
              {["PM", "销售", "管理层"].map((item) => (
                <button type="button" className={role === item ? "active" : ""} key={item} onClick={() => setRole(item)}>{item}</button>
              ))}
            </div>
          </div>
          <label>
            <span>项目风险</span>
            <select value={projectFilters.risk} onChange={(event) => updateProjectFilter("risk", event.target.value)}>
              {["全部风险", "高", "中", "低"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>项目状态</span>
            <select value={projectFilters.status} onChange={(event) => updateProjectFilter("status", event.target.value)}>
              {["全部状态", "执行中", "筹备中", "草稿", "已完成"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>资金状态</span>
            <select value={projectFilters.money} onChange={(event) => updateProjectFilter("money", event.target.value)}>
              {["全部资金", "有待回款", "无待回款"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>材料状态</span>
            <select value={projectFilters.material} onChange={(event) => updateProjectFilter("material", event.target.value)}>
              {["全部材料", "有材料缺口", "材料较完整"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          {hasProjectFilters && <button type="button" className="ghost" onClick={clearProjectFilters}>清空筛选</button>}
        </div>}

        {!projects.length && activeView !== "management" && (
          <EmptyProjectState
            isManagement={isManagement}
            canManageAssignments={canManageAssignments}
            canCreateProject={canCreateProject}
            onUpload={() => openUpload("create-project")}
            onAdmin={() => setView("admin")}
            onAssignments={() => setView("admin:assignments")}
            isAdmin={isAdmin}
          />
        )}

        {!!projects.length && !visibleProjects.length && (
          <section className="empty-project-state">
            <div>
              <PanelTitle icon={Search} title="没有匹配的项目" />
              <h2>当前搜索或筛选没有结果。</h2>
              <p>换一个项目名、客户名、负责人、PM，或清空项目筛选条件。</p>
              <button type="button" className="ghost" onClick={clearProjectFilters}>清空搜索和筛选</button>
            </div>
          </section>
        )}

        {!!visibleProjects.length && activeView === "ai" && <AiWorkbench
          session={session}
          projects={visibleProjects}
          approvals={state?.approvals || []}
          settings={state?.settings || {}}
          stats={stats}
          selected={selected}
          onUpload={(type = selected ? "cost-sheet" : "create-project", targetProject = selected) => openUpload(type, targetProject)}
          onSelectProject={setSelectedId}
          onNavigate={openAiAction}
          onDone={() => loadState()}
          onNotice={setNotice}
          onApprovalCreated={(approval) => {
            if (approval?.projectId) setSelectedId(approval.projectId);
            setApprovalFocusId(approval?.id || "");
            setActiveView("approvals");
            setActiveSubView("待我审批");
          }}
        />}
        {!!visibleProjects.length && activeView === "approvals" && <ApprovalFunds
          projects={visibleProjects}
          approvals={state?.approvals || []}
          selected={selected}
          session={session}
          subView={activeSubView}
          setSubView={setActiveSubView}
          focusApprovalId={approvalFocusId}
          onFocusConsumed={() => setApprovalFocusId("")}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "closeout" && <CloseoutReview
          project={selected}
          isManagement={isManagement}
          session={session}
          subView={activeSubView}
          onNotice={setNotice}
          onSetSubView={setActiveSubView}
          onUpload={(type = "cost-sheet", targetProject = selected) => openUpload(type, targetProject)}
          onDone={() => loadState()}
          onOpenProjectSection={(target, message) => {
            setActiveView("dashboard");
            setActiveSubView("我的项目");
            setProjectFocus(target);
            if (message) setNotice(message);
          }}
          onOpenSupplier={(supplier) => {
            const name = supplier?.supplier || "";
            if (!name) return;
            setSupplierFocusName(name);
            setActiveView("suppliers");
            setActiveSubView("供应商库");
            setNotice(`已从结案复盘打开供应商画像：${name}。`);
          }}
          onOpenCollection={() => {
            setActiveView("collections");
            setActiveSubView("催收助手");
            setNotice(`已打开催收助手：${selected.name} 当前待回款 ${money(selected.receivable)}。`);
          }}
        />}
        {!!visibleProjects.length && activeView === "suppliers" && <SupplierLibrary
          suppliers={state?.supplierProfiles || []}
          settlements={state?.suppliers || []}
          projects={visibleProjects}
          session={session}
          focusSupplierName={supplierFocusName}
          onFocusConsumed={() => setSupplierFocusName("")}
          onUpload={(type = "cost-sheet", targetProject = selected) => openUpload(type, targetProject)}
          onOpenProjects={() => {
            setActiveView("dashboard");
            setActiveSubView("我的项目");
            setProjectFocus("files");
            setNotice("已回到我的项目，可以先选择项目并上传成本表，供应商会自动沉淀到供应商库。");
          }}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "clients" && <ClientLibrary
          clients={state?.clientProfiles || []}
          projects={visibleProjects}
          session={session}
          focusClientName={clientFocusName}
          onFocusConsumed={() => setClientFocusName("")}
          onUpload={(type = "create-project", targetProject = null) => openUpload(type, targetProject)}
          onOpenProjects={() => {
            setActiveView("dashboard");
            setActiveSubView("我的项目");
            setProjectFocus("client");
            setNotice("已回到我的项目，可以从项目里的客户交接摘要继续维护偏好和雷区。");
          }}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "collections" && <CollectionAssistant
          projects={visibleProjects}
          scripts={state?.collectionScripts || []}
          session={session}
          onOpenProjectPayments={(project = selected) => {
            if (project?.id) setSelectedId(project.id);
            setActiveView("dashboard");
            setActiveSubView("我的项目");
            setProjectFocus("payments");
            setNotice(`已打开「${project?.name || "当前项目"}」的回款记录区，可以记录回款或检查尾款状态。`);
          }}
          onUploadVerification={(project = selected) => openUpload("verification-sheet", project)}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {activeView === "management" && isManagement && <ManagementCockpit
          projects={projects}
          approvals={state?.approvals || []}
          settings={state?.settings || {}}
          session={session}
          stats={stats}
          subView={activeSubView}
          setSubView={setActiveSubView}
          onOpenApprovals={() => {
            setActiveView("approvals");
            setActiveSubView("待我审批");
            setNotice("已打开审批工作台，优先处理备用金、报销和供应商付款。");
          }}
          onOpenCollections={(project = null) => {
            if (project?.id) setSelectedId(project.id);
            setActiveView("collections");
            setActiveSubView("催收助手");
            setNotice(project?.name ? `已打开催收助手：优先跟进 ${project.name} 待回款。` : "已打开催收助手，优先处理待回款项目。");
          }}
          onOpenProjectSection={(project = null, focus = "progress", message = "") => {
            if (project?.id) setSelectedId(project.id);
            setActiveView("dashboard");
            setActiveSubView("我的项目");
            setProjectFocus(focus);
            setNotice(message || `已打开「${project?.name || "项目"}」的${focus === "costs" ? "成本与审批区" : focus === "payments" ? "回款记录区" : "项目进度区"}。`);
          }}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}

        {!!visibleProjects.length && activeView === "dashboard" && activeSubView === "项目大盘" && (
          <section className={`overview-layout ${dashboardAiCollapsed ? "ai-collapsed" : ""}`}>
            <div className="overview-center">
              {isManagement ? (
                <ProjectOverview
                  stats={stats}
                  cashOption={cashOption}
                  progressOption={progressOption}
                  costOption={costOption}
                  role={role}
                  setRole={setRole}
                  visibleAlerts={visibleAlerts}
                />
              ) : (
                <EmployeeProjectOverview
                  projects={visibleProjects}
                  selected={selected}
                  feishuPendingFiles={state?.feishuPendingFiles || []}
                  onSelect={setSelectedId}
                  onUpload={() => openUpload("cost-sheet")}
                  onOpenProject={(focus = "progress") => {
                    setActiveSubView("我的项目");
                    setProjectFocus(focus);
                    setNotice(focus === "approvals"
                      ? "已打开我的项目审批区，可以提交报销、备用金或查看流程。"
                      : focus === "files"
                        ? "已打开我的项目文件区，可以上传项目资料或查看 AI 解析进度。"
                        : "已打开我的项目进度区，可以新增任务或更新完成度。");
                  }}
                />
              )}
            </div>
            <DashboardAiPanel
              session={session}
              projects={visibleProjects}
              approvals={state?.approvals || []}
              settings={state?.settings || {}}
              stats={stats}
              selected={selected}
              onUpload={(type = selected ? "cost-sheet" : "create-project", targetProject = selected) => openUpload(type, targetProject)}
              onSelectProject={setSelectedId}
              onNavigate={openAiAction}
              onDone={() => loadState()}
              onNotice={setNotice}
              collapsed={dashboardAiCollapsed}
              onToggleCollapsed={() => setDashboardAiCollapsed((value) => !value)}
              onApprovalCreated={(approval) => {
                if (approval?.projectId) setSelectedId(approval.projectId);
                setApprovalFocusId(approval?.id || "");
                setActiveView("approvals");
                setActiveSubView("待我审批");
              }}
            />
          </section>
        )}

        {!!visibleProjects.length && activeView === "dashboard" && activeSubView === "我的项目" && (
          <section className="workspace">
            <div className="project-list">
              <div className="section-head">
                <h2>我的项目</h2>
                <button type="button" onClick={() => openUpload(selected ? "cost-sheet" : "create-project")}><UploadCloud size={16} />上传项目文件</button>
              </div>
              {visibleProjects.map((project) => (
                <button
                  type="button"
                  className={`project-row ${project.id === selectedId ? "selected" : ""}`}
                  key={project.id}
                  onClick={() => setSelectedId(project.id)}
                >
                  <div>
                    <strong>{project.name}</strong>
                    <span>{project.client} · {project.sales} / {project.pm}</span>
                  </div>
                  <div className="row-right">
                    <RiskBadge risk={project.risk} />
                    <span>{project.progress}%</span>
                    <ChevronRight size={16} />
                  </div>
                </button>
              ))}
            </div>

            <ProjectDetail
              project={selected}
              isManagement={isManagement}
              session={session}
              files={state?.files || []}
              parseJobs={state?.parseJobs || []}
              approvals={state?.approvals || []}
              suppliers={state?.suppliers || []}
              clients={state?.clientProfiles || []}
              payments={state?.payments || []}
              collectionScripts={state?.collectionScripts || []}
              feishuPendingFiles={state?.feishuPendingFiles || []}
              comments={state?.comments || []}
              alertUpdates={state?.alertUpdates || []}
              auditLogs={state?.auditLogs || []}
              focusTarget={projectFocus}
              onFocusConsumed={() => setProjectFocus("")}
              onOpenApproval={(approval) => {
                if (approval?.projectId) setSelectedId(approval.projectId);
                setApprovalFocusId(approval?.id || "");
                setActiveView("approvals");
                setActiveSubView(approval?.type === "petty_cash" ? "项目备用金" : approval?.type === "reimbursement" ? "报销" : approval?.type === "supplier_payment" ? "供应商付款" : "待我审批");
                setNotice(`已打开审批流程：${approval?.typeLabel || approval?.category || "审批"} ${money(approval?.amount)}。`);
              }}
              onOpenSupplier={(supplier) => {
                const name = supplier?.supplier || "";
                if (!name) return;
                setSupplierFocusName(name);
                setActiveView("suppliers");
                setActiveSubView("供应商库");
                setNotice(`已打开供应商画像：${name}。`);
              }}
              onOpenClient={(client) => {
                const name = client?.client || project.client || "";
                if (!name) return;
                setClientFocusName(name);
                setActiveView("clients");
                setActiveSubView("客户偏好");
                setNotice(`已打开客户档案：${name}。`);
              }}
              onDone={() => loadState()}
              onNotice={setNotice}
            />
          </section>
        )}
        {uploadOpen && <UploadDialog
          session={session}
          projects={projects}
          selected={uploadTargetProject || selected}
          initialType={uploadInitialType}
          initialFiles={uploadInitialFiles}
          minimized={uploadMinimized}
          onMinimize={() => setUploadMinimized(true)}
          onExpand={() => setUploadMinimized(false)}
          onClose={() => {
            setUploadOpen(false);
            setUploadMinimized(false);
            setUploadTargetProject(null);
            setUploadInitialFiles([]);
          }}
          onDone={async () => {
            await loadState();
            setUploadTargetProject(null);
            setUploadInitialFiles([]);
          }}
        />}
      </main>
    </div>
  );
}

function NotificationDrawer({
  items = [],
  onClose,
  onOpenTarget,
  onQuickAction,
  onAction,
  onReopen,
  onSendFeishu,
  onSendWechat,
  handlingId = "",
  sendingFeishuId = "",
  sendingWechatId = "",
  lastAction = null,
  onScan,
  canScan,
  canManageAssignments,
  canCreateProject,
  isManagement,
  hasProject,
  scanning
}) {
  const highCount = items.filter((item) => item.severity === "高").length;
  const priorityQueue = notificationPriorityQueue(items);
  function nextStepText(item = {}) {
    if (item.actionView === "admin:assignments") return "下一步：打开项目分派，确认 PM 和执行人员。";
    if (item.actionView === "approvals") return "下一步：进入审批工作台，通过、驳回或查看流程。";
    if (item.actionView === "management:cash") return "下一步：查看现金流压力，按 6 个月安全线处理。";
    if (item.actionView === "project-files") return "下一步：打开文件与 AI 解析区，确认资料是否入库。";
    if (item.type === "collection-follow-up" || item.actionView === "collections") return "下一步：打开催收助手，按计划继续跟进客户。";
    if (item.type === "project-task-due") return "下一步：打开项目进度区，更新任务进度或标记完成。";
    if (item.type === "supplier-settlement-pending") return "下一步：打开供应商结算区，确认付款审批或标记已付款。";
    if (item.type === "project-receivable-risk") return "下一步：打开回款记录，生成催收建议或记录回款。";
    if (["project-cost-pressure", "project-cost-overrun"].includes(item.type)) return "下一步：打开项目进度区，核对执行预算、已发生成本和后续支出。";
    if (item.actionView === "project-detail") return "下一步：打开项目详情，检查进度、材料和待处理事项。";
    return "下一步：打开相关页面处理这个待办。";
  }
  return (
    <div className="notification-backdrop" onClick={onClose}>
      <aside className="notification-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="notification-head">
          <div>
            <span>智能待办</span>
            <h2>需要处理的 OA 提醒</h2>
            <p>{highCount ? `${highCount} 个高优先级事项需要先看。` : "系统会从项目、审批和飞书文件里自动扫描。"}</p>
          </div>
          <div className="notification-head-actions">
            {canScan && <button type="button" className="ghost" onClick={onScan} disabled={scanning}>{scanning ? "巡检中" : "立即巡检"}</button>}
            <button type="button" className="ghost" onClick={onClose}>关闭</button>
          </div>
        </div>
        {lastAction?.text && <div className={`notification-last-action ${lastAction.tone || ""}`}>
          <strong>最近操作</strong>
          <span>{lastAction.text}</span>
          {lastAction.canReopen && <button type="button" className="ghost tiny" disabled={handlingId === lastAction.id} onClick={() => onReopen?.(lastAction.item)}>
            {handlingId === lastAction.id ? "恢复中" : "恢复待办"}
          </button>}
        </div>}
        {priorityQueue.length > 0 && <div className="notification-priority-panel">
          <div>
            <strong>今天先处理</strong>
            <span>按高危、等待时间、金额压力和业务类型自动排序。</span>
          </div>
          {priorityQueue.map(({ item, reason, ageHours, amount }) => (
            <button type="button" key={`priority-${item.id}`} onClick={() => onOpenTarget(item)}>
              <b className={item.severity === "高" ? "danger" : ""}>{item.severity === "高" ? "先看" : "建议"}</b>
              <strong>{item.title}</strong>
              <span>{item.projectName || "公司"} · {reason}{ageHours ? ` · 等待 ${ageHours}h` : ""}</span>
              <em>{amount ? `涉及 ${money(amount)}` : item.actionLabel || "打开处理"}</em>
            </button>
          ))}
        </div>}
        <div className="notification-list">
          {items.length ? items.map((item) => (
            <div className={`notification-card ${item.severity === "高" ? "high" : ""} ${lastAction?.id === item.id ? "fresh" : ""}`} key={item.id}>
              <div className="notification-title">
                <strong>{item.title}</strong>
                <span>{item.severity || "中"}</span>
              </div>
              <p>{item.text}</p>
              <em>{item.projectName || "系统"} · {item.source || "scanner"}</em>
              <small className="notification-next-step">{nextStepText(item)}</small>
              <div className="notification-actions">
                <button type="button" className="primary" onClick={() => onOpenTarget(item)}>{item.actionLabel || "查看"}</button>
                <button type="button" className="ghost" disabled={sendingFeishuId === item.id} onClick={() => onSendFeishu(item)}>{sendingFeishuId === item.id ? "发送中" : "发送飞书"}</button>
                <button type="button" className="ghost" disabled={sendingWechatId === item.id} onClick={() => onSendWechat(item)}>{sendingWechatId === item.id ? "发送中" : "发送企业微信"}</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "resolve")}>{handlingId === item.id ? "处理中" : "标记处理"}</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "ignore")}>{handlingId === item.id ? "处理中" : "忽略"}</button>
              </div>
              {item.feishuDelivery?.sentAt && <small className="notification-delivery">飞书已发送 · {new Date(item.feishuDelivery.sentAt).toLocaleString("zh-CN", { hour12: false })}</small>}
              {item.feishuDelivery?.missingRecipients?.length > 0 && <small className="notification-delivery warn">未收到飞书：{item.feishuDelivery.missingRecipients.map((row) => row.name || row.email || row.id).slice(0, 4).join("、")}{item.feishuDelivery.missingRecipients.length > 4 ? `等 ${item.feishuDelivery.missingRecipients.length} 人` : ""}</small>}
              {item.wechatDelivery?.sentAt && <small className="notification-delivery">企业微信已发送 · {new Date(item.wechatDelivery.sentAt).toLocaleString("zh-CN", { hour12: false })}</small>}
            </div>
          )) : (
            <div className="notification-empty">
              <CheckCircle2 size={22} />
              <strong>当前没有待办</strong>
              <span>项目分派、飞书文件、逾期审批出现时会自动进入这里。</span>
              <div className="notification-empty-actions">
                {canScan && <button type="button" className="ghost tiny" onClick={onScan} disabled={scanning}>{scanning ? "巡检中" : "立即巡检一次"}</button>}
                {canManageAssignments && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("assignments")}>项目分派</button>}
                {isManagement && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("cash")}>现金流压力</button>}
                <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("approvals")}>审批工作台</button>
                {hasProject && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("dashboard")}>我的项目</button>}
                {canCreateProject
                  ? <button type="button" className="primary tiny" onClick={() => onQuickAction?.("create-project")}>上传合同创建项目</button>
                  : hasProject && <button type="button" className="primary tiny" onClick={() => onQuickAction?.("upload-file")}>上传项目材料</button>}
              </div>
              {!canScan && <small>普通成员只会看到自己项目相关提醒。</small>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="metric">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{sub}</p>
    </div>
  );
}

function ProjectOverview({ stats, cashOption, progressOption, costOption, role, setRole, visibleAlerts }) {
  const payRate = stats.contract ? Math.round((stats.paid / stats.contract) * 100) : 0;
  return (
    <>
      <section className="metrics">
        <Metric icon={CircleDollarSign} label="合同总额" value={money(stats.contract)} sub="本年度已归档项目" />
        <Metric icon={CheckCircle2} label="已回款" value={money(stats.paid)} sub={`回款率 ${payRate}%`} />
        <Metric icon={Clock3} label="待回款" value={money(stats.receivable)} sub="含逾期与未到期" />
        <Metric icon={ShieldAlert} label="成本消耗" value={money(stats.used)} sub="按执行表实时归集" />
      </section>

      <section className="dashboard-grid">
        <div className="panel wide">
          <PanelTitle icon={BarChart3} title="回款分布" />
          <LazyChart option={cashOption} />
        </div>
        <div className="panel">
          <PanelTitle icon={LayoutDashboard} title="进度结构" />
          <LazyChart option={progressOption} />
        </div>
        <div className="panel">
          <PanelTitle icon={AlertTriangle} title="PM 成本压力" />
          <LazyChart option={costOption} />
        </div>
        <div className="panel alert-panel">
          <div className="panel-row">
            <PanelTitle icon={BellRing} title="智能预警" />
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option>全部角色</option>
              <option>PM</option>
              <option>销售</option>
              <option>管理层</option>
            </select>
          </div>
          <div className="alert-list">
            {visibleAlerts.map((alert, index) => (
              <div className="alert-item" key={`${alert.project}-${index}`}>
                <strong>{alert.type}</strong>
                <span>{alert.role} · {alert.project}</span>
                <p>{alert.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function EmptyProjectState({ isManagement, isAdmin, canManageAssignments, canCreateProject, onUpload, onAdmin, onAssignments }) {
  return (
    <section className="empty-project-state">
      <div>
        <PanelTitle icon={FileText} title="还没有真实项目" />
        <h2>{canCreateProject ? "先上传第一份合同或报价表，OA 才会开始生成项目数据。" : "你当前还没有被分派到项目。"}</h2>
        <p>{canCreateProject
          ? (isManagement ? "上传后会自动进入项目台账、审批、回款、成本复盘和经营舱统计。" : "上传后可以进入我的项目继续归集成本、核销和审批。")
          : "请让管理员或总监在后台的项目分派里把你加入项目；分派后这里会自动出现你的项目进度、任务、备用金和上传入口。"}</p>
        <div className="button-row">
          {canCreateProject && <button type="button" className="primary" onClick={onUpload}><UploadCloud size={16} />上传合同创建项目</button>}
          {isAdmin && <button type="button" className="ghost" onClick={onAdmin}><UserCog size={16} />成员与权限</button>}
          {canManageAssignments && <button type="button" className="ghost" onClick={onAssignments}><UserCog size={16} />项目分派</button>}
        </div>
      </div>
      <div className="empty-steps">
        {canCreateProject ? <>
          <div><strong>1</strong><span>上传合同 / 报价表</span></div>
          <div><strong>2</strong><span>AI 预览识别字段</span></div>
          <div><strong>3</strong><span>确认入库生成项目</span></div>
          <div><strong>4</strong><span>审批、回款、成本复盘开始流转</span></div>
        </> : <>
          <div><strong>1</strong><span>联系管理员分派项目</span></div>
          <div><strong>2</strong><span>进入我的项目工作台</span></div>
          <div><strong>3</strong><span>上传成本 / 核销 / 报销</span></div>
          <div><strong>4</strong><span>查看进度、任务和 AI 提醒</span></div>
        </>}
      </div>
    </section>
  );
}

function EmployeeProjectOverview({ projects, selected, feishuPendingFiles = [], onSelect, onUpload, onOpenProject }) {
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const health = projectHealth(selected);
  const tasks = (selected.tasks || []).map(normalizeTask);
  const pettyLeft = Math.max(Number(selected.pettyCashBudget || 0) - Number(selected.pettyCashUsed || 0), 0);
  const executionBudget = Number(selected.costBudget || selected.extractedFields?.executionBudget || 0);
  const executionUsed = Number(selected.costUsed || 0);
  const executionLeft = Math.max(executionBudget - executionUsed, 0);
  const executionRate = executionBudget ? Math.round(executionUsed / executionBudget * 100) : 0;
  const missingItems = [
    selected.contract ? null : "合同金额待补",
    selected.files?.length ? null : "项目文件待上传",
    selected.paymentDue && selected.paymentDue !== "待确认回款节点" ? null : "回款节点待确认",
    selected.costUsed ? null : "成本表待归集",
  ].filter(Boolean);
  const projectPendingFeishu = feishuPendingFiles.filter((item) => item.status === "待确认" && (item.projectId === selected.id || item.projectName === selected.name));
  const displayMissing = [
    ...projectPendingFeishu.map((item) => `飞书文件待确认：${item.file?.name || item.preview?.fileName || "未命名文件"}`),
    ...(missingItems.length ? missingItems : ["合同、成本、核销材料目前没有明显缺口"])
  ];
  return (
    <>
      <section className="employee-hero">
        <div>
          <span>我的项目工作台</span>
          <h2>{selected.name}</h2>
          <p>{selected.client} · {selected.pm} 负责 · 下一节点：{selected.nextMilestone}</p>
        </div>
        <button type="button" className="primary hero-upload" onClick={onUpload}><UploadCloud size={16} /><span>上传项目文件</span></button>
      </section>

      <section className="metrics employee-metrics">
        <Metric icon={LayoutDashboard} label="项目进度" value={`${selected.progress}%`} sub={`AI 判断：${health.label}`} />
        <Metric icon={Clock3} label="时间进度" value={`${health.timeProgress}%`} sub="按合同周期粗略估算" />
        <Metric icon={CircleDollarSign} label="执行剩余预算" value={money(executionLeft)} sub={`总预算 ${money(executionBudget)} · 已用 ${money(executionUsed)}（${executionRate}%）`} />
        <Metric icon={FileText} label="当前项目数" value={`${activeProjects.length || projects.length} 个`} sub="仅展示你可见的项目" />
      </section>

      <section className={`employee-grid ${projects.length <= 1 ? "single-project" : ""}`}>
        <div className={`panel employee-focus ${health.tone}`}>
          <PanelTitle icon={Bot} title="AI 项目巡检" />
          <div className="employee-health-number">
            <strong>{health.label}</strong>
            <span>时间 {health.timeProgress}% · 完成 {health.completion}%</span>
          </div>
          <div className="health-track">
            <i style={{ width: `${health.completion}%` }} />
          </div>
          <p>{health.text}</p>
        </div>

        <div className="panel">
          <PanelTitle icon={CheckCircle2} title="当前任务" />
          <div className="employee-task-list">
            {tasks.map((task) => (
              <div className="employee-task" key={task.id || task.title}>
                <span>{task.title}</span>
                <b>{task.progress}%</b>
                <div><i style={{ width: `${task.progress}%` }} /></div>
                <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("progress")}>打开进度</button>
              </div>
            ))}
            {!tasks.length && (
              <div className="action-empty employee-task-empty">
                <strong>暂无执行任务</strong>
                <span>可以先进入项目详情，用广告项目节点模板新增任务，也可以让 AI 帮你归档材料。</span>
                <div className="button-row compact">
                  <button type="button" className="primary tiny" onClick={() => onOpenProject?.("progress")}>新增项目任务</button>
                  <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("files")}>上传项目材料</button>
                  <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("approvals")}>提交报销/备用金</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <PanelTitle icon={ShieldAlert} title="材料与报销提醒" />
          <div className="compact-list">
            {displayMissing.map((item) => (
              <div key={item}>
                <strong>{item}</strong>
                <span>可直接从右侧 AI 输入，或点上传让 AI 识别后归档。</span>
                <div className="button-row compact">
                  {/报销|备用金/.test(item)
                    ? <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("approvals")}>去审批区</button>
                    : <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("files")}>去文件区</button>}
                  <button type="button" className="ghost tiny" onClick={onUpload}>上传文件</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {projects.length > 1 && (
          <div className="panel">
            <PanelTitle icon={FileSpreadsheet} title="我的项目列表" />
            <div className="employee-project-strip">
              {projects.slice(0, 5).map((project) => (
                <button
                  type="button"
                  className={project.id === selected.id ? "active" : ""}
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{projectHealth(project).label} · {project.progress}% · 余 {money(Math.max(project.pettyCashBudget - project.pettyCashUsed, 0))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated, onSelectProject, onNavigate, collapsed = false, onToggleCollapsed }) {
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => [
    {
      from: "assistant",
      title: "AI 项目助手",
      text: "我会结合你的账号权限、当前项目和上传记录回答问题。你可以问备用金、报销、进度，也可以说“帮我登记到我的项目里”。",
    },
  ]);
  const weatherText = "上海 29°C · 多云，外拍注意补水";
  const timeText = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  async function send(text = question) {
    const query = text.trim();
    if (!query) {
      onNotice("先输入一句话，比如“我的项目备用金还有多少？”");
      return;
    }
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query, session, projects, approvals, settings, stats, selected, onDone });
    } catch (error) {
      result = { reply: `这次没办成：${error.message}` };
    }
    setMessages((items) => [
      ...items,
      { from: "user", title: session.name, text: query },
      { from: "assistant", title: "AI 项目助手", text: result.reply || "我已经处理完成。", pendingAction: result.pendingAction || null, filingAction: buildAiFilingAction(result, query, projects, selected), navActions: buildAiNavigationActions(query, projects, selected, session), query },
    ].slice(-7));
    setQuestion("");
    setSending(false);
  }

  async function confirmPending(message) {
    if (!message.pendingAction || sending) return;
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query: message.query, confirmAction: message.pendingAction, session, projects, approvals, settings, stats, selected, onDone });
      if (result.approval) onApprovalCreated?.(result.approval);
      onNotice("AI 已按你的确认提交审批，审批列表已刷新。");
    } catch (error) {
      result = { reply: `确认失败：${error.message}` };
    }
    setMessages((items) => [
      ...items.map((item) => item === message ? { ...item, pendingAction: null } : item),
      { from: "assistant", title: "AI 项目助手", text: result.reply || "已确认处理。" },
    ].slice(-7));
    setSending(false);
  }

  function inferAiDropUploadType(files = []) {
    const text = files.map((file) => file.name || "").join(" ");
    if (/核销|月度|确认收入|verification/i.test(text)) return "verification-sheet";
    if (/报价|quote|合同|contract/i.test(text)) return canCreateProjectRole(session) ? "create-project" : "quote-sheet";
    if (/报销|费用|成本|cost|expense|执行/i.test(text)) return "cost-sheet";
    return selected?.id ? "cost-sheet" : "create-project";
  }

  async function handleAiFileDrop(event) {
    event.preventDefault();
    const picked = Array.from(event.dataTransfer?.files || []);
    if (!picked.length) return;
    const uploadType = inferAiDropUploadType(picked);
    let payloads = [];
    try {
      payloads = await Promise.all(picked.map(fileToPayload));
    } catch (error) {
      onNotice(`AI 读取文件失败：${error.message}`);
      return;
    }
    const target = uploadType === "create-project" ? null : selected || projects[0] || null;
    if (uploadType !== "create-project" && !target?.id) {
      onNotice("当前没有可归档的项目，请先让销售、PM 或管理层上传合同创建项目。");
      return;
    }
    if (target?.id) onSelectProject?.(target.id);
    onUpload?.(uploadType, target, payloads);
    setMessages((items) => [
      ...items,
      {
        from: "assistant",
        title: "AI 项目助手",
        text: `已接收 ${payloads.length} 个文件，并打开上传预览。确认前不会写入项目。`,
      },
    ].slice(-7));
    onNotice(`AI 已接收 ${payloads.length} 个文件，已打开上传预览，确认后才会写入项目。`);
  }

  function handleFilingAction(action, projectId = "") {
    const targetId = projectId || action?.projectId || selected?.id || projects[0]?.id || "";
    const target = projects.find((project) => project.id === targetId) || selected || projects[0];
    const canCreate = canCreateProjectRole(session);
    const uploadType = action?.uploadType === "create-project" && !canCreate ? "cost-sheet" : action?.uploadType || "cost-sheet";
    if (!target?.id && uploadType !== "create-project") {
      onNotice("当前没有可上传归档的项目，请先让管理员分派项目。");
      return;
    }
    if (target?.id) onSelectProject?.(target.id);
    onUpload?.(uploadType, uploadType === "create-project" ? null : target);
    const targetName = uploadType === "create-project" ? "新项目" : target.name;
    const downgraded = action?.uploadType === "create-project" && !canCreate;
    onNotice(downgraded
      ? `当前账号不能创建新项目，已改为给「${target.name}」打开项目文件上传，AI 会先预览识别。`
      : `已为「${targetName}」打开${action?.uploadTypeLabel || "项目文件"}上传，AI 会先预览识别，确认后才写入项目。`);
  }

  if (collapsed) {
    return (
      <aside className="ai-activity-panel collapsed">
        <button type="button" className="ai-collapsed-button" onClick={onToggleCollapsed} aria-label="展开 AI 助手">
          <Bot size={18} />
          <span>AI</span>
          <ChevronRight size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-activity-panel" onDrop={handleAiFileDrop} onDragOver={(event) => event.preventDefault()}>
      <div className="ai-profile">
        <div className="ai-avatar">{session.name?.slice(0, 1) || "A"}</div>
        <div>
          <strong>{session.name}</strong>
          <span>{roleLabel(session.role)} · AI 项目伙伴</span>
        </div>
        <button type="button" className="ai-panel-toggle" onClick={onToggleCollapsed} aria-label="收起 AI 助手">
          <Minimize2 size={15} />
          <span>收起</span>
        </button>
      </div>

      <div className="ai-activity-head">
        <div>
          <span>{timeText}</span>
          <strong>{weatherText}</strong>
        </div>
        <Bot size={18} />
      </div>

      <div className="ai-quick-tags">
        <button type="button" onClick={() => send("我的项目备用金还有多少？")}>备用金</button>
        <button type="button" onClick={() => send("这个项目进度怎么样？")}>进度</button>
        <button type="button" onClick={() => send("帮我生成一个更容易过稿的内容方向")}>内容</button>
        <button type="button" onClick={() => onUpload?.()}><UploadCloud size={14} />上传文件</button>
      </div>
      <div className="ai-drop-hint"><UploadCloud size={14} />把合同、报价、成本、报销或核销表拖到这里</div>

      <div className="ai-feed">
        {messages.map((message, index) => (
          <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
            <span>{message.title}</span>
            <p>{message.text}</p>
            {message.pendingAction && <div className="ai-confirm-actions">
              <button type="button" className="primary" onClick={() => confirmPending(message)} disabled={sending}>确认提交</button>
              <button type="button" className="ghost" onClick={() => setMessages((items) => items.map((item) => item === message ? { ...item, pendingAction: null, text: `${item.text}\n已取消，未提交。` } : item))}>取消</button>
            </div>}
            {message.filingAction && <AiFilingActions action={message.filingAction} onOpen={handleFilingAction} />}
            {message.navActions && <AiNavigationActions actions={message.navActions} onOpen={onNavigate} />}
          </div>
        ))}
      </div>

      <div className="ai-project-context">
        <strong>{selected.name}</strong>
        <span>{projects.length} 个可见项目 · 当前 {projectHealth(selected).label}</span>
      </div>

      <div className="ai-compose">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="随心输入，问项目、报销、备用金或内容创意"
        />
        <button type="button" onClick={() => send()} disabled={sending}><ChevronRight size={18} /></button>
      </div>
    </aside>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function RiskBadge({ risk }) {
  return <b className={`risk risk-${risk}`}>{risk}风险</b>;
}

function ProjectDetail({ project, isManagement, session, files, parseJobs, approvals, suppliers = [], clients = [], payments = [], collectionScripts = [], feishuPendingFiles = [], comments, alertUpdates = [], auditLogs, focusTarget = "", onFocusConsumed, onOpenApproval, onOpenSupplier, onOpenClient, onDone, onNotice }) {
  const usedRate = project.costBudget ? Math.round((project.costUsed / project.costBudget) * 100) : 0;
  const health = projectHealth(project);
  const pettyCashLeft = Math.max(Number(project.pettyCashBudget || 0) - Number(project.pettyCashUsed || 0), 0);
  const canEditProject = canWriteProjectRole(session);
  const canRecordPayment = ["shareholder", "admin", "director", "pm", "sales", "finance"].includes(session.role);
  const canUseCollection = canUseCollectionRole(session);
  const canHandleFeishuPending = canHandleFeishuPendingRole(session);
  const canHandleProjectAlert = ["shareholder", "admin", "director", "pm", "sales", "finance"].includes(session.role);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseInfoFresh, setBaseInfoFresh] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [form, setForm] = useState({});
  const [paymentForm, setPaymentForm] = useState({ amount: "", payer: "", method: "", note: "" });
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [voidingPaymentId, setVoidingPaymentId] = useState("");
  const [exportingPaymentLedger, setExportingPaymentLedger] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState(null);
  const [generatingCollection, setGeneratingCollection] = useState(false);
  const [savingCollectionOutcomeId, setSavingCollectionOutcomeId] = useState("");
  const [collectionFollowUpForms, setCollectionFollowUpForms] = useState({});
  const [copyingCollectionId, setCopyingCollectionId] = useState("");
  const [handlingFeishuFile, setHandlingFeishuFile] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", owner: session.name || "", dueDate: "", progress: 0, note: "" });
  const [savingTaskForm, setSavingTaskForm] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState("");
  const [archivingTaskId, setArchivingTaskId] = useState("");
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const [exportingTaskLedger, setExportingTaskLedger] = useState(false);
  const [focusedPaymentId, setFocusedPaymentId] = useState("");
  const [reparsingProject, setReparsingProject] = useState(false);
  const [focusedParseJobId, setFocusedParseJobId] = useState("");
  const [progressingParseJobId, setProgressingParseJobId] = useState("");
  const [handlingActionKey, setHandlingActionKey] = useState("");
  const [focusedActionKey, setFocusedActionKey] = useState("");
  const [copyingFileKey, setCopyingFileKey] = useState("");
  const [archivingFileKey, setArchivingFileKey] = useState("");
  const [copyingActivityKey, setCopyingActivityKey] = useState("");
  const [archivingActivityKey, setArchivingActivityKey] = useState("");
  const [exportingActivityLedger, setExportingActivityLedger] = useState(false);
  const [quickUploadType, setQuickUploadType] = useState("");
  const [localFocusTarget, setLocalFocusTarget] = useState("");
  const [approvalForm, setApprovalForm] = useState({ type: "reimbursement", amount: "", payee: "", reason: "" });
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [withdrawingProjectApprovalId, setWithdrawingProjectApprovalId] = useState("");
  const approvalTypeOptions = approvalTypeOptionsFor(session);
  const focusRefs = {
    advice: useRef(null),
    client: useRef(null),
    progress: useRef(null),
    files: useRef(null),
    payments: useRef(null),
    approvals: useRef(null),
    activity: useRef(null)
  };
  useEffect(() => {
    setForm({
      name: project.name || "",
      client: project.client || "",
      owner: project.owner || "",
      pm: project.pm || "",
      sales: project.sales || "",
      status: project.status || "",
      contract: project.contract || 0,
      paid: project.paid || 0,
      nextMilestone: project.nextMilestone || "",
      paymentDue: project.paymentDue || ""
    });
    setEditing(false);
  }, [project.id]);

  useEffect(() => {
    const target = localFocusTarget || focusTarget;
    if (!target || !focusRefs[target]?.current) return;
    window.setTimeout(() => {
      focusRefs[target]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (localFocusTarget) setLocalFocusTarget("");
      if (focusTarget) onFocusConsumed?.();
    }, 120);
  }, [focusTarget, localFocusTarget, project.id]);

  const projectFiles = [
    ...(project.files || []).map((file) => ({ ...file, source: "project" })),
    ...files
      .filter((item) => item.projectId === project.id || item.projectName === project.name)
      .flatMap((item) => (item.files || [item]).map((file) => ({
        ...file,
        source: item.type || file.category || "upload",
        uploadedAt: file.uploadedAt || item.at,
        uploadedByName: file.uploadedByName || item.user
      })))
  ];
  const uniqueFiles = Array.from(new Map(projectFiles
    .filter((file) => !file.archivedAt)
    .map((file, index) => [`${file.id || file.name}-${file.uploadedAt || index}`, file])).values());
  const projectJobs = parseJobs.filter((job) => job.projectId === project.id || job.projectName === project.name);
  const projectApprovals = approvals.filter((item) => item.projectId === project.id || item.projectName === project.name || item.project === project.name);
  const projectSuppliers = suppliers.filter((item) => item.project === project.name || item.projectId === project.id);
  const clientProfile = clients.find((item) => item.client === project.client || item.client === project.brand);
  const projectPayments = payments.filter((item) => item.projectId === project.id || item.projectName === project.name || item.project === project.name);
  const projectCollectionScripts = collectionScripts.filter((item) => item.projectId === project.id || item.projectName === project.name);
  const projectFeishuPendingFiles = feishuPendingFiles.filter((item) => item.projectId === project.id || item.projectName === project.name);
  const projectFeishuHandledFiles = projectFeishuPendingFiles.filter((item) => item.status !== "待确认");
  const projectComments = comments.filter((item) => item.project === project.name && !item.archivedAt);
  const projectAlertUpdates = alertUpdates.filter((item) => item.project === project.name || item.projectName === project.name || item.projectId === project.id);
  const projectLogs = auditLogs.filter((item) => item.target === project.name);
  const projectTasks = (project.tasks || []).map(normalizeTask).filter((task) => !task.archivedAt);
  const costRows = (project.costs || []).map(normalizeCostRow).filter((row) => row.name);
  const materialStatus = projectMaterialStatus(project, uniqueFiles, projectJobs);
  const actionItems = projectActionItems({ project, files: uniqueFiles, jobs: projectJobs, approvals: projectApprovals, health, isManagement, feishuPending: projectFeishuPendingFiles });
  const aiAdvice = projectAiAdvice({ project, materialStatus, approvals: projectApprovals, health, isManagement, feishuPending: projectFeishuPendingFiles });
  const uploadTypeNames = {
    "cost-sheet": "成本表",
    "quote-sheet": "报价表",
    "verification-sheet": "核销表"
  };
  const activityItems = [
    ...projectJobs.map((job) => ({ at: job.updatedAt || job.createdAt, title: "AI 解析", text: `${job.projectName} · ${job.status} · ${job.progress || 0}%`, target: "files" })),
    ...projectApprovals.map((item) => ({ at: item.updatedAt || item.createdAt, title: item.typeLabel || "审批", text: `${item.status} · ${money(item.amount)} · ${item.applicantName || ""}`, target: "approvals" })),
    ...projectSuppliers.map((item) => ({ at: item.paidAt || item.updatedAt || item.createdAt, title: "供应商结算", text: `${item.supplier || "供应商"} · ${item.status || "待结算"} · ${money(item.amount)}`, target: "payments" })),
    ...projectPayments.map((item) => ({ at: item.receivedAt || item.createdAt, title: "项目回款", text: `${item.payer || project.client || "客户"} · ${money(item.amount)} · ${item.recordedByName || ""}`, target: "payments" })),
    ...projectFeishuPendingFiles.map((item) => ({ at: item.handledAt || item.createdAt, title: item.status === "待确认" ? "飞书文件待确认" : "飞书文件已处理", text: `${item.status} · ${item.file?.name || item.preview?.fileName || "飞书文件"} · ${item.uploadType || "文件"}${item.handledBy ? ` · 处理人 ${item.handledBy}` : ""}`, target: "files" })),
    ...projectComments.map((item) => ({ ...item, at: item.at, title: "项目评论", text: `${item.user || ""}：${item.body || ""}`, target: "activity", kind: "comment" })),
    ...projectLogs.map((item) => ({ at: item.at, title: "系统记录", text: `${item.user || ""} · ${item.action || item.type || ""}`, target: "activity" })),
    ...uniqueFiles.map((file) => ({ at: file.uploadedAt, title: "文件上传", text: `${file.name} · ${file.uploadedByName || file.uploadedBy || "未知"}`, target: "files" }))
  ].filter((item) => item.at || item.text).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 10);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function primeApprovalForm(type = "reimbursement", reason = "") {
    const allowedType = approvalTypeOptions.some(([value]) => value === type) ? type : "reimbursement";
    setForm((current) => ({
      ...current,
      projectId: current.projectId || selected?.id || projects[0]?.id || "",
      type: allowedType,
      payee: current.payee || session.name || "",
      reason: current.reason || reason
    }));
    setSubView(allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销");
    setSelectedApprovalKey("");
    onNotice(`已预填${allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销"}申请，请补金额后提交。`);
  }

  function openMaterialUpload(item) {
    if (!item?.uploadType || item.uploadType === "create-project") return;
    setQuickUploadType(item.uploadType);
    onNotice(`已为「${project.name}」准备上传${uploadTypeNames[item.uploadType] || item.label}，会先 AI 预览，确认后才写入项目。`);
  }

  function goProjectSection(target, message) {
    if (!target || !focusRefs[target]) return;
    setLocalFocusTarget(target);
    if (message) onNotice(message);
  }

  function runAdviceAction(item = "") {
    const text = String(item);
    if (text.includes("合同") || text.includes("报价") || text.includes("成本") || text.includes("核销") || text.includes("材料") || text.includes("文件")) {
      goProjectSection("files", "已打开文件与 AI 解析区，可以继续上传或刷新解析进度。");
      return;
    }
    if (text.includes("审批") || text.includes("备用金") || text.includes("报销")) {
      goProjectSection("approvals", "已打开审批与成本记录区，可以提交审批或查看流程。");
      return;
    }
    if (text.includes("回款") || text.includes("催收") || text.includes("供应商") || text.includes("结算")) {
      goProjectSection("payments", "已打开回款与成本记录区，可以查看回款、催收和供应商结算。");
      return;
    }
    if (text.includes("进度") || text.includes("任务") || text.includes("节点")) {
      goProjectSection("progress", "已打开执行进度区，可以补任务或更新完成度。");
      return;
    }
    goProjectSection("activity", "已打开项目动态区，可以记录最新进展。");
  }

  async function copyFileInfo(file) {
    const key = uploadedFileKey(file);
    setCopyingFileKey(key);
    try {
      const lines = [
        `项目文件：${file.name || "未命名文件"}`,
        `归属项目：${project.name}`,
        `类型：${file.source || file.category || "文件"}`,
        `大小：${fileSize(file.size)}`,
        `上传人：${file.uploadedByName || file.uploadedBy || "未知"}`,
        `上传时间：${file.uploadedAt ? new Date(file.uploadedAt).toLocaleString("zh-CN") : "时间待记录"}`
      ];
      await navigator.clipboard.writeText(lines.join("\n"));
      onNotice(`文件信息已复制：${file.name || "项目文件"}。`);
    } catch {
      onNotice("复制失败，请手动选中文件信息复制。");
    } finally {
      setCopyingFileKey("");
    }
  }

  async function archiveProjectFile(file) {
    const key = uploadedFileKey(file);
    setArchivingFileKey(key);
    try {
      await apiRequest("/api/files/archive", session, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          fileId: file.id || "",
          fileName: file.name || "",
          uploadedAt: file.uploadedAt || "",
          reason: `项目页归档：${file.name || "传错文件"}`
        })
      });
      await onDone();
      setLocalFocusTarget("files");
      onNotice(`文件已归档：${file.name || "项目文件"}。它会从当前文件列表隐藏，但审计记录仍保留。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setArchivingFileKey("");
    }
  }

  async function copyActivityItem(item, index) {
    const key = `${item.title}-${index}`;
    setCopyingActivityKey(key);
    try {
      await navigator.clipboard.writeText([
        `项目动态：${project.name}`,
        `${item.title}：${item.text}`,
        `时间：${item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}`
      ].join("\n"));
      onNotice(`项目动态已复制：${item.title}。`);
    } catch {
      onNotice("复制失败，请手动选中项目动态复制。");
    } finally {
      setCopyingActivityKey("");
    }
  }

  async function archiveActivityItem(item, index) {
    const key = `${item.id || item.title}-${item.at || index}`;
    setArchivingActivityKey(key);
    try {
      await apiRequest("/api/comments/archive", session, {
        method: "POST",
        body: JSON.stringify({
          project: project.name,
          projectId: project.id,
          commentId: item.id || "",
          body: item.body || "",
          at: item.at || "",
          reason: `项目页归档动态：${item.body || item.text || "记录有误"}`
        })
      });
      await onDone();
      setLocalFocusTarget("activity");
      onNotice("项目动态已归档，会从当前时间线隐藏，但审计记录仍保留。");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setArchivingActivityKey("");
    }
  }

  async function saveProject() {
    setSaving(true);
    try {
      await apiRequest("/api/projects/update", session, {
        method: "POST",
        body: JSON.stringify({
          id: project.id,
          values: {
            "项目名称": form.name,
            "客户 / 品牌": form.client,
            "负责人": form.owner,
            "PM": form.pm,
            "销售": form.sales,
            "项目状态": form.status,
            "合同金额": form.contract,
            "已回款": form.paid,
            "下一节点": form.nextMilestone,
            "回款节点": form.paymentDue
          }
        })
      });
      setEditing(false);
      await onDone();
      setBaseInfoFresh(true);
      setLocalFocusTarget("activity");
      onNotice(`项目基础信息已保存，项目台账和详情页已刷新：状态 ${form.status || "待补"}，下一节点 ${form.nextMilestone || "待补"}，回款节点 ${form.paymentDue || "待补"}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) {
      onNotice("先写一句项目进展，比如“客户已确认脚本，明天补核销表”。");
      return;
    }
    setCommenting(true);
    try {
      await apiRequest("/api/comments", session, {
        method: "POST",
        body: JSON.stringify({ project: project.name, body })
      });
      setCommentText("");
      await onDone();
      setLocalFocusTarget("activity");
      onNotice("项目进展已记录，项目动态已刷新。");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setCommenting(false);
    }
  }

  function updatePaymentForm(field, value) {
    setPaymentForm((current) => ({ ...current, [field]: value }));
  }

  function preparePaymentEntry() {
    setPaymentForm((current) => ({
      ...current,
      payer: current.payer || project.client || project.brand || "",
      method: current.method || "银行转账",
      note: current.note || (Number(project.receivable || 0) ? "项目回款" : "")
    }));
    setLocalFocusTarget("payments");
    onNotice("已帮你预填回款登记信息，请补充金额后点击记录回款。");
  }

  function updateTaskForm(field, value) {
    setTaskForm((current) => ({ ...current, [field]: value }));
  }

  function prepareTaskTemplate(template) {
    setTaskForm({
      title: template.title,
      owner: taskForm.owner || project.pm || project.owner || session.name || "",
      dueDate: template.dueDate || "",
      progress: template.progress,
      note: template.note
    });
    setLocalFocusTarget("progress");
    onNotice(`已预填「${template.title}」任务，请确认负责人和截止时间后保存。`);
  }

  const taskTemplates = [
    { title: "首轮方案 / 脚本确认", progress: 20, note: "明确客户方向、内容风格和雷区" },
    { title: "拍摄 / 执行排期", progress: 45, note: "确认人员、场地、道具、供应商与备用金需求" },
    { title: "客户反馈修改", progress: 70, note: "记录客户意见，沉淀可复用偏好" },
    { title: "核销 / 回款跟进", progress: 90, note: "上传核销表并同步回款节点" }
  ];

  async function submitPayment(event) {
    event.preventDefault();
    if (!Number(paymentForm.amount)) {
      onNotice("请填写回款金额");
      return;
    }
    setRecordingPayment(true);
    try {
      const data = await apiRequest("/api/payments", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...paymentForm })
      });
      const nextProject = data.project || {};
      const payment = data.payment || {};
      setPaymentForm({ amount: "", payer: "", method: "", note: "" });
      setFocusedPaymentId(payment.id || "");
      await onDone();
      setLocalFocusTarget("payments");
      onNotice(`回款已记录，回款流水已刷新：本次 ${money(payment.amount || paymentForm.amount)}，已回款 ${money(nextProject.paid ?? project.paid)}，待回款 ${money(nextProject.receivable ?? project.receivable)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setRecordingPayment(false);
    }
  }

  async function voidPayment(item) {
    setVoidingPaymentId(item.id);
    try {
      const data = await apiRequest("/api/payments/void", session, {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          reason: `作废回款：${item.note || item.method || item.payer || "录入纠错"}`
        })
      });
      const nextProject = data.project || {};
      setFocusedPaymentId(item.id || "");
      await onDone();
      setLocalFocusTarget("payments");
      onNotice(`回款已作废，项目金额已回滚：已回款 ${money(nextProject.paid ?? project.paid)}，待回款 ${money(nextProject.receivable ?? project.receivable)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setVoidingPaymentId("");
    }
  }

  function exportPaymentLedger() {
    if (!projectPayments.length) {
      onNotice("当前项目还没有回款流水，请先记录回款或上传核销表。");
      return;
    }
    setExportingPaymentLedger(true);
    try {
      const filename = `ad-payment-ledger-${project.name || "project"}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, paymentLedgerRows(project, projectPayments));
      onNotice(`回款台账 CSV 已导出：${project.name} · ${projectPayments.length} 条流水。`);
    } catch (error) {
      onNotice(error.message || "回款台账导出失败，请稍后再试。");
    } finally {
      setExportingPaymentLedger(false);
    }
  }

  async function generateCollectionScript() {
    if (!Number(project.receivable || 0)) {
      onNotice("这个项目当前没有待回款，不需要生成催收话术。");
      return;
    }
    setGeneratingCollection(true);
    try {
      const data = await apiRequest("/api/collections/suggest", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id })
      });
      setCollectionDraft(data);
      await onDone();
      setLocalFocusTarget("payments");
      onNotice(`催收话术已生成并保存到回款记录区：${data.tone || "自然提醒"} · ${money(data.amount)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setGeneratingCollection(false);
    }
  }

  function exportActivityLedger() {
    if (!activityItems.length) {
      onNotice("当前项目还没有可导出的动态，请先记录进展或上传项目材料。");
      return;
    }
    setExportingActivityLedger(true);
    try {
      const filename = `ad-activity-ledger-${project.name || "project"}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, activityLedgerRows(project, activityItems));
      onNotice(`项目动态 CSV 已导出：${project.name} · ${activityItems.length} 条记录。`);
    } catch (error) {
      onNotice(error.message || "项目动态导出失败，请稍后再试。");
    } finally {
      setExportingActivityLedger(false);
    }
  }

  function collectionFollowUpForm(record = {}) {
    return collectionFollowUpForms[record.id] || {
      nextFollowUpAt: record.nextFollowUpAt || daysFromNow(2),
      nextAction: record.nextAction || "换一种说法二次提醒，并补齐客户财务需要的材料"
    };
  }

  function updateCollectionFollowUp(record, key, value) {
    setCollectionFollowUpForms((current) => ({
      ...current,
      [record.id]: {
        ...collectionFollowUpForm(record),
        [key]: value
      }
    }));
  }

  async function markCollectionOutcome(record, success) {
    const followUp = collectionFollowUpForm(record);
    setSavingCollectionOutcomeId(record.id);
    try {
      await apiRequest("/api/collections/outcome", session, {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          success,
          score: success ? 5 : 2,
          outcome: success ? "客户已回复/推进付款" : "暂未推进，需要调整话术或再次跟进",
          nextFollowUpAt: success ? "" : followUp.nextFollowUpAt,
          nextAction: success ? "" : followUp.nextAction
        })
      });
      setLocalFocusTarget("payments");
      await onDone();
      onNotice(success
        ? "已记录为有效话术，回款记录和团队学习样本已刷新。"
        : `已记录为待优化话术，并创建下次跟进待办：${followUp.nextFollowUpAt || "时间待定"}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingCollectionOutcomeId("");
    }
  }

  async function copyCollectionScript(record) {
    const copyKey = record.id || "draft";
    setCopyingCollectionId(copyKey);
    try {
      await navigator.clipboard.writeText(record.script || "");
      onNotice(`催收话术已复制：${record.projectName || project.name}。`);
    } catch {
      onNotice("复制失败，请手动选中话术复制。");
    } finally {
      setCopyingCollectionId("");
    }
  }

  async function handleFeishuPendingFile(item, action) {
    setHandlingFeishuFile(item.id);
    try {
      const leftCount = Math.max(projectFeishuPendingFiles.filter((file) => file.status === "待确认").length - 1, 0);
      await apiRequest("/api/integrations/feishu/pending-files/action", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      await onDone();
      onNotice(action === "reject"
        ? `飞书文件已驳回，不会写入项目，当前还剩 ${leftCount} 个待确认文件。`
        : `飞书文件已确认入库，项目数据已刷新，当前还剩 ${leftCount} 个待确认文件。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setHandlingFeishuFile("");
    }
  }

  async function reparseCurrentProject() {
    if (!uniqueFiles.length && !projectJobs.some((job) => (job.files || []).length)) {
      onNotice("当前项目没有可重新解析的原始文件，请先上传合同、报价表、成本表或核销表。");
      return;
    }
    setReparsingProject(true);
    try {
      const data = await apiRequest("/api/projects/reparse", session, {
        method: "POST",
        body: JSON.stringify({ id: project.id })
      });
      const job = data.parseJob || {};
      setFocusedParseJobId(job.id || "");
      await onDone();
      setLocalFocusTarget("files");
      onNotice(`已重新发起 AI 解析，文件区已刷新：${job.status || "解析中"} ${job.progress || 0}%。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setReparsingProject(false);
    }
  }

  async function refreshParseJob(job) {
    const jobKey = job.id || job.projectId || project.id;
    setProgressingParseJobId(jobKey);
    try {
      const data = await apiRequest("/api/parse-jobs/progress", session, {
        method: "POST",
        body: JSON.stringify({ id: job.id, projectId: job.projectId || project.id })
      });
      setFocusedParseJobId(data.id || jobKey);
      await onDone();
      setLocalFocusTarget("files");
      onNotice(`解析任务已刷新：${data.status || "解析中"} ${data.progress || 0}%。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setProgressingParseJobId("");
    }
  }

  async function handleActionItem(item, action) {
    const key = actionItemKey(item);
    setHandlingActionKey(key);
    try {
      const data = await apiRequest("/api/alerts/update", session, {
        method: "POST",
        body: JSON.stringify({
          project: project.name,
          projectId: project.id,
          action,
          alertKey: key,
          title: item.title,
          note: item.text
        })
      });
      await onDone();
      setFocusedActionKey(data.alertKey || key);
      setLocalFocusTarget("activity");
      onNotice(`${item.title} 已${action === "ignore" ? "忽略" : "标记处理"}，项目行动项记录已刷新。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setHandlingActionKey("");
    }
  }

  async function saveTask(payload) {
    const completingKey = payload.action === "complete" ? (payload.taskId || payload.title) : "";
    if (completingKey) setCompletingTaskId(completingKey);
    else setSavingTaskForm(true);
    try {
      const result = await apiRequest("/api/project-tasks", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...payload })
      });
      const taskKey = result.task?.id || payload.taskId || payload.title || "";
      setFocusedTaskId(taskKey);
      if (!completingKey) setTaskForm({ title: "", owner: session.name || "", dueDate: "", progress: 0, note: "" });
      await onDone();
      const nextProgress = Number(result.project?.progress ?? project.progress ?? 0);
      onNotice(payload.action === "complete"
        ? `任务已标记完成，项目进度已刷新到 ${nextProgress}%。`
        : `任务已保存，项目进度已刷新到 ${nextProgress}%。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      if (completingKey) setCompletingTaskId("");
      else setSavingTaskForm(false);
    }
  }

  async function submitTask(event) {
    event.preventDefault();
    if (!taskForm.title.trim()) {
      onNotice("请先写任务名称");
      return;
    }
    await saveTask(taskForm);
  }

  async function archiveTask(task) {
    const taskKey = task.id || task.title;
    setArchivingTaskId(taskKey);
    try {
      const result = await apiRequest("/api/project-tasks/archive", session, {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          taskId: task.id,
          reason: `归档任务：${task.title || "误建任务"}`
        })
      });
      await onDone();
      setLocalFocusTarget("progress");
      const nextProgress = Number(result.project?.progress ?? project.progress ?? 0);
      onNotice(`任务已归档，项目进度已刷新到 ${nextProgress}%。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setArchivingTaskId("");
    }
  }

  function exportTaskLedger() {
    const allProjectTasks = (project.tasks || []).map(normalizeTask);
    if (!allProjectTasks.length) {
      onNotice("当前项目还没有任务节点，请先新增任务或使用模板预填。");
      return;
    }
    setExportingTaskLedger(true);
    try {
      const filename = `ad-task-ledger-${project.name || "project"}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, taskLedgerRows(project, allProjectTasks));
      onNotice(`任务台账 CSV 已导出：${project.name} · ${allProjectTasks.length} 个任务节点。`);
    } catch (error) {
      onNotice(error.message || "任务台账导出失败，请稍后再试。");
    } finally {
      setExportingTaskLedger(false);
    }
  }

  function updateApprovalForm(field, value) {
    setApprovalForm((current) => ({ ...current, [field]: value }));
  }

  function prepareProjectApproval(type = "reimbursement", reason = "") {
    const allowedType = approvalTypeOptions.some(([value]) => value === type) ? type : "reimbursement";
    setApprovalForm((current) => ({
      ...current,
      type: allowedType,
      payee: current.payee || (allowedType === "supplier_payment" ? projectSuppliers[0]?.supplier || "" : session.name || ""),
      reason: current.reason || reason
    }));
    setLocalFocusTarget("approvals");
    onNotice(`已为「${project.name}」预填${allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销"}审批，请补金额后提交。`);
  }

  function prepareSupplierPaymentApproval() {
    if (!approvalTypeOptions.some(([value]) => value === "supplier_payment")) {
      onNotice("当前角色不能提交供应商付款，请让 PM、销售、财务或管理层处理。");
      return;
    }
    prepareProjectApproval("supplier_payment", `${project.name} 供应商费用付款`);
  }

  function prepareCostAction(type = "cost-sheet") {
    if (type === "cost-sheet") {
      setQuickUploadType("cost-sheet");
      setLocalFocusTarget("files");
      onNotice(`已为「${project.name}」打开成本表上传，AI 预览确认后才会写入成本构成。`);
      return;
    }
    if (type === "reimbursement") {
      prepareProjectApproval("reimbursement", "项目执行费用报销");
      return;
    }
    prepareSupplierPaymentApproval();
  }

  function prepareActivityTemplate(text) {
    setCommentText((current) => current || text);
    setLocalFocusTarget("activity");
    onNotice("已预填项目动态，确认内容后点击记录，就会沉淀到项目时间线。");
  }

  async function submitProjectApproval(event) {
    event.preventDefault();
    if (!approvalTypeOptions.some(([value]) => value === approvalForm.type)) {
      onNotice("当前角色不能提交该审批类型，请选择报销或项目备用金。");
      return;
    }
    if (!Number(approvalForm.amount)) {
      onNotice("请填写审批金额");
      return;
    }
    setSubmittingApproval(true);
    try {
      const approval = await apiRequest("/api/approvals", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...approvalForm })
      });
      setApprovalForm({ type: "reimbursement", amount: "", payee: "", reason: "" });
      await onDone();
      setLocalFocusTarget("approvals");
      onNotice(`项目审批已提交，审批记录已刷新：${approval.typeLabel || "审批"} ${money(approval.amount)}，当前状态 ${approval.status}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSubmittingApproval(false);
    }
  }

  async function withdrawProjectApproval(item) {
    setWithdrawingProjectApprovalId(item.id);
    try {
      const approval = await apiRequest("/api/approvals/withdraw", session, {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          reason: `项目页撤回：${item.reason || item.typeLabel || "审批信息需要调整"}`
        })
      });
      await onDone();
      setLocalFocusTarget("approvals");
      onNotice(`审批已撤回：${approval.typeLabel || item.typeLabel || "审批"} ${money(approval.amount || item.amount)}，不会继续流转。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setWithdrawingProjectApprovalId("");
    }
  }

  const activityTemplates = [
    "客户已确认脚本，下一步准备拍摄执行排期。",
    "客户反馈需要调整创意方向，已记录雷区并准备二稿。",
    "本周需要补充成本票据和月度核销材料。",
    "项目存在进度风险，需要 PM 协调人员和客户确认节点。"
  ];

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="id">{project.id}</span>
          <h2>{project.name}</h2>
          <p>{project.client} · {project.brand} · {project.status}</p>
        </div>
        <RiskBadge risk={project.risk} />
      </div>

      <div className="summary">
        <Bot size={18} />
        <p>{project.aiSummary}</p>
      </div>

      {clientProfile && <section className="detail-section client-handoff" ref={focusRefs.client}>
        <div className="section-head">
          <h2>客户交接摘要</h2>
          <div className="section-actions">
            <span className="muted">{clientProfile.client}</span>
            <button type="button" className="ghost tiny" onClick={() => onOpenClient?.(clientProfile)}>查看客户档案</button>
          </div>
        </div>
        <p>{clientProfile.handoffSummary}</p>
        <div className="handoff-tags">
          {(clientProfile.likes || []).slice(0, 3).map((item) => <span className="good" key={item}>{item}</span>)}
          {(clientProfile.pitfalls || []).slice(0, 3).map((item) => <span className="danger" key={item}>{item}</span>)}
        </div>
      </section>}

      <div className="detail-metrics">
        <Mini label="合同金额" value={money(project.contract)} />
        <Mini label="备用金余额" value={money(pettyCashLeft)} />
        <Mini label="已回款" value={money(project.paid)} />
        <Mini label="待回款" value={money(project.receivable)} />
        <Mini label={isManagement ? "毛利率" : "项目状态"} value={isManagement ? `${project.margin}%` : health.label} />
      </div>

      <section className="detail-section project-command-center">
        <div className="section-head">
          <h2>项目工作台</h2>
          <span className="muted">围绕当前项目上传、审批、记录和查看 AI 建议</span>
        </div>
        <div className="project-command-grid">
          <button type="button" onClick={() => setQuickUploadType("cost-sheet")}>
            <UploadCloud size={16} />
            <strong>上传成本表</strong>
            <span>执行支出、供应商费用、内部成本</span>
          </button>
          <button type="button" onClick={() => setQuickUploadType("quote-sheet")}>
            <FileSpreadsheet size={16} />
            <strong>上传报价表</strong>
            <span>用于后续月度核销匹配</span>
          </button>
          <button type="button" onClick={() => setQuickUploadType("verification-sheet")}>
            <CheckCircle2 size={16} />
            <strong>上传核销表</strong>
            <span>归集确认收入与核销状态</span>
          </button>
          <button type="button" onClick={() => setCommentText((current) => current || "客户已确认：")}>
            <MessageSquareText size={16} />
            <strong>记录动态</strong>
            <span>客户反馈、材料补充、风险提醒</span>
          </button>
        </div>
      </section>

      <section className="detail-section workbench-block">
        <div className="section-head">
          <h2>项目推进清单</h2>
          <span className="muted">{materialStatus.doneCount}/4 项关键材料已完成</span>
        </div>
        <div className="material-grid">
          {materialStatus.items.map((item) => (
            <div className={`material-card ${item.status}`} key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <b>{item.statusLabel}</b>
              </div>
              <span>{item.tip}</span>
              <small>{item.files[0]?.name || item.jobs[0]?.status || "暂无文件记录"}</small>
              {item.key !== "contract" && <button type="button" onClick={() => openMaterialUpload(item)}>
                {item.status === "missing" ? "上传" : "补充"}
              </button>}
            </div>
          ))}
        </div>
        <div className="action-list">
          {actionItems.map((item) => {
            const itemKey = actionItemKey(item);
            const handled = projectAlertUpdates.find((update) => update.alertKey === itemKey || update.title === item.title);
            return (
              <div className={`${item.tone} ${focusedActionKey === itemKey ? "fresh" : ""}`} key={`${item.title}-${item.text}`}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
                {handled ? (
                  <small>{handled.action === "ignore" ? "已忽略" : "已处理"} · {handled.user || "处理人"} · {handled.at ? new Date(handled.at).toLocaleString("zh-CN") : "刚刚"}</small>
                ) : canHandleProjectAlert && (
                  <div className="button-row compact">
                    <button type="button" className="ghost tiny" disabled={handlingActionKey === itemKey} onClick={() => handleActionItem(item, "resolve")}>
                      {handlingActionKey === itemKey ? "处理中" : "标记处理"}
                    </button>
                    <button type="button" className="ghost tiny" disabled={handlingActionKey === itemKey} onClick={() => handleActionItem(item, "ignore")}>
                      {handlingActionKey === itemKey ? "处理中" : "忽略"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={`detail-section ${baseInfoFresh ? "fresh" : ""}`}>
        <div className="section-head">
          <h2>项目基础信息</h2>
          {editing ? (
            <div className="button-row">
              <button type="button" className="ghost" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" onClick={saveProject} disabled={saving}>{saving ? "保存中" : "保存"}</button>
            </div>
          ) : canEditProject ? (
            <button type="button" onClick={() => setEditing(true)}>编辑</button>
          ) : <span className="muted">基础信息由 PM / 销售 / 管理层维护</span>}
        </div>
        <div className="detail-form-grid">
          {[
            ["name", "项目名称"],
            ["client", "客户 / 品牌"],
            ["owner", "负责人"],
            ["pm", "PM"],
            ["sales", "销售"],
            ["status", "状态"],
            ["contract", "合同金额"],
            ["paid", "已回款"],
            ["nextMilestone", "下一节点"],
            ["paymentDue", "回款节点"]
          ].map(([field, label]) => (
            <label key={field}>
              <span>{label}</span>
              {editing ? (
                <input value={form[field] ?? ""} onChange={(event) => updateForm(field, event.target.value)} />
              ) : (
                <strong>{["contract", "paid"].includes(field) ? money(form[field]) : form[field] || "待补充"}</strong>
              )}
            </label>
          ))}
        </div>
      </section>

      <div className={`health-card ${health.tone}`}>
        <div>
          <span>AI 巡检</span>
          <strong>{health.label}</strong>
        </div>
        <div className="health-track">
          <i style={{ width: `${health.completion}%` }} />
        </div>
        <p>时间已过 {health.timeProgress}% · 完成度 {health.completion}%：{health.text}</p>
      </div>

      <div className="split" ref={focusRefs.progress} id="project-progress-section">
        <div>
          <div className="section-head compact">
            <h3>执行进度</h3>
            <button type="button" className="ghost tiny" disabled={exportingTaskLedger || !(project.tasks || []).length} onClick={exportTaskLedger}>
              <FileSpreadsheet size={14} />{exportingTaskLedger ? "导出中" : "导出任务"}
            </button>
          </div>
          <form className="task-form" onSubmit={submitTask}>
            <input value={taskForm.title} onChange={(event) => updateTaskForm("title", event.target.value)} placeholder="新增交付节点 / 任务" />
            <input value={taskForm.owner} onChange={(event) => updateTaskForm("owner", event.target.value)} placeholder="负责人" />
            <input value={taskForm.dueDate} onChange={(event) => updateTaskForm("dueDate", event.target.value)} placeholder="截止时间" />
            <input value={taskForm.progress} onChange={(event) => updateTaskForm("progress", event.target.value)} placeholder="进度%" />
            <button type="submit" className="primary" disabled={savingTaskForm}>{savingTaskForm ? "保存中" : "新增任务"}</button>
          </form>
          {projectTasks.map((task) => {
            const dueInfo = taskDueInfo(task);
            return (
              <div className={`progress-row task-row ${task.status} ${dueInfo?.tone || ""} ${focusedTaskId === (task.id || task.title) ? "fresh" : ""}`} key={task.id || task.title}>
                <span>{task.title}</span>
                <div><i style={{ width: `${task.progress}%` }} /></div>
                <b>{task.progress}%</b>
                <button type="button" onClick={() => saveTask({ taskId: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, note: task.note, action: "complete" })} disabled={completingTaskId === (task.id || task.title) || task.progress >= 100}>
                  {task.progress >= 100 ? "已完成" : completingTaskId === (task.id || task.title) ? "完成中" : "完成"}
                </button>
                <button type="button" className="ghost" onClick={() => archiveTask(task)} disabled={archivingTaskId === (task.id || task.title)}>
                  {archivingTaskId === (task.id || task.title) ? "归档中" : "归档"}
                </button>
                <small>
                  {[task.owner, task.dueDate, task.note].filter(Boolean).join(" · ") || "未补充负责人/节点"}
                  {dueInfo && <em className={`task-due-badge ${dueInfo.tone}`}>{dueInfo.label}</em>}
                </small>
              </div>
            );
          })}
          {!projectTasks.length && (
            <div className="action-empty task-template-empty">
              <strong>暂无执行任务</strong>
              <span>可以先用常见广告项目节点预填任务，确认负责人和截止时间后再保存。</span>
              <div className="button-row compact">
                {taskTemplates.map((template) => (
                  <button type="button" className="ghost tiny" onClick={() => prepareTaskTemplate(template)} key={template.title}>
                    {template.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <h3>{isManagement ? "成本与利润" : "成本构成"}</h3>
          {costRows.length ? costRows.map(({ name, value }) => (
            <div className="cost-row" key={name}>
              <span>{name}</span>
              <b>{money(value)}</b>
            </div>
          )) : (
            <div className="action-empty cost-action-empty">
              <strong>暂无成本明细</strong>
              <span>上传成本表、提交报销或供应商付款通过后，会自动进入这里形成成本构成。</span>
              <div className="button-row compact">
                <button type="button" className="ghost tiny" onClick={() => prepareCostAction("cost-sheet")}>上传成本表</button>
                <button type="button" className="ghost tiny" onClick={() => prepareCostAction("reimbursement")}>提交报销</button>
                {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                  <button type="button" className="ghost tiny" onClick={() => prepareCostAction("supplier_payment")}>供应商付款</button>
                )}
              </div>
            </div>
          )}
          {isManagement && <div className="cost-row strong">
            <span>项目利润</span>
            <b>{money(project.extractedFields?.profitBreakdown?.profit ?? Number(project.contract || 0) - Number(project.costUsed || 0))}</b>
          </div>}
          {isManagement && <div className="cost-row strong">
            <span>毛利率</span>
            <b>{project.margin || 0}%</b>
          </div>}
        </div>
      </div>

      <section className="detail-section" ref={focusRefs.advice} id="project-advice-section">
        <div className="section-head">
          <h2>AI 项目建议</h2>
          <span className="muted">基于当前项目材料、进度、审批和回款</span>
        </div>
        <div className="ai-advice-list">
          {aiAdvice.map((item, index) => (
            <div key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
              <button type="button" className="ghost tiny" onClick={() => runAdviceAction(item)}>去处理</button>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section" ref={focusRefs.files} id="project-files-section">
        <div className="section-head">
          <h2>文件与 AI 解析</h2>
          <div className="section-actions">
            <span className="muted">{uniqueFiles.length} 个文件 · {projectJobs.length} 个解析任务</span>
            {canEditProject && <button type="button" className="ghost" onClick={reparseCurrentProject} disabled={reparsingProject || (!uniqueFiles.length && !projectJobs.some((job) => (job.files || []).length))}>
              {reparsingProject ? "解析中" : "重新 AI 解析"}
            </button>}
          </div>
        </div>
        {projectFeishuPendingFiles.length > 0 && <div className="project-feishu-pending">
          <div className="section-head compact">
            <h3>飞书待确认文件</h3>
            <span className="muted">{projectFeishuPendingFiles.filter((item) => item.status === "待确认").length} 个待处理</span>
          </div>
          {projectFeishuPendingFiles.slice(0, 5).map((item) => (
            <div className="project-feishu-card" key={item.id}>
              <div>
                <strong>{item.file?.name || item.preview?.fileName || "飞书文件"}</strong>
                <span>{item.status} · {item.uploadType || "file"} · {item.senderName || "飞书成员"}</span>
                <p>{item.preview?.summary || item.note || "确认后才会写入项目。"}</p>
              </div>
              {item.status === "待确认" && canHandleFeishuPending && <div className="button-row">
                <button type="button" className="primary" disabled={handlingFeishuFile === item.id} onClick={() => handleFeishuPendingFile(item, "confirm")}>
                  {handlingFeishuFile === item.id ? "处理中" : "确认入库"}
                </button>
                <button type="button" className="ghost" disabled={handlingFeishuFile === item.id} onClick={() => handleFeishuPendingFile(item, "reject")}>{handlingFeishuFile === item.id ? "处理中" : "驳回"}</button>
              </div>}
            </div>
          ))}
        </div>}
        <div className="material-intake-strip">
          <div>
            <strong>材料入库检查</strong>
            <span>{materialStatus.doneCount}/4 项已解析，{materialStatus.missing.length ? `还需处理：${materialStatus.missing.map((item) => item.label).join("、")}` : "关键材料已较完整，可以继续核销、回款和结案复盘。"}</span>
          </div>
          <div className="material-intake-grid">
            {materialStatus.items.map((item) => (
              <button
                type="button"
                className={`material-intake-item ${item.status}`}
                key={item.key}
                onClick={() => item.status === "parsed" ? onNotice(`${item.label}已解析：${item.files[0]?.name || item.jobs[0]?.status || "项目数据已入库"}`) : openMaterialUpload(item)}
              >
                <b>{item.statusLabel}</b>
                <strong>{item.label}</strong>
                <span>{item.status === "parsed" ? "已入库" : item.status === "parsing" ? "等解析" : item.status === "uploaded" ? "待确认" : item.status === "review" ? "需复核" : "去补传"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="detail-list">
          {uniqueFiles.length ? uniqueFiles.slice(0, 8).map((file, index) => (
            <div key={`${file.name}-${index}`}>
              <strong>{file.name}</strong>
              <span>{file.source || file.category || "文件"} · {fileSize(file.size)} · {file.storageStatus || (file.storageUrl ? "已持久化" : "仅记录")} · {file.uploadedByName || file.uploadedBy || "未知上传人"} · {file.uploadedAt ? new Date(file.uploadedAt).toLocaleString("zh-CN") : "时间待记录"}</span>
              {file.storageUrl && !String(file.storageUrl).startsWith("/uploads/")
                ? <a className="ghost tiny file-link" href={file.storageUrl} target="_blank" rel="noreferrer">打开文件</a>
                : file.storageProvider === "local" && <span className="muted">本地暂存不可公开访问，需配置对象存储</span>}
              <button type="button" className="ghost tiny" disabled={copyingFileKey === uploadedFileKey(file)} onClick={() => copyFileInfo(file)}>
                {copyingFileKey === uploadedFileKey(file) ? "复制中" : "复制信息"}
              </button>
              {canEditProject && <button type="button" className="ghost tiny" disabled={archivingFileKey === uploadedFileKey(file)} onClick={() => archiveProjectFile(file)}>
                {archivingFileKey === uploadedFileKey(file) ? "归档中" : "归档文件"}
              </button>}
            </div>
          )) : (
            <div className="action-empty project-file-empty">
              <strong>还没有项目文件</strong>
              <span>可以先补报价表、成本表或核销表，AI 会先预览识别，确认后才写入项目。</span>
              <div className="button-row compact">
                <button type="button" className="primary tiny" onClick={() => setQuickUploadType("quote-sheet")}>上传报价表</button>
                <button type="button" className="ghost tiny" onClick={() => setQuickUploadType("cost-sheet")}>上传成本表</button>
                <button type="button" className="ghost tiny" onClick={() => setQuickUploadType("verification-sheet")}>上传核销表</button>
                <button type="button" className="ghost tiny" onClick={() => prepareActivityTemplate("已补充项目材料，待 AI 识别后确认入库。")}>记录材料进展</button>
              </div>
            </div>
          )}
          {projectJobs.slice(0, 4).map((job) => (
            <div className={`parse-job-card ${parseJobTone(job)} ${focusedParseJobId === job.id ? "fresh" : ""}`} key={job.id}>
              <strong>解析任务：{job.status}</strong>
              <span>{job.progress || 0}% · {(job.files || []).map((file) => file.name).join("、") || "文件待识别"}</span>
              {job.error && <p>{job.error}</p>}
              {Array.isArray(job.steps) && job.steps.length > 0 && (
                <ol>
                  {job.steps.map((step) => <li className={String(step.status || "")} key={step.name}>{step.name} · {step.status}</li>)}
                </ol>
              )}
              <button type="button" className="ghost tiny" disabled={progressingParseJobId === (job.id || job.projectId)} onClick={() => refreshParseJob(job)}>
                {progressingParseJobId === (job.id || job.projectId) ? "刷新中" : /失败/.test(String(job.status || "")) ? "重试解析" : "刷新进度"}
              </button>
            </div>
          ))}
        </div>
        {projectFeishuHandledFiles.length > 0 && <div className="project-feishu-history">
          <div className="section-head compact">
            <h3>飞书文件处理历史</h3>
            <span className="muted">{projectFeishuHandledFiles.length} 条</span>
          </div>
          {projectFeishuHandledFiles.slice(0, 5).map((item) => (
            <div className={`project-feishu-history-row ${item.status === "已驳回" ? "rejected" : "confirmed"}`} key={item.id}>
              <strong>{item.file?.name || item.preview?.fileName || "飞书文件"}</strong>
              <span>{item.status} · {item.uploadType || "file"} · {item.note || "暂无备注"}</span>
              <em>{item.handledAt ? new Date(item.handledAt).toLocaleString("zh-CN") : "时间待记录"}</em>
            </div>
          ))}
        </div>}
      </section>

      <section className="detail-section" ref={focusRefs.approvals} id="project-approvals-section">
        <div className="section-head">
          <h2>审批与成本记录</h2>
          <span className="muted">{projectApprovals.length} 条审批</span>
        </div>
        <form className="project-approval-mini" onSubmit={submitProjectApproval}>
          <select value={approvalForm.type} onChange={(event) => updateApprovalForm("type", event.target.value)}>
            {approvalTypeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <input value={approvalForm.amount} onChange={(event) => updateApprovalForm("amount", event.target.value)} placeholder="金额" />
          <input value={approvalForm.payee} onChange={(event) => updateApprovalForm("payee", event.target.value)} placeholder="收款人 / 用途" />
          <input value={approvalForm.reason} onChange={(event) => updateApprovalForm("reason", event.target.value)} placeholder="说明" />
          <button type="submit" className="primary" disabled={submittingApproval}>{submittingApproval ? "提交中" : "提交审批"}</button>
        </form>
        <div className="detail-list">
          {projectApprovals.length ? projectApprovals.slice(0, 6).map((item) => (
            <div key={item.id}>
              <strong>{item.typeLabel || item.category || "审批"} · {money(item.amount)}</strong>
              <span>{item.status} · {currentApprovalStepInfo(item)?.label || (item.appliedAt ? "已入账/付款" : "流程中")} · {item.applicantName || "提交人"} · {item.reason || "暂无说明"}</span>
              <button type="button" className="ghost tiny" onClick={() => onOpenApproval?.(item)}>查看流程</button>
              {canWithdrawApproval(session, item) && <button type="button" className="ghost tiny" onClick={() => withdrawProjectApproval(item)} disabled={withdrawingProjectApprovalId === item.id}>
                {withdrawingProjectApprovalId === item.id ? "撤回中" : "撤回"}
              </button>}
            </div>
          )) : (
            <div className="action-empty project-approval-empty">
              <strong>暂无审批记录</strong>
              <span>报销、备用金和供应商付款提交后会自动生成流程进度，并沉淀到项目成本里。</span>
              <div className="button-row compact">
                <button type="button" className="primary tiny" onClick={() => prepareProjectApproval("reimbursement", "项目执行报销")}>提交报销</button>
                <button type="button" className="ghost tiny" onClick={() => prepareProjectApproval("petty_cash", "项目执行备用金")}>申请备用金</button>
                {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                  <button type="button" className="ghost tiny" onClick={() => prepareProjectApproval("supplier_payment", `${project.name} 供应商费用付款`)}>供应商付款</button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="detail-section" ref={focusRefs.payments} id="project-payments-section">
        <div className="section-head">
          <h2>回款记录</h2>
          <div className="section-head-actions">
            <span className="muted">已回款 {money(project.paid)} · 待回款 {money(project.receivable)}</span>
            <button type="button" className="ghost tiny" disabled={exportingPaymentLedger || !projectPayments.length} onClick={exportPaymentLedger}>
              <FileSpreadsheet size={14} />{exportingPaymentLedger ? "导出中" : "导出回款"}
            </button>
          </div>
        </div>
        <div className="collection-callout">
          <div>
            <strong>销售催收话术</strong>
            <span>{canUseCollection
              ? (project.receivable > 0 ? "根据客户偏好、回款节点和销售风格生成更像真人的提醒。" : "当前无待回款，先不用催收。")
              : "该操作由销售、PM、财务或管理层处理；你可以查看回款状态。"}
            </span>
          </div>
          {canUseCollection && <button type="button" className="ghost" onClick={generateCollectionScript} disabled={generatingCollection || !Number(project.receivable || 0)}>
            {generatingCollection ? "生成中" : "生成话术"}
          </button>}
        </div>
        {collectionDraft && <div className="collection-script-card fresh">
          <strong>{collectionDraft.projectName} · {collectionDraft.tone}</strong>
          <pre>{collectionDraft.script}</pre>
          <span>{collectionDraft.reason}</span>
          <div className="button-row">
            <button type="button" className="ghost" disabled={copyingCollectionId === (collectionDraft.id || "draft")} onClick={() => copyCollectionScript(collectionDraft)}>
              {copyingCollectionId === (collectionDraft.id || "draft") ? "复制中" : "复制话术"}
            </button>
          </div>
        </div>}
        {projectCollectionScripts.slice(0, 2).map((item) => (
          <div className="collection-script-card" key={item.id}>
            <strong>{item.salesName || "销售"} · {item.tone || "自然提醒"} · {money(item.amount)}</strong>
            <pre>{item.script}</pre>
            <span>{item.outcome || item.reason || "结果待记录"}</span>
            {(item.followUpStatus === "待跟进" || item.nextFollowUpAt || item.nextAction) && (
              <div className="collection-follow-up-note">
                <strong>下次跟进</strong>
                <span>{item.nextFollowUpAt || "时间待定"} · {item.nextAction || "再次跟进客户付款"}</span>
              </div>
            )}
            {canUseCollection && <div className="button-row">
              <button type="button" className="ghost" disabled={copyingCollectionId === item.id} onClick={() => copyCollectionScript(item)}>{copyingCollectionId === item.id ? "复制中" : "复制话术"}</button>
              <button type="button" className="primary" disabled={savingCollectionOutcomeId === item.id} onClick={() => markCollectionOutcome(item, true)}>{savingCollectionOutcomeId === item.id ? "记录中" : "有效"}</button>
            </div>}
            {canUseCollection && <div className="collection-follow-up-form">
              <label>
                <span>下次跟进时间</span>
                <input type="date" value={collectionFollowUpForm(item).nextFollowUpAt} onChange={(event) => updateCollectionFollowUp(item, "nextFollowUpAt", event.target.value)} />
              </label>
              <label>
                <span>下一步动作</span>
                <input value={collectionFollowUpForm(item).nextAction} onChange={(event) => updateCollectionFollowUp(item, "nextAction", event.target.value)} placeholder="例如：补发对账单后再提醒客户财务" />
              </label>
              <button type="button" className="ghost" disabled={savingCollectionOutcomeId === item.id} onClick={() => markCollectionOutcome(item, false)}>{savingCollectionOutcomeId === item.id ? "记录中" : "待优化并提醒"}</button>
            </div>}
          </div>
        ))}
        {canRecordPayment && <form className="project-approval-mini" onSubmit={submitPayment}>
          <input value={paymentForm.amount} onChange={(event) => updatePaymentForm("amount", event.target.value)} placeholder="回款金额" />
          <input value={paymentForm.payer} onChange={(event) => updatePaymentForm("payer", event.target.value)} placeholder="付款方 / 客户" />
          <input value={paymentForm.method} onChange={(event) => updatePaymentForm("method", event.target.value)} placeholder="方式：银行 / 票据等" />
          <input value={paymentForm.note} onChange={(event) => updatePaymentForm("note", event.target.value)} placeholder="备注：首款 / 尾款 / 第几期" />
          <button type="submit" className="primary" disabled={recordingPayment}>{recordingPayment ? "记录中" : "记录回款"}</button>
        </form>}
        <div className="detail-list">
          {projectPayments.length ? projectPayments.slice(0, 6).map((item) => {
            const voided = item.status === "已作废" || item.voidedAt;
            return (
              <div className={`${focusedPaymentId === item.id ? "fresh" : ""} ${voided ? "voided" : ""}`} key={item.id}>
                <strong>{item.payer || item.client || project.client || "客户"} · {money(item.amount)}{voided ? " · 已作废" : ""}</strong>
                <span>{item.method || "方式待补"} · {item.note || "暂无备注"} · {item.recordedByName || "记录人"} · {item.receivedAt ? new Date(item.receivedAt).toLocaleString("zh-CN") : "时间待记录"}{voided ? ` · 作废人 ${item.voidedByName || "未知"} · ${item.voidReason || "手动作废"}` : ""}</span>
                {canRecordPayment && !voided && <button type="button" className="ghost tiny" disabled={voidingPaymentId === item.id} onClick={() => voidPayment(item)}>
                  {voidingPaymentId === item.id ? "作废中" : "作废回款"}
                </button>}
              </div>
            );
          }) : (
            <div className="action-empty payment-action-empty">
              <strong>暂无回款流水</strong>
              <span>销售或财务记录后，会自动更新项目已回款和待回款；如果是月度核销，请先上传核销表让 AI 做收入匹配。</span>
              <div className="button-row compact">
                {canRecordPayment && <button type="button" className="ghost tiny" onClick={preparePaymentEntry}>准备记录回款</button>}
                <button type="button" className="ghost tiny" onClick={() => setQuickUploadType("verification-sheet")}>上传核销表</button>
                {canUseCollection && Number(project.receivable || 0) > 0 && (
                  <button type="button" className="ghost tiny" onClick={generateCollectionScript} disabled={generatingCollection}>
                    {generatingCollection ? "生成中" : "生成催收话术"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>供应商结算</h2>
          <span className="muted">{projectSuppliers.length} 条记录</span>
        </div>
        <div className="detail-list">
          {projectSuppliers.length ? projectSuppliers.slice(0, 6).map((item, index) => (
            <div key={item.approvalId || `${item.supplier}-${index}`}>
              <strong>{item.supplier || "供应商"} · {money(item.amount)}</strong>
              <span>{item.status || "待结算"} · {item.type || "项目费用"}{item.paidAt ? ` · ${new Date(item.paidAt).toLocaleString("zh-CN")}` : ""}</span>
              <button type="button" className="ghost tiny" onClick={() => onOpenSupplier?.(item)}>查看供应商</button>
            </div>
          )) : (
            <div className="action-empty supplier-action-empty">
              <strong>暂无供应商结算记录</strong>
              <span>供应商付款审批通过后会自动进入这里；如果已经有供应商账单，可以先发起付款审批或上传成本表让 AI 归集。</span>
              <div className="button-row compact">
                {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                  <button type="button" className="ghost tiny" onClick={prepareSupplierPaymentApproval}>准备供应商付款</button>
                )}
                <button type="button" className="ghost tiny" onClick={() => setQuickUploadType("cost-sheet")}>上传成本表</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="detail-section" ref={focusRefs.activity} id="project-activity-section">
        <div className="section-head">
          <h2>项目动态</h2>
          <div className="section-head-actions">
            <span className="muted">{activityItems.length} 条</span>
            <button type="button" className="ghost tiny" disabled={exportingActivityLedger || !activityItems.length} onClick={exportActivityLedger}>
              <FileSpreadsheet size={14} />{exportingActivityLedger ? "导出中" : "导出动态"}
            </button>
          </div>
        </div>
        <form className="comment-form" onSubmit={submitComment}>
          <input
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="记录一句项目进展、客户反馈、材料补充或风险提醒"
          />
          <button type="submit" className="primary" disabled={commenting}>{commenting ? "记录中" : "记录"}</button>
        </form>
        <div className="activity-list">
          {activityItems.length ? activityItems.map((item, index) => (
            <div key={`${item.title}-${index}`}>
              <i />
              <div>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
                <em>{item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}</em>
                <div className="button-row compact">
                  {item.target && item.target !== "activity" && <button type="button" className="ghost tiny" onClick={() => goProjectSection(item.target, `已打开「${item.title}」相关区域。`)}>打开相关</button>}
                  <button type="button" className="ghost tiny" disabled={copyingActivityKey === `${item.title}-${index}`} onClick={() => copyActivityItem(item, index)}>
                    {copyingActivityKey === `${item.title}-${index}` ? "复制中" : "复制动态"}
                  </button>
                  {item.kind === "comment" && canArchiveComment(session, item) && <button type="button" className="ghost tiny" disabled={archivingActivityKey === `${item.id || item.title}-${item.at || index}`} onClick={() => archiveActivityItem(item, index)}>
                    {archivingActivityKey === `${item.id || item.title}-${item.at || index}` ? "归档中" : "归档动态"}
                  </button>}
                </div>
              </div>
            </div>
          )) : (
            <div className="action-empty activity-action-empty">
              <strong>暂无项目动态</strong>
              <span>可以先记录一次客户反馈、材料补充或进度风险，后续上传、解析、审批也会自动出现在这里。</span>
              <div className="button-row compact">
                {activityTemplates.map((text) => (
                  <button type="button" className="ghost tiny" onClick={() => prepareActivityTemplate(text)} key={text}>
                    {text.slice(0, 12)}
                  </button>
                ))}
                <button type="button" className="ghost tiny" onClick={() => goProjectSection("files", "已打开文件区，可以上传合同、报价、成本或核销材料。")}>上传项目文件</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="timeline">
        <div>
          <span>下一节点</span>
          <strong>{project.nextMilestone}</strong>
        </div>
        <div>
          <span>回款节点</span>
          <strong>{project.paymentDue}</strong>
        </div>
      </div>
      {quickUploadType && <UploadDialog
        session={session}
        projects={[project]}
        selected={project}
        initialType={quickUploadType}
        onClose={() => setQuickUploadType("")}
        onDone={async () => {
          await onDone();
          setLocalFocusTarget("files");
          onNotice("文件已处理，已回到文件与 AI 解析区。");
          setQuickUploadType("");
        }}
      />}
    </div>
  );
}

function buildAiFilingAction(result = {}, query = "", projects = [], selected = null) {
  if (result.action !== "filing-guidance") return null;
  const text = String(query || "");
  const explicitMatches = projects.filter((project) => String(query || "").includes(project.name) || (project.client && String(query || "").includes(project.client)));
  const target = explicitMatches[0] || selected || projects[0] || null;
  const ambiguous = !explicitMatches.length && projects.length > 1;
  const uploadType = /核销|月度|确认收入/.test(text)
    ? "verification-sheet"
    : /报价|报价表|quote/i.test(text)
      ? "quote-sheet"
      : /合同|新项目|立项/.test(text)
        ? "create-project"
        : "cost-sheet";
  const uploadTypeLabel = uploadType === "verification-sheet"
    ? "月度核销表"
    : uploadType === "quote-sheet"
      ? "合同报价表"
      : uploadType === "create-project"
        ? "合同/报价创建项目"
        : "执行成本表";
  return {
    projectId: target?.id || "",
    projectName: target?.name || "",
    uploadType,
    uploadTypeLabel,
    ambiguous,
    options: ambiguous ? projects.slice(0, 4).map((project) => ({ id: project.id, name: project.name, client: project.client })) : []
  };
}

function AiFilingActions({ action, onOpen }) {
  return (
    <div className="ai-filing-actions">
      <strong>{action.ambiguous ? `选择要归档的项目 · ${action.uploadTypeLabel}` : `准备上传${action.uploadTypeLabel}到「${action.projectName || "当前项目"}」`}</strong>
      {action.ambiguous && <div className="ai-project-options">
        {action.options.map((project) => (
          <button type="button" className="ghost tiny" key={project.id} onClick={() => onOpen(action, project.id)}>
            {project.name}
          </button>
        ))}
      </div>}
      <button type="button" className="primary tiny" onClick={() => onOpen(action)}>
        {action.ambiguous ? "用当前项目上传" : "打开上传"}
      </button>
      <span>会先进入 AI 预览，确认后才写入成本、报价或核销数据。</span>
    </div>
  );
}

function buildAiNavigationActions(query = "", projects = [], selected = null, session = {}) {
  const text = String(query || "");
  const target = findProjectFromText(text, projects, selected) || selected || projects[0] || null;
  const actions = [];
  if (/备用金|报销|审批|票据/.test(text)) {
    actions.push({
      label: /备用金|预算/.test(text) ? "查看项目备用金" : "查看审批记录",
      view: "approvals",
      subView: /备用金|预算/.test(text) ? "项目备用金" : "报销",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」相关审批与备用金。`
    });
  }
  if (/进度|节点|滞后|超前|完成度|材料|文件|解析/.test(text)) {
    actions.push({
      label: /材料|文件|解析/.test(text) ? "打开文件解析区" : "打开项目进度",
      view: "dashboard",
      focus: /材料|文件|解析/.test(text) ? "files" : "progress",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」的${/材料|文件|解析/.test(text) ? "文件与 AI 解析区" : "项目进度区"}。`
    });
  }
  if (/回款|收款|催收|待收|尾款|首款/.test(text)) {
    actions.push({
      label: canUseCollectionRole(session) ? "打开催收助手" : "查看回款记录",
      view: canUseCollectionRole(session) ? "collections" : "dashboard",
      focus: "payments",
      projectId: target?.id || "",
      notice: canUseCollectionRole(session)
        ? `已打开催收助手：${target?.name || "当前项目"}。`
        : `已打开「${target?.name || "当前项目"}」的回款记录区。`
    });
  }
  if (/创意|内容|过稿|脚本|客户|偏好|雷区/.test(text)) {
    actions.push({
      label: "查看客户偏好",
      view: "dashboard",
      focus: "client",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」的客户偏好与交接信息。`
    });
  }
  if (/现金流|经营|倒闭|安全线|老板|公司/.test(text) && canSeeManagement(session)) {
    actions.push({
      label: "打开现金流压力",
      view: "management",
      subView: "现金流压力",
      projectId: target?.id || "",
      notice: "已打开经营舱现金流压力页。"
    });
  }
  return actions.slice(0, 2);
}

function AiNavigationActions({ actions = [], onOpen }) {
  if (!actions.length) return null;
  return (
    <div className="ai-filing-actions">
      <strong>下一步可以直接处理</strong>
      <div className="ai-project-options">
        {actions.map((action) => (
          <button type="button" className="ghost tiny" key={`${action.view}-${action.subView || action.focus || action.label}`} onClick={() => onOpen(action)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated, onSelectProject, onNavigate }) {
  const visibleProjects = projects.slice(0, 4);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => [
    {
      from: "assistant",
      title: "AI 项目助手",
      text: "你可以直接问项目进度、备用金、审批、材料缺口和内容创意；也可以说“帮我提交500元报销到我的项目”。",
    },
  ]);

  async function ask(text) {
    const query = String(text || question).trim();
    if (!query.trim()) {
      onNotice("先输入一个问题，比如“我的项目备用金还有多少？”");
      return;
    }
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query, session, projects, approvals, settings, stats, selected, onDone });
    } catch (error) {
      result = { reply: `这次没办成：${error.message}` };
    }
    setMessages((items) => [
      ...items,
      { from: "user", title: session.name, text: query },
      { from: "assistant", title: "AI 项目助手", text: result.reply || "我已经处理完成。", pendingAction: result.pendingAction || null, filingAction: buildAiFilingAction(result, query, projects, selected), navActions: buildAiNavigationActions(query, projects, selected, session), query },
    ].slice(-8));
    setQuestion(query);
    setSending(false);
  }

  async function confirmPending(message) {
    if (!message.pendingAction || sending) return;
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query: message.query, confirmAction: message.pendingAction, session, projects, approvals, settings, stats, selected, onDone });
      if (result.approval) onApprovalCreated?.(result.approval);
      onNotice("AI 已按你的确认提交审批，审批列表已刷新。");
    } catch (error) {
      result = { reply: `确认失败：${error.message}` };
    }
    setMessages((items) => [
      ...items.map((item) => item === message ? { ...item, pendingAction: null } : item),
      { from: "assistant", title: "AI 项目助手", text: result.reply || "已确认处理。" },
    ].slice(-8));
    setSending(false);
  }

  function handleFilingAction(action, projectId = "") {
    const targetId = projectId || action?.projectId || selected?.id || projects[0]?.id || "";
    const target = projects.find((project) => project.id === targetId) || selected || projects[0];
    const canCreate = canCreateProjectRole(session);
    const uploadType = action?.uploadType === "create-project" && !canCreate ? "cost-sheet" : action?.uploadType || "cost-sheet";
    if (!target?.id && uploadType !== "create-project") {
      onNotice("当前没有可上传归档的项目，请先让管理员分派项目。");
      return;
    }
    if (target?.id) onSelectProject?.(target.id);
    onUpload?.(uploadType, uploadType === "create-project" ? null : target);
    const targetName = uploadType === "create-project" ? "新项目" : target.name;
    const downgraded = action?.uploadType === "create-project" && !canCreate;
    onNotice(downgraded
      ? `当前账号不能创建新项目，已改为给「${target.name}」打开项目文件上传，AI 会先预览识别。`
      : `已为「${targetName}」打开${action?.uploadTypeLabel || "项目文件"}上传，AI 会先预览识别，确认后才写入项目。`);
  }

  function inferAiDropUploadType(files = []) {
    const text = files.map((file) => file.name || "").join(" ");
    if (/核销|月度|确认收入|verification/i.test(text)) return "verification-sheet";
    if (/报价|quote|合同|contract/i.test(text)) return canCreateProjectRole(session) ? "create-project" : "quote-sheet";
    if (/报销|费用|成本|cost|expense|执行/i.test(text)) return "cost-sheet";
    return selected?.id ? "cost-sheet" : "create-project";
  }

  async function handleAiFileDrop(event) {
    event.preventDefault();
    const picked = Array.from(event.dataTransfer?.files || []);
    if (!picked.length) return;
    const uploadType = inferAiDropUploadType(picked);
    let payloads = [];
    try {
      payloads = await Promise.all(picked.map(fileToPayload));
    } catch (error) {
      onNotice(`AI 读取文件失败：${error.message}`);
      return;
    }
    const target = uploadType === "create-project" ? null : selected || projects[0] || null;
    if (uploadType !== "create-project" && !target?.id) {
      onNotice("当前没有可归档的项目，请先让销售、PM 或管理层上传合同创建项目。");
      return;
    }
    if (target?.id) onSelectProject?.(target.id);
    onUpload?.(uploadType, target, payloads);
    setMessages((items) => [
      ...items,
      { from: "assistant", title: "AI 项目助手", text: `已接收 ${payloads.length} 个文件，并打开上传预览。确认前不会写入项目。` },
    ].slice(-8));
    onNotice(`AI 已接收 ${payloads.length} 个文件，已打开上传预览，确认后才会写入项目。`);
  }

  return (
    <section className="ai-workbench" onDrop={handleAiFileDrop} onDragOver={(event) => event.preventDefault()}>
      <div className="ai-chat-shell">
        <div className="ai-chat-head">
          <PanelTitle icon={Bot} title="AI 项目助手" />
          <span>{session.name} 的项目上下文</span>
        </div>
        <div className="ai-message ai-message-assistant">
          <strong>你可以直接把项目里的事情丢给我。</strong>
          <p>问备用金、报销、进度、材料缺口，或者把合同、报价表、成本表、票据、核销表拖到这个对话区，我会先识别你的账号和项目权限，再帮你归档或登记。</p>
        </div>
        <div className="prompt-list">
          <button type="button" onClick={() => ask("我的项目备用金还有多少？")}>我的项目备用金还有多少？</button>
          <button type="button" onClick={() => ask(`帮我提交500元报销到${selected.name}`)}>帮我提交一笔报销</button>
          <button type="button" onClick={() => ask("这个项目进度怎么样？")}>这个项目进度怎么样？</button>
          <button type="button" onClick={() => ask("给我生成一个更容易过稿的内容方向")}>给我生成一个更容易过稿的内容方向</button>
          <button type="button" onClick={() => onUpload?.()}><UploadCloud size={14} />让 AI 识别项目文件</button>
        </div>
        <div className="ai-feed ai-workbench-feed">
          {messages.map((message, index) => (
            <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
              <span>{message.title}</span>
              <p>{message.text}</p>
              {message.pendingAction && <div className="ai-confirm-actions">
                <button type="button" className="primary" onClick={() => confirmPending(message)} disabled={sending}>确认提交</button>
                <button type="button" className="ghost" onClick={() => setMessages((items) => items.map((item) => item === message ? { ...item, pendingAction: null, text: `${item.text}\n已取消，未提交。` } : item))}>取消</button>
              </div>}
              {message.filingAction && <AiFilingActions action={message.filingAction} onOpen={handleFilingAction} />}
              {message.navActions && <AiNavigationActions actions={message.navActions} onOpen={onNavigate} />}
            </div>
          ))}
        </div>
        <div className="ai-context-strip">
          {visibleProjects.map((project) => (
            <div key={project.id}>
              <span>{projectHealth(project).label}</span>
              <strong>{project.name}</strong>
            </div>
          ))}
        </div>
        <div className="chat-input ai-main-input">
          <UploadCloud size={16} />
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="输入问题，或先用上传入口让 AI 识别项目文件" />
          <button type="button" className="ghost" onClick={() => onUpload?.()}>上传</button>
          <button type="button" onClick={() => ask()} disabled={sending}>{sending ? "处理中" : "发送"}</button>
        </div>
      </div>

      <div className="ai-side-panel">
        <PanelTitle icon={FileText} title="当前项目建议" />
        <div className="idea-card">
          <strong>{selected.client || selected.name} 内容建议</strong>
          <p>优先用“真实场景 + 明确卖点 + 可执行路径”，避免只给概念不落地。新 PM 接手时自动生成客户雷区和交接摘要。</p>
        </div>
        <div className="compact-list">
          {visibleProjects.map((project) => (
            <div key={project.id}>
              <strong>{project.name}</strong>
              <span>{project.pm} · {projectHealth(project).label} · 备用金余 {money(Math.max(project.pettyCashBudget - project.pettyCashUsed, 0))}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ApprovalFunds({ projects, approvals, selected, session, subView, setSubView, focusApprovalId = "", onFocusConsumed, onDone, onNotice }) {
  const [selectedApprovalKey, setSelectedApprovalKey] = useState("");
  const [form, setForm] = useState({
    projectId: selected?.id || "",
    type: "reimbursement",
    amount: "",
    payee: "",
    reason: "",
    expenseCategory: "自动识别"
  });
  const [submitting, setSubmitting] = useState(false);
  const [actingApprovalId, setActingApprovalId] = useState("");
  const [withdrawingApprovalId, setWithdrawingApprovalId] = useState("");
  const [approvalActionNote, setApprovalActionNote] = useState("");
  const [localApprovalFocusId, setLocalApprovalFocusId] = useState("");
  const [exportingApprovalLedger, setExportingApprovalLedger] = useState(false);
  const [reimbursementMonth, setReimbursementMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [summaryProjectId, setSummaryProjectId] = useState("all");
  const [exportingReimbursementSummary, setExportingReimbursementSummary] = useState("");
  const approvalTypeOptions = approvalTypeOptionsFor(session);
  useEffect(() => {
    if (selected?.id) setForm((current) => ({ ...current, projectId: current.projectId || selected.id }));
  }, [selected?.id]);
  useEffect(() => {
    if (!approvalTypeOptions.some(([value]) => value === form.type)) {
      setForm((current) => ({ ...current, type: "reimbursement" }));
    }
  }, [form.type, approvalTypeOptions]);
  const normalizedApprovals = approvals.map((item) => ({
    ...item,
    project: item.projectName || item.project || "未命名项目",
    user: item.applicantName || item.user || "提交人",
    typeName: item.typeLabel || item.type || "审批",
    category: item.type === "petty_cash" ? "项目备用金" : item.type === "reimbursement" ? "报销" : item.type === "supplier_payment" ? "供应商付款" : item.category || "待我审批",
    scope: item.reason || item.scope || "暂无说明",
    steps: Array.isArray(item.steps) ? item.steps : []
  }));
  const actionableApprovals = normalizedApprovals.filter((item) => canHandleApproval(session, item));
  const categories = [
    { label: "待我审批", desc: "需要当前角色处理的审批", count: actionableApprovals.length },
    { label: "项目备用金", desc: "项目预算、已用和剩余额度", count: normalizedApprovals.filter((item) => item.category === "项目备用金").length },
    { label: "报销", desc: "员工报销、票据和入账状态", count: normalizedApprovals.filter((item) => item.category === "报销").length },
    { label: "供应商付款", desc: "供应商支出、付款和结算状态", count: normalizedApprovals.filter((item) => item.category === "供应商付款").length },
  ];
  const activeCategory = subView || "待我审批";
  const visibleApprovals = activeCategory === "待我审批"
    ? actionableApprovals
    : normalizedApprovals.filter((item) => item.category === activeCategory);
  useEffect(() => {
    const focusId = focusApprovalId || localApprovalFocusId;
    if (!focusId) return;
    const target = normalizedApprovals.find((item) => item.id === focusId);
    if (!target) return;
    setSelectedApprovalKey(target.id);
    setSubView(target.category || "待我审批");
    if (focusApprovalId) onFocusConsumed?.();
    if (localApprovalFocusId) setLocalApprovalFocusId("");
  }, [focusApprovalId, localApprovalFocusId, normalizedApprovals, setSubView, onFocusConsumed]);
  const visibleAmount = visibleApprovals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingVisible = visibleApprovals.filter((item) => String(item.status || "").includes("待")).length;
  const completedVisible = visibleApprovals.filter((item) => item.status === "已完成").length;
  const rejectedVisible = visibleApprovals.filter((item) => item.status === "已驳回").length;
  const withdrawnVisible = visibleApprovals.filter((item) => item.status === "已撤回").length;
  const priorityApprovals = approvalPriorityQueue(normalizedApprovals, session);
  const fallbackApproval = normalizedApprovals[0] || {
    id: "",
    typeName: "暂无审批",
    projectId: selected.id,
    project: selected.name,
    amount: 0,
    status: "等待提交",
    steps: []
  };
  const selectedApproval = visibleApprovals.find((item) => item.id === selectedApprovalKey) || visibleApprovals[0] || fallbackApproval;
  const canAct = canHandleApproval(session, selectedApproval);
  const canWithdrawSelected = canWithdrawApproval(session, selectedApproval);
  const selectedRuntime = approvalRuntimeInfo(selectedApproval);
  const reimbursementApprovals = normalizedApprovals.filter((item) => item.type === "reimbursement");
  const monthlyReimbursements = reimbursementApprovals.filter((item) => String(item.createdAt || item.submittedAt || "").slice(0, 7) === reimbursementMonth);
  const selectedProjectReimbursements = summaryProjectId === "all"
    ? monthlyReimbursements
    : monthlyReimbursements.filter((item) => item.projectId === summaryProjectId);
  const reimbursementCategorySummary = expenseCategoryValues.map((category) => ({
    category,
    amount: monthlyReimbursements.filter((item) => (item.expenseCategory || "其他") === category).reduce((sum, item) => sum + Number(item.amount || 0), 0),
    count: monthlyReimbursements.filter((item) => (item.expenseCategory || "其他") === category).length
  })).filter((item) => item.amount || item.count);
  const reimbursementStatusSummary = ["待审批", "已完成", "已驳回", "已撤回"].map((status) => {
    const matched = monthlyReimbursements.filter((item) => status === "待审批" ? String(item.status || "").includes("待") : item.status === status);
    return { status, count: matched.length, amount: matched.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
  });
  const reimbursementProjectSummary = projects.map((project) => {
    const rows = monthlyReimbursements.filter((item) => item.projectId === project.id || item.project === project.name);
    return { project, count: rows.length, amount: rows.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
  }).filter((item) => item.count || item.amount);
  const pettyCashProject = projects.find((project) => project.id === selectedApproval.projectId)
    || projects.find((project) => project.name === selectedApproval.project)
    || projects.find((project) => project.id === form.projectId)
    || selected;
  const pettyCashLeft = Math.max(Number(pettyCashProject?.pettyCashBudget || 0) - Number(pettyCashProject?.pettyCashUsed || 0), 0);
  const approvalFinanceImpact = (() => {
    if (!selectedApproval?.id) return "选择一条审批后，会在这里预览通过后的财务影响。";
    if (selectedApproval.status === "已驳回") return "这条审批已驳回，不会写入项目成本或备用金。";
    if (selectedApproval.status === "已完成") return "这条审批已完成，财务影响已经写入项目数据。";
    if (selectedApproval.type === "petty_cash") return `通过全流程后，会给「${selectedApproval.project}」增加备用金预算 ${money(selectedApproval.amount)}。`;
    if (selectedApproval.type === "reimbursement") return `通过全流程后，会把 ${money(selectedApproval.amount)} 计入「${selectedApproval.project}」员工报销-${selectedApproval.expenseCategory || "其他"}成本，并同步占用项目备用金。`;
    if (selectedApproval.type === "supplier_payment") return `通过全流程后，会把 ${money(selectedApproval.amount)} 计入「${selectedApproval.project}」供应商支出，并进入供应商结算记录。`;
    return "通过全流程后，系统会按审批类型写入项目财务记录。";
  })();

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function primeApprovalForm(type = "reimbursement", reason = "") {
    const allowedType = approvalTypeOptions.some(([value]) => value === type) ? type : "reimbursement";
    setForm((current) => ({
      ...current,
      projectId: current.projectId || selected?.id || projects[0]?.id || "",
      type: allowedType,
      payee: current.payee || session.name || "",
      reason: current.reason || reason,
      expenseCategory: allowedType === "reimbursement" ? current.expenseCategory || "自动识别" : current.expenseCategory
    }));
    setSubView(allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销");
    setSelectedApprovalKey("");
    onNotice(`已预填${allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销"}申请，请补金额后提交。`);
  }

  async function submitApproval(event) {
    event.preventDefault();
    if (!approvalTypeOptions.some(([value]) => value === form.type)) {
      onNotice("当前角色不能提交供应商付款，请让 PM、销售、财务或管理层处理。");
      return;
    }
    if (!form.projectId) {
      onNotice("请先选择项目");
      return;
    }
    if (!Number(form.amount)) {
      onNotice("请填写审批金额");
      return;
    }
    setSubmitting(true);
    try {
      const approval = await apiRequest("/api/approvals", session, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setForm({ projectId: form.projectId, type: "reimbursement", amount: "", payee: "", reason: "", expenseCategory: "自动识别" });
      const targetCategory = form.type === "petty_cash" ? "项目备用金" : form.type === "supplier_payment" ? "供应商付款" : "报销";
      setSubView(targetCategory);
      setSelectedApprovalKey(approval.id || "");
      setLocalApprovalFocusId(approval.id || "");
      await onDone();
      onNotice(`审批已提交，${targetCategory}列表已刷新并选中新审批：${approval.typeLabel || targetCategory} ${money(approval.amount)}，当前状态 ${approval.status}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function act(action) {
    if (!selectedApproval.id) return;
    setActingApprovalId(selectedApproval.id);
    try {
      const handledApproval = await apiRequest("/api/approvals/action", session, {
        method: "POST",
        body: JSON.stringify({ id: selectedApproval.id, action, note: approvalActionNote })
      });
      const nextApproval = visibleApprovals.find((item) => item.id !== selectedApproval.id && canHandleApproval(session, item));
      setSelectedApprovalKey(nextApproval?.id || "");
      setApprovalActionNote("");
      onNotice(nextApproval
        ? `${action === "reject" ? "审批已驳回" : handledApproval.status === "已完成" ? "审批已完成并写入项目财务" : "审批已通过到下一步"}，已切到下一条待处理。`
        : `${action === "reject" ? "审批已驳回" : handledApproval.status === "已完成" ? "审批已完成并写入项目财务" : "审批已通过到下一步"}，当前列表暂无下一条待处理。`);
      await onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setActingApprovalId("");
    }
  }

  async function withdraw(item = selectedApproval) {
    if (!item?.id) return;
    setWithdrawingApprovalId(item.id);
    try {
      const approval = await apiRequest("/api/approvals/withdraw", session, {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          reason: approvalActionNote || `撤回审批：${item.typeName || item.typeLabel || "申请信息需要调整"}`
        })
      });
      setApprovalActionNote("");
      setSelectedApprovalKey(approval.id || item.id);
      onNotice(`审批已撤回：${approval.typeLabel || item.typeName || "审批"} ${money(approval.amount || item.amount)}，不会继续流转。`);
      await onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setWithdrawingApprovalId("");
    }
  }

  function exportApprovalLedger() {
    if (!visibleApprovals.length) {
      onNotice("当前分类没有可导出的审批记录，请先切换分类或提交审批。");
      return;
    }
    setExportingApprovalLedger(true);
    try {
      const safeCategory = String(activeCategory || "approvals").replace(/[\\s/\\\\]+/g, "-");
      const filename = `ad-approval-ledger-${safeCategory}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(filename, approvalLedgerRows(visibleApprovals));
      onNotice(`审批台账 CSV 已导出：${activeCategory} · ${visibleApprovals.length} 条记录。`);
    } catch (error) {
      onNotice(error.message || "审批台账导出失败，请稍后再试。");
    } finally {
      setExportingApprovalLedger(false);
    }
  }

  function exportSingleProjectReimbursements() {
    const rows = selectedProjectReimbursements;
    if (!rows.length || summaryProjectId === "all") {
      onNotice("请先选择一个有报销记录的项目，再导出单项目报销表。");
      return;
    }
    setExportingReimbursementSummary("single");
    try {
      const project = projects.find((item) => item.id === summaryProjectId);
      downloadCsv(`${project?.name || "单项目"}-${reimbursementMonth}-报销表.csv`, reimbursementSummaryRows(rows, projects, reimbursementMonth));
      onNotice(`单项目报销表已导出：${project?.name || "当前项目"} · ${rows.length} 条。`);
    } catch (error) {
      onNotice(error.message || "单项目报销表导出失败，请稍后再试。");
    } finally {
      setExportingReimbursementSummary("");
    }
  }

  function exportAllProjectReimbursementSummary() {
    if (!monthlyReimbursements.length) {
      onNotice("当前月份没有可导出的报销记录。");
      return;
    }
    setExportingReimbursementSummary("all");
    try {
      downloadCsv(`${reimbursementMonth}-全部项目报销汇总.csv`, reimbursementSummaryRows(monthlyReimbursements, projects, reimbursementMonth));
      onNotice(`全部项目报销汇总已导出：${reimbursementMonth} · ${monthlyReimbursements.length} 条。`);
    } catch (error) {
      onNotice(error.message || "全部项目报销汇总导出失败，请稍后再试。");
    } finally {
      setExportingReimbursementSummary("");
    }
  }

  return (
    <section className="approval-workbench">
      <div className="approval-type-row">
        {categories.map((item) => (
          <button
            type="button"
            className={`approval-type ${activeCategory === item.label ? "active" : ""}`}
            key={item.label}
            onClick={() => {
              setSubView(item.label);
              setSelectedApprovalKey("");
            }}
          >
            <strong>{item.label}</strong>
            <span>{item.desc}</span>
            <b>{item.count}</b>
          </button>
        ))}
      </div>

      <form className="feature-panel approval-form" onSubmit={submitApproval}>
        <PanelTitle icon={Plus} title="提交审批" />
        <label>
          <span>项目</span>
          <select value={form.projectId} onChange={(event) => updateForm("projectId", event.target.value)}>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>类型</span>
          <select value={form.type} onChange={(event) => updateForm("type", event.target.value)}>
            {approvalTypeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>金额</span>
          <input value={form.amount} onChange={(event) => updateForm("amount", event.target.value)} placeholder="例如 1280" />
        </label>
        <label>
          <span>收款人 / 用途</span>
          <input value={form.payee} onChange={(event) => updateForm("payee", event.target.value)} placeholder="员工、供应商或用途" />
        </label>
        <label>
          <span>说明</span>
          <input value={form.reason} onChange={(event) => updateForm("reason", event.target.value)} placeholder="拍摄交通、道具采购、票据说明等" />
        </label>
        {form.type === "reimbursement" && <label>
          <span>报销类目</span>
          <select value={form.expenseCategory} onChange={(event) => updateForm("expenseCategory", event.target.value)}>
            {expenseCategories.map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
        </label>}
        <button type="submit" className="primary" disabled={submitting}>{submitting ? "提交中" : "提交审批"}</button>
      </form>

      <div className="feature-panel approval-main">
        <div className="section-head compact">
          <PanelTitle icon={BellRing} title={activeCategory} />
          <button type="button" className="ghost tiny" disabled={exportingApprovalLedger || !visibleApprovals.length} onClick={exportApprovalLedger}>
            <FileSpreadsheet size={14} />{exportingApprovalLedger ? "导出中" : "导出审批"}
          </button>
        </div>
        <div className="approval-summary-row">
          <Mini label="当前数量" value={`${visibleApprovals.length} 条`} />
          <Mini label="当前金额" value={money(visibleAmount)} />
          <Mini label="待处理" value={`${pendingVisible} 条`} />
          <Mini label="已完成" value={`${completedVisible} 条`} />
          <Mini label="已驳回" value={`${rejectedVisible} 条`} />
          <Mini label="已撤回" value={`${withdrawnVisible} 条`} />
        </div>
        <div className="approval-priority-panel">
          <div>
            <strong>优先处理</strong>
            <span>{priorityApprovals.length ? "按是否轮到你、SLA、等待时长和金额排序。" : "暂无待处理审批，可以先提交报销或备用金申请。"}</span>
          </div>
          {priorityApprovals.length ? priorityApprovals.map(({ approval, runtime, actionable, reason }) => (
            <button type="button" key={approval.id} onClick={() => {
              setSelectedApprovalKey(approval.id);
              setSubView(approval.category || "待我审批");
            }}>
              <b className={runtime.tone}>{actionable ? "轮到你" : runtime.stepLabel}</b>
              <strong>{approval.typeName} · {money(approval.amount)}</strong>
              <span>{approval.project} · {reason}</span>
              <em>{runtime.hint}</em>
            </button>
          )) : <div className="approval-priority-empty">
            <strong>暂无审批压力</strong>
            <span>需要用款、报销或供应商付款时，可以从左侧提交审批，系统会自动生成流程和处理人。</span>
          </div>}
        </div>
        <div className="approval-list">
          {visibleApprovals.length ? visibleApprovals.map((item) => (
            <div className="approval-card" key={item.id}>
              <div>
                <strong>{item.typeName}</strong>
                <span>{item.project} · {item.user} · {item.expenseCategory ? `报销类目：${item.expenseCategory} · ` : ""}{currentApprovalStepInfo(item)?.label || item.status} · {item.scope}</span>
                <small className={`approval-next-line ${approvalRuntimeInfo(item).tone}`}>
                  {approvalRuntimeInfo(item).handler} · {approvalRuntimeInfo(item).waitText} · {approvalRuntimeInfo(item).slaText}
                </small>
              </div>
              <b>{money(item.amount)}</b>
              <em>{item.status}</em>
              <button type="button" onClick={() => setSelectedApprovalKey(item.id)}>查看</button>
              {canWithdrawApproval(session, item) && <button type="button" className="ghost" onClick={() => withdraw(item)} disabled={withdrawingApprovalId === item.id}>
                {withdrawingApprovalId === item.id ? "撤回中" : "撤回"}
              </button>}
            </div>
          )) : <div className="empty-state action-empty approval-empty-actions">
            <strong>{activeCategory === "待我审批" ? "当前没有需要你处理的审批" : `暂无${activeCategory}记录`}</strong>
            <span>{activeCategory === "待我审批" ? "可以先提交一条报销或备用金申请，提交后会自动生成流程进度。" : "可以用下面的快捷入口预填申请，真正提交前仍需要你确认金额和说明。"}</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => primeApprovalForm("reimbursement", "项目执行报销")}>提交报销</button>
              <button type="button" className="ghost tiny" onClick={() => primeApprovalForm("petty_cash", "项目执行备用金")}>申请备用金</button>
              {canSubmitSupplierPaymentRole(session) && <button type="button" className="ghost tiny" onClick={() => primeApprovalForm("supplier_payment", "供应商付款")}>供应商付款</button>}
            </div>
          </div>}
        </div>
      </div>

      <div className="feature-panel reimbursement-summary-panel">
        <div className="section-head compact">
          <PanelTitle icon={FileSpreadsheet} title="月度报销汇总" />
          <div className="button-row compact">
            <button type="button" className="ghost tiny" disabled={exportingReimbursementSummary === "single" || summaryProjectId === "all"} onClick={exportSingleProjectReimbursements}>
              <FileSpreadsheet size={14} />{exportingReimbursementSummary === "single" ? "导出中" : "导出单项目报销表"}
            </button>
            <button type="button" className="ghost tiny" disabled={exportingReimbursementSummary === "all" || !monthlyReimbursements.length} onClick={exportAllProjectReimbursementSummary}>
              <FileSpreadsheet size={14} />{exportingReimbursementSummary === "all" ? "导出中" : "导出全部项目报销汇总"}
            </button>
          </div>
        </div>
        <div className="reimbursement-summary-controls">
          <label>
            <span>月份</span>
            <input type="month" value={reimbursementMonth} onChange={(event) => setReimbursementMonth(event.target.value)} />
          </label>
          <label>
            <span>项目</span>
            <select value={summaryProjectId} onChange={(event) => setSummaryProjectId(event.target.value)}>
              <option value="all">全部项目</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
        <div className="approval-summary-row">
          <Mini label="全部项目报销" value={money(monthlyReimbursements.reduce((sum, item) => sum + Number(item.amount || 0), 0))} />
          <Mini label="全部项目条数" value={`${monthlyReimbursements.length} 条`} />
          <Mini label="单项目报销" value={money(selectedProjectReimbursements.reduce((sum, item) => sum + Number(item.amount || 0), 0))} />
          <Mini label="单项目条数" value={`${selectedProjectReimbursements.length} 条`} />
        </div>
        <div className="reimbursement-summary-grid">
          <div className="compact-list">
            <strong>按报销类目</strong>
            {reimbursementCategorySummary.length ? reimbursementCategorySummary.map((item) => (
              <div key={item.category}><strong>{item.category}</strong><span>{item.count} 条 · {money(item.amount)}</span></div>
            )) : <div><strong>暂无类目数据</strong><span>提交报销后会自动按类目汇总。</span></div>}
          </div>
          <div className="compact-list">
            <strong>按审批状态</strong>
            {reimbursementStatusSummary.map((item) => (
              <div key={item.status}><strong>{item.status}</strong><span>{item.count} 条 · {money(item.amount)}</span></div>
            ))}
          </div>
          <div className="compact-list">
            <strong>单个项目总数</strong>
            {reimbursementProjectSummary.length ? reimbursementProjectSummary.slice(0, 8).map(({ project, count, amount }) => (
              <div key={project.id}><strong>{project.name}</strong><span>{count} 条 · {money(amount)}</span></div>
            )) : <div><strong>暂无项目报销</strong><span>本月还没有报销记录。</span></div>}
          </div>
        </div>
      </div>

      <div className="feature-panel approval-detail">
        <PanelTitle icon={Clock3} title="流程进度" />
        <div className="approval-detail-head">
          <strong>{selectedApproval.typeName}</strong>
          <span>{selectedApproval.project} · {selectedApproval.expenseCategory ? `${selectedApproval.expenseCategory} · ` : ""}{money(selectedApproval.amount)}</span>
        </div>
        {selectedApproval.id && <div className={`approval-next-panel ${selectedRuntime.tone}`}>
          <strong>{selectedRuntime.stepLabel} · {selectedRuntime.handler}</strong>
          <span>{selectedRuntime.waitText} · {selectedRuntime.slaText}</span>
          <p>{selectedRuntime.hint}</p>
        </div>}
        <div className="approval-steps">
          {selectedApproval.steps.length ? selectedApproval.steps.map((step) => (
            <div className={`approval-step ${step.status}`} key={step.key || step.label}>
              <i />
              <div>
                <strong>{step.label}</strong>
                <span>{selectedApproval.status === "已撤回" && step.status === "pending" ? "已撤回" : step.status === "done" ? "已完成" : step.status === "current" ? selectedApproval.status : step.status === "rejected" ? "已驳回" : "等待处理"}</span>
              </div>
            </div>
          )) : <div className="empty-state action-empty approval-flow-empty">
            <strong>还没有审批流程</strong>
            <span>先从左侧提交一条申请，系统会自动生成员工、PM、总监、财务到老板的流程进度。</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => primeApprovalForm("reimbursement", "项目执行报销")}>预填报销</button>
              <button type="button" className="ghost tiny" onClick={() => primeApprovalForm("petty_cash", "项目执行备用金")}>预填备用金</button>
              {canSubmitSupplierPaymentRole(session) && <button type="button" className="ghost tiny" onClick={() => primeApprovalForm("supplier_payment", "供应商付款")}>预填供应商付款</button>}
            </div>
          </div>}
        </div>
        {selectedApproval.logs?.length > 0 && <div className="approval-log">
          {selectedApproval.logs.slice(0, 3).map((log) => (
            <p key={`${log.action}-${log.at}`}>{log.user} · {log.action === "reject" ? "驳回" : log.action === "approve" ? "通过" : "提交"} · {new Date(log.at).toLocaleString("zh-CN")}{log.note ? ` · ${log.note}` : ""}</p>
          ))}
        </div>}
        {canAct && <div className="approval-actions">
          <label className="approval-action-note">
            <span>处理意见</span>
            <input value={approvalActionNote} onChange={(event) => setApprovalActionNote(event.target.value)} placeholder="例如：票据齐全，同意；或请补充发票后再提交" />
          </label>
          <button type="button" className="primary" onClick={() => act("approve")} disabled={actingApprovalId === selectedApproval.id}>{actingApprovalId === selectedApproval.id ? "处理中" : "通过"}</button>
          <button type="button" className="ghost" onClick={() => act("reject")} disabled={actingApprovalId === selectedApproval.id}>{actingApprovalId === selectedApproval.id ? "处理中" : "驳回"}</button>
        </div>}
        {canWithdrawSelected && <div className="approval-actions">
          <button type="button" className="ghost" onClick={() => withdraw(selectedApproval)} disabled={withdrawingApprovalId === selectedApproval.id}>
            {withdrawingApprovalId === selectedApproval.id ? "撤回中" : "撤回审批"}
          </button>
        </div>}
      </div>

      <div className="feature-panel">
        <PanelTitle icon={CircleDollarSign} title="项目备用金" />
        <p className="muted">{pettyCashProject?.name || "当前项目"} · 跟随当前审批/表单项目</p>
        <Mini label="预算额度" value={money(pettyCashProject?.pettyCashBudget || 0)} />
        <Mini label="已使用" value={money(pettyCashProject?.pettyCashUsed || 0)} />
        <Mini label="剩余额度" value={money(pettyCashLeft)} />
      </div>
      <div className="feature-panel">
        <PanelTitle icon={ShieldAlert} title="AI 审批提示" />
        <p className="muted">备用金只用于执行人员拍摄、差旅、现场小额支出；供应商付款单独进入供应商支出。报销通过后自动计入项目成本。</p>
        <div className="approval-impact-preview">
          <strong>财务影响预览</strong>
          <span>{approvalFinanceImpact}</span>
        </div>
      </div>
    </section>
  );
}

function CloseoutReview({ project, isManagement, session, subView, onNotice, onOpenProjectSection, onOpenSupplier, onOpenCollection, onSetSubView, onUpload, onDone }) {
  const [copyingReview, setCopyingReview] = useState(false);
  const [exportingCloseout, setExportingCloseout] = useState(false);
  const [savingCloseout, setSavingCloseout] = useState(false);
  const [savingLearning, setSavingLearning] = useState("");
  const [closeoutNote, setCloseoutNote] = useState(project.closeoutNote || project.extractedFields?.closeoutNote || "");
  useEffect(() => {
    setCloseoutNote(project.closeoutNote || project.extractedFields?.closeoutNote || "");
  }, [project.id, project.closeoutNote, project.extractedFields?.closeoutNote]);
  const costRows = (project.costs || [])
    .map(normalizeCostRow)
    .filter((row) => Number(row.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const topCost = costRows[0] || { name: "待归集成本", value: project.costUsed };
  const totalCost = costRows.reduce((sum, row) => sum + Number(row.value || 0), 0) || Number(project.costUsed || 0);
  const topCostShare = totalCost ? Math.round((Number(topCost.value || 0) / totalCost) * 100) : 0;
  const costContractRate = project.contract ? Math.round((Number(project.costUsed || 0) / Number(project.contract || 1)) * 100) : 0;
  const suggestedReserve = Math.round(Number(topCost.value || 0) * 1.15);
  const costWarning = costContractRate >= 80
    ? "成本已接近合同金额，下一次同类项目报价要提高安全线或减少非必要支出。"
    : topCostShare >= 45
      ? "单项支出占比偏高，建议复盘供应商报价和是否存在临时追加。"
      : "成本结构相对分散，建议保留当前供应商和预算拆分方法。";
  const showRanking = subView === "支出排行";
  const hasReceivable = Number(project.receivable || 0) > 0;
  const canInspectSupplier = costRows.some((row) => row.name && !/待归集|暂无/.test(row.name));
  const closeoutDone = /已完成|结案|已结案/.test(String(project.status || "")) || Boolean(project.closedAt || project.extractedFields?.closedAt);
  function openCostFiles() {
    onOpenProjectSection?.("files", "已打开项目文件与 AI 解析区，可以补上传成本表、报价表或核销表。");
  }
  function uploadCloseoutMaterial(type = "cost-sheet") {
    onUpload?.(type, project);
    onNotice?.(`已为「${project.name}」打开${type === "verification-sheet" ? "核销表" : "成本表"}上传，AI 会先预览识别，确认后才写入项目。`);
  }
  function openPaymentReview() {
    onOpenProjectSection?.("payments", hasReceivable ? "已打开回款记录区，可以生成催收话术或记录回款。" : "已打开回款记录区，可以检查是否还有未登记流水。");
  }
  function openRanking() {
    onSetSubView?.("支出排行");
    onNotice?.("已切到支出排行，先看最大支出和预算预留建议。");
  }
  function openSupplierReview() {
    if (!canInspectSupplier) {
      onNotice?.("当前还没有明确供应商/成本明细，建议先补上传成本表。");
      return;
    }
    onOpenSupplier?.({ supplier: topCost.name });
  }
  async function copyCloseoutSummary() {
    const ranking = costRows.length
      ? costRows.slice(0, 5).map((row, index) => `${index + 1}. ${row.name}：${money(row.value)}，占总成本 ${totalCost ? Math.round((Number(row.value || 0) / totalCost) * 100) : 0}%`)
      : ["暂无成本明细，建议先上传成本表或等待报销/供应商付款归集。"];
    const lines = [
      `项目结案成本复盘：${project.name}`,
      `客户：${project.client || project.brand || "未填写"}`,
      `合同金额：${money(project.contract)}`,
      `总成本：${money(project.costUsed)}`,
      isManagement ? `项目利润：${money(project.contract - project.costUsed)}，毛利率：${project.margin}%` : "利润信息：普通成员不可见",
      `最大支出：${topCost.name} ${money(topCost.value)}，占总成本 ${topCostShare}%`,
      `成本占合同：${project.contract ? `${costContractRate}%` : "待确认合同"}`,
      `回款状态：${project.receivable > 0 ? `待回款 ${money(project.receivable)}` : "已无待回款"}`,
      `AI 优化建议：${costWarning} 下次同类项目建议为「${topCost.name}」至少预留 ${money(suggestedReserve)}。`,
      "支出排行：",
      ...ranking
    ];
    setCopyingReview(true);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      onNotice?.("结案复盘纪要已复制，可以发给 PM、财务或管理层讨论。");
    } catch (error) {
      onNotice?.(error.message || "复制失败，请稍后再试。");
    } finally {
      setCopyingReview(false);
    }
  }
  async function exportCloseoutReview() {
    setExportingCloseout(true);
    try {
      downloadCsv(`${project.name || "项目"}-结案成本复盘.csv`, closeoutReviewRows({
        project,
        costRows,
        topCost,
        totalCost,
        topCostShare,
        costContractRate,
        suggestedReserve,
        costWarning,
        closeoutNote,
        isManagement
      }));
      onNotice?.(`结案成本复盘 CSV 已导出：${project.name}。`);
    } finally {
      setExportingCloseout(false);
    }
  }
  async function saveCloseoutToClientMemory() {
    const client = project.client || project.brand || "";
    if (!client) {
      onNotice?.("当前项目还没有客户名称，先在项目详情补客户/品牌后再沉淀客户经验。");
      return;
    }
    setSavingLearning("client");
    try {
      const pitfallLines = [
        costContractRate >= 80 ? `成本占合同 ${costContractRate}%，下次报价需提前提高安全线。` : "",
        topCostShare >= 45 ? `最大支出「${topCost.name}」占总成本 ${topCostShare}%，下次需提前锁价或比价。` : "",
        hasReceivable ? `结案后仍有待回款 ${money(project.receivable)}，下次合同需明确回款节点。` : ""
      ].filter(Boolean);
      await apiRequest("/api/clients/profile", session, {
        method: "POST",
        body: JSON.stringify({
          append: true,
          client,
          pitfalls: pitfallLines.join("\n"),
          handoffNote: closeoutNote || `结案复盘：最大支出「${topCost.name}」${money(topCost.value)}，下次同类项目建议预留 ${money(suggestedReserve)}。`
        })
      });
      await onDone?.();
      onNotice?.(`已沉淀到客户档案：${client}，新 PM 交接时会看到这次结案经验。`);
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingLearning("");
    }
  }
  async function saveCloseoutToSupplierMemory() {
    if (!canInspectSupplier) {
      onNotice?.("当前还没有明确供应商/成本明细，建议先补上传成本表。");
      return;
    }
    setSavingLearning("supplier");
    try {
      await apiRequest("/api/suppliers/rate", session, {
        method: "POST",
        body: JSON.stringify({
          supplier: topCost.name,
          project: project.name,
          score: topCostShare >= 45 || costContractRate >= 80 ? 3 : 5,
          market: "结案成本复盘",
          comment: closeoutNote || `结案复盘：${topCost.name} 支出 ${money(topCost.value)}，占总成本 ${topCostShare}%，下次建议预留 ${money(suggestedReserve)}。`
        })
      });
      await onDone?.();
      onNotice?.(`已沉淀到供应商库：${topCost.name}，推荐星级和评分记录已刷新。`);
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingLearning("");
    }
  }
  async function markProjectClosed() {
    setSavingCloseout(true);
    try {
      const closedAt = project.closedAt || project.extractedFields?.closedAt || new Date().toISOString();
      await apiRequest("/api/projects/update", session, {
        method: "POST",
        body: JSON.stringify({
          id: project.id,
          values: {
            "项目名称": project.name,
            "客户 / 品牌": project.client || project.brand || "",
            "负责人": project.owner || "",
            "PM": project.pm || project.owner || "",
            "销售": project.sales || "",
            "项目状态": "已完成",
            "合同金额": project.contract,
            "已回款": project.paid,
            "下一节点": hasReceivable ? "结案待回款跟进" : "已结案归档",
            "回款节点": project.paymentDue || "",
            "结案时间": closedAt,
            "结案复盘备注": closeoutNote || `最大支出：${topCost.name} ${money(topCost.value)}，建议下次预留 ${money(suggestedReserve)}。`
          }
        })
      });
      await onDone?.();
      onNotice?.(hasReceivable
        ? `项目已标记结案，仍有待回款 ${money(project.receivable)}，建议继续用催收助手跟进。`
        : "项目已标记结案并归档，成本复盘备注已写入项目审计。");
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      setSavingCloseout(false);
    }
  }
  return (
    <section className="feature-grid">
      {!showRanking && <>
        <div className="feature-panel wide-feature">
          <div className="section-head closeout-head">
            <PanelTitle icon={FileSpreadsheet} title="项目结案成本复盘" />
            <div className="closeout-actions">
              <button type="button" className="ghost" onClick={openRanking}>看支出排行</button>
              <button type="button" className="ghost" onClick={copyCloseoutSummary} disabled={copyingReview}>{copyingReview ? "复制中" : "复制复盘纪要"}</button>
              <button type="button" className="ghost" onClick={exportCloseoutReview} disabled={exportingCloseout}><FileSpreadsheet size={14} />{exportingCloseout ? "导出中" : "导出复盘"}</button>
            </div>
          </div>
          <div className="review-summary">
            <Mini label="合同金额" value={money(project.contract)} />
            <Mini label="总成本" value={money(project.costUsed)} />
            <Mini label={isManagement ? "项目利润" : "结案状态"} value={isManagement ? money(project.contract - project.costUsed) : "待复盘"} />
            <Mini label={isManagement ? "毛利率" : "资料完整度"} value={isManagement ? `${project.margin}%` : `${Math.min(100, project.progress + 12)}%`} />
            <Mini label="项目状态" value={closeoutDone ? "已结案" : project.status || "待结案"} />
            <Mini label="结案时间" value={project.closedAt || project.extractedFields?.closedAt ? new Date(project.closedAt || project.extractedFields?.closedAt).toLocaleDateString("zh-CN") : "待确认"} />
          </div>
          <div className="idea-card">
            <strong>AI 优化建议</strong>
            <p>当前最大支出为「{topCost.name}」{money(topCost.value)}，占总成本 {topCostShare}%。{costWarning} 建议下次同类项目至少为该项预留 {money(suggestedReserve)}。</p>
            <div className="button-row compact closeout-next-actions">
              <button type="button" className="ghost tiny" onClick={openCostFiles}>补成本/核销资料</button>
              <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
              <button type="button" className="ghost tiny" onClick={openSupplierReview}>查看最大支出来源</button>
              <button type="button" className="ghost tiny" onClick={openPaymentReview}>{hasReceivable ? "跟进待回款" : "检查回款记录"}</button>
            </div>
          </div>
          <div className="closeout-complete-box">
            <label>
              <span>结案复盘备注</span>
              <textarea value={closeoutNote} onChange={(event) => setCloseoutNote(event.target.value)} placeholder="例如：最大支出来自达人拍摄，下次同类项目需提前锁价；尾款已催收，待客户确认核销。" />
            </label>
            <button type="button" className={closeoutDone ? "ghost" : "primary"} onClick={markProjectClosed} disabled={savingCloseout}>
              {savingCloseout ? "归档中" : closeoutDone ? "更新结案备注" : "确认项目结案"}
            </button>
            <div className="button-row compact closeout-memory-actions">
              <button type="button" className="ghost tiny" onClick={saveCloseoutToClientMemory} disabled={savingLearning === "client"}>
                {savingLearning === "client" ? "沉淀中" : "沉淀到客户档案"}
              </button>
              <button type="button" className="ghost tiny" onClick={saveCloseoutToSupplierMemory} disabled={savingLearning === "supplier"}>
                {savingLearning === "supplier" ? "沉淀中" : "沉淀到供应商库"}
              </button>
            </div>
            <span>{closeoutDone ? "项目已进入已完成状态，可继续补充复盘备注。" : "确认后会把项目状态改为已完成，并写入结案时间和审计记录。"}</span>
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={ShieldAlert} title="复盘风险" />
          <div className="compact-list">
            <div><strong>最大支出</strong><span>{topCost.name} · {money(topCost.value)}</span></div>
            <div><strong>最大支出占比</strong><span>{topCostShare}%</span></div>
            <div><strong>成本占合同</strong><span>{project.contract ? `${costContractRate}%` : "待确认合同"}</span></div>
            <div><strong>回款状态</strong><span>{project.receivable > 0 ? `待回款 ${money(project.receivable)}` : "已无待回款"}</span></div>
            <div><strong>下次预算建议</strong><span>{topCost.name} 预留 {money(suggestedReserve)}</span></div>
          </div>
          <div className="button-row compact closeout-next-actions">
            <button type="button" className="primary tiny" onClick={openRanking}>展开支出排行</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
          </div>
        </div>
      </>}
      {showRanking && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={BarChart3} title="支出排行" />
          <div className="compact-list">
            {costRows.length ? costRows.slice(0, 8).map(({ name, value }) => (
              <div key={name}>
                <strong>{name}</strong>
                <span>{money(value)} · 占总成本 {totalCost ? Math.round((Number(value || 0) / totalCost) * 100) : 0}%</span>
              </div>
            )) : <div className="empty-state action-empty closeout-cost-empty">
              <strong>暂无成本明细</strong>
              <span>上传成本表、核销表，或让报销/供应商付款审批通过后，支出排行会自动刷新。</span>
              <div className="button-row compact closeout-next-actions">
                <button type="button" className="primary tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
                <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
                <button type="button" className="ghost tiny" onClick={openCostFiles}>打开文件区</button>
                <button type="button" className="ghost tiny" onClick={copyCloseoutSummary} disabled={copyingReview}>{copyingReview ? "复制中" : "复制复盘草稿"}</button>
              </div>
            </div>}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={Bot} title="支出优化建议" />
          <div className="logic-list">
            <LogicItem title="优先复盘" text={`先看最大支出「${topCost.name}」，确认是否有临时追加、供应商报价偏高或审批滞后。`} />
            <LogicItem title="下次控制" text="把高占比支出前置到立项预算里，并设置超过预算阈值时必须重新审批。" />
            <LogicItem title="预算预留" text={`下次同类项目建议为「${topCost.name}」至少预留 ${money(suggestedReserve)}，并在报价阶段写入执行预算。`} />
          </div>
          <div className="button-row compact closeout-next-actions">
            <button type="button" className="ghost tiny" onClick={openSupplierReview}>查看最大支出来源</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("cost-sheet")}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={() => uploadCloseoutMaterial("verification-sheet")}>上传核销表</button>
            {hasReceivable && <button type="button" className="primary tiny" onClick={onOpenCollection}>生成催收建议</button>}
          </div>
        </div>
      </>}
    </section>
  );
}

function SupplierLibrary({ suppliers = [], settlements = [], projects = [], session, focusSupplierName = "", onFocusConsumed, onUpload, onOpenProjects, onDone, onNotice }) {
  const [selectedName, setSelectedName] = useState(suppliers[0]?.supplier || "");
  const [form, setForm] = useState({ score: 5, market: "", contact: "", comment: "" });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingProfiles, setExportingProfiles] = useState(false);
  const [settlementNote, setSettlementNote] = useState("");
  const [settlementSavingId, setSettlementSavingId] = useState("");
  const [focusedSupplier, setFocusedSupplier] = useState("");
  const [focusedRatingKey, setFocusedRatingKey] = useState("");
  useEffect(() => {
    if (!selectedName && suppliers[0]?.supplier) setSelectedName(suppliers[0].supplier);
  }, [suppliers, selectedName]);
  useEffect(() => {
    if (!focusSupplierName) return;
    setSelectedName(focusSupplierName);
    setFocusedSupplier(focusSupplierName);
    onFocusConsumed?.();
  }, [focusSupplierName, onFocusConsumed]);
  const selected = suppliers.find((item) => item.supplier === selectedName) || suppliers[0] || null;
  const selectedSettlements = settlements.filter((item) => item.supplier === selected?.supplier);
  const pendingSettlementAmount = selectedSettlements
    .filter(isSupplierSettlementPayable)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const supplierRatingTags = [
    { label: "配合快", comment: "配合快，响应及时，现场沟通顺畅。" },
    { label: "报价稳", comment: "报价稳定，临时追加少，适合长期复用。" },
    { label: "质量好", comment: "交付质量稳定，返工少，客户反馈相对安全。" },
    { label: "交付准", comment: "交付准时，排期可靠，适合时间紧的项目。" },
    { label: "发票慢", comment: "交付可用，但发票/结算配合偏慢，下次需提前约定。" },
    { label: "需比价", comment: "报价偏高，下次同类型项目建议至少再找两家比价。" }
  ];

  function applySupplierRatingTag(tag) {
    setForm((current) => ({
      ...current,
      market: current.market || selected?.types?.[0] || selected?.market || "制作 / 执行",
      comment: current.comment ? `${current.comment}；${tag.comment}` : tag.comment
    }));
    onNotice(`已加入「${tag.label}」评价标签，请按真实情况调整后保存评分。`);
  }

  async function exportSuppliers() {
    setExporting(true);
    try {
      await downloadFile("/api/suppliers/export", session, "supplier-settlements.csv");
      onNotice("供应商结算 CSV 已导出");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setExporting(false);
    }
  }

  async function exportSupplierProfiles() {
    if (!suppliers.length) {
      onNotice("当前没有可导出的供应商画像，请先上传成本表或保存供应商评分。");
      return;
    }
    setExportingProfiles(true);
    try {
      downloadCsv("供应商画像推荐表.csv", supplierProfileRows(suppliers));
      onNotice(`供应商画像推荐表 CSV 已导出：${suppliers.length} 家供应商。`);
    } catch (error) {
      onNotice(error.message || "供应商画像导出失败，请稍后再试。");
    } finally {
      setExportingProfiles(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected?.supplier) {
      onNotice("暂无可评价的供应商");
      return;
    }
    setSaving(true);
    try {
      const savedSupplier = await apiRequest("/api/suppliers/rate", session, {
        method: "POST",
        body: JSON.stringify({ supplier: selected.supplier, ...form })
      });
      const latestRating = savedSupplier?.ratings?.[0];
      setFocusedSupplier(selected.supplier);
      setFocusedRatingKey(`${latestRating?.user || session.name || session.email}-${latestRating?.at || ""}`);
      setForm({ score: 5, market: "", contact: "", comment: "" });
      await onDone();
      onNotice(`供应商评分已保存，推荐星级和评分记录已刷新：${savedSupplier?.supplier || selected.supplier}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateSettlement(row, status) {
    const rowKey = row.id || `${row.project}-${row.supplier}-${row.amount}`;
    setSettlementSavingId(rowKey);
    try {
      const data = await apiRequest("/api/suppliers/settlement", session, {
        method: "POST",
        body: JSON.stringify({
          id: row.id,
          supplier: row.supplier,
          project: row.project,
          status,
          note: settlementNote
        })
      });
      setFocusedSupplier(data?.supplier?.supplier || row.supplier);
      setSettlementNote("");
      await onDone();
      onNotice(`${row.supplier} · ${row.project || "项目"} 已更新为${status}，供应商结算和导出 CSV 已刷新。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSettlementSavingId("");
    }
  }

  if (!suppliers.length) {
    const targetProject = projects[0] || null;
    return (
      <section className="feature-panel">
        <PanelTitle icon={UsersRound} title="供应商库" />
        <div className="empty-state action-empty">
          <strong>暂无供应商记录</strong>
          <span>上传成本表、提交供应商付款审批，或在项目里记录供应商结算后，这里会自动沉淀供应商画像和推荐星级。</span>
          <div className="button-row compact">
            <button type="button" className="primary tiny" onClick={() => onUpload?.("cost-sheet", targetProject)}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={onOpenProjects}>打开我的项目</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="supplier-library">
      <div className="feature-panel wide-feature">
        <div className="section-head">
          <PanelTitle icon={UsersRound} title="供应商库" />
          <div className="button-row compact">
            <button type="button" className="ghost" disabled={exportingProfiles} onClick={exportSupplierProfiles}><FileSpreadsheet size={14} />{exportingProfiles ? "导出中" : "导出画像 CSV"}</button>
            <button type="button" className="ghost" disabled={exporting} onClick={exportSuppliers}><FileSpreadsheet size={14} />{exporting ? "导出中" : "导出结算 CSV"}</button>
          </div>
        </div>
        <div className="supplier-card-grid">
          {suppliers.map((item) => (
            <button
              type="button"
              className={`supplier-card ${item.supplier === selected?.supplier ? "active" : ""} ${focusedSupplier === item.supplier ? "fresh" : ""}`}
              key={item.supplier}
              onClick={() => setSelectedName(item.supplier)}
            >
              <strong>{item.supplier}</strong>
              <span>{"★".repeat(item.star || 1)}{"☆".repeat(Math.max(0, 5 - (item.star || 1)))}</span>
              <b className={`supplier-action action-${item.recommendationAction === "谨慎使用" ? "danger" : item.recommendationAction === "先比价" ? "warn" : "ok"}`}>
                {item.recommendationAction || "可试用"}
              </b>
              <em>{item.cooperationCount || 0} 次合作 · {item.projectCount || 0} 个项目</em>
              <small>{item.recommendationReason}</small>
            </button>
          ))}
        </div>
      </div>

      {selected && <div className="feature-panel wide-feature supplier-detail-panel">
        <PanelTitle icon={BarChart3} title="供应商画像" />
        <div className="review-summary">
          <Mini label="推荐星级" value={`${selected.star || 1} 星`} />
          <Mini label="合作次数" value={`${selected.cooperationCount || 0} 次`} />
          <Mini label="合作项目" value={`${selected.projectCount || 0} 个`} />
          <Mini label="累计金额" value={money(selected.totalAmount)} />
          <Mini label="待结算金额" value={money(pendingSettlementAmount)} />
          <Mini label="内部评分" value={selected.averageRating ? `${selected.averageRating}/5` : "待评分"} />
          <Mini label="评分人数" value={`${selected.ratingCount || 0} 人`} />
          <Mini label="风险等级" value={selected.riskLevel || "低"} />
        </div>
        <div className={`supplier-risk-panel risk-${selected.riskLevel === "高" ? "high" : selected.riskLevel === "中" ? "medium" : "low"}`}>
          <div>
            <strong>{selected.recommendationAction || "可试用"}</strong>
            <span>{selected.selectionAdvice || "暂无足够历史数据，建议合作后补充评分。"}</span>
          </div>
          <div className="supplier-risk-tags">
            {(selected.riskTags?.length ? selected.riskTags : ["暂无明显风险"]).map((tag) => <b key={tag}>{tag}</b>)}
          </div>
        </div>
        <div className="compact-list">
          <div><strong>合作项目</strong><span>{selected.projects?.join("、") || "暂无"}</span></div>
          <div><strong>合作类型</strong><span>{selected.types?.join("、") || selected.market || "待沉淀"}</span></div>
          <div><strong>推荐原因</strong><span>{selected.recommendationReason}</span></div>
          <div><strong>选择建议</strong><span>{selected.selectionAdvice || "暂无足够历史数据，建议从小额或低风险项目开始合作并补充评分。"}</span></div>
          <div><strong>推荐逻辑</strong><span>星级由合作次数、合作项目数、累计金额和内部评分共同计算，多人使用且评分稳定的供应商会优先推荐。</span></div>
        </div>
      </div>}

      {selected && <div className="feature-panel wide-feature supplier-settlement-panel">
        <PanelTitle icon={CircleDollarSign} title="供应商结算记录" />
        <label className="supplier-settlement-note">
          <span>付款备注</span>
          <input value={settlementNote} onChange={(event) => setSettlementNote(event.target.value)} placeholder="例如：已转账，待发票；或合同尾款暂缓" />
        </label>
        <div className="compact-list">
          {selectedSettlements.length ? selectedSettlements.map((item) => {
            const itemKey = item.id || `${item.project}-${item.supplier}-${item.amount}`;
            const paid = /已付|已结/.test(String(item.status || ""));
            const payable = isSupplierSettlementPayable(item);
            return (
              <div className={settlementSavingId === itemKey ? "fresh" : ""} key={itemKey}>
                <strong>{item.project || "未绑定项目"} · {money(item.amount)}</strong>
                <span>{item.type || "项目费用"} · {item.status || "待结算"}{item.paidAt ? ` · ${new Date(item.paidAt).toLocaleString("zh-CN")}` : ""}{item.paymentNote ? ` · ${item.paymentNote}` : ""}</span>
                <div className="button-row compact">
                  {payable && <button type="button" className={paid ? "ghost tiny" : "primary tiny"} disabled={settlementSavingId === itemKey} onClick={() => updateSettlement(item, "已付款")}>
                    {settlementSavingId === itemKey ? "更新中" : "标记已付款"}
                  </button>}
                  {paid && <button type="button" className="ghost tiny" disabled={settlementSavingId === itemKey} onClick={() => updateSettlement(item, "待结算")}>
                    退回待结算
                  </button>}
                </div>
              </div>
            );
          }) : <div className="empty-state action-empty supplier-settlement-empty">
            <strong>暂无结算流水</strong>
            <span>上传成本表或通过供应商付款审批后，这里会出现可标记付款的结算记录。</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => onUpload?.("cost-sheet", projects[0] || null)}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={onOpenProjects}>打开我的项目</button>
            </div>
          </div>}
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <PanelTitle icon={CheckCircle2} title="内部评分" />
        <div className="supplier-rating-tags">
          {supplierRatingTags.map((tag) => (
            <button type="button" className="ghost tiny" onClick={() => applySupplierRatingTag(tag)} key={tag.label}>
              {tag.label}
            </button>
          ))}
        </div>
        <label><span>评分 1-5</span><input value={form.score} onChange={(event) => update("score", event.target.value)} /></label>
        <label><span>合作市场 / 类型</span><input value={form.market} onChange={(event) => update("market", event.target.value)} placeholder="例如 制作 / 达人 / 场地 / 投放" /></label>
        <label><span>联系方式</span><input value={form.contact} onChange={(event) => update("contact", event.target.value)} placeholder="可选" /></label>
        <label><span>评价</span><input value={form.comment} onChange={(event) => update("comment", event.target.value)} placeholder="例如 配合快、报价稳、发票慢等" /></label>
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存评分"}</button>
      </form>}

      {selected?.ratings?.length > 0 && <div className="feature-panel">
        <PanelTitle icon={MessageSquareText} title="评分记录" />
        <div className="compact-list">
          {selected.ratings.slice(0, 6).map((item) => (
            <div className={focusedRatingKey === `${item.user}-${item.at || ""}` ? "fresh" : ""} key={`${item.user}-${item.at}`}>
              <strong>{item.score}/5 · {item.user}</strong>
              <span>{item.comment || "暂无评价"} · {item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}</span>
            </div>
          ))}
        </div>
      </div>}
    </section>
  );
}

function ClientLibrary({ clients = [], projects = [], session, focusClientName = "", onFocusConsumed, onUpload, onOpenProjects, onDone, onNotice }) {
  const [selectedName, setSelectedName] = useState(clients[0]?.client || "");
  const [form, setForm] = useState({ likes: "", dislikes: "", pitfalls: "", handoffNote: "", contactStyle: "" });
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exportingHandoff, setExportingHandoff] = useState(false);
  const [focusedClient, setFocusedClient] = useState("");
  useEffect(() => {
    if (!selectedName && clients[0]?.client) setSelectedName(clients[0].client);
  }, [clients, selectedName]);
  useEffect(() => {
    if (!focusClientName) return;
    setSelectedName(focusClientName);
    setFocusedClient(focusClientName);
    onFocusConsumed?.();
  }, [focusClientName, onFocusConsumed]);
  const selected = clients.find((item) => item.client === selectedName) || clients[0] || null;
  useEffect(() => {
    if (!selected) return;
    setForm({
      likes: (selected.likes || []).join("\n"),
      dislikes: (selected.dislikes || []).join("\n"),
      pitfalls: (selected.pitfalls || []).join("\n"),
      handoffNote: selected.handoffNote || "",
      contactStyle: selected.contactStyle || ""
    });
  }, [selected?.client]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function primeClientHandoffTemplate() {
    if (!selected?.client) return;
    setForm((current) => ({
      likes: current.likes || "真实场景\n明确执行路径\n有数据或案例支撑",
      dislikes: current.dislikes || "空概念\n临时大改方向\n只讲创意不讲落地",
      pitfalls: current.pitfalls || "不要临时改报价\n不要跳过客户确认节点\n不要只给抽象口号",
      contactStyle: current.contactStyle || "先给依据，再给建议，表达直接但不生硬",
      handoffNote: current.handoffNote || `${selected.client} 新 PM 交接：先看历史方案、报价/核销节点、客户反馈和雷区，沟通前准备可确认的执行路径。`
    }));
    setFocusedClient(selected.client);
    onNotice(`已为「${selected.client}」预填客户交接模板，请按真实情况调整后保存。`);
  }

  async function copyHandoff() {
    if (!selected) return;
    setCopying(true);
    const handoff = selected.handoffPackage || {};
    const lines = [
      `客户：${selected.client}`,
      `项目数：${selected.projectCount || 0} 个`,
      `最近项目：${selected.latestProject || "待补充"}${selected.latestStatus ? `（${selected.latestStatus}）` : ""}`,
      `自动交接摘要：${handoff.summary || selected.handoffSummary || "待补充"}`,
      `接手先做：${handoff.firstActions?.join("；") || "先确认项目状态、回款节点和客户雷区"}`,
      `重点回款：${handoff.receivableProjects?.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") || "暂无待回款"}`,
      `客户喜欢：${selected.likes?.join("；") || "待沉淀"}`,
      `客户不喜欢：${selected.dislikes?.join("；") || "待沉淀"}`,
      `雷区：${selected.pitfalls?.join("；") || "待沉淀"}`,
      `沟通风格：${selected.contactStyle || "待沉淀"}`,
      `交接备注：${selected.handoffNote || selected.handoffSummary || "待补充"}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setFocusedClient(selected.client);
      onNotice(`客户交接清单已复制：${selected.client}。`);
    } catch {
      onNotice("复制失败，请手动选中交接摘要复制");
    } finally {
      setCopying(false);
    }
  }

  async function exportHandoff() {
    if (!selected) {
      onNotice("暂无可导出的客户交接包。");
      return;
    }
    setExportingHandoff(true);
    try {
      downloadCsv(`${selected.client || "客户"}-PM交接包.csv`, clientHandoffRows(selected));
      setFocusedClient(selected.client);
      onNotice(`客户交接包 CSV 已导出：${selected.client}。`);
    } finally {
      setExportingHandoff(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected?.client) {
      onNotice("暂无可维护的客户");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/clients/profile", session, {
        method: "POST",
        body: JSON.stringify({ client: selected.client, ...form })
      });
      setFocusedClient(selected.client);
      await onDone();
      onNotice(`客户偏好和交接备注已保存，交接摘要已刷新：${selected.client}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!clients.length) {
    return (
      <section className="feature-panel">
        <PanelTitle icon={MessageSquareText} title="客户偏好" />
        <div className="empty-state action-empty">
          <strong>暂无客户项目</strong>
          <span>上传合同创建项目后，客户偏好、雷区、交接摘要会从项目资料和后续评论里持续沉淀。</span>
          <div className="button-row compact">
            <button type="button" className="primary tiny" onClick={() => onUpload?.("create-project", null)}>上传合同创建项目</button>
            <button type="button" className="ghost tiny" onClick={onOpenProjects}>{projects.length ? "打开我的项目" : "查看项目入口"}</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="client-library">
      <div className="feature-panel wide-feature">
        <PanelTitle icon={MessageSquareText} title="客户偏好 / 交接雷区" />
        <div className="supplier-card-grid">
          {clients.map((item) => (
            <button
              type="button"
              className={`supplier-card ${item.client === selected?.client ? "active" : ""} ${focusedClient === item.client ? "fresh" : ""}`}
              key={item.client}
              onClick={() => setSelectedName(item.client)}
            >
              <strong>{item.client}</strong>
              <em>{item.projectCount || 0} 个项目 · 待回款 {money(item.receivable)}</em>
              <b className={`client-handoff-badge ${item.handoffPackage?.activeProjectCount ? "active" : item.receivable ? "warn" : ""}`}>
                {item.handoffPackage?.activeProjectCount ? `${item.handoffPackage.activeProjectCount} 个在执行` : item.receivable ? "先看回款" : "可交接"}
              </b>
              <small>{item.handoffSummary}</small>
            </button>
          ))}
        </div>
      </div>

      {selected && <div className="feature-panel wide-feature supplier-detail-panel">
        <div className="section-head">
          <PanelTitle icon={FileText} title="交接摘要" />
          <div className="section-head-actions">
            <button type="button" className="ghost" disabled={copying} onClick={copyHandoff}>{copying ? "复制中" : "复制交接清单"}</button>
            <button type="button" className="ghost" disabled={exportingHandoff} onClick={exportHandoff}><FileSpreadsheet size={14} />{exportingHandoff ? "导出中" : "导出交接包"}</button>
          </div>
        </div>
        <div className="review-summary">
          <Mini label="项目数" value={`${selected.projectCount || 0} 个`} />
          <Mini label="合同总额" value={money(selected.totalContract)} />
          <Mini label="待回款" value={money(selected.receivable)} />
          <Mini label="动态记录" value={`${selected.commentCount || 0} 条`} />
          <Mini label="在执行项目" value={`${selected.handoffPackage?.activeProjectCount || 0} 个`} />
        </div>
        <div className="client-handoff-pack">
          <div>
            <strong>{selected.handoffPackage?.title || `${selected.client} PM 自动交接包`}</strong>
            <span>{selected.handoffPackage?.summary || selected.handoffSummary}</span>
          </div>
          <div className="client-handoff-actions">
            {(selected.handoffPackage?.firstActions?.length ? selected.handoffPackage.firstActions : ["先补充客户偏好、雷区、最近项目状态和回款节点。"]).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
        <div className="compact-list">
          <div><strong>客户喜欢</strong><span>{selected.likes?.join("；") || "待沉淀"}</span></div>
          <div><strong>客户不喜欢</strong><span>{selected.dislikes?.join("；") || "待沉淀"}</span></div>
          <div><strong>雷区</strong><span>{selected.pitfalls?.join("；") || "待沉淀"}</span></div>
          <div><strong>重点回款</strong><span>{selected.handoffPackage?.receivableProjects?.length ? selected.handoffPackage.receivableProjects.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") : "暂无待回款"}</span></div>
          <div><strong>最近反馈</strong><span>{selected.handoffPackage?.latestFeedback?.join("；") || "暂无可交接反馈"}</span></div>
          <div><strong>交接摘要</strong><span>{selected.handoffSummary}</span></div>
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <div className="section-head">
          <PanelTitle icon={CheckCircle2} title="维护客户档案" />
          <button type="button" className="ghost tiny" onClick={primeClientHandoffTemplate}>预填交接模板</button>
        </div>
        <label><span>客户喜欢</span><textarea value={form.likes} onChange={(event) => update("likes", event.target.value)} placeholder="一行一条，例如：喜欢真实场景、喜欢明确执行路径" /></label>
        <label><span>客户不喜欢</span><textarea value={form.dislikes} onChange={(event) => update("dislikes", event.target.value)} placeholder="一行一条" /></label>
        <label><span>雷区</span><textarea value={form.pitfalls} onChange={(event) => update("pitfalls", event.target.value)} placeholder="一行一条，例如：不要空概念、不要临时改报价" /></label>
        <label><span>沟通风格</span><input value={form.contactStyle} onChange={(event) => update("contactStyle", event.target.value)} placeholder="例如 直接、重细节、需要先给依据" /></label>
        <label><span>交接备注</span><textarea value={form.handoffNote} onChange={(event) => update("handoffNote", event.target.value)} placeholder="给新 PM 的简短交接说明" /></label>
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存客户档案"}</button>
      </form>}
    </section>
  );
}

function CollectionAssistant({ projects = [], scripts = [], session, onOpenProjectPayments, onUploadVerification, onDone, onNotice }) {
  const canUseCollection = canUseCollectionRole(session);
  const receivableProjects = projects.filter((project) => Number(project.receivable || 0) > 0)
    .sort((a, b) => Number(b.receivable || 0) - Number(a.receivable || 0));
  const [selectedId, setSelectedId] = useState(receivableProjects[0]?.id || projects[0]?.id || "");
  const [style, setStyle] = useState("");
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPin, setNewPin] = useState("");
  const [savingOutcomeId, setSavingOutcomeId] = useState("");
  const [followUpForms, setFollowUpForms] = useState({});
  const [copyingScriptId, setCopyingScriptId] = useState("");
  const [exportingCollection, setExportingCollection] = useState(false);
  const [focusedScriptId, setFocusedScriptId] = useState("");
  const selected = projects.find((project) => project.id === selectedId) || receivableProjects[0] || projects[0];
  const relatedScripts = scripts.filter((item) => !selected || item.projectId === selected.id || item.projectName === selected.name);
  const ownScripts = scripts.filter((item) => item.salesName === session.name);
  const ownDone = ownScripts.filter((item) => item.outcome || typeof item.success === "boolean");
  const ownSuccess = ownDone.filter((item) => item.success).length;
  const bestScript = [...scripts].filter((item) => item.success).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const canGenerateSelected = canUseCollection && selected && Number(selected.receivable || 0) > 0;
  const followUpQueue = collectionFollowUpQueue(projects, scripts);

  useEffect(() => {
    if (!selectedId && receivableProjects[0]?.id) setSelectedId(receivableProjects[0].id);
  }, [selectedId, receivableProjects[0]?.id]);

  async function generateScript() {
    if (!canUseCollection) {
      onNotice("催收话术由销售、PM、财务或管理层处理。");
      return;
    }
    if (!selected) {
      onNotice("当前没有可催收的项目");
      return;
    }
    if (!Number(selected.receivable || 0)) {
      onNotice("这个项目当前没有待回款。");
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest("/api/collections/suggest", session, {
        method: "POST",
        body: JSON.stringify({ projectId: selected.id, style })
      });
      setDraft(data);
      setFocusedScriptId(data.id || "");
      await onDone();
      onNotice(`话术已生成并保存，催收记录已刷新：${data.projectName} · ${money(data.amount)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  function followUpForm(record = {}) {
    return followUpForms[record.id] || {
      nextFollowUpAt: record.nextFollowUpAt || daysFromNow(2),
      nextAction: record.nextAction || "换一种更自然的说法二次提醒，并主动补齐客户财务需要的材料"
    };
  }

  function updateFollowUp(record, key, value) {
    setFollowUpForms((current) => ({
      ...current,
      [record.id]: {
        ...followUpForm(record),
        [key]: value
      }
    }));
  }

  async function saveOutcome(record, success) {
    if (!canUseCollection) {
      onNotice("催收结果由销售、PM、财务或管理层记录。");
      return;
    }
    const followUp = followUpForm(record);
    setSavingOutcomeId(record.id);
    try {
      await apiRequest("/api/collections/outcome", session, {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          success,
          score: success ? 5 : 2,
          outcome: success ? "客户已回复/确认付款流程" : "客户暂未回复或未推进付款",
          nextFollowUpAt: success ? "" : followUp.nextFollowUpAt,
          nextAction: success ? "" : followUp.nextAction
        })
      });
      setFocusedScriptId(record.id);
      await onDone();
      onNotice(success
        ? `已记录为有效话术，催收记录和团队学习样本已刷新：${record.projectName || "当前项目"}。`
        : `已记录为待优化话术，并创建下次跟进待办：${record.projectName || "当前项目"} · ${followUp.nextFollowUpAt || "时间待定"}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingOutcomeId("");
    }
  }

  async function copyScript(record) {
    const copyKey = record.id || "draft";
    setCopyingScriptId(copyKey);
    try {
      await navigator.clipboard.writeText(record.script || "");
      setFocusedScriptId(record.id || "");
      onNotice(`催收话术已复制：${record.projectName || selected?.name || "当前项目"}。`);
    } catch {
      onNotice("复制失败，请手动选中话术复制。");
    } finally {
      setCopyingScriptId("");
    }
  }

  async function exportCollectionLedger() {
    if (!scripts.length) {
      onNotice("当前还没有可导出的催收记录，请先生成话术或记录跟进结果。");
      return;
    }
    setExportingCollection(true);
    try {
      downloadCsv("催收话术记录.csv", collectionLedgerRows(scripts, projects));
      onNotice(`催收话术记录 CSV 已导出：${scripts.length} 条。`);
    } finally {
      setExportingCollection(false);
    }
  }

  return (
    <section className="collection-workbench">
      <div className="feature-panel collection-hero">
        <PanelTitle icon={MessagesSquare} title="销售催收助手" />
        <p>从真实待回款项目里生成更像人说话的跟进消息，并把客户回复结果沉淀下来，后面会慢慢学出每个销售自己的有效风格。</p>
        <div className="review-summary">
          <Mini label="待跟进项目" value={receivableProjects.length} />
          <Mini label="我的成功率" value={ownDone.length ? `${Math.round((ownSuccess / ownDone.length) * 100)}%` : "待沉淀"} />
          <Mini label="历史话术" value={scripts.length} />
        </div>
        <div className="collection-priority-panel">
          <div>
            <strong>今天先跟进</strong>
            <span>{followUpQueue.length ? `按回款压力和下次跟进时间排序，优先处理前 ${Math.min(3, followUpQueue.length)} 个。` : "暂无待回款项目，可以先检查核销或回款流水。"}</span>
          </div>
          {followUpQueue.length ? followUpQueue.slice(0, 3).map((item) => (
            <button type="button" key={item.project.id} onClick={() => setSelectedId(item.project.id)}>
              <b>{item.status}</b>
              <strong>{item.project.name}</strong>
              <span>{money(item.project.receivable)} · 待收占比 {item.receivableRate}%{item.nextFollowUpAt ? ` · ${item.nextFollowUpAt}` : ""}</span>
              <em>{item.nextAction}</em>
            </button>
          )) : (
            <div className="collection-action-empty">
              <strong>暂无回款跟进队列</strong>
              <span>如果实际已有收入确认但未出现待回款，可以上传核销表或到项目回款记录补流水。</span>
              <div className="button-row compact">
                {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="feature-panel collection-generator">
        <PanelTitle icon={Bot} title="生成话术" />
        <label>
          <span>选择项目</span>
          <select value={selectedId} onChange={(event) => {
            setSelectedId(event.target.value);
            setDraft(null);
          }}>
            {receivableProjects.length ? receivableProjects.map((project) => (
              <option value={project.id} key={project.id}>{project.name} · 待回款 {money(project.receivable)}</option>
            )) : projects.map((project) => (
              <option value={project.id} key={project.id}>{project.name} · 暂无待回款</option>
            ))}
          </select>
        </label>
        <label>
          <span>我的说话风格</span>
          <input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="例如：自然一点、像微信私聊、别太硬" />
        </label>
        {selected && <div className="compact-list">
          <div><strong>{selected.name}</strong><span>{selected.client || "客户待补"} · 回款节点 {selected.paymentDue || "待确认"}</span></div>
          <div><strong>待回款</strong><span>{money(selected.receivable)}</span></div>
        </div>}
        <button type="button" className="primary" onClick={generateScript} disabled={!canUseCollection || loading || !selected || !Number(selected.receivable || 0)}>
          {loading ? "生成中" : "生成催收话术"}
        </button>
        {selected && !Number(selected.receivable || 0) && <div className="collection-action-empty">
          <strong>这个项目当前没有待回款</strong>
          <span>可以先检查回款流水，或上传月度核销表让系统更新确认收入和待收状态。</span>
          <div className="button-row compact">
            <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>
            <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>
          </div>
        </div>}
      </div>

      <div className="feature-panel wide-feature">
        <PanelTitle icon={MessageSquareText} title="当前话术" />
        {(draft || relatedScripts[0]) ? (
          <div className="collection-script-card fresh">
            <strong>{(draft || relatedScripts[0]).projectName} · {(draft || relatedScripts[0]).tone || "自然提醒"}</strong>
            <pre>{(draft || relatedScripts[0]).script}</pre>
            <span>{(draft || relatedScripts[0]).reason || (draft || relatedScripts[0]).outcome || "生成后可复制到微信/飞书跟进客户。"}</span>
            <div className="button-row">
              <button type="button" className="ghost" disabled={copyingScriptId === ((draft || relatedScripts[0]).id || "draft")} onClick={() => copyScript(draft || relatedScripts[0])}>
                {copyingScriptId === ((draft || relatedScripts[0]).id || "draft") ? "复制中" : "复制话术"}
              </button>
            </div>
          </div>
        ) : <div className="empty-state action-empty">
          <strong>{receivableProjects.length ? "还没有当前项目的话术" : "当前没有待回款项目"}</strong>
          <span>{receivableProjects.length ? "可以先为选中的待回款项目生成第一条话术，后续复制、记录有效/待优化都会沉淀为团队样本。" : "没有待回款时，建议先去项目回款记录检查流水，或上传核销表更新确认收入状态。"}</span>
          <div className="button-row compact">
            {receivableProjects.length && <button type="button" className="primary tiny" onClick={generateScript} disabled={!canGenerateSelected || loading}>{loading ? "生成中" : "生成第一条"}</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
          </div>
        </div>}
      </div>

      <div className="feature-panel">
        <PanelTitle icon={CheckCircle2} title="有效话术参考" />
        {bestScript ? <div className="idea-card">
          <strong>{bestScript.salesName} · {bestScript.projectName}</strong>
          <p>{bestScript.script}</p>
        </div> : <div className="collection-action-empty">
          <strong>还没有成功样本</strong>
          <span>先生成话术并记录“有效/待优化”，系统就会慢慢沉淀每个销售更像本人说话的表达。</span>
          <div className="button-row compact">
            {canGenerateSelected && <button type="button" className="primary tiny" onClick={generateScript} disabled={loading}>{loading ? "生成中" : "生成第一条"}</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>去看项目回款</button>}
          </div>
        </div>}
      </div>

      <div className="feature-panel wide-feature">
        <div className="section-head">
          <PanelTitle icon={Clock3} title="话术记录" />
          <button type="button" className="ghost" disabled={exportingCollection} onClick={exportCollectionLedger}><FileSpreadsheet size={14} />{exportingCollection ? "导出中" : "导出话术"}</button>
        </div>
        <div className="detail-list">
          {scripts.length ? scripts.slice(0, 10).map((item) => (
            <div className={`collection-history-row ${focusedScriptId === item.id ? "fresh" : ""}`} key={item.id}>
              <strong>{item.projectName} · {item.salesName || "销售"} · {money(item.amount)}</strong>
              <span>{item.outcome || item.reason || "结果待记录"}</span>
              {(item.followUpStatus === "待跟进" || item.nextFollowUpAt || item.nextAction) && (
                <div className="collection-follow-up-note">
                  <strong>下次跟进</strong>
                  <span>{item.nextFollowUpAt || "时间待定"} · {item.nextAction || "再次跟进客户付款"}</span>
                </div>
              )}
              {canUseCollection && <div className="button-row">
                <button type="button" className="ghost" disabled={copyingScriptId === item.id} onClick={() => copyScript(item)}>{copyingScriptId === item.id ? "复制中" : "复制话术"}</button>
                <button type="button" className="primary" disabled={savingOutcomeId === item.id} onClick={() => saveOutcome(item, true)}>{savingOutcomeId === item.id ? "记录中" : "有效"}</button>
              </div>}
              {canUseCollection && <div className="collection-follow-up-form">
                <label>
                  <span>下次跟进时间</span>
                  <input type="date" value={followUpForm(item).nextFollowUpAt} onChange={(event) => updateFollowUp(item, "nextFollowUpAt", event.target.value)} />
                </label>
                <label>
                  <span>下一步动作</span>
                  <input value={followUpForm(item).nextAction} onChange={(event) => updateFollowUp(item, "nextAction", event.target.value)} placeholder="例如：补发对账单后再提醒客户财务" />
                </label>
                <button type="button" className="ghost" disabled={savingOutcomeId === item.id} onClick={() => saveOutcome(item, false)}>{savingOutcomeId === item.id ? "记录中" : "待优化并提醒"}</button>
              </div>}
            </div>
          )) : (
            <div className="collection-action-empty collection-history-empty">
              <strong>暂无话术记录</strong>
              <span>可以先为待回款项目生成第一条话术；如果当前项目没有待回款，就先检查回款流水或上传核销表。</span>
              <div className="button-row compact">
                {canGenerateSelected && <button type="button" className="primary tiny" onClick={generateScript} disabled={loading}>{loading ? "生成中" : "生成第一条"}</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ManagementCockpit({ projects, approvals = [], settings = {}, session, stats, subView, setSubView, onOpenApprovals, onOpenCollections, onOpenProjectSection, onDone, onNotice }) {
  const metrics = operatingMetrics(projects, approvals, stats, settings);
  const [financeForm, setFinanceForm] = useState(() => ({
    currentCash: metrics.runway.currentCash || "",
    monthlyLaborCost: metrics.runway.monthlyLaborCost || "",
    monthlyRent: metrics.runway.monthlyRent || "",
    monthlyLoan: metrics.runway.monthlyLoan || "",
    monthlyInterest: metrics.runway.monthlyInterest || "",
    monthlyOtherCost: metrics.runway.monthlyOtherCost || ""
  }));
  const [savingFinance, setSavingFinance] = useState(false);
  const [exportingManagement, setExportingManagement] = useState(false);
  useEffect(() => {
    setFinanceForm({
      currentCash: metrics.runway.currentCash || "",
      monthlyLaborCost: metrics.runway.monthlyLaborCost || "",
      monthlyRent: metrics.runway.monthlyRent || "",
      monthlyLoan: metrics.runway.monthlyLoan || "",
      monthlyInterest: metrics.runway.monthlyInterest || "",
      monthlyOtherCost: metrics.runway.monthlyOtherCost || ""
    });
  }, [settings.companyFinance?.savedAt]);
  const financePreview = calculateRunway(financeForm);

  async function saveFinance(event) {
    event.preventDefault();
    setSavingFinance(true);
    try {
      const saved = await apiRequest("/api/company-finance", session, {
        method: "POST",
        body: JSON.stringify({ values: financeForm })
      });
      await onDone();
      onNotice(`公司现金流设置已保存，经营舱已刷新：月固定支出 ${money(saved.monthlyFixedCost)}，现金可撑 ${saved.monthlyFixedCost ? `${Number(saved.runwayMonths || 0).toFixed(1)} 个月` : "待设置"}，6个月缺口 ${money(saved.gap)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingFinance(false);
    }
  }

  const evidence = [
    `待回款占合同 ${metrics.receivableRate}%`,
    `待处理审批 ${metrics.pendingApprovals.length} 条`,
    `综合毛利率 ${metrics.margin}%`,
    metrics.topRisk ? `最高风险项目：${metrics.topRisk.name}` : "暂无明显高风险项目"
  ];
  const showCash = subView === "现金流压力";
  const showAdvisor = subView === "AI 商业顾问";
  const showDashboard = !showCash && !showAdvisor;
  const managementTabs = [
    { label: "公司大盘", icon: BarChart3, text: "看总额、回款、利润、项目结构" },
    { label: "现金流压力", icon: CircleDollarSign, text: "按6个月安全线判断现金能撑多久" },
    { label: "AI 商业顾问", icon: Bot, text: "把经营数据翻译成下一步动作" }
  ];
  function handleAdvisorAction(action = "", index = 0) {
    if (/催收|回款|待回款/.test(action)) {
      onOpenCollections?.(metrics.highRiskProjects[0] || metrics.topRisk || null);
      return;
    }
    if (/审批|备用金|报销|供应商付款|支出/.test(action)) {
      onOpenApprovals?.();
      return;
    }
    if (/现金|安全线|缺口|固定支出|收缩/.test(action)) {
      setSubView("现金流压力");
      onNotice?.("已切到现金流压力页，可以先补现金设置，再按 6 个月安全线做收缩决策。");
      return;
    }
    setSubView("公司大盘");
    onNotice?.(`已回到公司经营大盘，查看建议 ${index + 1} 的数据来源。`);
  }
  function handleRiskProject(project) {
    if (project.actionTarget === "payments" && Number(project.receivable || 0) > 0) {
      onOpenCollections?.(project);
      return;
    }
    onOpenProjectSection?.(project, project.actionTarget === "costs" ? "costs" : "progress", `已打开「${project.name}」的${project.actionTarget === "costs" ? "成本与审批区" : "项目进度区"}，处理经营舱建议：${project.actionReason}。`);
  }
  const cashHealthClass = metrics.runway.runwayLabel.includes("危险") || metrics.pressureLevel === "高" ? "danger" : metrics.pressureLevel === "中" ? "ok" : "good";
  const cashHealth = (
    <div className={`health-card ${cashHealthClass}`}>
      <div><span>压力等级</span><strong>{metrics.runway.runwayLabel.includes("危险") ? "危险" : metrics.pressureLevel}</strong></div>
      <div className="health-track"><i style={{ width: `${Math.min(100, metrics.pressureScore)}%` }} /></div>
      <p>{metrics.runway.runwayLabel}。待回款 {money(stats.receivable)} · 待备用金 {money(metrics.pendingPettyCash)} · 待报销 {money(metrics.pendingReimbursements)} · 待供应商付款 {money(metrics.pendingSupplierPay)}</p>
    </div>
  );
  const cashFormula = [
    ["人力", metrics.runway.monthlyLaborCost],
    ["租金", metrics.runway.monthlyRent],
    ["贷款", metrics.runway.monthlyLoan],
    ["利息", metrics.runway.monthlyInterest],
    ["其他", metrics.runway.monthlyOtherCost]
  ];
  const financeTemplates = [
    {
      label: "轻团队",
      values: { monthlyLaborCost: 80000, monthlyRent: 12000, monthlyLoan: 0, monthlyInterest: 0, monthlyOtherCost: 15000 }
    },
    {
      label: "拍摄执行期",
      values: { monthlyLaborCost: 120000, monthlyRent: 18000, monthlyLoan: 20000, monthlyInterest: 3000, monthlyOtherCost: 35000 }
    },
    {
      label: "收缩现金流",
      values: { monthlyLaborCost: 70000, monthlyRent: 10000, monthlyLoan: 15000, monthlyInterest: 2500, monthlyOtherCost: 8000 }
    }
  ];
  function applyFinanceTemplate(template) {
    setFinanceForm((current) => ({ ...current, ...template.values }));
    onNotice?.(`已套用「${template.label}」现金流模板，请按真实账面现金和固定支出调整后保存。`);
  }
  async function exportManagementLedger() {
    setExportingManagement(true);
    try {
      downloadCsv("公司经营舱摘要.csv", managementLedgerRows(metrics, stats, projects));
      onNotice?.("公司经营舱摘要 CSV 已导出，包含经营建议、现金安全线和优先项目。");
    } finally {
      setExportingManagement(false);
    }
  }
  const financeSettingsForm = (
    <form className="feature-panel settings-form" onSubmit={saveFinance}>
      <PanelTitle icon={Settings2} title="经营现金设置" />
      <div className="finance-template-row">
        {financeTemplates.map((template) => (
          <button type="button" className="ghost tiny" key={template.label} onClick={() => applyFinanceTemplate(template)}>
            <HandCoins size={14} />{template.label}
          </button>
        ))}
      </div>
      {[
        ["currentCash", "当前公司现金"],
        ["monthlyLaborCost", "每月人力成本"],
        ["monthlyRent", "每月租金"],
        ["monthlyLoan", "每月贷款"],
        ["monthlyInterest", "每月利息"],
        ["monthlyOtherCost", "每月其他固定支出"]
      ].map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <input value={financeForm[key]} onChange={(event) => setFinanceForm((current) => ({ ...current, [key]: event.target.value }))} placeholder="填写金额" />
        </label>
      ))}
      <div className={`cash-settings-preview ${financePreview.runwayLabel.includes("危险") ? "danger" : financePreview.runwayLabel === "谨慎" ? "warn" : "ok"}`}>
        <strong>{financePreview.runwayLabel}</strong>
        <span>月固定支出 {money(financePreview.monthlyFixedCost)} · 6个月安全线 {money(financePreview.safetyReserve)} · 缺口 {money(financePreview.gap)}</span>
        <em>{financePreview.monthlyFixedCost ? `按当前填写，现金还能撑 ${financePreview.runwayMonths.toFixed(1)} 个月。` : "先填写每月固定支出，系统才会计算现金安全线。"}</em>
      </div>
      <button type="submit" className="primary" disabled={savingFinance}>{savingFinance ? "保存中" : "保存现金设置"}</button>
    </form>
  );
  return (
    <section className="feature-grid">
      <div className="feature-panel wide-feature management-switcher">
        <div>
          <PanelTitle icon={showCash ? CircleDollarSign : showAdvisor ? Bot : BarChart3} title={showCash ? "现金流压力" : showAdvisor ? "AI 商业顾问" : "公司经营大盘"} />
          <p>{showCash ? "现金安全线 = 当前公司现金 ÷（人力 + 租金 + 贷款 + 利息 + 每月其他固定支出），目标至少撑过 6 个月。" : showAdvisor ? "AI 顾问只给管理层看，会根据回款、毛利、现金压力和项目风险给经营动作。" : "这里汇总所有项目的合同、回款、支出、利润和项目风险，帮助创始人快速看公司状态。"}</p>
        </div>
        <button type="button" className="ghost" disabled={exportingManagement} onClick={exportManagementLedger}><FileSpreadsheet size={14} />{exportingManagement ? "导出中" : "导出经营摘要"}</button>
        <div className="management-tab-row">
          {managementTabs.map(({ label, icon: Icon, text }) => (
            <button
              type="button"
              className={(subView || "公司大盘") === label || (!subView && label === "公司大盘") ? "active" : ""}
              key={label}
              onClick={() => setSubView(label)}
            >
              <Icon size={16} />
              <strong>{label}</strong>
              <span>{text}</span>
            </button>
          ))}
        </div>
      </div>
      {showDashboard && <>
        <div className="feature-panel founder-card wide-feature">
          <PanelTitle icon={BarChart3} title="公司经营大盘" />
          <div className="review-summary">
            <Mini label="合同总额" value={money(stats.contract)} />
            <Mini label="已回款" value={money(stats.paid)} />
            <Mini label="待回款" value={money(stats.receivable)} />
            <Mini label="总支出" value={money(metrics.spending)} />
            <Mini label="项目利润" value={money(metrics.profit)} />
            <Mini label="综合毛利率" value={`${metrics.margin}%`} />
            <Mini label="进行中项目" value={`${metrics.activeProjects.length} 个`} />
            <Mini label="已完成项目" value={`${metrics.completedProjects.length} 个`} />
            <Mini label="现金可撑" value={metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)}月` : "待设置"} />
            <Mini label="6个月缺口" value={money(metrics.runway.gap)} />
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="风险雷达" />
          <div className="compact-list">
            {metrics.highRiskProjects.slice(0, 5).map((project) => (
              <div key={project.id}><strong>{project.name}</strong><span>{project.risk}风险 · 待回款 {money(project.receivable)} · 成本占比 {project.costRate}% · 毛利率 {project.projectMargin}%</span></div>
            ))}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={UsersRound} title="项目结构" />
          <div className="compact-list">
            <div><strong>高风险项目</strong><span>{projects.filter((project) => project.risk === "高").length} 个</span></div>
            <div><strong>中风险项目</strong><span>{projects.filter((project) => project.risk === "中").length} 个</span></div>
            <div><strong>低风险项目</strong><span>{projects.filter((project) => project.risk === "低").length} 个</span></div>
            <div><strong>待审批</strong><span>{metrics.pendingApprovals.length} 条</span></div>
          </div>
        </div>
      </>}
      {showCash && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={CircleDollarSign} title="现金流压力" />
          {cashHealth}
          <div className="cash-formula-card">
            <strong>6个月现金底线公式</strong>
            <p>月固定支出 = 人力 + 租金 + 贷款 + 利息 + 每月其他支出；可存活月数 = 当前公司现金 ÷ 月固定支出。</p>
            <div>
              {cashFormula.map(([label, value]) => <span key={label}>{label} {money(value)}</span>)}
            </div>
            <b>{money(metrics.runway.currentCash)} ÷ {money(metrics.runway.monthlyFixedCost)} = {metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)} 个月` : "待设置"}</b>
          </div>
          <div className="review-summary">
            <Mini label="当前现金" value={money(metrics.runway.currentCash)} />
            <Mini label="月固定支出" value={money(metrics.runway.monthlyFixedCost)} />
            <Mini label="6个月安全线" value={money(metrics.runway.safetyReserve)} />
            <Mini label="6个月缺口" value={money(metrics.runway.gap)} />
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="现金压力来源" />
          <div className="compact-list">
            <div><strong>现金压力总暴露</strong><span>{money(metrics.cashPressureAmount)}</span></div>
            <div><strong>待回款</strong><span>{money(stats.receivable)}</span></div>
            <div><strong>待备用金</strong><span>{money(metrics.pendingPettyCash)}</span></div>
            <div><strong>待报销</strong><span>{money(metrics.pendingReimbursements)}</span></div>
            <div><strong>待供应商付款</strong><span>{money(metrics.pendingSupplierPay)}</span></div>
          </div>
        </div>
        {financeSettingsForm}
      </>}
      {showAdvisor && <>
        <div className="feature-panel founder-card wide-feature">
          <PanelTitle icon={Bot} title="AI 商业顾问" />
          <div className="idea-card">
            <strong>经营建议：{metrics.recommendation}</strong>
            <p>{evidence.join("；")}。</p>
          </div>
          <div className="logic-list advisor-action-list">
            {metrics.advisorActions.map((action, index) => (
              <button type="button" className="advisor-action-card" key={action} onClick={() => handleAdvisorAction(action, index)}>
                <LogicItem title={`建议 ${index + 1}`} text={action} />
                <span>{/催收|回款|待回款/.test(action) ? "去催收" : /审批|备用金|报销|供应商付款|支出/.test(action) ? "去审批" : /现金|安全线|缺口|固定支出|收缩/.test(action) ? "看现金流" : "看大盘"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={BarChart3} title="判断依据" />
          <div className="compact-list">
            <div><strong>待回款占比</strong><span>{metrics.receivableRate}%</span></div>
            <div><strong>综合毛利率</strong><span>{metrics.margin}%</span></div>
            <div><strong>现金可撑</strong><span>{metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)}个月` : "待设置"}</span></div>
            <div><strong>待处理审批</strong><span>{metrics.pendingApprovals.length} 条</span></div>
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="优先关注项目" />
          <div className="compact-list">
            {metrics.highRiskProjects.slice(0, 4).map((project) => (
              <button type="button" className="compact-action-row management-risk-action" key={project.id} onClick={() => handleRiskProject(project)}>
                <strong>{project.name}</strong>
                <span>评分 {project.score} · 待回款 {money(project.receivable)} · 毛利率 {project.projectMargin}%</span>
                <em>{project.actionLabel} · {project.actionReason}</em>
              </button>
            ))}
          </div>
        </div>
      </>}
    </section>
  );
}

function LogicItem({ title, text }) {
  return <div className="logic-item"><strong>{title}</strong><p>{text}</p></div>;
}

function UploadDialog({ session, projects, selected, initialType = "create-project", initialFiles = [], minimized = false, onMinimize, onExpand, onClose, onDone }) {
  const canCreateProject = canCreateProjectRole(session);
  const safeInitialType = initialType === "create-project" && !canCreateProject
    ? (projects.length ? "cost-sheet" : "create-project")
    : initialType;
  const [type, setType] = useState(safeInitialType);
  const [projectId, setProjectId] = useState(selected?.id || projects[0]?.id || "");
  const [values, setValues] = useState({
    "项目名称": "",
    "客户 / 品牌": "",
    "负责人": session.name,
    "合同金额": "",
    "执行预算占比": "60%",
  });
  const [files, setFiles] = useState(() => initialFiles);
  const [message, setMessage] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const previewRef = useRef(null);
  const [progress, setProgress] = useState(() => initialFiles.length
    ? { step: "ready", percent: 12, text: `已选择 ${initialFiles.length} 个文件，下一步点击 AI 预览识别` }
    : { step: "idle", percent: 0, text: "等待选择文件" });
  const targetProject = projects.find((project) => project.id === projectId) || selected || projects[0];
  const needsProject = type !== "create-project";
  const hasProjects = projects.length > 0;
  const typeLabels = {
    "create-project": "新项目：合同 / 报价表",
    "cost-sheet": "已有项目：执行成本表",
    "quote-sheet": "已有项目：合同报价表",
    "verification-sheet": "已有项目：月度核销表"
  };
  const canUseCreateProject = canCreateProject;
  const typeOptions = [
    canUseCreateProject ? ["create-project", typeLabels["create-project"]] : null,
    hasProjects ? ["cost-sheet", typeLabels["cost-sheet"]] : null,
    hasProjects ? ["quote-sheet", typeLabels["quote-sheet"]] : null,
    hasProjects ? ["verification-sheet", typeLabels["verification-sheet"]] : null,
  ].filter(Boolean);

  useEffect(() => {
    if (type === "create-project" && !canUseCreateProject && hasProjects) {
      setType("cost-sheet");
      setMessage("当前账号不能创建新项目，已切换为上传到已有项目。");
      setUploadError(null);
      setPreview(null);
      setConfirmed(false);
    }
  }, [type, canUseCreateProject, hasProjects]);

  useEffect(() => {
    if (!preview || loading) return;
    window.requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [preview, loading]);

  function showPreview() {
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function appendPickedFiles(picked = []) {
    setMessage("");
    setUploadError(null);
    const payloads = await Promise.all(picked.map(fileToPayload));
    const oversized = picked.find((file) => file.size > 40 * 1024 * 1024 && /pdf/i.test(file.type || file.name));
    setFiles((current) => {
      const merged = [...current];
      const keys = new Set(current.map(uploadedFileKey));
      payloads.forEach((file) => {
        const key = uploadedFileKey(file);
        if (!keys.has(key)) {
          merged.push(file);
          keys.add(key);
        }
      });
      setProgress({ step: "ready", percent: 12, text: `已选择 ${merged.length} 个文件，下一步点击 AI 预览识别` });
      return merged;
    });
    if (oversized) setMessage("已选择超过 40MB 的 PDF，完整 OCR 可能需要几分钟，请不要重复提交。");
    setPreview(null);
    setConfirmed(false);
  }

  async function pickFiles(event) {
    const picked = Array.from(event.target.files || []);
    await appendPickedFiles(picked);
    event.target.value = "";
  }

  async function dropFiles(event) {
    event.preventDefault();
    const picked = Array.from(event.dataTransfer?.files || []);
    if (!picked.length) return;
    await appendPickedFiles(picked);
  }

  function removeFile(fileKey) {
    setFiles((current) => {
      const next = current.filter((file) => uploadedFileKey(file) !== fileKey);
      setProgress(next.length
        ? { step: "ready", percent: 12, text: `已选择 ${next.length} 个文件，等待重新预览` }
        : { step: "idle", percent: 0, text: "等待选择文件" });
      return next;
    });
    setPreview(null);
    setConfirmed(false);
    setMessage("");
    setUploadError(null);
  }

  function uploadBody() {
    return type === "create-project"
      ? { type, values, files }
      : { type, id: targetProject.id, files };
  }

  async function requestPreview() {
    if (type === "create-project" && !canUseCreateProject) {
      setMessage("当前账号不能创建新项目，请让销售、PM 或管理层上传合同创建项目。");
      setUploadError(null);
      return;
    }
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传成本表、报价表或核销表。");
      setUploadError(null);
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      setUploadError(null);
      return;
    }
    setLoading(true);
    setProgress({ step: "preview", percent: 34, text: "正在上传文件并解析基础信息" });
    setMessage("AI 正在预览识别结果，预览阶段不会写入项目。");
    setUploadError(null);
    try {
      window.setTimeout(() => {
        setProgress((current) => current.step === "preview" ? { step: "preview", percent: 62, text: "正在 OCR / 表格识别，请耐心等待" } : current);
      }, 900);
      const data = await apiRequest("/api/projects/upload-preview", session, {
        method: "POST",
        body: JSON.stringify(uploadBody()),
      });
      setPreview(data);
      setConfirmed(false);
      setProgress({ step: "review", percent: data.canConfirm ? 82 : 70, text: data.canConfirm ? "识别完成，等待你确认入库" : "识别完成，但需要先处理提示" });
      setMessage(data.canConfirm ? "请检查识别结果，确认无误后再入库。" : "识别结果需要处理后才能入库。");
    } catch (error) {
      setProgress({ step: "error", percent: 100, text: "识别失败，请查看提示后重试" });
      setMessage("");
      setUploadError(explainUploadError(error));
    } finally {
      setLoading(false);
    }
  }

  async function confirmUpload() {
    if (type === "create-project" && !canUseCreateProject) {
      setMessage("当前账号不能创建新项目，请让销售、PM 或管理层上传合同创建项目。");
      setUploadError(null);
      return;
    }
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传项目资料。");
      setUploadError(null);
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      setUploadError(null);
      return;
    }
    setLoading(true);
    setProgress({ step: "confirm", percent: 88, text: "正在写入项目数据并刷新大盘" });
    setMessage("正在确认入库，请稍候...");
    setUploadError(null);
    try {
      if (type === "create-project") {
        await apiRequest("/api/projects", session, {
          method: "POST",
          body: JSON.stringify({ values, files }),
        });
      }
      if (type === "cost-sheet") {
        await apiRequest("/api/projects/cost-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      if (type === "quote-sheet") {
        await apiRequest("/api/projects/quote-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      if (type === "verification-sheet") {
        await apiRequest("/api/projects/verification-sheet", session, {
          method: "POST",
          body: JSON.stringify({ id: targetProject.id, files }),
        });
      }
      setMessage("上传成功，项目数据已刷新。");
      setConfirmed(true);
      setProgress({ step: "done", percent: 100, text: "已完成入库，项目数据已刷新" });
      await onDone();
      setTimeout(onClose, 700);
    } catch (error) {
      setProgress({ step: "error", percent: 100, text: "入库失败，请查看提示后重试" });
      setMessage("");
      setUploadError(explainUploadError(error));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!files.length && type !== "create-project") {
      setMessage("请先选择要上传的文件");
      setUploadError(null);
      return;
    }
    if (!preview) {
      await requestPreview();
      return;
    }
    if (!preview.canConfirm) {
      setMessage("当前识别结果还不能确认入库，请先按提示补充或更换文件。");
      setUploadError(null);
      return;
    }
    await confirmUpload();
  }

  const hasProgress = progress.step !== "idle" || loading || preview || files.length > 0;
  const progressPercent = Math.max(0, Math.min(100, progress.percent || 0));
  const progressLabel = loading ? progress.text : confirmed ? "已完成入库" : progress.text;
  const canCloseUpload = !loading;
  const canEditUploadFiles = !loading && !confirmed;
  const uploadTargetName = needsProject ? targetProject?.name || "当前项目" : values["项目名称"] || "新项目";
  const uploadNextAction = loading
    ? "后台处理中，完成前不用重复提交"
    : confirmed
      ? "已完成，可以回到项目大盘查看"
      : preview?.canConfirm
        ? "点开后确认入库"
        : preview
          ? "点开后处理识别提示"
          : files.length
            ? "点开后开始 AI 预览识别"
            : "等待选择文件";

  if (minimized) {
    return (
      <div className="upload-mini-panel">
        <button type="button" className="upload-mini-main" onClick={onExpand}>
          <UploadCloud size={17} />
          <span>
            <strong>{loading ? "AI 正在识别文件" : preview ? "识别结果待确认" : "上传任务已收起"}</strong>
            <em>{progressLabel}</em>
          </span>
        </button>
        <div className="upload-mini-meta">
          <span>{typeLabels[type]}</span>
          <span>{uploadTargetName} · {files.length} 个文件</span>
          <b>{uploadNextAction}</b>
        </div>
        <div className="upload-mini-progress"><i style={{ width: `${progressPercent}%` }} /></div>
        <button type="button" className="ghost tiny" onClick={onExpand}>打开</button>
      </div>
    );
  }

  return createPortal(
    <div className="modal-backdrop">
      <form className="upload-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>{needsProject ? `上传到「${targetProject?.name || "当前项目"}」` : "上传合同创建项目"}</h2>
            <p>{needsProject ? "先 AI 预览识别，确认后才会写入当前项目。" : "合同/报价表会先预览，确认后创建项目。"}</p>
            {hasProgress && (
              <div className="upload-head-progress">
                <span>{progressLabel}</span>
                <b>{progressPercent}%</b>
                <i style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </div>
          <div className="modal-head-actions">
            {preview && <button type="button" className="ghost" onClick={showPreview}>查看识别结果</button>}
            {hasProgress && <button type="button" className="ghost" onClick={onMinimize}><Minimize2 size={15} />缩到后台继续</button>}
            {canCloseUpload
              ? <button type="button" className="ghost" onClick={onClose}>关闭</button>
              : <button type="button" className="ghost" onClick={onMinimize}>处理中，缩到后台</button>}
          </div>
        </div>

        <div className="upload-modal-body" tabIndex="0" aria-label="上传内容与 AI 识别结果，可上下滚动">
          <label>
            <span>上传类型</span>
            <select value={type} onChange={(event) => {
              setType(event.target.value);
              setPreview(null);
              setConfirmed(false);
              setMessage("");
              setUploadError(null);
            }}>
              {typeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          {!canUseCreateProject && <p className="upload-context-note">你的账号不能创建新项目；可以把成本表、报价表、核销表上传到自己可见的项目。</p>}
          {needsProject && <p className="upload-context-note">已按当前项目预选：{typeLabels[type]}。AI 预览确认前不会写入项目。</p>}

          {needsProject && hasProjects && (
            <label>
              <span>归属项目</span>
              <select value={projectId} onChange={(event) => {
                setProjectId(event.target.value);
                setPreview(null);
                setConfirmed(false);
                setMessage("");
                setUploadError(null);
              }}>
                {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}

          {type === "create-project" && (
            <div className="form-grid">
              {Object.keys(values).map((key) => (
                <label key={key}>
                  <span>{key}</span>
                  <input value={values[key]} onChange={(event) => {
                    setValues({ ...values, [key]: event.target.value });
                    setPreview(null);
                    setConfirmed(false);
                    setUploadError(null);
                  }} placeholder={key === "项目名称" ? "可留空，由 AI 从合同识别" : ""} />
                </label>
              ))}
            </div>
          )}

          <label className="file-drop" onDrop={dropFiles} onDragOver={(event) => event.preventDefault()}>
            <UploadCloud size={18} />
            <strong>{files.length ? `已选择 ${files.length} 个文件` : `选择${needsProject ? typeLabels[type].replace("已有项目：", "") : "合同、报价表"}文件`}</strong>
            <span>{needsProject && targetProject ? `归属项目：${targetProject.name}。` : ""}支持 PDF / Word / Excel / CSV / 图片。大 PDF 请耐心等待 OCR。</span>
            <input type="file" multiple onChange={pickFiles} />
          </label>

          {hasProgress && <UploadProgressPanel
            loading={loading}
            confirmed={confirmed}
            preview={preview}
            progressLabel={progressLabel}
            progressPercent={progressPercent}
            fileCount={files.length}
          />}

          {files.length > 0 && (
            <div className="file-list">
              {files.map((file) => (
                <div key={`${file.name}-${file.size}`}>
                  <strong>{file.name}</strong>
                  <span>{fileSize(file.size)}</span>
                  <button type="button" className="ghost tiny" disabled={!canEditUploadFiles} onClick={() => removeFile(uploadedFileKey(file))}>{loading ? "处理中" : "移除"}</button>
                </div>
              ))}
            </div>
          )}

          {preview && <div ref={previewRef} className="upload-preview-anchor"><UploadPreview preview={preview} /></div>}

          {message && <p className="form-message">{message}</p>}
          {uploadError && <UploadErrorHint error={uploadError} />}
        </div>
        <div className="modal-actions">
          {canCloseUpload
            ? <button type="button" className="ghost" onClick={onClose}>取消</button>
            : <button type="button" className="ghost" onClick={onMinimize}>处理中，缩到后台</button>}
          {hasProgress && <button type="button" className="ghost" onClick={onMinimize}>缩到后台继续</button>}
          {preview && <button type="button" className="ghost" onClick={showPreview}>查看识别结果</button>}
          {preview && !confirmed && <button type="button" className="ghost" onClick={requestPreview} disabled={loading}>重新预览</button>}
          <button type="submit" className="primary" disabled={loading || (preview && !preview.canConfirm)}>{loading ? "处理中" : preview ? "确认入库" : "AI 预览识别"}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function UploadProgressPanel({ loading, confirmed, preview, progressLabel, progressPercent, fileCount = 0 }) {
  const title = loading ? "AI 正在处理" : confirmed ? "处理完成" : preview ? "等待确认" : fileCount ? "文件已加入任务" : "准备识别";
  return (
    <div className="upload-progress-panel">
      <div>
        <strong>{title}</strong>
        <span>{progressLabel}</span>
      </div>
      {fileCount > 0 && !loading && !preview && !confirmed && <p>已放入 {fileCount} 个文件。现在可以点下面的「AI 预览识别」，预览完成前不会写入项目。</p>}
      <div className="upload-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      <ol>
        {["读取文件", "AI/OCR识别", "预览确认", "写入项目"].map((step, index) => (
          <li className={progressPercent >= [12, 62, 82, 100][index] ? "done" : ""} key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function UploadErrorHint({ error }) {
  if (!error) return null;
  return (
    <div className="upload-error-hint">
      <div>
        <AlertTriangle size={16} />
        <strong>{error.title}</strong>
      </div>
      <p>{error.detail}</p>
      <span>{error.next}</span>
    </div>
  );
}

function UploadPreview({ preview }) {
  const fieldEntries = Object.entries(preview.fields || {}).filter(([, value]) => value !== "" && value !== undefined && value !== null);
  return (
    <section className="upload-preview">
      <div className="preview-head">
        <div>
          <strong>AI 识别结果确认</strong>
          <span>{preview.summary}</span>
        </div>
        <b className={preview.canConfirm ? "ok" : "danger"}>{preview.canConfirm ? "可确认" : "需处理"}</b>
      </div>
      <div className="preview-progress-note">
        <strong>{preview.canConfirm ? "识别已完成，正在等待你确认入库。" : "识别已完成，但还有信息需要处理。"}</strong>
        <span>这个预览阶段不会写入项目；长表格会在弹窗内自动换行，不需要拖动整个页面找按钮。</span>
      </div>

      {!!preview.targetProject && (
        <div className="preview-target">
          <span>归属项目</span>
          <strong>{preview.targetProject.name}</strong>
        </div>
      )}

      {!!fieldEntries.length && (
        <div className="preview-fields">
          {fieldEntries.map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{typeof value === "number" ? money(value) : value}</strong>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(preview.warnings) && preview.warnings.length > 0 && (
        <div className="preview-warnings">
          {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {(preview.sections || []).map((section) => (
        <div className="preview-section" key={section.title}>
          <div className="preview-section-head">
            <strong>{section.title}</strong>
            {section.total ? <span>合计 {money(section.total)}</span> : null}
          </div>
          <div className="preview-table">
            {(section.rows || []).slice(0, 8).map((row, index) => (
              <div key={`${section.title}-${index}`}>
                <strong title={row.name || row.matched || "未命名项"}>{row.name || row.matched || "未命名项"}</strong>
                <p>
                  <span>{row.quantity ? `${row.quantity}${row.unit || ""}` : row.status || "待确认"}</span>
                  <b>{row.amount || row.unitPrice ? money(row.amount || row.unitPrice) : "金额待确认"}</b>
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

function BackupDiffPreview({ diff }) {
  const items = (diff?.changed?.length ? diff.changed : diff?.items || []).filter((item) => item && item.key).slice(0, 8);
  if (!diff || !items.length) return <span className="backup-diff-empty">恢复预演：备份数量与当前 OA 基本一致。</span>;
  return (
    <div className="backup-diff-preview">
      <strong>恢复预演影响：{diff.summary || `${diff.changedCount || items.length} 类数据会变化`}</strong>
      <div>
        {items.map((item) => (
          <span className={item.direction || (item.delta > 0 ? "increase" : item.delta < 0 ? "decrease" : "same")} key={item.key}>
            {item.label || item.key}：当前 {item.current ?? 0} → 备份 {item.backup ?? 0}{Number(item.delta || 0) !== 0 ? `（${item.delta > 0 ? "+" : ""}${item.delta}）` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPin, setNewPin] = useState("");

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "登录失败");
      if (payload.data.requiresPasswordChange) { setResetToken(payload.data.resetToken); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload.data));
      onLogin(payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resetToken, newPin }) });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "修改 PIN 失败");
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload.data)); onLogin(payload.data);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="logo">
          <div className="logo-mark">A</div>
          <div>
            <strong>广告项目中台 OA</strong>
            <span>内部项目协作与智能分析</span>
          </div>
        </div>
        <form onSubmit={resetToken ? changePassword : submit}>
          {resetToken && <p className="login-hint">这是临时 PIN，请先设置新的 6-12 位数字 PIN。</p>}
          {!resetToken && <>
          <label>
            <span>邮箱</span>
            <div className="input-row"><Mail size={16} /><input value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </label>
          </>}
          <label>
            <span>{resetToken ? "新 PIN" : "PIN"}</span>
            <div className="input-row"><LockKeyhole size={16} /><input value={resetToken ? newPin : pin} type="password" inputMode="numeric" onChange={(event) => resetToken ? setNewPin(event.target.value) : setPin(event.target.value)} /></div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="primary" disabled={loading}>{loading ? "处理中" : resetToken ? "保存新 PIN 并进入系统" : "进入系统"}</button>
        </form>
        <p className="login-hint">请使用管理员分配的内部账号登录。</p>
      </section>
    </main>
  );
}

function AdminMembers({ session, setView, onLogout, initialTab = "members" }) {
  const isAdmin = ["shareholder", "admin"].includes(session?.role);
  const canManageAssignments = ["shareholder", "admin", "director"].includes(session?.role);
  const [adminTab, setAdminTab] = useState(initialTab);
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [feishuBindings, setFeishuBindings] = useState([]);
  const [feishuEvents, setFeishuEvents] = useState([]);
  const [feishuPendingFiles, setFeishuPendingFiles] = useState([]);
  const [systemNotifications, setSystemNotifications] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [savingMember, setSavingMember] = useState(false);
  const [togglingMemberId, setTogglingMemberId] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [testingAi, setTestingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [savingProductSettings, setSavingProductSettings] = useState(false);
  const [savingSettingType, setSavingSettingType] = useState("");
  const [testingStorage, setTestingStorage] = useState(false);
  const [storageTestResult, setStorageTestResult] = useState(null);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [validatingBackup, setValidatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [backupCheck, setBackupCheck] = useState(null);
  const [backupRestoreConfirm, setBackupRestoreConfirm] = useState("");
  const [syncingFeishuContacts, setSyncingFeishuContacts] = useState(false);
  const [deployHealth, setDeployHealth] = useState(null);
  const [checkingDeployHealth, setCheckingDeployHealth] = useState(false);
  const [aiSettings, setAiSettings] = useState({
    "服务商": "DeepSeek",
    "API Key": "",
    "Base URL": "https://api.deepseek.com",
    "模型名称": "deepseek-chat",
  });
  const [productSettings, setProductSettings] = useState({
    "公司名称": "广告项目中台",
    "默认执行预算占比": "60%",
    "大文件提醒阈值MB": "40",
    "自动巡检间隔毫秒": "900000",
    "关闭自动巡检": "",
  });
  const [feishuSettings, setFeishuSettings] = useState({
    appId: "",
    appSecret: "",
    eventUrl: "",
    verificationToken: "",
    tenantAccessToken: "",
    mockSend: "",
    mockContactsJson: "",
    mockFileBase64: "",
    mockFileName: "",
    mockFileType: "",
  });
  const [feishuSyncResult, setFeishuSyncResult] = useState(null);
  const [wechatSettings, setWechatSettings] = useState({
    webhookUrl: "",
    corpId: "",
    agentId: "",
    secret: "",
  });
  const [storageSettings, setStorageSettings] = useState({
    provider: "local",
    bucket: "",
    publicBaseUrl: "",
    endpoint: "",
    region: "",
    pathPrefix: "ad-project-hub",
    accessKeyId: "",
    secretAccessKey: "",
    pathStyle: "",
    mockUpload: "",
  });
  const [approvalSettings, setApprovalSettings] = useState({
    pettyCashDirectorLimit: "3000",
    financeRequiredAmount: "1000",
    ownerRequiredAmount: "10000",
  });
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "member",
    department: "",
    feishuOpenId: "",
    feishuUserId: "",
    feishuName: "",
    status: "active",
    pin: "",
  });
  const aiReady = Boolean(aiSettings["API Key"]);
  const activeMembers = members.filter((member) => member.status !== "disabled");
  const feishuBoundCount = activeMembers.filter((member) => member.feishuOpenId || member.feishuUserId).length;
  const feishuMissingMembers = activeMembers.filter((member) => !member.feishuOpenId && !member.feishuUserId);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token || ""}`,
        ...(options.headers || {}),
      },
    });
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "请求失败");
    return payload.data;
  }

  async function loadMembers() {
    setMembers(await api("/api/members"));
  }

  async function loadAssignmentMembers() {
    setMembers(await api("/api/project-assignments/members"));
  }

  async function loadAssignments() {
    setAssignments(await api("/api/project-assignments"));
  }

  async function loadSettings() {
    const res = await fetch("/api/state", { headers: { authorization: `Bearer ${session.token || ""}` } });
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "读取设置失败");
    const settings = payload.data?.settings || {};
    setFeishuBindings(payload.data?.feishuProjectBindings || []);
    setFeishuEvents(payload.data?.feishuEvents || []);
    setFeishuPendingFiles(payload.data?.feishuPendingFiles || []);
    setSystemNotifications(payload.data?.systemNotifications || []);
    setAiSettings((current) => ({ ...current, ...(settings.aiService || {}) }));
    setProductSettings((current) => ({ ...current, ...(settings.product || {}) }));
    setFeishuSettings((current) => ({ ...current, ...(settings.feishu || {}) }));
    setWechatSettings((current) => ({ ...current, ...(settings.wechat || {}) }));
    setStorageSettings((current) => ({ ...current, ...(settings.storage || {}) }));
    setApprovalSettings((current) => ({ ...current, ...(settings.approvalRules || {}) }));
  }

  async function loadDeployHealth({ silent = false } = {}) {
    setCheckingDeployHealth(true);
    if (!silent) setSettingsMessage("正在检查线上部署状态...");
    try {
      const res = await fetch("/api/health");
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "健康检查失败");
      setDeployHealth(payload.data || null);
      if (!silent) setSettingsMessage(payload.data?.version === BUILD_VERSION ? "线上版本检查通过，后台和服务端是同一版。" : "线上版本可能不是最新版，请重新部署或检查是否上传了旧包。");
    } catch (error) {
      setDeployHealth({ version: "无法读取", uploadProgress: false, renderBuildCommand: false, startOpensPortOnly: false });
      if (!silent) setSettingsMessage(error.message || "健康检查失败");
    } finally {
      setCheckingDeployHealth(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadMembers().catch((err) => setMessage(err.message));
      loadSettings().catch((err) => setSettingsMessage(err.message));
      loadDeployHealth({ silent: true });
    }
    if (canManageAssignments) {
      loadAssignments().catch((err) => setSettingsMessage(err.message));
      if (!isAdmin) loadAssignmentMembers().catch((err) => setSettingsMessage(err.message));
    }
  }, [isAdmin, canManageAssignments]);

  function edit(member) {
    setEditingId(member.id);
    setForm({
      name: member.name || "",
      email: member.email || "",
      role: member.role || "member",
      department: member.department || "",
      feishuOpenId: member.feishuOpenId || "",
      feishuUserId: member.feishuUserId || "",
      feishuName: member.feishuName || member.name || "",
      status: member.status || "active",
      pin: "",
    });
    setMessage("");
  }

  function resetForm() {
    setEditingId("");
    setForm({ name: "", email: "", role: "member", department: "", feishuOpenId: "", feishuUserId: "", feishuName: "", status: "active", pin: "" });
  }

  async function save(event) {
    event.preventDefault();
    setSavingMember(true);
    try {
      await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ id: editingId || undefined, ...form }),
      });
      const nextMembers = await api("/api/members");
      setMembers(nextMembers);
      resetForm();
      setMessage(`成员已保存，当前成员列表共 ${nextMembers.length} 人。`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSavingMember(false);
    }
  }

  async function toggle(member) {
    setTogglingMemberId(member.id);
    try {
      const nextStatus = member.status === "disabled" ? "active" : "disabled";
      await api("/api/members/status", {
        method: "POST",
        body: JSON.stringify({ id: member.id, status: nextStatus }),
      });
      const nextMembers = await api("/api/members");
      setMembers(nextMembers);
      setMessage(`${member.name} 已${nextStatus === "disabled" ? "停用" : "启用"}，成员列表已刷新。`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setTogglingMemberId("");
    }
  }

  function applyProviderPreset(provider) {
    const presets = {
      DeepSeek: { "服务商": "DeepSeek", "Base URL": "https://api.deepseek.com", "模型名称": "deepseek-chat" },
      "Kimi / Moonshot": { "服务商": "Kimi / Moonshot", "Base URL": "https://api.moonshot.cn/v1", "模型名称": "moonshot-v1-8k" },
      "GPT / OpenAI": { "服务商": "GPT / OpenAI", "Base URL": "https://api.openai.com/v1", "模型名称": "gpt-4.1" },
      "自定义": { "服务商": "自定义" },
    };
    setAiSettings({ ...aiSettings, ...(presets[provider] || { "服务商": provider }) });
  }

  async function testAi(event) {
    event.preventDefault();
    if (savingAi) return;
    setTestingAi(true);
    setSettingsMessage("正在测试 AI 连接...");
    try {
      const data = await api("/api/settings/ai/test", {
        method: "POST",
        body: JSON.stringify({ values: aiSettings }),
      });
      setSettingsMessage(`AI 连接正常：${data.provider} / ${data.model}`);
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setTestingAi(false);
    }
  }

  async function saveAi(event) {
    event.preventDefault();
    if (testingAi) return;
    setSavingAi(true);
    setSettingsMessage("正在保存 AI 配置...");
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type: "aiService", values: aiSettings }),
      });
      await loadSettings();
      setSettingsMessage("AI API 已保存并刷新配置，后续合同/表格解析会使用这套配置。");
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setSavingAi(false);
    }
  }

  async function saveProductSettings(event) {
    event.preventDefault();
    setSavingProductSettings(true);
    setSettingsMessage("正在保存产品设置...");
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type: "product", values: productSettings }),
      });
      await loadSettings();
      setSettingsMessage("产品设置已保存并刷新配置。回到员工端后，侧边栏和上传提醒会按新名称/提示展示。");
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setSavingProductSettings(false);
    }
  }

  async function exportBackup() {
    setExportingBackup(true);
    setSettingsMessage("正在导出 OA 备份...");
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadFile("/api/admin/backup", session, `ad-project-hub-backup-${date}.json`);
      setSettingsMessage("OA 备份已导出，文件已脱敏，不包含 PIN、API Key、Webhook 或 Secret。");
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setExportingBackup(false);
    }
  }

  async function validateBackup() {
    if (!backupText.trim()) {
      setSettingsMessage("请先粘贴 OA 备份 JSON，再点击校验。");
      return;
    }
    setValidatingBackup(true);
    setBackupCheck(null);
    setSettingsMessage("正在校验备份 JSON，本次不会写入或恢复任何数据...");
    try {
      const data = await api("/api/admin/backup/validate", {
        method: "POST",
        body: JSON.stringify({ text: backupText })
      });
      setBackupCheck(data);
      setSettingsMessage(data.ok ? "备份 JSON 校验通过：这是恢复预演，不会写入数据。" : "备份 JSON 校验未通过，请查看下方提示。");
    } catch (err) {
      setBackupCheck({ ok: false, error: err.message, warnings: ["本次校验不会写入或恢复任何数据。"] });
      setSettingsMessage(err.message);
    } finally {
      setValidatingBackup(false);
    }
  }

  async function restoreBackup() {
    if (!backupText.trim()) {
      setSettingsMessage("请先粘贴 OA 备份 JSON，并完成校验后再恢复。");
      return;
    }
    if (backupRestoreConfirm.trim() !== "确认恢复OA备份") {
      setSettingsMessage("恢复会覆盖当前业务数据。请输入：确认恢复OA备份");
      return;
    }
    setRestoringBackup(true);
    setSettingsMessage("正在恢复 OA 备份，请不要刷新页面...");
    try {
      const data = await api("/api/admin/backup/restore", {
        method: "POST",
        body: JSON.stringify({ text: backupText, confirmText: backupRestoreConfirm })
      });
      setBackupCheck({ ...data, ok: true });
      setBackupRestoreConfirm("");
      setSettingsMessage(`OA 备份已恢复：项目 ${data.counts?.projects ?? 0} 个，审批 ${data.counts?.approvals ?? 0} 条。请回员工端刷新查看。`);
      await loadSettings();
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setRestoringBackup(false);
    }
  }

  function settingNextStep(type) {
    if (type === "feishu") return "下一步：在下方飞书机器人面板自测事件地址，或同步飞书通讯录。";
    if (type === "wechat") return "下一步：回到待办或项目提醒里测试企业微信通知。";
    if (type === "storage") return "下一步：点击“测试存储上传”，确认对象存储或本地备份能正常返回访问地址。";
    if (type === "approvalRules") return "下一步：新提交的备用金、报销和供应商付款会按新阈值流转。";
    return "配置已写入后台。";
  }
  const integrationStatusCards = [
    {
      type: "feishu",
      title: "飞书机器人",
      ok: Boolean(feishuSettings.appId && feishuSettings.appSecret),
      status: feishuSettings.appId && feishuSettings.appSecret ? "已填写 App ID / Secret" : "待填写 App ID / Secret",
      next: settingNextStep("feishu")
    },
    {
      type: "wechat",
      title: "企业微信",
      ok: Boolean(wechatSettings.webhookUrl || (wechatSettings.corpId && wechatSettings.agentId && wechatSettings.secret)),
      status: wechatSettings.webhookUrl || wechatSettings.corpId ? "已有通知配置" : "待配置通知入口",
      next: settingNextStep("wechat")
    },
    {
      type: "storage",
      title: "对象存储",
      ok: Boolean(storageSettings.provider && storageSettings.bucket),
      status: storageSettings.provider && storageSettings.bucket ? `${storageSettings.provider} · ${storageSettings.bucket}` : "未配置 Bucket",
      next: settingNextStep("storage")
    },
    {
      type: "approvalRules",
      title: "审批规则",
      ok: Boolean(approvalSettings.pettyCashDirectorLimit || approvalSettings.financeRequiredAmount || approvalSettings.ownerRequiredAmount),
      status: approvalSettings.ownerRequiredAmount ? `老板审批线 ${money(approvalSettings.ownerRequiredAmount)}` : "使用默认审批线",
      next: settingNextStep("approvalRules")
    }
  ];
  const deployCheckItems = [
    {
      title: "前后端版本",
      ok: deployHealth?.version === BUILD_VERSION,
      status: deployHealth?.version ? `页面 ${BUILD_VERSION} / 服务端 ${deployHealth.version}${deployHealth.deployedCommit ? ` · 提交 ${deployHealth.deployedCommit.slice(0, 8)}` : ""}` : "正在读取版本",
      next: deployHealth?.deployedCommit ? `Render 实际部署提交：${deployHealth.deployedCommit}` : "Render 未返回提交号，请检查部署日志。"
    },
    {
      title: "Render 构建命令",
      ok: Boolean(deployHealth?.renderBuildCommand && deployHealth?.noPrestartBuild),
      status: deployHealth?.buildCommand || "npm install && npm run build",
      next: "Render Build Command 应为 npm install && npm run build，package.json 里不能加 prestart。"
    },
    {
      title: "Render 启动命令",
      ok: Boolean(deployHealth?.startOpensPortOnly),
      status: deployHealth?.startCommand || "npm start",
      next: "Start Command 应为 npm start，启动时只开服务，不要二次构建 dist。"
    },
    {
      title: "上传进度新版",
      ok: Boolean(deployHealth?.uploadProgress),
      status: deployHealth?.uploadProgress ? "已启用识别进度与缩到后台" : "未检测到新版上传进度",
      next: deployHealth?.uploadProgress ? "合同/报价/成本上传时会显示读取、识别、预览、写入进度。" : "请确认最新包已上传并重新部署。"
    },
    {
      title: "AI 环境兜底",
      ok: aiReady || Boolean(deployHealth?.aiEnv?.apiKey),
      status: aiReady ? "后台已保存 AI Key" : deployHealth?.aiEnv?.apiKey ? "Render 已配置 AI_API_KEY" : "未检测到 AI Key",
      next: "如果覆盖 data/db.json 后后台 Key 丢失，可在 Render 环境变量配置 AI_API_KEY、AI_BASE_URL、AI_MODEL。"
    },
    {
      title: "腾讯 OCR",
      ok: Boolean(deployHealth?.ocrEnv?.secretId && deployHealth?.ocrEnv?.secretKey),
      status: deployHealth?.ocrEnv?.secretId && deployHealth?.ocrEnv?.secretKey ? `已配置${deployHealth?.ocrEnv?.region ? ` · ${deployHealth.ocrEnv.region}` : ""}` : "未检测到 TENCENT_SECRET_ID / TENCENT_SECRET_KEY",
      next: "扫描版 PDF 需要腾讯 OCR 环境变量；普通可复制文字 PDF 和表格仍可走本地解析。"
    },
    {
      title: "数据存储",
      ok: deployHealth?.productionPersistenceReady === true,
      status: deployHealth?.storageMode ? `当前：${deployHealth.storageMode}` : "未读取到存储模式",
      next: deployHealth?.productionPersistenceReady ? "生产数据库已启用 PostgreSQL。" : "Render 上长期使用必须接 PostgreSQL；本地 JSON 只适合测试。"
    },
    {
      title: "后台定时巡检",
      ok: Boolean(deployHealth?.scheduler?.enabled),
      status: deployHealth?.scheduler?.enabled ? `每 ${Math.round((deployHealth.scheduler.intervalMs || 0) / 60000)} 分钟 · 已跑 ${deployHealth.scheduler.runCount || 0} 次` : "未启用",
      next: deployHealth?.scheduler?.lastError ? `最近错误：${deployHealth.scheduler.lastError}` : "用于自动扫描项目分派、进度、审批、现金流和文件待办。"
    }
  ];
  const deployReadyCount = deployCheckItems.filter((item) => item.ok).length;
  const deployReadinessSteps = deployReadinessActions(deployHealth || {}, deployCheckItems);

  async function saveTypedSetting(type, values, label) {
    setSavingSettingType(type);
    setSettingsMessage(`正在保存${label}...`);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type, values }),
      });
      setSettingsMessage(`${label}已保存。${settingNextStep(type)}`);
      await loadSettings();
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setSavingSettingType("");
    }
  }

  async function testStorageUpload() {
    setTestingStorage(true);
    setStorageTestResult(null);
    setSettingsMessage("正在测试对象存储上传...");
    try {
      const data = await api("/api/settings/storage/test", {
        method: "POST",
        body: JSON.stringify({ values: storageSettings }),
      });
      setStorageTestResult(data);
      if (data.ok) {
        setSettingsMessage(`存储测试通过：${data.storageStatus || "已保存"}。后续合同、报价表、核销表会保留访问地址。`);
      } else {
        setSettingsMessage(data.storageRemoteError || "存储测试未完全通过，请检查 Bucket、Endpoint、Key 和权限。");
      }
      await loadSettings();
    } catch (err) {
      setStorageTestResult({ ok: false, storageRemoteError: err.message });
      setSettingsMessage(err.message);
    } finally {
      setTestingStorage(false);
    }
  }

  async function loadFeishuBindings() {
    setFeishuBindings(await api("/api/integrations/feishu/bindings"));
    const res = await fetch("/api/state", { headers: { authorization: `Bearer ${session.token || ""}` } });
    const payload = await res.json();
    if (payload.ok) {
      setFeishuEvents(payload.data?.feishuEvents || []);
      setFeishuPendingFiles(payload.data?.feishuPendingFiles || []);
      setSystemNotifications(payload.data?.systemNotifications || []);
    }
  }

  async function syncFeishuContacts() {
    setSyncingFeishuContacts(true);
    setSettingsMessage("正在同步飞书通讯录...");
    try {
      const data = await api("/api/integrations/feishu/contacts/sync", {
        method: "POST",
        body: JSON.stringify({})
      });
      setFeishuSyncResult(data);
      setSettingsMessage(`飞书通讯录同步完成：新增 ${data.created} 人，更新 ${data.updated} 人，跳过 ${data.skipped} 人。`);
      await loadMembers();
      await loadSettings();
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setSyncingFeishuContacts(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">A</div>
          <div>
            <strong>后台管理</strong>
            <span>成员 / 权限 / 设置</span>
          </div>
        </div>
        <nav>
          <button type="button" className="admin-nav-link" onClick={() => setView("app")}><LayoutDashboard size={18} />返回员工端</button>
          {isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "members" ? "active" : ""}`} onClick={() => setAdminTab("members")}><UsersRound size={18} />成员管理</button>}
          {canManageAssignments && <button type="button" className={`admin-nav-link ${adminTab === "assignments" ? "active" : ""}`} onClick={() => setAdminTab("assignments")}><UserCog size={18} />项目分派</button>}
          {isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "ai" ? "active" : ""}`} onClick={() => setAdminTab("ai")}><Bot size={18} />AI 接入</button>}
          {isAdmin && <button type="button" className={`admin-nav-link ${adminTab === "product" ? "active" : ""}`} onClick={() => setAdminTab("product")}><Settings2 size={18} />产品设置</button>}
        </nav>
        <div className="integration">
          <p>{session.name} · {roleLabel(session.role)}</p>
          <button type="button" onClick={onLogout}><LogOut size={16} />退出登录</button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{adminTab === "members" ? "成员管理" : adminTab === "assignments" ? "项目分派" : adminTab === "ai" ? "AI 接入" : "产品设置"}</h1>
            <p>{adminTab === "members" ? "维护内部账号、角色和后台访问权限" : adminTab === "assignments" ? "把项目分给 PM、销售和执行成员，员工端会按这里展示自己的项目" : adminTab === "ai" ? "配置 DeepSeek、Kimi、OpenAI 或兼容模型，用于合同和表格智能解析" : "维护产品基础参数和上传提醒"}</p>
          </div>
          {isAdmin && adminTab === "members" && <button type="button" className="ghost" onClick={resetForm}><Plus size={16} />新增成员</button>}
        </header>

        {isAdmin && adminTab === "members" && <section className="admin-grid">
          <form className="member-form" onSubmit={save}>
            <div className="section-head"><h2>{editingId ? "编辑成员" : "新增成员"}</h2></div>
            <label><span>姓名</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>邮箱</span><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>
              <span>角色</span>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                {roleOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label><span>部门</span><input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label>
            <label><span>飞书 Open ID</span><input value={form.feishuOpenId} onChange={(event) => setForm({ ...form, feishuOpenId: event.target.value })} placeholder="用于机器人私聊通知" /></label>
            <label><span>飞书 User ID（可选）</span><input value={form.feishuUserId} onChange={(event) => setForm({ ...form, feishuUserId: event.target.value })} /></label>
            <label><span>飞书姓名（可选）</span><input value={form.feishuName} onChange={(event) => setForm({ ...form, feishuName: event.target.value })} /></label>
            <label><span>临时 PIN</span><input value={form.pin} placeholder="留空则保持不变" onChange={(event) => setForm({ ...form, pin: event.target.value })} /></label>
            {message && <p className="form-message">{message}</p>}
            <button type="submit" className="primary" disabled={savingMember}>{savingMember ? "保存中" : "保存成员"}</button>
          </form>

          <div className="member-table">
            <div className="section-head"><h2>成员列表</h2><span>{members.length} 人</span></div>
            <div className={`member-sync-status ${feishuMissingMembers.length ? "warn" : "ok"}`}>
              <strong>飞书私聊绑定：{feishuBoundCount}/{activeMembers.length || 0}</strong>
              <span>{feishuMissingMembers.length ? `还差 ${feishuMissingMembers.slice(0, 5).map((member) => member.name || member.email).join("、")}${feishuMissingMembers.length > 5 ? `等 ${feishuMissingMembers.length} 人` : ""}，这些成员暂时收不到 OA 私聊提醒。` : "启用中的成员都已绑定飞书，可以接收 OA 私聊提醒。"}</span>
            </div>
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.email} · {member.department || "未分组"}{member.feishuOpenId || member.feishuUserId ? " · 已绑飞书" : " · 未绑飞书"}</span>
                </div>
                <b className={`role-pill ${member.role}`}>{roleLabel(member.role)}</b>
                <b className={`status-pill ${member.status}`}>{member.status === "disabled" ? "已停用" : "启用中"}</b>
                <button type="button" className="ghost" disabled={savingMember || togglingMemberId === member.id} onClick={() => edit(member)}>编辑</button>
                <button type="button" className="ghost" disabled={togglingMemberId === member.id} onClick={() => toggle(member)}>{togglingMemberId === member.id ? "处理中" : member.status === "disabled" ? "启用" : "停用"}</button>
              </div>
            ))}
          </div>
        </section>}

        {canManageAssignments && adminTab === "assignments" && (
          <ProjectAssignmentPanel
            api={api}
            members={members}
            assignments={assignments}
            onCreateProject={() => setView("app:create-project")}
            onOpenMembers={() => setAdminTab("members")}
            onSyncFeishuContacts={syncFeishuContacts}
            syncingFeishuContacts={syncingFeishuContacts}
            onReload={async () => {
              await loadAssignments();
              await loadSettings();
            }}
          />
        )}

        {isAdmin && adminTab === "ai" && <section className="admin-grid">
          <form className="member-form settings-form" onSubmit={saveAi}>
            <div className="section-head">
              <h2>AI 服务配置</h2>
              <span className={`config-state ${aiReady ? "ok" : "warn"}`}>{aiReady ? "已保存 Key" : "未接入"}</span>
            </div>
            <label>
              <span>服务商</span>
              <select value={aiSettings["服务商"] || "DeepSeek"} onChange={(event) => applyProviderPreset(event.target.value)}>
                <option value="DeepSeek">DeepSeek</option>
                <option value="Kimi / Moonshot">Kimi / Moonshot</option>
                <option value="GPT / OpenAI">GPT / OpenAI</option>
                <option value="自定义">自定义兼容接口</option>
              </select>
            </label>
            <label><span>API Key</span><input value={aiSettings["API Key"] || ""} type="password" onChange={(event) => setAiSettings({ ...aiSettings, "API Key": event.target.value })} placeholder="粘贴你的 API Key" /></label>
            <label><span>Base URL</span><input value={aiSettings["Base URL"] || ""} onChange={(event) => setAiSettings({ ...aiSettings, "Base URL": event.target.value })} /></label>
            <label><span>模型名称</span><input value={aiSettings["模型名称"] || ""} onChange={(event) => setAiSettings({ ...aiSettings, "模型名称": event.target.value })} /></label>
            {settingsMessage && <p className="form-message">{settingsMessage}</p>}
            <div className="button-row">
              <button className="ghost" type="button" onClick={testAi} disabled={testingAi || savingAi}>{testingAi ? "测试中" : "测试连接"}</button>
              <button type="submit" className="primary" disabled={savingAi || testingAi}>{savingAi ? "保存中" : "保存 AI API"}</button>
            </div>
          </form>
          <div className="member-table settings-help">
            <div className="section-head"><h2>接入说明</h2></div>
            <div className="logic-list">
              <LogicItem title="为什么看起来没了" text="如果覆盖上传时带了空的 data/db.json，线上保存过的 AI API 可能被重置。新版已支持 Render 环境变量兜底。" />
              <LogicItem title="Render 兜底变量" text="可以在 Render 设置 AI_API_KEY、AI_BASE_URL、AI_MODEL，后台配置为空时也能继续解析。" />
              <LogicItem title="DeepSeek" text="适合成本敏感的表格解析和项目问答，默认 Base URL 为 https://api.deepseek.com。" />
              <LogicItem title="Kimi / Moonshot" text="适合长文本合同理解，可填 moonshot-v1-8k 或你购买的其他模型。" />
              <LogicItem title="OpenAI 兼容" text="支持 OpenAI 或其他兼容 Chat Completions 的服务，只要填写 Base URL、API Key 和模型名。" />
            </div>
          </div>
        </section>}

        {isAdmin && adminTab === "product" && <section className="admin-grid">
          <form className="member-form settings-form" onSubmit={saveProductSettings}>
            <div className="section-head"><h2>基础参数</h2></div>
            {Object.keys(productSettings).map((key) => (
              <label key={key}>
                <span>{key}</span>
                <input value={productSettings[key]} onChange={(event) => setProductSettings({ ...productSettings, [key]: event.target.value })} />
              </label>
            ))}
            {settingsMessage && <p className="form-message">{settingsMessage}</p>}
            <button type="submit" className="primary" disabled={savingProductSettings}>{savingProductSettings ? "保存中" : "保存产品设置"}</button>
          </form>
          <div className="member-table settings-help">
            <div className="section-head"><h2>协同与生产配置</h2></div>
            <div className="button-row compact">
              <button type="button" className="ghost" onClick={exportBackup} disabled={exportingBackup}>{exportingBackup ? "导出中" : "导出 OA 备份 JSON"}</button>
            </div>
            <div className="settings-block backup-validate-block">
              <h3>备份校验 / 安全恢复</h3>
              <p className="settings-next-step">先校验备份 JSON。恢复会覆盖当前业务数据，但会保留当前账号和环境密钥；原始合同/发票不写入备份，需由对象存储长期保存。备份中新成员会先停用，管理员设置临时 PIN 后才能启用。</p>
              <textarea rows={5} value={backupText} onChange={(event) => setBackupText(event.target.value)} placeholder="粘贴 ad-project-hub-backup-YYYY-MM-DD.json 的内容" />
              <div className="button-row compact">
                <button type="button" className="ghost" onClick={validateBackup} disabled={validatingBackup}>{validatingBackup ? "校验中" : "校验备份 JSON"}</button>
                <button type="button" className="ghost tiny" onClick={() => { setBackupText(""); setBackupCheck(null); setBackupRestoreConfirm(""); }} disabled={validatingBackup || restoringBackup || (!backupText && !backupCheck)}>清空</button>
              </div>
              {backupCheck && (
                <div className={`backup-check-result ${backupCheck.ok ? "ok" : "warn"}`}>
                  <strong>{backupCheck.restored ? "备份已恢复" : backupCheck.ok ? "备份格式可用" : "备份暂不可用"}</strong>
                  <span>格式：{backupCheck.format || "未识别"}{backupCheck.exportedAt ? ` · 导出时间 ${new Date(backupCheck.exportedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</span>
                  <span>项目 {backupCheck.counts?.projects ?? 0} 个 / 审批 {backupCheck.counts?.approvals ?? 0} 条 / 文件 {backupCheck.counts?.files ?? 0} 个</span>
                  <span>当前 OA：项目 {backupCheck.currentCounts?.projects ?? 0} 个 / 审批 {backupCheck.currentCounts?.approvals ?? 0} 条 / 文件 {backupCheck.currentCounts?.files ?? 0} 个</span>
                  <BackupDiffPreview diff={backupCheck.diff} />
                  {(backupCheck.warnings || []).map((warning) => <em key={warning}>{warning}</em>)}
                  {backupCheck.error && <em>{backupCheck.error}</em>}
                </div>
              )}
              <div className="backup-restore-box">
                <label>
                  <span>恢复确认语</span>
                  <input value={backupRestoreConfirm} onChange={(event) => setBackupRestoreConfirm(event.target.value)} placeholder="输入：确认恢复OA备份" />
                </label>
                <button type="button" className="danger-button" onClick={restoreBackup} disabled={restoringBackup || validatingBackup || backupRestoreConfirm.trim() !== "确认恢复OA备份"}>
                  {restoringBackup ? "恢复中" : "执行恢复备份"}
                </button>
              </div>
            </div>
            <DeployHealthPanel
              items={deployCheckItems}
              actions={deployReadinessSteps}
              readyCount={deployReadyCount}
              total={deployCheckItems.length}
              checkedAt={deployHealth?.checkedAt}
              rootDirectory={deployHealth?.rootDirectory}
              nodeEnv={deployHealth?.nodeEnv}
              checking={checkingDeployHealth}
              onRefresh={() => loadDeployHealth()}
            />
            <div className="integration-status-grid">
              {integrationStatusCards.map((item) => (
                <div className={item.ok ? "ok" : "warn"} key={item.type}>
                  <strong>{item.title}</strong>
                  <span>{item.status}</span>
                  <em>{item.next}</em>
                </div>
              ))}
            </div>
            <div className="settings-block">
              <h3>飞书机器人</h3>
              <p className="settings-next-step">{settingNextStep("feishu")}</p>
              {[
                ["appId", "App ID"],
                ["appSecret", "App Secret"],
                ["eventUrl", "事件订阅 URL"],
                ["verificationToken", "Verification Token"],
                ["tenantAccessToken", "Tenant Access Token（可选）"],
                ["mockSend", "模拟发送通知（true/false）"],
                ["mockContactsJson", "测试通讯录 JSON（可选）"],
                ["mockFileBase64", "测试文件 Base64（可选）"],
                ["mockFileName", "测试文件名（可选）"],
                ["mockFileType", "测试文件类型（可选）"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  {key === "mockContactsJson"
                    ? <textarea rows={4} value={feishuSettings[key]} onChange={(event) => setFeishuSettings({ ...feishuSettings, [key]: event.target.value })} placeholder='[{"name":"张三","email":"zhangsan@company.com","open_id":"ou_xxx","department":"项目部"}]' />
                    : <input value={feishuSettings[key]} onChange={(event) => setFeishuSettings({ ...feishuSettings, [key]: event.target.value })} />}
                </label>
              ))}
              <label>
                <span>OA 事件地址</span>
                <input value="/api/integrations/feishu/events" readOnly />
              </label>
              <button type="button" className="ghost" disabled={savingSettingType === "feishu" || syncingFeishuContacts} onClick={() => saveTypedSetting("feishu", feishuSettings, "飞书配置")}>{savingSettingType === "feishu" ? "保存中" : "保存飞书配置"}</button>
              <button type="button" className="ghost" disabled={syncingFeishuContacts || savingSettingType === "feishu"} onClick={syncFeishuContacts}>{syncingFeishuContacts ? "同步中" : "同步飞书通讯录"}</button>
              {feishuSyncResult && <p className="form-message">最近同步：新增 {feishuSyncResult.created} 人，更新 {feishuSyncResult.updated} 人，跳过 {feishuSyncResult.skipped} 人。</p>}
            </div>
            <FeishuBotPanel
              api={api}
              settings={feishuSettings}
              projects={assignments}
              members={members}
              bindings={feishuBindings}
              events={feishuEvents}
              pendingFiles={feishuPendingFiles}
              notifications={systemNotifications}
              onReload={loadFeishuBindings}
            />
            <div className="settings-block">
              <h3>企业微信</h3>
              <p className="settings-next-step">{settingNextStep("wechat")}</p>
              {[
                ["webhookUrl", "群机器人 Webhook"],
                ["corpId", "Corp ID"],
                ["agentId", "Agent ID"],
                ["secret", "应用 Secret"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input value={wechatSettings[key]} onChange={(event) => setWechatSettings({ ...wechatSettings, [key]: event.target.value })} />
                </label>
              ))}
              <button type="button" className="ghost" disabled={savingSettingType === "wechat"} onClick={() => saveTypedSetting("wechat", wechatSettings, "企业微信配置")}>{savingSettingType === "wechat" ? "保存中" : "保存企业微信配置"}</button>
            </div>
            <div className="settings-block">
              <h3>对象存储</h3>
              <p className="settings-next-step">{settingNextStep("storage")}</p>
              {[
                ["provider", "服务商"],
                ["bucket", "Bucket"],
                ["publicBaseUrl", "访问域名"],
                ["endpoint", "S3 Endpoint"],
                ["region", "Region"],
                ["pathPrefix", "路径前缀"],
                ["accessKeyId", "Access Key ID"],
                ["secretAccessKey", "Secret Access Key"],
                ["pathStyle", "Path Style（true/false）"],
                ["mockUpload", "模拟上传（true/false）"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input type={key === "secretAccessKey" ? "password" : "text"} value={storageSettings[key]} onChange={(event) => setStorageSettings({ ...storageSettings, [key]: event.target.value })} />
                </label>
              ))}
              <div className="button-row compact">
                <button type="button" className="ghost" disabled={savingSettingType === "storage" || testingStorage} onClick={() => saveTypedSetting("storage", storageSettings, "对象存储配置")}>{savingSettingType === "storage" ? "保存中" : "保存存储配置"}</button>
                <button type="button" className="ghost" disabled={testingStorage || savingSettingType === "storage"} onClick={testStorageUpload}>{testingStorage ? "测试中" : "测试存储上传"}</button>
              </div>
              {storageTestResult && (
                <div className={`storage-test-result ${storageTestResult.ok ? "ok" : "warn"}`}>
                  <strong>{storageTestResult.ok ? "测试上传成功" : "测试上传未通过"}</strong>
                  <span>{storageTestResult.storageStatus || "未返回存储状态"} · {storageTestResult.provider || storageSettings.provider || "local"}</span>
                  {storageTestResult.storageUrl && <a href={storageTestResult.storageUrl} target="_blank" rel="noreferrer">打开存储地址</a>}
                  {storageTestResult.localStorageUrl && <a href={storageTestResult.localStorageUrl} target="_blank" rel="noreferrer">打开本地备份</a>}
                  {storageTestResult.storageRemoteError && <em>{storageTestResult.storageRemoteError}</em>}
                  {storageTestResult.warning && <em>{storageTestResult.warning}</em>}
                </div>
              )}
            </div>
            <div className="settings-block">
              <h3>审批阈值</h3>
              <p className="settings-next-step">{settingNextStep("approvalRules")}</p>
              {[
                ["pettyCashDirectorLimit", "备用金总监审批线"],
                ["financeRequiredAmount", "财务介入金额"],
                ["ownerRequiredAmount", "老板审批金额"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input value={approvalSettings[key]} onChange={(event) => setApprovalSettings({ ...approvalSettings, [key]: event.target.value })} />
                </label>
              ))}
              <button type="button" className="ghost" disabled={savingSettingType === "approvalRules"} onClick={() => saveTypedSetting("approvalRules", approvalSettings, "审批规则")}>{savingSettingType === "approvalRules" ? "保存中" : "保存审批规则"}</button>
            </div>
          </div>
        </section>}
      </main>
    </div>
  );
}

function DeployHealthPanel({ items = [], actions = [], readyCount = 0, total = 0, checkedAt = "", rootDirectory = "", nodeEnv = "", checking = false, onRefresh }) {
  const nextIssue = items.find((item) => !item.ok);
  return (
    <div className="settings-block deploy-health-panel">
      <div className="section-head">
        <div>
          <h3>上线健康检查</h3>
          <span>检查 Render 部署、版本、AI 和 OCR 环境，避免更新后还是旧页面。</span>
        </div>
        <button type="button" className="ghost tiny" onClick={onRefresh} disabled={checking}>{checking ? "检查中" : "刷新检查"}</button>
      </div>
      <div className={`deploy-health-summary ${nextIssue ? "warn" : "ok"}`}>
        <div>
          {nextIssue ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{nextIssue ? `还差：${nextIssue.title}` : "上线检查通过"}</strong>
        </div>
        <span>{readyCount}/{total} 项就绪{checkedAt ? ` · ${new Date(checkedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</span>
        {rootDirectory && <em>Render Root Directory：{rootDirectory}{nodeEnv ? ` · ${nodeEnv}` : ""}</em>}
      </div>
      {actions.length > 0 && (
        <div className="deploy-readiness-actions">
          <strong>上线下一步</strong>
          {actions.map((action) => (
            <div className={action.tone} key={action.title}>
              {action.tone === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{action.title}</span>
              <em>{action.text}</em>
            </div>
          ))}
        </div>
      )}
      <div className="deploy-health-grid">
        {items.map((item) => (
          <div className={item.ok ? "ok" : "warn"} key={item.title}>
            {item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <strong>{item.title}</strong>
            <span>{item.status}</span>
            <em>{item.next}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectAssignmentPanel({ api, members, assignments, onReload, onCreateProject, onOpenMembers, onSyncFeishuContacts, syncingFeishuContacts = false }) {
  const activeMembers = members.filter((member) => member.status !== "disabled");
  const [selectedProjectId, setSelectedProjectId] = useState(assignments[0]?.id || "");
  const selected = assignments.find((item) => item.id === selectedProjectId) || assignments[0] || null;
  const activeMemberById = useMemo(() => new Map(activeMembers.map((member) => [member.id, member])), [activeMembers]);
  const memberByNameOrContact = useMemo(() => {
    const map = new Map();
    activeMembers.forEach((member) => {
      [member.name, member.email].filter(Boolean).forEach((key) => map.set(String(key).toLowerCase(), member.id));
    });
    return map;
  }, [activeMembers]);
  const [form, setForm] = useState({ pmId: "", salesId: "", memberIds: [], department: "" });
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportingAssignments, setExportingAssignments] = useState(false);
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const assignmentPreview = useMemo(() => {
    const pm = activeMemberById.get(form.pmId)?.name || "待分派";
    const sales = activeMemberById.get(form.salesId)?.name || "待确认";
    const memberNames = form.memberIds.map((id) => activeMemberById.get(id)?.name).filter(Boolean);
    return { pm, sales, memberNames };
  }, [activeMemberById, form.pmId, form.salesId, form.memberIds]);

  useEffect(() => {
    if (!assignments.length) return;
    if (!selectedProjectId || !assignments.some((item) => item.id === selectedProjectId)) {
      setSelectedProjectId(assignments[0].id);
    }
  }, [assignments, selectedProjectId]);

  useEffect(() => {
    if (!selected) return;
    const pmId = memberByNameOrContact.get(String(selected.pm || "").toLowerCase()) || "";
    const salesId = memberByNameOrContact.get(String(selected.sales || "").toLowerCase()) || "";
    const memberIds = (selected.members || [])
      .map((item) => memberByNameOrContact.get(String(item || "").toLowerCase()))
      .filter(Boolean);
    setForm({
      pmId,
      salesId,
      memberIds: Array.from(new Set(memberIds)),
      department: selected.department || "",
    });
    setMessage("");
  }, [selected?.id, memberByNameOrContact]);

  async function loadSuggestions(projectId = selected?.id, { silent = false } = {}) {
    if (!projectId) return;
    setSuggesting(true);
    if (!silent) setMessage("正在刷新 AI 分派建议...");
    try {
      const data = await api(`/api/project-assignments/suggestions?projectId=${encodeURIComponent(projectId)}`);
      setSuggestions(data);
      if (!silent) setMessage("AI 分派建议已刷新，可以一键套用或手动调整。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    if (!selected?.id) return;
    let alive = true;
    setSuggesting(true);
    api(`/api/project-assignments/suggestions?projectId=${encodeURIComponent(selected.id)}`)
      .then((data) => {
        if (alive) setSuggestions(data);
      })
      .catch((error) => {
        if (alive) setMessage(error.message);
      })
      .finally(() => {
        if (alive) setSuggesting(false);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id]);

  function toggleMember(id) {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((item) => item !== id)
        : [...current.memberIds, id],
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("正在保存项目分派...");
    try {
      await api("/api/project-assignments", {
        method: "POST",
        body: JSON.stringify({
          projectId: selected.id,
          pmId: form.pmId,
          salesId: form.salesId,
          memberIds: form.memberIds,
          department: form.department,
        }),
      });
      setFocusedProjectId(selected.id);
      await onReload();
      setMessage(`项目分派已保存并刷新：PM ${assignmentPreview.pm}，销售 ${assignmentPreview.sales}，执行 ${assignmentPreview.memberNames.length} 人。员工端现在会按这里看到自己的项目。`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  function applySuggestion() {
    if (!suggestions?.recommended) return;
    const recommendedMemberIds = suggestions.recommended.memberIds || [];
    const pmName = activeMemberById.get(suggestions.recommended.pmId)?.name || "待分派";
    const salesName = activeMemberById.get(suggestions.recommended.salesId)?.name || "待确认";
    setForm((current) => ({
      ...current,
      pmId: suggestions.recommended.pmId || current.pmId,
      salesId: suggestions.recommended.salesId || current.salesId,
      memberIds: Array.from(new Set([...recommendedMemberIds])),
    }));
    setMessage(`已套用 AI 分派建议：PM ${pmName}，销售 ${salesName}，执行 ${recommendedMemberIds.length} 人。确认无误后保存。`);
  }

  async function exportAssignmentLedger() {
    if (!assignments.length) {
      setMessage("当前没有可导出的项目分派，请先上传合同创建项目。");
      return;
    }
    setExportingAssignments(true);
    try {
      downloadCsv(`项目分派表-${new Date().toISOString().slice(0, 10)}.csv`, assignmentLedgerRows(assignments));
      setMessage(`项目分派表 CSV 已导出：${assignments.length} 个项目。`);
    } catch (error) {
      setMessage(error.message || "项目分派表导出失败，请稍后再试。");
    } finally {
      setExportingAssignments(false);
    }
  }

  if (!assignments.length) {
    return (
      <section className="empty-project-state">
        <div>
          <PanelTitle icon={UserCog} title="项目分派" />
          <h2>还没有可分派的项目</h2>
          <p>先上传合同或报价表创建项目，再回来把 PM、销售和执行成员分配进去。</p>
          <div className="button-row compact assignment-empty-actions">
            <button type="button" className="primary" onClick={onCreateProject}><UploadCloud size={16} />上传合同创建项目</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="assignment-layout">
      <div className="member-table assignment-list">
        <div className="section-head">
          <h2>项目列表</h2>
          <div className="button-row compact">
            <span>{assignments.length} 个</span>
            <button type="button" className="ghost tiny" disabled={exportingAssignments} onClick={exportAssignmentLedger}><FileSpreadsheet size={14} />{exportingAssignments ? "导出中" : "导出分派表"}</button>
          </div>
        </div>
        {assignments.map((project) => (
          <button
            type="button"
            className={`project-row ${project.id === selected?.id ? "selected" : ""} ${focusedProjectId === project.id ? "fresh" : ""}`}
            key={project.id}
            onClick={() => setSelectedProjectId(project.id)}
          >
            <div>
              <strong>{project.name}</strong>
              <span>{project.client || "未填写客户"} · {project.status || "未设置状态"}</span>
            </div>
            <div className="row-right">
              <span>{project.pm || "待分派 PM"}</span>
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
      </div>

      <form className="member-form assignment-form" onSubmit={save}>
        <div className="section-head">
          <h2>{selected?.name}</h2>
          <span>{selected?.client || "未填写客户"}</span>
        </div>
        <div className="assignment-suggestion">
          <div className="section-head">
            <h3>AI 分派建议</h3>
            <div className="button-row compact">
              <button type="button" className="ghost tiny" onClick={() => loadSuggestions(selected?.id)} disabled={suggesting || !selected}>{suggesting ? "刷新中" : "刷新建议"}</button>
              <button type="button" className="ghost tiny" onClick={applySuggestion} disabled={suggesting || !suggestions?.recommended}>{suggesting ? "分析中" : "一键套用推荐"}</button>
            </div>
          </div>
          {suggestions ? (
            <div className="suggestion-grid">
              <SuggestionColumn title="推荐 PM" items={suggestions.pmCandidates} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} />
              <SuggestionColumn title="推荐销售" items={suggestions.salesCandidates} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} />
              <SuggestionColumn title="推荐执行" items={suggestions.memberCandidates?.slice(0, 3)} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} />
            </div>
          ) : <div className="empty-state action-empty assignment-suggestion-empty">
            <strong>{suggesting ? "正在生成分派建议" : "暂无推荐数据"}</strong>
            <span>{suggesting ? "系统正在根据项目部门、人员角色和负载匹配 PM、销售和执行成员。" : "可以刷新建议；如果候选为空，先同步飞书通讯录或去成员管理补角色、部门和飞书 ID。"}</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => loadSuggestions(selected?.id)} disabled={suggesting || !selected}>{suggesting ? "刷新中" : "刷新建议"}</button>
              {onSyncFeishuContacts && <button type="button" className="ghost tiny" onClick={onSyncFeishuContacts} disabled={syncingFeishuContacts}>{syncingFeishuContacts ? "同步中" : "同步飞书通讯录"}</button>}
              {onOpenMembers && <button type="button" className="ghost tiny" onClick={onOpenMembers}>打开成员管理</button>}
            </div>
          </div>}
        </div>
        <label>
          <span>项目部门</span>
          <input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="例如 项目部 / 内容部" />
        </label>
        <label>
          <span>PM</span>
          <select value={form.pmId} onChange={(event) => setForm({ ...form, pmId: event.target.value })}>
            <option value="">待分派</option>
            {activeMembers.filter((member) => ["pm", "director", "admin"].includes(member.role)).map((member) => (
              <option value={member.id} key={member.id}>{member.name} · {roleLabel(member.role)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>销售</span>
          <select value={form.salesId} onChange={(event) => setForm({ ...form, salesId: event.target.value })}>
            <option value="">待确认</option>
            {activeMembers.filter((member) => ["sales", "director", "admin"].includes(member.role)).map((member) => (
              <option value={member.id} key={member.id}>{member.name} · {roleLabel(member.role)}</option>
            ))}
          </select>
        </label>
        <div className="assignment-members">
          <span>执行成员</span>
          <div>
            {activeMembers.filter((member) => !["shareholder", "viewer"].includes(member.role)).map((member) => (
              <label className="member-check" key={member.id}>
                <input
                  type="checkbox"
                  checked={form.memberIds.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                />
                <strong>{member.name}</strong>
                <small>{roleLabel(member.role)} · {member.department || "未分组"}</small>
              </label>
            ))}
          </div>
        </div>
        <div className="assignment-preview">
          <strong>本次将保存</strong>
          <span>PM {assignmentPreview.pm} · 销售 {assignmentPreview.sales} · 执行 {assignmentPreview.memberNames.length ? assignmentPreview.memberNames.join("、") : "待选择"}</span>
        </div>
        {message && <p className="form-message">{message}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存项目分派"}</button>
      </form>
    </section>
  );
}

function SuggestionColumn({ title, items = [], onRefresh, onOpenMembers }) {
  return (
    <div className="suggestion-column">
      <strong>{title}</strong>
      {items.length ? items.map((item) => (
        <div key={item.id}>
          <span>{item.name} · {item.roleLabel}</span>
          <em>{item.reason} · 评分 {item.score}</em>
        </div>
      )) : <div className="suggestion-empty-candidate">
        <em>暂无候选</em>
        <span>先补成员角色、部门或飞书身份，再刷新建议。</span>
        <div className="button-row compact">
          {onRefresh && <button type="button" className="ghost tiny" onClick={onRefresh}>刷新</button>}
          {onOpenMembers && <button type="button" className="ghost tiny" onClick={onOpenMembers}>成员</button>}
        </div>
      </div>}
    </div>
  );
}

function FeishuBotPanel({ api, settings = {}, projects = [], members = [], bindings = [], events = [], pendingFiles = [], notifications = [], onReload }) {
  const [form, setForm] = useState({
    projectId: projects[0]?.id || "",
    chatId: "",
    chatName: ""
  });
  const [message, setMessage] = useState("");
  const [operationLogs, setOperationLogs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [handlingId, setHandlingId] = useState("");
  const [exportingPendingFiles, setExportingPendingFiles] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sampleText, setSampleText] = useState("这是项目群测试消息，帮我记录到项目动态里");
  const [focusedBindingId, setFocusedBindingId] = useState("");
  const [focusedEventId, setFocusedEventId] = useState("");
  const [focusedPendingId, setFocusedPendingId] = useState("");
  const latestDownload = events.find((item) => /download|下载|解析|引用/.test(`${item.action || ""} ${item.status || ""} ${item.reply || ""}`));
  const feishuNotices = notifications.filter((item) => item.type === "feishu-pending-file" && item.status === "待处理");
  const feishuNoticeReady = notifications.filter((item) => item.status === "待处理" && item.recipients?.length);
  const pendingQueueRef = useRef(null);
  const bindingFormRef = useRef(null);
  const eventListRef = useRef(null);
  const activeMembers = members.filter((item) => item.status !== "disabled");
  const boundMembers = activeMembers.filter((item) => item.feishuOpenId || item.feishuUserId);
  const missingFeishuMembers = activeMembers.filter((item) => !item.feishuOpenId && !item.feishuUserId);
  const pendingCount = pendingFiles.filter((item) => item.status === "待确认").length;
  const handledFileCount = pendingFiles.filter((item) => item.status && item.status !== "待确认").length;
  const latestEvent = events[0];
  const latestSyncAt = settings.lastContactSyncAt || "";
  const latestSync = settings.lastContactSyncResult || null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const callbackPath = "/api/integrations/feishu/events";
  const callbackUrl = settings.eventUrl || (origin ? `${origin}${callbackPath}` : callbackPath);
  const setupChecks = [
    { label: "App ID", ok: Boolean(settings.appId), text: settings.appId ? "已填写" : "待填写", action: "后台上方填写并保存" },
    { label: "App Secret", ok: Boolean(settings.appSecret), text: settings.appSecret ? "已填写" : "待填写", action: "后台上方填写并保存" },
    { label: "Verification Token", ok: Boolean(settings.verificationToken), text: settings.verificationToken ? "已填写" : "建议填写", action: "飞书事件订阅页复制过来" },
    { label: "事件订阅 URL", ok: Boolean(settings.eventUrl || origin), text: callbackUrl, action: "复制到飞书开放平台" },
    { label: "项目群绑定", ok: bindings.length > 0, text: `${bindings.length} 个群`, action: "把 Chat ID 绑定到 OA 项目" },
    { label: "成员飞书身份", ok: boundMembers.length > 0 && missingFeishuMembers.length === 0, text: `${boundMembers.length}/${activeMembers.length || 0} 已绑定`, action: "同步通讯录或手动填写 Open ID" },
    { label: "机器人事件", ok: events.length > 0, text: latestEvent ? `${latestEvent.status || latestEvent.action || "已接收"} · ${latestEvent.chatName || latestEvent.projectName || latestEvent.chatId || "最近事件"}` : "暂无事件", action: "自测消息入库或在群里 @机器人" },
    { label: "待确认队列", ok: pendingCount === 0, text: pendingCount ? `${pendingCount} 个待处理` : `${handledFileCount} 个已处理记录`, action: "确认或驳回飞书文件" },
    { label: "飞书私聊通知", ok: Boolean(settings.mockSend === true || settings.mockSend === "true" || settings.appId && settings.appSecret && boundMembers.length > 0), text: settings.mockSend === true || settings.mockSend === "true" ? "模拟发送开启" : `${feishuNoticeReady.length} 条可提醒`, action: "给待办负责人发送飞书" },
    { label: "通讯录同步", ok: Boolean(latestSyncAt), text: latestSyncAt ? `${new Date(latestSyncAt).toLocaleString("zh-CN", { hour12: false })}` : "未同步", action: "点击同步飞书通讯录" }
  ];
  const readyCount = setupChecks.filter((item) => item.ok).length;
  const nextSetupAction = setupChecks.find((item) => !item.ok);

  useEffect(() => {
    if (!form.projectId && projects[0]?.id) setForm((current) => ({ ...current, projectId: projects[0].id }));
  }, [projects[0]?.id, form.projectId]);

  function pushOperation(text, tone = "ok") {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      tone,
      at: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };
    setOperationLogs((current) => [item, ...current].slice(0, 5));
    setMessage(text);
  }

  async function save(event) {
    event.preventDefault();
    if (!form.chatId.trim()) {
      pushOperation("请填写飞书群 Chat ID", "warn");
      return;
    }
    if (!form.projectId) {
      pushOperation("请先选择要绑定的项目", "warn");
      return;
    }
    setSaving(true);
    setMessage("正在保存飞书群绑定...");
    try {
      const savedBinding = await api("/api/integrations/feishu/bindings", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setFocusedBindingId(savedBinding.id || savedBinding.chatId || form.chatId);
      setForm((current) => ({ ...current, chatId: "", chatName: "" }));
      await onReload();
      pushOperation(`飞书群绑定已保存并刷新：${savedBinding.chatName || form.chatName || form.chatId} -> ${savedBinding.projectName || projects.find((project) => project.id === form.projectId)?.name || "已选项目"}。`);
    } catch (error) {
      pushOperation(error.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  async function handlePendingFile(item, action) {
    setHandlingId(item.id);
    setMessage(action === "reject" ? "正在驳回飞书文件..." : "正在确认入库飞书文件...");
    try {
      const handled = await api("/api/integrations/feishu/pending-files/action", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      const leftCount = Math.max(pendingFiles.filter((file) => file.status === "待确认").length - 1, 0);
      setFocusedPendingId(handled.id || item.id);
      await onReload();
      pushOperation(`${action === "reject" ? "飞书文件已驳回，队列已刷新" : "飞书文件已确认入库，项目数据和队列已刷新"}，当前还剩 ${leftCount} 个待确认文件。`);
    } catch (error) {
      pushOperation(error.message, "danger");
    } finally {
      setHandlingId("");
    }
  }

  async function exportPendingFiles() {
    if (!pendingFiles.length) {
      pushOperation("当前没有可导出的飞书文件队列。", "warn");
      return;
    }
    setExportingPendingFiles(true);
    try {
      downloadCsv("飞书文件入库队列.csv", feishuPendingLedgerRows(pendingFiles));
      pushOperation(`飞书文件入库队列 CSV 已导出：${pendingFiles.length} 条。`);
    } finally {
      setExportingPendingFiles(false);
    }
  }

  async function copyCallbackUrl() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      pushOperation("事件订阅 URL 已复制，可以粘贴到飞书开放平台。");
    } catch {
      pushOperation(`请复制这个地址：${callbackUrl}`, "warn");
    }
  }

  async function testCallback() {
    setTesting(true);
    setMessage("正在自测 OA 飞书事件地址...");
    try {
      const res = await fetch(callbackPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge: "ad-project-hub-feishu-check", token: settings.verificationToken || undefined })
      });
      const payload = await res.json();
      if (payload.challenge !== "ad-project-hub-feishu-check") throw new Error(payload.error || "事件地址没有返回飞书需要的 challenge");
      pushOperation("OA 事件地址自测通过。下一步去飞书开放平台保存事件订阅。");
    } catch (error) {
      pushOperation(error.message || "事件地址自测失败", "danger");
    } finally {
      setTesting(false);
    }
  }

  async function testMessageIntake() {
    const chatId = form.chatId.trim() || bindings[0]?.chatId || "";
    if (!chatId) {
      pushOperation("请先填写或保存一个飞书群 Chat ID，再测试消息入库。", "warn");
      return;
    }
    setTesting(true);
    setMessage("正在模拟飞书群消息...");
    try {
      const res = await fetch(callbackPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: settings.verificationToken || undefined,
          event: {
            message: {
              chat_id: chatId,
              chat_name: form.chatName || bindings.find((item) => item.chatId === chatId)?.chatName || "OA 测试群",
              message_type: "text",
              content: JSON.stringify({ text: sampleText })
            },
            sender: {
              sender_name: "OA 接入测试",
              sender_id: { open_id: "oa-feishu-setup-test" }
            }
          }
        })
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "模拟消息没有成功进入 OA");
      setFocusedEventId(payload.data?.event?.id || "");
      await onReload();
      pushOperation(payload.data?.reply ? `模拟飞书消息已入库，事件列表已刷新：${payload.data.reply}` : "模拟飞书消息已入库，事件列表已刷新。");
    } catch (error) {
      pushOperation(error.message || "模拟飞书消息失败", "danger");
    } finally {
      setTesting(false);
    }
  }

  function prepareFirstBinding() {
    const target = projects[0];
    if (!target) {
      pushOperation("当前还没有项目，请先上传合同创建项目，再绑定飞书项目群。", "warn");
      return;
    }
    setForm((current) => ({
      ...current,
      projectId: current.projectId || target.id,
      chatName: current.chatName || `${target.name}项目群`
    }));
    pushOperation(`已预选「${target.name}」，请补飞书群 Chat ID 后保存绑定。`, "warn");
  }

  function scrollToFeishuArea(ref, messageText) {
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (messageText) pushOperation(messageText, "warn");
  }

  async function handleSetupCheckAction(item) {
    if (!item) return;
    if (["App ID", "App Secret", "Verification Token"].includes(item.label)) {
      pushOperation("请在上方飞书配置表单补齐对应字段，然后点击保存飞书配置。", "warn");
      return;
    }
    if (item.label === "事件订阅 URL") {
      await copyCallbackUrl();
      return;
    }
    if (item.label === "项目群绑定") {
      prepareFirstBinding();
      scrollToFeishuArea(bindingFormRef, "已定位到群绑定表单，请补 Chat ID 后保存。");
      return;
    }
    if (item.label === "成员飞书身份" || item.label === "通讯录同步") {
      pushOperation("请点击上方「同步飞书通讯录」；如果没有权限，可在成员管理里手动填写 Open ID。", "warn");
      return;
    }
    if (item.label === "机器人事件") {
      if (bindings.length) await testMessageIntake();
      else await testCallback();
      scrollToFeishuArea(eventListRef, "已定位到最近机器人事件列表。");
      return;
    }
    if (item.label === "待确认队列") {
      scrollToFeishuArea(pendingQueueRef, "已定位到待确认文件队列，可以确认入库或驳回。");
      return;
    }
    if (item.label === "飞书私聊通知") {
      pushOperation("飞书私聊通知从顶部「待办」里发送；如果没有收件人，请先补成员飞书 Open ID。", "warn");
    }
  }

  return (
    <div className="settings-block feishu-bot-panel">
      <div className="feishu-setup-head">
        <div>
          <h3>飞书机器人接入向导</h3>
          <p>把飞书项目群、合同/报价/成本/核销文件，接进 OA 的待确认入库流程。</p>
        </div>
        <span>{readyCount}/{setupChecks.length} 已就绪</span>
      </div>
      <div className="feishu-status-grid">
        {setupChecks.map((item) => (
          <div className={item.ok ? "ok" : "warn"} key={item.label}>
            {item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <strong>{item.label}</strong>
            <span>{item.text}</span>
            {!item.ok && <em>{item.action}</em>}
            {!item.ok && <button type="button" className="ghost tiny" onClick={() => handleSetupCheckAction(item)}>去处理</button>}
          </div>
        ))}
      </div>
      <div className={`feishu-health-card ${nextSetupAction ? "warn" : "ok"}`}>
        <div>
          {nextSetupAction ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{nextSetupAction ? `下一步：${nextSetupAction.action}` : "飞书接入清单已完成"}</strong>
        </div>
        <span>
          {nextSetupAction
            ? `当前卡在「${nextSetupAction.label}」。补完后再点自测事件地址 / 测试消息入库，就能判断链路是否通。`
            : "现在可以从飞书群收消息和文件，文件会先进入待确认队列，确认后才写入 OA 项目。"}
        </span>
      </div>
      <div className="feishu-ops-strip">
        <div><strong>{activeMembers.length}</strong><span>启用成员</span></div>
        <div><strong>{missingFeishuMembers.length}</strong><span>缺飞书 ID</span></div>
        <div><strong>{bindings.length}</strong><span>项目群</span></div>
        <div><strong>{events.length}</strong><span>机器人事件</span></div>
        <div><strong>{pendingCount}</strong><span>待确认文件</span></div>
        <div><strong>{notifications.length}</strong><span>系统待办</span></div>
      </div>
      {latestSync && <div className="feishu-download-state">
        <strong>最近通讯录同步</strong>
        <span>新增 {latestSync.created || 0} 人，更新 {latestSync.updated || 0} 人，跳过 {latestSync.skipped || 0} 人。同步后成员的飞书 Open ID 会用于机器人私聊通知。</span>
      </div>}
      {missingFeishuMembers.length > 0 && <div className="feishu-mini-list feishu-missing-list">
        <strong>还缺飞书身份的成员</strong>
        {missingFeishuMembers.slice(0, 6).map((member) => (
          <div key={member.id}>
            <span>{member.name}</span>
            <em>{member.email} · {member.department || "未分组"} · 缺 Open ID / User ID</em>
          </div>
        ))}
        {missingFeishuMembers.length > 6 && <p>还有 {missingFeishuMembers.length - 6} 人未展示，建议先同步飞书通讯录。</p>}
      </div>}
      <div className="feishu-guide">
        <div>
          <strong>1. 飞书开放平台创建企业自建应用</strong>
          <span>复制 App ID、App Secret、Verification Token，填到上面的飞书配置并保存。</span>
        </div>
        <div>
          <strong>2. 配置事件订阅地址</strong>
          <span>{callbackUrl}</span>
          <button type="button" className="ghost" onClick={copyCallbackUrl}>复制 URL</button>
        </div>
        <div>
          <strong>3. 开启消息与文件权限</strong>
          <span>给机器人开通读取群消息、读取消息资源文件、接收群消息/被 @ 消息事件，以及发送单聊消息权限，然后把机器人拉进项目群。</span>
        </div>
        <div>
          <strong>4. 绑定项目群并测试</strong>
          <span>在下方把 Chat ID 绑定到 OA 项目，并在成员管理里填写成员飞书 Open ID。群里 @机器人发文件会进待确认，待办也可以私聊提醒负责人。</span>
        </div>
      </div>
      <div className="button-row">
        <button type="button" className="ghost" onClick={testCallback} disabled={testing}>{testing ? "自测中" : "自测事件地址"}</button>
      </div>

      <h3>飞书项目群绑定</h3>
      <form className="feishu-bind-form" onSubmit={save} ref={bindingFormRef}>
        <label>
          <span>项目</span>
          <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>群 Chat ID</span>
          <input value={form.chatId} onChange={(event) => setForm({ ...form, chatId: event.target.value })} placeholder="飞书群聊 chat_id" />
        </label>
        <label>
          <span>群名称</span>
          <input value={form.chatName} onChange={(event) => setForm({ ...form, chatName: event.target.value })} placeholder="例如 捷途汽车项目群" />
        </label>
        <button type="submit" className="ghost" disabled={saving}>{saving ? "保存中" : "保存群绑定"}</button>
      </form>
      <div className="feishu-intake-test">
        <label>
          <span>模拟群消息</span>
          <textarea value={sampleText} onChange={(event) => setSampleText(event.target.value)} rows={2} />
        </label>
        <button type="button" className="ghost" onClick={testMessageIntake} disabled={testing}>{testing ? "测试中" : "测试消息入库"}</button>
      </div>
      {message && <p className="form-message">{message}</p>}
      {operationLogs.length > 0 && <div className="feishu-operation-log">
        <strong>最近操作</strong>
        {operationLogs.map((item) => (
          <div className={item.tone} key={item.id}>
            <span>{item.text}</span>
            <em>{item.at}</em>
          </div>
        ))}
      </div>}
      <div className="feishu-download-state">
        <strong>文件下载与解析</strong>
        <span>{latestDownload ? `${latestDownload.status || latestDownload.action}：${latestDownload.reply || "已接收飞书文件事件"}` : "配置 App ID / App Secret 后，机器人会尝试用 message_id + file_key 下载文件；下载成功后先进入待确认队列，人工确认后才写入项目。"}</span>
      </div>
      <div className="feishu-download-state">
        <strong>自动提醒</strong>
        <span>{feishuNotices.length ? `系统已生成 ${feishuNotices.length} 条飞书待办，会出现在顶部「待办」里。超过 24 小时未处理会升为高优先级。` : "暂无飞书待办。待确认文件出现后，系统会自动生成 PM/管理层提醒。"}</span>
      </div>
      <div className="feishu-mini-list feishu-pending-list" ref={pendingQueueRef}>
        <div className="section-head">
          <strong>待确认文件</strong>
          <button type="button" className="ghost tiny" disabled={exportingPendingFiles} onClick={exportPendingFiles}><FileSpreadsheet size={14} />{exportingPendingFiles ? "导出中" : "导出队列"}</button>
        </div>
        {pendingFiles.length ? pendingFiles.slice(0, 6).map((item) => (
          <div className={focusedPendingId === item.id ? "fresh" : ""} key={item.id}>
            <span>{item.file?.name || item.preview?.fileName || "飞书文件"} · {item.status}</span>
            <em>{item.projectName || "待匹配项目"} · {item.uploadType || "file"} · {item.preview?.summary || item.note || "等待确认"}</em>
            {item.status === "待确认" && <div className="feishu-pending-actions">
              <button type="button" className="primary" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "confirm")}>
                {handlingId === item.id ? "处理中" : "确认入库"}
              </button>
              <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "reject")}>{handlingId === item.id ? "处理中" : "驳回"}</button>
            </div>}
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无待确认文件</span>
            <em>飞书群发来的成本/报价/核销文件下载成功后会先出现在这里，确认后才写入项目。</em>
            <button type="button" className="ghost tiny" onClick={testMessageIntake} disabled={testing}>{testing ? "测试中" : "测试消息入库"}</button>
          </div>
        )}
      </div>
      <div className="feishu-mini-list" ref={eventListRef}>
        <strong>已绑定群</strong>
        {bindings.length ? bindings.slice(0, 5).map((item) => (
          <div className={focusedBindingId === (item.id || item.chatId) ? "fresh" : ""} key={item.chatId}>
            <span>{item.chatName || item.chatId}</span>
            <em>{item.projectName}</em>
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无绑定</span>
            <em>先把飞书项目群 Chat ID 绑定到 OA 项目，群里 @机器人发文件才知道归到哪个项目。</em>
            <button type="button" className="ghost tiny" onClick={prepareFirstBinding}>预填第一个项目</button>
          </div>
        )}
      </div>
      <div className="feishu-mini-list">
        <strong>最近机器人事件</strong>
        {events.length ? events.slice(0, 5).map((item) => (
          <div className={focusedEventId === item.id ? "fresh" : ""} key={item.id}>
            <span>{item.status || item.action}</span>
            <em>{item.projectName || item.chatName || item.chatId || "待匹配项目"} · {item.reply || item.text || item.fileName || "无内容"}</em>
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无事件</span>
            <em>配置飞书事件订阅后，飞书消息会显示在这里；也可以先自测 OA 事件地址。</em>
            <button type="button" className="ghost tiny" onClick={testCallback} disabled={testing}>{testing ? "自测中" : "自测事件地址"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AppShell() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  });
  const [view, setView] = useState("app");

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setView("app");
  }

  if (!session) return <LoginScreen onLogin={setSession} />;
  const adminRouteMap = {
    admin: "members",
    "admin:ai": "ai",
    "admin:product": "product",
    "admin:assignments": "assignments"
  };
  const isAdmin = ["shareholder", "admin"].includes(session.role);
  const canManageAssignments = ["shareholder", "admin", "director"].includes(session.role);
  const adminVisible = Boolean(adminRouteMap[view] && (isAdmin || (view === "admin:assignments" && canManageAssignments)));
  return <>
    <div className={adminVisible ? "app-route-preserved hidden" : "app-route-preserved"}>
      <ProjectDashboard session={session} view={view} setView={setView} onLogout={logout} />
    </div>
    {adminVisible && <AdminMembers session={session} setView={setView} onLogout={logout} initialTab={adminRouteMap[view]} />}
  </>;
}

createRoot(document.getElementById("root")).render(<AppShell />);
