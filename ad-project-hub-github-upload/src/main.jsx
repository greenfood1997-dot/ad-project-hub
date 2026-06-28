import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
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

const SESSION_KEY = "ad-project-hub-session";
const BUILD_VERSION = "2026-06-27-upload-progress-prestart-health";
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

function money(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100000) {
    return `${Number((number / 10000).toFixed(2)).toLocaleString("zh-CN")}万`;
  }
  return number.toLocaleString("zh-CN");
}

function fileSize(value) {
  const number = Number(value || 0);
  if (number >= 1024 * 1024) return `${Number((number / 1024 / 1024).toFixed(1))} MB`;
  if (number >= 1024) return `${Number((number / 1024).toFixed(1))} KB`;
  return `${number} B`;
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
    updatedAt: task?.updatedAt || ""
  };
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

async function apiRequest(path, session, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-user-id": session.id,
      ...(options.headers || {}),
    },
  });
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error || "请求失败");
  return payload.data;
}

async function downloadFile(path, session, filename) {
  const res = await fetch(path, {
    headers: {
      "x-user-id": session.id,
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
      return { ...project, costRate, receivableProjectRate, projectMargin, score };
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
  return data;
}

function useChart(option) {
  return (node) => {
    if (!node) return;
    const chart = echarts.init(node);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
  };
}

function ProjectDashboard({ session, view, setView, onLogout }) {
  const [state, setState] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [activeSubView, setActiveSubView] = useState("项目大盘");
  const [openNav, setOpenNav] = useState({ dashboard: true });
  const [selectedId, setSelectedId] = useState("");
  const [projectFocus, setProjectFocus] = useState("");
  const [role, setRole] = useState("全部角色");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMinimized, setUploadMinimized] = useState(false);
  const [uploadInitialType, setUploadInitialType] = useState("create-project");
  const [filterOpen, setFilterOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [handlingNotificationId, setHandlingNotificationId] = useState("");
  const [notice, setNotice] = useState("");
  const [searchText, setSearchText] = useState("");
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
    if (!query) return projects;
    return projects.filter((project) => [project.name, project.client, project.owner, project.pm, project.sales, project.status]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [projects, searchText]);
  const selected = visibleProjects.find((project) => project.id === selectedId) || visibleProjects[0] || projects[0] || null;
  const systemNotifications = (state?.systemNotifications || []).filter((item) => item.status === "待处理");

  function loadState() {
    return fetch("/api/state", { headers: { "x-user-id": session.id } })
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
    fetch("/api/health")
      .then((res) => res.json())
      .then((payload) => setHealth(payload?.data || null))
      .catch(() => setHealth({ version: "无法读取", uploadProgress: false, prestartBuild: false }));
  }, []);

  function openUpload(type = "create-project") {
    setUploadInitialType(type);
    setUploadOpen(true);
    setUploadMinimized(false);
  }

  async function handleNotification(item, action = "resolve") {
    setHandlingNotificationId(item.id);
    try {
      await apiRequest("/api/notifications/action", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      const leftCount = Math.max(systemNotifications.length - 1, 0);
      setNotice(`${action === "ignore" ? "通知已忽略" : "通知已标记处理"}，当前还剩 ${leftCount} 条待办。`);
      await loadState();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setHandlingNotificationId("");
    }
  }

  async function sendNotificationToFeishu(item) {
    try {
      const data = await apiRequest("/api/notifications/feishu/send", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id })
      });
      const okCount = (data.results || []).filter((row) => row.ok).length;
      setNotice(`飞书通知已发送：${okCount}/${(data.results || []).length} 人。`);
      await loadState();
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function runSystemScan() {
    setScanning(true);
    try {
      const data = await apiRequest("/api/system/scan", session, { method: "POST", body: JSON.stringify({}) });
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
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "approvals") {
      setActiveView("approvals");
      setActiveSubView("待我审批");
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "management:cash" && isManagement) {
      setActiveView("management");
      setActiveSubView("现金流压力");
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "project-files") {
      setActiveView("dashboard");
      setActiveSubView("我的项目");
      setProjectFocus("files");
      setNotificationsOpen(false);
      return;
    }
    if (item.actionView === "project-detail") {
      setActiveView("dashboard");
      setActiveSubView("我的项目");
      setProjectFocus(item.type === "project-receivable-risk" ? "payments" : "progress");
      setNotificationsOpen(false);
      return;
    }
    setActiveView("dashboard");
    setActiveSubView("我的项目");
    setProjectFocus("");
    setNotificationsOpen(false);
  }

  const stats = useMemo(() => {
    const contract = visibleProjects.reduce((sum, item) => sum + item.contract, 0);
    const used = visibleProjects.reduce((sum, item) => sum + item.costUsed, 0);
    const paid = visibleProjects.reduce((sum, item) => sum + item.paid, 0);
    const receivable = visibleProjects.reduce((sum, item) => sum + item.receivable, 0);
    return { contract, used, paid, receivable };
  }, [visibleProjects]);

  const progressRef = useChart({
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
  });

  const cashRef = useChart({
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
  });

  const costRef = useChart({
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
  });

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
            onClick={() => setNotice(health?.version === BUILD_VERSION
              ? `当前线上版本正确：${BUILD_VERSION}`
              : `当前线上版本可能不是最新。页面版本：${BUILD_VERSION}，服务端版本：${health?.version || "未读取"}。请重新部署或清理旧 dist。`)}
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
            <button type="button" className={`ghost notification-trigger ${systemNotifications.length ? "has-items" : ""}`} onClick={() => setNotificationsOpen(true)}>
              <BellRing size={16} />待办
              {systemNotifications.length > 0 && <b>{systemNotifications.length}</b>}
            </button>
            {isAdmin && <button type="button" className="ghost" onClick={() => setView("admin")}><UserCog size={16} />成员管理</button>}
            {isAdmin && <button type="button" className={aiConfigured ? "ghost" : "ghost warning"} onClick={() => setView("admin:ai")}><Bot size={16} />{aiConfigured ? "AI 已接入" : "接入 AI"}</button>}
            {canCreateProject && <button type="button" className="primary" onClick={() => openUpload("create-project")}><Plus size={16} />新建项目</button>}
          </div>
        </header>
        {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>知道了</button></div>}
        {notificationsOpen && <NotificationDrawer
          items={systemNotifications}
          onClose={() => setNotificationsOpen(false)}
          onOpenTarget={openNotificationTarget}
          onAction={handleNotification}
          onSendFeishu={sendNotificationToFeishu}
          handlingId={handlingNotificationId}
          onScan={runSystemScan}
          canScan={isManagement}
          scanning={scanning}
        />}
        {filterOpen && <div className="filter-panel">
          <button type="button" className={role === "全部角色" ? "active" : ""} onClick={() => setRole("全部角色")}>全部提醒</button>
          {["PM", "销售", "管理层"].map((item) => (
            <button type="button" className={role === item ? "active" : ""} key={item} onClick={() => setRole(item)}>{item}</button>
          ))}
        </div>}

        {!projects.length && activeView !== "management" && (
          <EmptyProjectState
            isManagement={isManagement}
            canCreateProject={canCreateProject}
            onUpload={() => openUpload("create-project")}
            onAdmin={() => setView("admin")}
            isAdmin={isAdmin}
          />
        )}

        {!!projects.length && !visibleProjects.length && (
          <section className="empty-project-state">
            <div>
              <PanelTitle icon={Search} title="没有匹配的项目" />
              <h2>当前搜索没有结果。</h2>
              <p>换一个项目名、客户名、负责人或 PM 试试。</p>
              <button type="button" className="ghost" onClick={() => setSearchText("")}>清空搜索</button>
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
          onUpload={() => openUpload(selected ? "cost-sheet" : "create-project")}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "approvals" && <ApprovalFunds
          projects={visibleProjects}
          approvals={state?.approvals || []}
          selected={selected}
          session={session}
          subView={activeSubView}
          setSubView={setActiveSubView}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "closeout" && <CloseoutReview project={selected} isManagement={isManagement} subView={activeSubView} />}
        {!!visibleProjects.length && activeView === "suppliers" && <SupplierLibrary
          suppliers={state?.supplierProfiles || []}
          session={session}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "clients" && <ClientLibrary
          clients={state?.clientProfiles || []}
          session={session}
          onDone={() => loadState()}
          onNotice={setNotice}
        />}
        {!!visibleProjects.length && activeView === "collections" && <CollectionAssistant
          projects={visibleProjects}
          scripts={state?.collectionScripts || []}
          session={session}
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
          onDone={() => loadState()}
          onNotice={setNotice}
        />}

        {!!visibleProjects.length && activeView === "dashboard" && activeSubView === "项目大盘" && (
          <section className="overview-layout">
            <div className="overview-center">
              {isManagement ? (
                <ProjectOverview
                  stats={stats}
                  cashRef={cashRef}
                  progressRef={progressRef}
                  costRef={costRef}
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
              onUpload={() => openUpload(selected ? "cost-sheet" : "create-project")}
              onDone={() => loadState()}
              onNotice={setNotice}
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
              auditLogs={state?.auditLogs || []}
              focusTarget={projectFocus}
              onFocusConsumed={() => setProjectFocus("")}
              onDone={() => loadState()}
              onNotice={setNotice}
            />
          </section>
        )}
        {uploadOpen && <UploadDialog
          session={session}
          projects={projects}
          selected={selected}
          initialType={uploadInitialType}
          minimized={uploadMinimized}
          onMinimize={() => setUploadMinimized(true)}
          onExpand={() => setUploadMinimized(false)}
          onClose={() => {
            setUploadOpen(false);
            setUploadMinimized(false);
          }}
          onDone={() => loadState()}
        />}
      </main>
    </div>
  );
}

function NotificationDrawer({ items = [], onClose, onOpenTarget, onAction, onSendFeishu, handlingId = "", onScan, canScan, scanning }) {
  const highCount = items.filter((item) => item.severity === "高").length;
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
        <div className="notification-list">
          {items.length ? items.map((item) => (
            <div className={`notification-card ${item.severity === "高" ? "high" : ""}`} key={item.id}>
              <div className="notification-title">
                <strong>{item.title}</strong>
                <span>{item.severity || "中"}</span>
              </div>
              <p>{item.text}</p>
              <em>{item.projectName || "系统"} · {item.source || "scanner"}</em>
              <div className="notification-actions">
                <button type="button" className="primary" onClick={() => onOpenTarget(item)}>{item.actionLabel || "查看"}</button>
                <button type="button" className="ghost" onClick={() => onSendFeishu(item)}>发送飞书</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "resolve")}>{handlingId === item.id ? "处理中" : "标记处理"}</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "ignore")}>{handlingId === item.id ? "处理中" : "忽略"}</button>
              </div>
              {item.feishuDelivery?.sentAt && <small className="notification-delivery">飞书已发送 · {new Date(item.feishuDelivery.sentAt).toLocaleString("zh-CN", { hour12: false })}</small>}
            </div>
          )) : (
            <div className="notification-empty">
              <CheckCircle2 size={22} />
              <strong>当前没有待办</strong>
              <span>项目分派、飞书文件、逾期审批出现时会自动进入这里。</span>
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

function ProjectOverview({ stats, cashRef, progressRef, costRef, role, setRole, visibleAlerts }) {
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
          <div className="chart" ref={cashRef}></div>
        </div>
        <div className="panel">
          <PanelTitle icon={LayoutDashboard} title="进度结构" />
          <div className="chart" ref={progressRef}></div>
        </div>
        <div className="panel">
          <PanelTitle icon={AlertTriangle} title="PM 成本压力" />
          <div className="chart" ref={costRef}></div>
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

function EmptyProjectState({ isManagement, isAdmin, canCreateProject, onUpload, onAdmin }) {
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

function EmployeeProjectOverview({ projects, selected, feishuPendingFiles = [], onSelect, onUpload }) {
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const health = projectHealth(selected);
  const tasks = (selected.tasks || []).map(normalizeTask);
  const pettyLeft = Math.max(Number(selected.pettyCashBudget || 0) - Number(selected.pettyCashUsed || 0), 0);
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
        <Metric icon={CircleDollarSign} label="备用金余额" value={money(pettyLeft)} sub={`已用 ${money(selected.pettyCashUsed)}`} />
        <Metric icon={FileText} label="当前项目数" value={`${activeProjects.length || projects.length} 个`} sub="仅展示你可见的项目" />
      </section>

      <section className="employee-grid">
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
              </div>
            ))}
            {!tasks.length && <p className="muted">暂无任务。PM 新增任务后会显示在这里。</p>}
          </div>
        </div>

        <div className="panel">
          <PanelTitle icon={ShieldAlert} title="材料与报销提醒" />
          <div className="compact-list">
            {displayMissing.map((item) => (
              <div key={item}>
                <strong>{item}</strong>
                <span>可直接从右侧 AI 输入，或点上传让 AI 识别后归档。</span>
              </div>
            ))}
          </div>
        </div>

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
      </section>
    </>
  );
}

function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice }) {
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
      { from: "assistant", title: "AI 项目助手", text: result.reply || "我已经处理完成。", pendingAction: result.pendingAction || null, query },
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
      onNotice("AI 已按你的确认提交审批。");
    } catch (error) {
      result = { reply: `确认失败：${error.message}` };
    }
    setMessages((items) => [
      ...items.map((item) => item === message ? { ...item, pendingAction: null } : item),
      { from: "assistant", title: "AI 项目助手", text: result.reply || "已确认处理。" },
    ].slice(-7));
    setSending(false);
  }

  return (
    <aside className="ai-activity-panel">
      <div className="ai-profile">
        <div className="ai-avatar">{session.name?.slice(0, 1) || "A"}</div>
        <div>
          <strong>{session.name}</strong>
          <span>{roleLabel(session.role)} · AI 项目伙伴</span>
        </div>
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
        <button type="button" onClick={onUpload}><UploadCloud size={14} />上传文件</button>
      </div>

      <div className="ai-feed">
        {messages.map((message, index) => (
          <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
            <span>{message.title}</span>
            <p>{message.text}</p>
            {message.pendingAction && <div className="ai-confirm-actions">
              <button type="button" className="primary" onClick={() => confirmPending(message)} disabled={sending}>确认提交</button>
              <button type="button" className="ghost" onClick={() => setMessages((items) => items.map((item) => item === message ? { ...item, pendingAction: null, text: `${item.text}\n已取消，未提交。` } : item))}>取消</button>
            </div>}
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

function ProjectDetail({ project, isManagement, session, files, parseJobs, approvals, suppliers = [], clients = [], payments = [], collectionScripts = [], feishuPendingFiles = [], comments, auditLogs, focusTarget = "", onFocusConsumed, onDone, onNotice }) {
  const usedRate = project.costBudget ? Math.round((project.costUsed / project.costBudget) * 100) : 0;
  const health = projectHealth(project);
  const pettyCashLeft = Math.max(Number(project.pettyCashBudget || 0) - Number(project.pettyCashUsed || 0), 0);
  const canEditProject = canWriteProjectRole(session);
  const canRecordPayment = ["shareholder", "admin", "director", "pm", "sales", "finance"].includes(session.role);
  const canUseCollection = canUseCollectionRole(session);
  const canHandleFeishuPending = canHandleFeishuPendingRole(session);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [form, setForm] = useState({});
  const [paymentForm, setPaymentForm] = useState({ amount: "", payer: "", method: "", note: "" });
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState(null);
  const [generatingCollection, setGeneratingCollection] = useState(false);
  const [handlingFeishuFile, setHandlingFeishuFile] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", owner: session.name || "", dueDate: "", progress: 0, note: "" });
  const [savingTask, setSavingTask] = useState(false);
  const [quickUploadType, setQuickUploadType] = useState("");
  const [localFocusTarget, setLocalFocusTarget] = useState("");
  const [approvalForm, setApprovalForm] = useState({ type: "reimbursement", amount: "", payee: "", reason: "" });
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const focusRefs = {
    progress: useRef(null),
    files: useRef(null),
    payments: useRef(null),
    approvals: useRef(null)
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
  const uniqueFiles = Array.from(new Map(projectFiles.map((file, index) => [`${file.name}-${file.uploadedAt || index}`, file])).values());
  const projectJobs = parseJobs.filter((job) => job.projectId === project.id || job.projectName === project.name);
  const projectApprovals = approvals.filter((item) => item.projectId === project.id || item.projectName === project.name || item.project === project.name);
  const projectSuppliers = suppliers.filter((item) => item.project === project.name || item.projectId === project.id);
  const clientProfile = clients.find((item) => item.client === project.client || item.client === project.brand);
  const projectPayments = payments.filter((item) => item.projectId === project.id || item.projectName === project.name || item.project === project.name);
  const projectCollectionScripts = collectionScripts.filter((item) => item.projectId === project.id || item.projectName === project.name);
  const projectFeishuPendingFiles = feishuPendingFiles.filter((item) => item.projectId === project.id || item.projectName === project.name);
  const projectFeishuHandledFiles = projectFeishuPendingFiles.filter((item) => item.status !== "待确认");
  const projectComments = comments.filter((item) => item.project === project.name);
  const projectLogs = auditLogs.filter((item) => item.target === project.name);
  const projectTasks = (project.tasks || []).map(normalizeTask);
  const costRows = (project.costs || []).map(normalizeCostRow).filter((row) => row.name);
  const materialStatus = projectMaterialStatus(project, uniqueFiles, projectJobs);
  const actionItems = projectActionItems({ project, files: uniqueFiles, jobs: projectJobs, approvals: projectApprovals, health, isManagement, feishuPending: projectFeishuPendingFiles });
  const aiAdvice = projectAiAdvice({ project, materialStatus, approvals: projectApprovals, health, isManagement, feishuPending: projectFeishuPendingFiles });
  const activityItems = [
    ...projectJobs.map((job) => ({ at: job.updatedAt || job.createdAt, title: "AI 解析", text: `${job.projectName} · ${job.status} · ${job.progress || 0}%` })),
    ...projectApprovals.map((item) => ({ at: item.updatedAt || item.createdAt, title: item.typeLabel || "审批", text: `${item.status} · ${money(item.amount)} · ${item.applicantName || ""}` })),
    ...projectSuppliers.map((item) => ({ at: item.paidAt || item.updatedAt || item.createdAt, title: "供应商结算", text: `${item.supplier || "供应商"} · ${item.status || "待结算"} · ${money(item.amount)}` })),
    ...projectPayments.map((item) => ({ at: item.receivedAt || item.createdAt, title: "项目回款", text: `${item.payer || project.client || "客户"} · ${money(item.amount)} · ${item.recordedByName || ""}` })),
    ...projectFeishuPendingFiles.map((item) => ({ at: item.handledAt || item.createdAt, title: item.status === "待确认" ? "飞书文件待确认" : "飞书文件已处理", text: `${item.status} · ${item.file?.name || item.preview?.fileName || "飞书文件"} · ${item.uploadType || "文件"}${item.handledBy ? ` · 处理人 ${item.handledBy}` : ""}` })),
    ...projectComments.map((item) => ({ at: item.at, title: "项目评论", text: `${item.user || ""}：${item.body || ""}` })),
    ...projectLogs.map((item) => ({ at: item.at, title: "系统记录", text: `${item.user || ""} · ${item.action || item.type || ""}` })),
    ...uniqueFiles.map((file) => ({ at: file.uploadedAt, title: "文件上传", text: `${file.name} · ${file.uploadedByName || file.uploadedBy || "未知"}` }))
  ].filter((item) => item.at || item.text).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 10);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
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
      onNotice("项目基础信息已保存");
      setEditing(false);
      onDone();
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
      onNotice("项目进展已记录");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setCommenting(false);
    }
  }

  function updatePaymentForm(field, value) {
    setPaymentForm((current) => ({ ...current, [field]: value }));
  }

  function updateTaskForm(field, value) {
    setTaskForm((current) => ({ ...current, [field]: value }));
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!Number(paymentForm.amount)) {
      onNotice("请填写回款金额");
      return;
    }
    setRecordingPayment(true);
    try {
      await apiRequest("/api/payments", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...paymentForm })
      });
      setPaymentForm({ amount: "", payer: "", method: "", note: "" });
      onNotice("回款已记录，项目已回款和待回款已更新");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setRecordingPayment(false);
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
      onNotice("催收话术已生成，并已保存到催收助手。");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setGeneratingCollection(false);
    }
  }

  async function markCollectionOutcome(record, success) {
    try {
      await apiRequest("/api/collections/outcome", session, {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          success,
          score: success ? 5 : 2,
          outcome: success ? "客户已回复/推进付款" : "暂未推进，需要调整话术或再次跟进"
        })
      });
      onNotice(success ? "已记录为有效话术" : "已记录为待优化话术");
      onDone();
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function handleFeishuPendingFile(item, action) {
    setHandlingFeishuFile(item.id);
    try {
      await apiRequest("/api/integrations/feishu/pending-files/action", session, {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      onNotice(action === "reject" ? "飞书文件已驳回，不会写入项目。" : "飞书文件已确认入库，项目数据已刷新。");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setHandlingFeishuFile("");
    }
  }

  async function saveTask(payload) {
    setSavingTask(true);
    try {
      await apiRequest("/api/project-tasks", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...payload })
      });
      setTaskForm({ title: "", owner: session.name || "", dueDate: "", progress: 0, note: "" });
      onNotice(payload.action === "complete" ? "任务已标记完成，项目进度已更新" : "任务已保存，项目进度已更新");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingTask(false);
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

  function updateApprovalForm(field, value) {
    setApprovalForm((current) => ({ ...current, [field]: value }));
  }

  async function submitProjectApproval(event) {
    event.preventDefault();
    if (!Number(approvalForm.amount)) {
      onNotice("请填写审批金额");
      return;
    }
    setSubmittingApproval(true);
    try {
      await apiRequest("/api/approvals", session, {
        method: "POST",
        body: JSON.stringify({ projectId: project.id, ...approvalForm })
      });
      setApprovalForm({ type: "reimbursement", amount: "", payee: "", reason: "" });
      onNotice("项目审批已提交，会进入 PM、总监、财务流程。");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSubmittingApproval(false);
    }
  }

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

      {clientProfile && <section className="detail-section client-handoff">
        <div className="section-head">
          <h2>客户交接摘要</h2>
          <span className="muted">{clientProfile.client}</span>
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
              {item.key !== "contract" && <button type="button" onClick={() => setQuickUploadType(item.uploadType)}>
                {item.status === "missing" ? "上传" : "补充"}
              </button>}
            </div>
          ))}
        </div>
        <div className="action-list">
          {actionItems.map((item) => (
            <div className={item.tone} key={`${item.title}-${item.text}`}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
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
          <h3>执行进度</h3>
          <form className="task-form" onSubmit={submitTask}>
            <input value={taskForm.title} onChange={(event) => updateTaskForm("title", event.target.value)} placeholder="新增交付节点 / 任务" />
            <input value={taskForm.owner} onChange={(event) => updateTaskForm("owner", event.target.value)} placeholder="负责人" />
            <input value={taskForm.dueDate} onChange={(event) => updateTaskForm("dueDate", event.target.value)} placeholder="截止时间" />
            <input value={taskForm.progress} onChange={(event) => updateTaskForm("progress", event.target.value)} placeholder="进度%" />
            <button type="submit" className="primary" disabled={savingTask}>{savingTask ? "保存中" : "新增任务"}</button>
          </form>
          {projectTasks.map((task) => (
            <div className={`progress-row task-row ${task.status}`} key={task.id || task.title}>
              <span>{task.title}</span>
              <div><i style={{ width: `${task.progress}%` }} /></div>
              <b>{task.progress}%</b>
              <button type="button" onClick={() => saveTask({ taskId: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, note: task.note, action: "complete" })} disabled={savingTask || task.progress >= 100}>
                {task.progress >= 100 ? "已完成" : "完成"}
              </button>
              <small>{[task.owner, task.dueDate, task.note].filter(Boolean).join(" · ") || "未补充负责人/节点"}</small>
            </div>
          ))}
        </div>
        <div>
          <h3>{isManagement ? "成本与利润" : "成本构成"}</h3>
          {costRows.map(({ name, value }) => (
            <div className="cost-row" key={name}>
              <span>{name}</span>
              <b>{money(value)}</b>
            </div>
          ))}
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

      <section className="detail-section" ref={focusRefs.files} id="project-files-section">
        <div className="section-head">
          <h2>AI 项目建议</h2>
          <span className="muted">基于当前项目材料、进度、审批和回款</span>
        </div>
        <div className="ai-advice-list">
          {aiAdvice.map((item, index) => (
            <div key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section" ref={focusRefs.approvals} id="project-approvals-section">
        <div className="section-head">
          <h2>文件与 AI 解析</h2>
          <span className="muted">{uniqueFiles.length} 个文件 · {projectJobs.length} 个解析任务</span>
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
                <button type="button" className="ghost" disabled={handlingFeishuFile === item.id} onClick={() => handleFeishuPendingFile(item, "reject")}>驳回</button>
              </div>}
            </div>
          ))}
        </div>}
        <div className="detail-list">
          {uniqueFiles.length ? uniqueFiles.slice(0, 8).map((file, index) => (
            <div key={`${file.name}-${index}`}>
              <strong>{file.name}</strong>
              <span>{file.source || file.category || "文件"} · {fileSize(file.size)} · {file.uploadedByName || file.uploadedBy || "未知上传人"} · {file.uploadedAt ? new Date(file.uploadedAt).toLocaleString("zh-CN") : "时间待记录"}</span>
            </div>
          )) : <p className="muted">还没有项目文件。上传合同、报价表、成本表或核销表后会显示在这里。</p>}
          {projectJobs.slice(0, 4).map((job) => (
            <div key={job.id}>
              <strong>解析任务：{job.status}</strong>
              <span>{job.progress || 0}% · {(job.files || []).map((file) => file.name).join("、") || "文件待识别"}</span>
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

      <section className="detail-section" ref={focusRefs.payments} id="project-payments-section">
        <div className="section-head">
          <h2>审批与成本记录</h2>
          <span className="muted">{projectApprovals.length} 条审批</span>
        </div>
        <form className="project-approval-mini" onSubmit={submitProjectApproval}>
          <select value={approvalForm.type} onChange={(event) => updateApprovalForm("type", event.target.value)}>
            <option value="reimbursement">报销</option>
            <option value="petty_cash">项目备用金</option>
            <option value="supplier_payment">供应商付款</option>
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
            </div>
          )) : <p className="muted">暂无审批记录。报销和备用金通过后会自动沉淀到这里。</p>}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>回款记录</h2>
          <span className="muted">已回款 {money(project.paid)} · 待回款 {money(project.receivable)}</span>
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
        </div>}
        {projectCollectionScripts.slice(0, 2).map((item) => (
          <div className="collection-script-card" key={item.id}>
            <strong>{item.salesName || "销售"} · {item.tone || "自然提醒"} · {money(item.amount)}</strong>
            <pre>{item.script}</pre>
            <span>{item.outcome || item.reason || "结果待记录"}</span>
            {canUseCollection && <div className="button-row">
              <button type="button" className="primary" onClick={() => markCollectionOutcome(item, true)}>有效</button>
              <button type="button" className="ghost" onClick={() => markCollectionOutcome(item, false)}>待优化</button>
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
          {projectPayments.length ? projectPayments.slice(0, 6).map((item) => (
            <div key={item.id}>
              <strong>{item.payer || item.client || project.client || "客户"} · {money(item.amount)}</strong>
              <span>{item.method || "方式待补"} · {item.note || "暂无备注"} · {item.recordedByName || "记录人"} · {item.receivedAt ? new Date(item.receivedAt).toLocaleString("zh-CN") : "时间待记录"}</span>
            </div>
          )) : <p className="muted">暂无回款流水。销售或财务记录后，会自动更新项目已回款和待回款。</p>}
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
            </div>
          )) : <p className="muted">暂无供应商结算记录。供应商付款审批通过后会自动进入这里。</p>}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>项目动态</h2>
          <span className="muted">{activityItems.length} 条</span>
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
              </div>
            </div>
          )) : <p className="muted">项目动态会记录上传、解析、审批、评论和系统更新。</p>}
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

function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice }) {
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
      { from: "assistant", title: "AI 项目助手", text: result.reply || "我已经处理完成。", pendingAction: result.pendingAction || null, query },
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
      onNotice("AI 已按你的确认提交审批。");
    } catch (error) {
      result = { reply: `确认失败：${error.message}` };
    }
    setMessages((items) => [
      ...items.map((item) => item === message ? { ...item, pendingAction: null } : item),
      { from: "assistant", title: "AI 项目助手", text: result.reply || "已确认处理。" },
    ].slice(-8));
    setSending(false);
  }
  return (
    <section className="ai-workbench">
      <div className="ai-chat-shell">
        <div className="ai-chat-head">
          <PanelTitle icon={Bot} title="AI 项目助手" />
          <span>{session.name} 的项目上下文</span>
        </div>
        <div className="ai-message ai-message-assistant">
          <strong>你可以直接把项目里的事情丢给我。</strong>
          <p>问备用金、报销、进度、材料缺口，或者把合同、报价表、成本表、票据、核销表发过来，我会先识别你的账号和项目权限，再帮你归档或登记。</p>
        </div>
        <div className="prompt-list">
          <button type="button" onClick={() => ask("我的项目备用金还有多少？")}>我的项目备用金还有多少？</button>
          <button type="button" onClick={() => ask(`帮我提交500元报销到${selected.name}`)}>帮我提交一笔报销</button>
          <button type="button" onClick={() => ask("这个项目进度怎么样？")}>这个项目进度怎么样？</button>
          <button type="button" onClick={() => ask("给我生成一个更容易过稿的内容方向")}>给我生成一个更容易过稿的内容方向</button>
          <button type="button" onClick={onUpload}><UploadCloud size={14} />让 AI 识别项目文件</button>
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
          <button type="button" className="ghost" onClick={onUpload}>上传</button>
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

function ApprovalFunds({ projects, approvals, selected, session, subView, setSubView, onDone, onNotice }) {
  const [selectedApprovalKey, setSelectedApprovalKey] = useState("");
  const [form, setForm] = useState({
    projectId: selected?.id || "",
    type: "reimbursement",
    amount: "",
    payee: "",
    reason: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [actingApprovalId, setActingApprovalId] = useState("");
  useEffect(() => {
    if (selected?.id) setForm((current) => ({ ...current, projectId: current.projectId || selected.id }));
  }, [selected?.id]);
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
  const visibleAmount = visibleApprovals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingVisible = visibleApprovals.filter((item) => String(item.status || "").includes("待")).length;
  const completedVisible = visibleApprovals.filter((item) => item.status === "已完成").length;
  const rejectedVisible = visibleApprovals.filter((item) => item.status === "已驳回").length;
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
  const pettyCashProject = projects.find((project) => project.id === selectedApproval.projectId)
    || projects.find((project) => project.name === selectedApproval.project)
    || projects.find((project) => project.id === form.projectId)
    || selected;
  const pettyCashLeft = Math.max(Number(pettyCashProject?.pettyCashBudget || 0) - Number(pettyCashProject?.pettyCashUsed || 0), 0);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitApproval(event) {
    event.preventDefault();
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
      await apiRequest("/api/approvals", session, {
        method: "POST",
        body: JSON.stringify(form)
      });
      setForm({ projectId: form.projectId, type: "reimbursement", amount: "", payee: "", reason: "" });
      setSubView(form.type === "petty_cash" ? "项目备用金" : form.type === "supplier_payment" ? "供应商付款" : "报销");
      setSelectedApprovalKey("");
      onNotice("审批已提交，会进入 PM、总监、财务流程。");
      onDone();
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
      await apiRequest("/api/approvals/action", session, {
        method: "POST",
        body: JSON.stringify({ id: selectedApproval.id, action })
      });
      const nextApproval = visibleApprovals.find((item) => item.id !== selectedApproval.id && canHandleApproval(session, item));
      setSelectedApprovalKey(nextApproval?.id || "");
      onNotice(nextApproval
        ? `${action === "reject" ? "审批已驳回" : "审批已通过到下一步"}，已切到下一条待处理。`
        : `${action === "reject" ? "审批已驳回" : "审批已通过到下一步"}，当前列表暂无下一条待处理。`);
      await onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setActingApprovalId("");
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
            <option value="reimbursement">报销</option>
            <option value="petty_cash">项目备用金</option>
            <option value="supplier_payment">供应商付款</option>
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
        <button type="submit" className="primary" disabled={submitting}>{submitting ? "提交中" : "提交审批"}</button>
      </form>

      <div className="feature-panel approval-main">
        <PanelTitle icon={BellRing} title={activeCategory} />
        <div className="approval-summary-row">
          <Mini label="当前数量" value={`${visibleApprovals.length} 条`} />
          <Mini label="当前金额" value={money(visibleAmount)} />
          <Mini label="待处理" value={`${pendingVisible} 条`} />
          <Mini label="已完成" value={`${completedVisible} 条`} />
          <Mini label="已驳回" value={`${rejectedVisible} 条`} />
        </div>
        <div className="approval-list">
          {visibleApprovals.length ? visibleApprovals.map((item) => (
            <div className="approval-card" key={item.id}>
              <div>
                <strong>{item.typeName}</strong>
                <span>{item.project} · {item.user} · {currentApprovalStepInfo(item)?.label || item.status} · {item.scope}</span>
              </div>
              <b>{money(item.amount)}</b>
              <em>{item.status}</em>
              <button type="button" onClick={() => setSelectedApprovalKey(item.id)}>查看</button>
            </div>
          )) : <div className="empty-state">暂无审批单，可以从左侧提交备用金或报销。</div>}
        </div>
      </div>

      <div className="feature-panel approval-detail">
        <PanelTitle icon={Clock3} title="流程进度" />
        <div className="approval-detail-head">
          <strong>{selectedApproval.typeName}</strong>
          <span>{selectedApproval.project} · {money(selectedApproval.amount)}</span>
        </div>
        <div className="approval-steps">
          {selectedApproval.steps.length ? selectedApproval.steps.map((step) => (
            <div className={`approval-step ${step.status}`} key={step.key || step.label}>
              <i />
              <div>
                <strong>{step.label}</strong>
                <span>{step.status === "done" ? "已完成" : step.status === "current" ? selectedApproval.status : step.status === "rejected" ? "已驳回" : "等待处理"}</span>
              </div>
            </div>
          )) : <p className="muted">还没有审批流程，提交后会自动生成。</p>}
        </div>
        {selectedApproval.logs?.length > 0 && <div className="approval-log">
          {selectedApproval.logs.slice(0, 3).map((log) => (
            <p key={`${log.action}-${log.at}`}>{log.user} · {log.action === "reject" ? "驳回" : log.action === "approve" ? "通过" : "提交"} · {new Date(log.at).toLocaleString("zh-CN")}</p>
          ))}
        </div>}
        {canAct && <div className="approval-actions">
          <button type="button" className="primary" onClick={() => act("approve")} disabled={actingApprovalId === selectedApproval.id}>{actingApprovalId === selectedApproval.id ? "处理中" : "通过"}</button>
          <button type="button" className="ghost" onClick={() => act("reject")} disabled={actingApprovalId === selectedApproval.id}>{actingApprovalId === selectedApproval.id ? "处理中" : "驳回"}</button>
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
      </div>
    </section>
  );
}

function CloseoutReview({ project, isManagement, subView }) {
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
  return (
    <section className="feature-grid">
      {!showRanking && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={FileSpreadsheet} title="项目结案成本复盘" />
          <div className="review-summary">
            <Mini label="合同金额" value={money(project.contract)} />
            <Mini label="总成本" value={money(project.costUsed)} />
            <Mini label={isManagement ? "项目利润" : "结案状态"} value={isManagement ? money(project.contract - project.costUsed) : "待复盘"} />
            <Mini label={isManagement ? "毛利率" : "资料完整度"} value={isManagement ? `${project.margin}%` : `${Math.min(100, project.progress + 12)}%`} />
          </div>
          <div className="idea-card">
            <strong>AI 优化建议</strong>
            <p>当前最大支出为「{topCost.name}」{money(topCost.value)}，占总成本 {topCostShare}%。{costWarning} 建议下次同类项目至少为该项预留 {money(suggestedReserve)}。</p>
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
            )) : <div className="empty-state">暂无成本明细，上传成本表或报销通过后会自动出现在这里。</div>}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={Bot} title="支出优化建议" />
          <div className="logic-list">
            <LogicItem title="优先复盘" text={`先看最大支出「${topCost.name}」，确认是否有临时追加、供应商报价偏高或审批滞后。`} />
            <LogicItem title="下次控制" text="把高占比支出前置到立项预算里，并设置超过预算阈值时必须重新审批。" />
            <LogicItem title="预算预留" text={`下次同类项目建议为「${topCost.name}」至少预留 ${money(suggestedReserve)}，并在报价阶段写入执行预算。`} />
          </div>
        </div>
      </>}
    </section>
  );
}

function SupplierLibrary({ suppliers = [], session, onDone, onNotice }) {
  const [selectedName, setSelectedName] = useState(suppliers[0]?.supplier || "");
  const [form, setForm] = useState({ score: 5, market: "", contact: "", comment: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!selectedName && suppliers[0]?.supplier) setSelectedName(suppliers[0].supplier);
  }, [suppliers, selectedName]);
  const selected = suppliers.find((item) => item.supplier === selectedName) || suppliers[0] || null;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function exportSuppliers() {
    try {
      await downloadFile("/api/suppliers/export", session, "supplier-settlements.csv");
      onNotice("供应商结算 CSV 已导出");
    } catch (error) {
      onNotice(error.message);
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
      await apiRequest("/api/suppliers/rate", session, {
        method: "POST",
        body: JSON.stringify({ supplier: selected.supplier, ...form })
      });
      setForm({ score: 5, market: "", contact: "", comment: "" });
      onNotice("供应商评分已保存");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!suppliers.length) {
    return (
      <section className="feature-panel">
        <PanelTitle icon={UsersRound} title="供应商库" />
        <div className="empty-state">暂无供应商记录。上传成本表或完成供应商付款审批后，会自动沉淀供应商档案。</div>
      </section>
    );
  }

  return (
    <section className="supplier-library">
      <div className="feature-panel wide-feature">
        <div className="section-head">
          <PanelTitle icon={UsersRound} title="供应商库" />
          <button type="button" className="ghost" onClick={exportSuppliers}>导出结算 CSV</button>
        </div>
        <div className="supplier-card-grid">
          {suppliers.map((item) => (
            <button
              type="button"
              className={`supplier-card ${item.supplier === selected?.supplier ? "active" : ""}`}
              key={item.supplier}
              onClick={() => setSelectedName(item.supplier)}
            >
              <strong>{item.supplier}</strong>
              <span>{"★".repeat(item.star || 1)}{"☆".repeat(Math.max(0, 5 - (item.star || 1)))}</span>
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
          <Mini label="内部评分" value={selected.averageRating ? `${selected.averageRating}/5` : "待评分"} />
          <Mini label="评分人数" value={`${selected.ratingCount || 0} 人`} />
        </div>
        <div className="compact-list">
          <div><strong>合作项目</strong><span>{selected.projects?.join("、") || "暂无"}</span></div>
          <div><strong>合作类型</strong><span>{selected.types?.join("、") || selected.market || "待沉淀"}</span></div>
          <div><strong>推荐原因</strong><span>{selected.recommendationReason}</span></div>
          <div><strong>推荐逻辑</strong><span>星级由合作次数、合作项目数、累计金额和内部评分共同计算，多人使用且评分稳定的供应商会优先推荐。</span></div>
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <PanelTitle icon={CheckCircle2} title="内部评分" />
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
            <div key={`${item.user}-${item.at}`}>
              <strong>{item.score}/5 · {item.user}</strong>
              <span>{item.comment || "暂无评价"} · {item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}</span>
            </div>
          ))}
        </div>
      </div>}
    </section>
  );
}

function ClientLibrary({ clients = [], session, onDone, onNotice }) {
  const [selectedName, setSelectedName] = useState(clients[0]?.client || "");
  const [form, setForm] = useState({ likes: "", dislikes: "", pitfalls: "", handoffNote: "", contactStyle: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!selectedName && clients[0]?.client) setSelectedName(clients[0].client);
  }, [clients, selectedName]);
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

  async function copyHandoff() {
    if (!selected) return;
    const lines = [
      `客户：${selected.client}`,
      `项目数：${selected.projectCount || 0} 个`,
      `最近项目：${selected.latestProject || "待补充"}${selected.latestStatus ? `（${selected.latestStatus}）` : ""}`,
      `客户喜欢：${selected.likes?.join("；") || "待沉淀"}`,
      `客户不喜欢：${selected.dislikes?.join("；") || "待沉淀"}`,
      `雷区：${selected.pitfalls?.join("；") || "待沉淀"}`,
      `沟通风格：${selected.contactStyle || "待沉淀"}`,
      `交接备注：${selected.handoffNote || selected.handoffSummary || "待补充"}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      onNotice("客户交接清单已复制");
    } catch {
      onNotice("复制失败，请手动选中交接摘要复制");
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
      onNotice("客户偏好和交接备注已保存");
      onDone();
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
        <div className="empty-state">暂无客户项目。创建项目后，这里会自动沉淀客户偏好、雷区和交接摘要。</div>
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
              className={`supplier-card ${item.client === selected?.client ? "active" : ""}`}
              key={item.client}
              onClick={() => setSelectedName(item.client)}
            >
              <strong>{item.client}</strong>
              <em>{item.projectCount || 0} 个项目 · 待回款 {money(item.receivable)}</em>
              <small>{item.handoffSummary}</small>
            </button>
          ))}
        </div>
      </div>

      {selected && <div className="feature-panel wide-feature supplier-detail-panel">
        <div className="section-head">
          <PanelTitle icon={FileText} title="交接摘要" />
          <button type="button" className="ghost" onClick={copyHandoff}>复制交接清单</button>
        </div>
        <div className="review-summary">
          <Mini label="项目数" value={`${selected.projectCount || 0} 个`} />
          <Mini label="合同总额" value={money(selected.totalContract)} />
          <Mini label="待回款" value={money(selected.receivable)} />
          <Mini label="动态记录" value={`${selected.commentCount || 0} 条`} />
        </div>
        <div className="compact-list">
          <div><strong>客户喜欢</strong><span>{selected.likes?.join("；") || "待沉淀"}</span></div>
          <div><strong>客户不喜欢</strong><span>{selected.dislikes?.join("；") || "待沉淀"}</span></div>
          <div><strong>雷区</strong><span>{selected.pitfalls?.join("；") || "待沉淀"}</span></div>
          <div><strong>交接摘要</strong><span>{selected.handoffSummary}</span></div>
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <PanelTitle icon={CheckCircle2} title="维护客户档案" />
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

function CollectionAssistant({ projects = [], scripts = [], session, onDone, onNotice }) {
  const canUseCollection = canUseCollectionRole(session);
  const receivableProjects = projects.filter((project) => Number(project.receivable || 0) > 0)
    .sort((a, b) => Number(b.receivable || 0) - Number(a.receivable || 0));
  const [selectedId, setSelectedId] = useState(receivableProjects[0]?.id || projects[0]?.id || "");
  const [style, setStyle] = useState("");
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const selected = projects.find((project) => project.id === selectedId) || receivableProjects[0] || projects[0];
  const relatedScripts = scripts.filter((item) => !selected || item.projectId === selected.id || item.projectName === selected.name);
  const ownScripts = scripts.filter((item) => item.salesName === session.name);
  const ownDone = ownScripts.filter((item) => item.outcome || typeof item.success === "boolean");
  const ownSuccess = ownDone.filter((item) => item.success).length;
  const bestScript = [...scripts].filter((item) => item.success).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

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
      onNotice("话术已生成并保存。");
      onDone();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveOutcome(record, success) {
    if (!canUseCollection) {
      onNotice("催收结果由销售、PM、财务或管理层记录。");
      return;
    }
    try {
      await apiRequest("/api/collections/outcome", session, {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          success,
          score: success ? 5 : 2,
          outcome: success ? "客户已回复/确认付款流程" : "客户暂未回复或未推进付款"
        })
      });
      onNotice(success ? "已记录为有效话术，后续会优先学习。" : "已记录为待优化，后续生成会避开。");
      onDone();
    } catch (error) {
      onNotice(error.message);
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
      </div>

      <div className="feature-panel wide-feature">
        <PanelTitle icon={MessageSquareText} title="当前话术" />
        {(draft || relatedScripts[0]) ? (
          <div className="collection-script-card fresh">
            <strong>{(draft || relatedScripts[0]).projectName} · {(draft || relatedScripts[0]).tone || "自然提醒"}</strong>
            <pre>{(draft || relatedScripts[0]).script}</pre>
            <span>{(draft || relatedScripts[0]).reason || (draft || relatedScripts[0]).outcome || "生成后可复制到微信/飞书跟进客户。"}</span>
          </div>
        ) : <div className="empty-state">选择一个待回款项目，生成第一条催收话术。</div>}
      </div>

      <div className="feature-panel">
        <PanelTitle icon={CheckCircle2} title="有效话术参考" />
        {bestScript ? <div className="idea-card">
          <strong>{bestScript.salesName} · {bestScript.projectName}</strong>
          <p>{bestScript.script}</p>
        </div> : <p className="muted">还没有成功结果。记录几次后，这里会出现团队里更有效的人话表达。</p>}
      </div>

      <div className="feature-panel wide-feature">
        <PanelTitle icon={Clock3} title="话术记录" />
        <div className="detail-list">
          {scripts.length ? scripts.slice(0, 10).map((item) => (
            <div className="collection-history-row" key={item.id}>
              <strong>{item.projectName} · {item.salesName || "销售"} · {money(item.amount)}</strong>
              <span>{item.outcome || item.reason || "结果待记录"}</span>
              {canUseCollection && <div className="button-row">
                <button type="button" className="primary" onClick={() => saveOutcome(item, true)}>有效</button>
                <button type="button" className="ghost" onClick={() => saveOutcome(item, false)}>待优化</button>
              </div>}
            </div>
          )) : <p className="muted">暂无话术记录。生成后会保存在这里。</p>}
        </div>
      </div>
    </section>
  );
}

function ManagementCockpit({ projects, approvals = [], settings = {}, session, stats, subView, setSubView, onDone, onNotice }) {
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

  async function saveFinance(event) {
    event.preventDefault();
    setSavingFinance(true);
    try {
      await apiRequest("/api/settings", session, {
        method: "POST",
        body: JSON.stringify({
          type: "companyFinance",
          values: financeForm
        })
      });
      onNotice("公司现金流设置已保存");
      onDone();
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
  const financeSettingsForm = (
    <form className="feature-panel settings-form" onSubmit={saveFinance}>
      <PanelTitle icon={Settings2} title="经营现金设置" />
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
          <div className="logic-list">
            {metrics.advisorActions.map((action, index) => <LogicItem title={`建议 ${index + 1}`} text={action} key={action} />)}
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
              <div key={project.id}><strong>{project.name}</strong><span>评分 {project.score} · 待回款 {money(project.receivable)} · 毛利率 {project.projectMargin}%</span></div>
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

function UploadDialog({ session, projects, selected, initialType = "create-project", minimized = false, onMinimize, onExpand, onClose, onDone }) {
  const [type, setType] = useState(initialType);
  const [projectId, setProjectId] = useState(selected?.id || projects[0]?.id || "");
  const [values, setValues] = useState({
    "项目名称": "",
    "客户 / 品牌": "",
    "负责人": session.name,
    "合同金额": "",
  });
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState({ step: "idle", percent: 0, text: "等待选择文件" });
  const targetProject = projects.find((project) => project.id === projectId) || selected || projects[0];
  const needsProject = type !== "create-project";
  const hasProjects = projects.length > 0;
  const typeLabels = {
    "create-project": "新项目：合同 / 报价表",
    "cost-sheet": "已有项目：执行成本表",
    "quote-sheet": "已有项目：合同报价表",
    "verification-sheet": "已有项目：月度核销表"
  };

  async function appendPickedFiles(picked = []) {
    setMessage("");
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
  }

  function uploadBody() {
    return type === "create-project"
      ? { type, values, files }
      : { type, id: targetProject.id, files };
  }

  async function requestPreview() {
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传成本表、报价表或核销表。");
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      return;
    }
    setLoading(true);
    setProgress({ step: "preview", percent: 34, text: "正在上传文件并解析基础信息" });
    setMessage("AI 正在预览识别结果，预览阶段不会写入项目。");
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
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmUpload() {
    if (needsProject && !targetProject?.id) {
      setMessage("请先创建项目，再上传项目资料。");
      return;
    }
    if (type === "create-project" && !files.length && !values["项目名称"]?.trim()) {
      setMessage("请先选择合同/报价表，或至少填写项目名称，避免创建空项目。");
      return;
    }
    setLoading(true);
    setProgress({ step: "confirm", percent: 88, text: "正在写入项目数据并刷新大盘" });
    setMessage("正在确认入库，请稍候...");
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
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!files.length && type !== "create-project") {
      setMessage("请先选择要上传的文件");
      return;
    }
    if (!preview) {
      await requestPreview();
      return;
    }
    if (!preview.canConfirm) {
      setMessage("当前识别结果还不能确认入库，请先按提示补充或更换文件。");
      return;
    }
    await confirmUpload();
  }

  const hasProgress = progress.step !== "idle" || loading || preview || files.length > 0;
  const progressPercent = Math.max(0, Math.min(100, progress.percent || 0));
  const progressLabel = loading ? progress.text : confirmed ? "已完成入库" : progress.text;

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
        <div className="upload-mini-progress"><i style={{ width: `${progressPercent}%` }} /></div>
        <button type="button" className="ghost tiny" onClick={onExpand}>打开</button>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <form className="upload-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>{needsProject ? `上传到「${targetProject?.name || "当前项目"}」` : "上传合同创建项目"}</h2>
            <p>{needsProject ? "先 AI 预览识别，确认后才会写入当前项目。" : "合同/报价表会先预览，确认后创建项目。"}</p>
          </div>
          <div className="modal-head-actions">
            {hasProgress && <button type="button" className="ghost" onClick={onMinimize}><Minimize2 size={15} />缩到后台</button>}
            <button type="button" className="ghost" onClick={onClose}>关闭</button>
          </div>
        </div>

        <label>
          <span>上传类型</span>
          <select value={type} onChange={(event) => {
            setType(event.target.value);
            setPreview(null);
            setConfirmed(false);
            setMessage("");
          }}>
            <option value="create-project">{typeLabels["create-project"]}</option>
            {hasProjects && <option value="cost-sheet">{typeLabels["cost-sheet"]}</option>}
            {hasProjects && <option value="quote-sheet">{typeLabels["quote-sheet"]}</option>}
            {hasProjects && <option value="verification-sheet">{typeLabels["verification-sheet"]}</option>}
          </select>
        </label>

        {needsProject && hasProjects && (
          <label>
            <span>归属项目</span>
            <select value={projectId} onChange={(event) => {
              setProjectId(event.target.value);
              setPreview(null);
              setConfirmed(false);
              setMessage("");
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
                <button type="button" className="ghost tiny" onClick={() => removeFile(uploadedFileKey(file))}>移除</button>
              </div>
            ))}
          </div>
        )}

        {preview && <UploadPreview preview={preview} />}

        {message && <p className="form-message">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          {hasProgress && <button type="button" className="ghost" onClick={onMinimize}>缩到后台</button>}
          {preview && !confirmed && <button type="button" className="ghost" onClick={requestPreview} disabled={loading}>重新预览</button>}
          <button type="submit" className="primary" disabled={loading || (preview && !preview.canConfirm)}>{loading ? "处理中" : preview ? "确认入库" : "AI 预览识别"}</button>
        </div>
      </form>
    </div>
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
                <strong>{row.name || row.matched || "未命名项"}</strong>
                <span>{row.quantity ? `${row.quantity}${row.unit || ""}` : row.status || "待确认"}</span>
                <b>{row.amount || row.unitPrice ? money(row.amount || row.unitPrice) : ""}</b>
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

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("admin@company.local");
  const [pin, setPin] = useState("123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload.data));
      onLogin(payload.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
        <form onSubmit={submit}>
          <label>
            <span>邮箱</span>
            <div className="input-row"><Mail size={16} /><input value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </label>
          <label>
            <span>PIN</span>
            <div className="input-row"><LockKeyhole size={16} /><input value={pin} type="password" onChange={(event) => setPin(event.target.value)} /></div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="primary" disabled={loading}>{loading ? "登录中" : "进入系统"}</button>
        </form>
        <p className="login-hint">默认管理员：admin@company.local / 123456。上线后请在成员管理里修改 PIN。</p>
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
  const [settingsMessage, setSettingsMessage] = useState("");
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
    pin: "123456",
  });
  const aiReady = Boolean(aiSettings["API Key"]);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-user-id": session.id,
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
    const res = await fetch("/api/state", { headers: { "x-user-id": session.id } });
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

  useEffect(() => {
    if (isAdmin) {
      loadMembers().catch((err) => setMessage(err.message));
      loadSettings().catch((err) => setSettingsMessage(err.message));
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
    setForm({ name: "", email: "", role: "member", department: "", feishuOpenId: "", feishuUserId: "", feishuName: "", status: "active", pin: "123456" });
  }

  async function save(event) {
    event.preventDefault();
    try {
      await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ id: editingId || undefined, ...form }),
      });
      await loadMembers();
      resetForm();
      setMessage("成员已保存");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function toggle(member) {
    try {
      await api("/api/members/status", {
        method: "POST",
        body: JSON.stringify({ id: member.id, status: member.status === "disabled" ? "active" : "disabled" }),
      });
      await loadMembers();
    } catch (err) {
      setMessage(err.message);
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
    setSettingsMessage("正在测试 AI 连接...");
    try {
      const data = await api("/api/settings/ai/test", {
        method: "POST",
        body: JSON.stringify({ values: aiSettings }),
      });
      setSettingsMessage(`AI 连接正常：${data.provider} / ${data.model}`);
    } catch (err) {
      setSettingsMessage(err.message);
    }
  }

  async function saveAi(event) {
    event.preventDefault();
    setSettingsMessage("正在保存 AI 配置...");
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type: "aiService", values: aiSettings }),
      });
      setSettingsMessage("AI API 已保存，后续合同/表格解析会使用这套配置。");
      await loadSettings();
    } catch (err) {
      setSettingsMessage(err.message);
    }
  }

  async function saveProductSettings(event) {
    event.preventDefault();
    setSettingsMessage("正在保存产品设置...");
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type: "product", values: productSettings }),
      });
      setSettingsMessage("产品设置已保存");
    } catch (err) {
      setSettingsMessage(err.message);
    }
  }

  async function saveTypedSetting(type, values, label) {
    setSettingsMessage(`正在保存${label}...`);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ type, values }),
      });
      setSettingsMessage(`${label}已保存`);
      await loadSettings();
    } catch (err) {
      setSettingsMessage(err.message);
    }
  }

  async function loadFeishuBindings() {
    setFeishuBindings(await api("/api/integrations/feishu/bindings"));
    const res = await fetch("/api/state", { headers: { "x-user-id": session.id } });
    const payload = await res.json();
    if (payload.ok) {
      setFeishuEvents(payload.data?.feishuEvents || []);
      setFeishuPendingFiles(payload.data?.feishuPendingFiles || []);
      setSystemNotifications(payload.data?.systemNotifications || []);
    }
  }

  async function syncFeishuContacts() {
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
            <button type="submit" className="primary">保存成员</button>
          </form>

          <div className="member-table">
            <div className="section-head"><h2>成员列表</h2><span>{members.length} 人</span></div>
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.email} · {member.department || "未分组"}{member.feishuOpenId ? " · 已绑飞书" : ""}</span>
                </div>
                <b className={`role-pill ${member.role}`}>{roleLabel(member.role)}</b>
                <b className={`status-pill ${member.status}`}>{member.status === "disabled" ? "已停用" : "启用中"}</b>
                <button type="button" className="ghost" onClick={() => edit(member)}>编辑</button>
                <button type="button" className="ghost" onClick={() => toggle(member)}>{member.status === "disabled" ? "启用" : "停用"}</button>
              </div>
            ))}
          </div>
        </section>}

        {canManageAssignments && adminTab === "assignments" && (
          <ProjectAssignmentPanel
            api={api}
            members={members}
            assignments={assignments}
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
              <button className="ghost" type="button" onClick={testAi}>测试连接</button>
              <button type="submit" className="primary">保存 AI API</button>
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
            <button type="submit" className="primary">保存产品设置</button>
          </form>
          <div className="member-table settings-help">
            <div className="section-head"><h2>协同与生产配置</h2></div>
            <div className="settings-block">
              <h3>飞书机器人</h3>
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
              <button type="button" className="ghost" onClick={() => saveTypedSetting("feishu", feishuSettings, "飞书配置")}>保存飞书配置</button>
              <button type="button" className="ghost" onClick={syncFeishuContacts}>同步飞书通讯录</button>
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
              <button type="button" className="ghost" onClick={() => saveTypedSetting("wechat", wechatSettings, "企业微信配置")}>保存企业微信配置</button>
            </div>
            <div className="settings-block">
              <h3>对象存储</h3>
              {[
                ["provider", "服务商"],
                ["bucket", "Bucket"],
                ["publicBaseUrl", "访问域名"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input value={storageSettings[key]} onChange={(event) => setStorageSettings({ ...storageSettings, [key]: event.target.value })} />
                </label>
              ))}
              <button type="button" className="ghost" onClick={() => saveTypedSetting("storage", storageSettings, "对象存储配置")}>保存存储配置</button>
            </div>
            <div className="settings-block">
              <h3>审批阈值</h3>
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
              <button type="button" className="ghost" onClick={() => saveTypedSetting("approvalRules", approvalSettings, "审批规则")}>保存审批规则</button>
            </div>
          </div>
        </section>}
      </main>
    </div>
  );
}

function ProjectAssignmentPanel({ api, members, assignments, onReload }) {
  const activeMembers = members.filter((member) => member.status !== "disabled");
  const [selectedProjectId, setSelectedProjectId] = useState(assignments[0]?.id || "");
  const selected = assignments.find((item) => item.id === selectedProjectId) || assignments[0] || null;
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
      await onReload();
      setMessage("项目分派已保存，员工端会按这里展示自己的项目。");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  function applySuggestion() {
    if (!suggestions?.recommended) return;
    setForm((current) => ({
      ...current,
      pmId: suggestions.recommended.pmId || current.pmId,
      salesId: suggestions.recommended.salesId || current.salesId,
      memberIds: Array.from(new Set([...(suggestions.recommended.memberIds || [])])),
    }));
    setMessage("已套用 AI 分派建议，确认无误后保存。");
  }

  if (!assignments.length) {
    return (
      <section className="empty-project-state">
        <div>
          <PanelTitle icon={UserCog} title="项目分派" />
          <h2>还没有可分派的项目</h2>
          <p>先上传合同或报价表创建项目，再回来把 PM、销售和执行成员分配进去。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="assignment-layout">
      <div className="member-table assignment-list">
        <div className="section-head"><h2>项目列表</h2><span>{assignments.length} 个</span></div>
        {assignments.map((project) => (
          <button
            type="button"
            className={`project-row ${project.id === selected?.id ? "selected" : ""}`}
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
            <button type="button" className="ghost" onClick={applySuggestion} disabled={suggesting || !suggestions?.recommended}>{suggesting ? "分析中" : "一键套用推荐"}</button>
          </div>
          {suggestions ? (
            <div className="suggestion-grid">
              <SuggestionColumn title="推荐 PM" items={suggestions.pmCandidates} />
              <SuggestionColumn title="推荐销售" items={suggestions.salesCandidates} />
              <SuggestionColumn title="推荐执行" items={suggestions.memberCandidates?.slice(0, 3)} />
            </div>
          ) : <p className="muted">{suggesting ? "正在根据人员负载和项目部门生成建议..." : "暂无推荐数据。"}</p>}
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
        {message && <p className="form-message">{message}</p>}
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存项目分派"}</button>
      </form>
    </section>
  );
}

function SuggestionColumn({ title, items = [] }) {
  return (
    <div className="suggestion-column">
      <strong>{title}</strong>
      {items.length ? items.map((item) => (
        <div key={item.id}>
          <span>{item.name} · {item.roleLabel}</span>
          <em>{item.reason} · 评分 {item.score}</em>
        </div>
      )) : <em>暂无候选</em>}
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
  const [testing, setTesting] = useState(false);
  const [sampleText, setSampleText] = useState("这是项目群测试消息，帮我记录到项目动态里");
  const latestDownload = events.find((item) => /download|下载|解析|引用/.test(`${item.action || ""} ${item.status || ""} ${item.reply || ""}`));
  const feishuNotices = notifications.filter((item) => item.type === "feishu-pending-file" && item.status === "待处理");
  const feishuNoticeReady = notifications.filter((item) => item.status === "待处理" && item.recipients?.length);
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
      await api("/api/integrations/feishu/bindings", {
        method: "POST",
        body: JSON.stringify(form)
      });
      pushOperation("飞书群已绑定项目。群里 @机器人发文件或项目消息后，会进入 OA 事件记录。");
      setForm((current) => ({ ...current, chatId: "", chatName: "" }));
      await onReload();
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
      await api("/api/integrations/feishu/pending-files/action", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      pushOperation(action === "reject" ? "飞书文件已驳回。" : "飞书文件已确认入库。");
      await onReload();
    } catch (error) {
      pushOperation(error.message, "danger");
    } finally {
      setHandlingId("");
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
      pushOperation(payload.data?.reply || "模拟飞书消息已进入 OA。");
      await onReload();
    } catch (error) {
      pushOperation(error.message || "模拟飞书消息失败", "danger");
    } finally {
      setTesting(false);
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
      <form className="feishu-bind-form" onSubmit={save}>
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
      <div className="feishu-mini-list feishu-pending-list">
        <strong>待确认文件</strong>
        {pendingFiles.length ? pendingFiles.slice(0, 6).map((item) => (
          <div key={item.id}>
            <span>{item.file?.name || item.preview?.fileName || "飞书文件"} · {item.status}</span>
            <em>{item.projectName || "待匹配项目"} · {item.uploadType || "file"} · {item.preview?.summary || item.note || "等待确认"}</em>
            {item.status === "待确认" && <div className="feishu-pending-actions">
              <button type="button" className="primary" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "confirm")}>
                {handlingId === item.id ? "处理中" : "确认入库"}
              </button>
              <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "reject")}>驳回</button>
            </div>}
          </div>
        )) : <p>暂无待确认文件。飞书群发来的成本/报价/核销文件下载成功后会先出现在这里。</p>}
      </div>
      <div className="feishu-mini-list">
        <strong>已绑定群</strong>
        {bindings.length ? bindings.slice(0, 5).map((item) => (
          <div key={item.chatId}>
            <span>{item.chatName || item.chatId}</span>
            <em>{item.projectName}</em>
          </div>
        )) : <p>暂无绑定。先填 Chat ID，把飞书项目群和 OA 项目连起来。</p>}
      </div>
      <div className="feishu-mini-list">
        <strong>最近机器人事件</strong>
        {events.length ? events.slice(0, 5).map((item) => (
          <div key={item.id}>
            <span>{item.status || item.action}</span>
            <em>{item.projectName || item.chatName || item.chatId || "待匹配项目"} · {item.reply || item.text || item.fileName || "无内容"}</em>
          </div>
        )) : <p>暂无事件。配置飞书事件订阅后，飞书消息会显示在这里。</p>}
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
  if (adminRouteMap[view] && (isAdmin || (view === "admin:assignments" && canManageAssignments))) {
    return <AdminMembers session={session} setView={setView} onLogout={logout} initialTab={adminRouteMap[view]} />;
  }
  return <ProjectDashboard session={session} view={view} setView={setView} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<AppShell />);
