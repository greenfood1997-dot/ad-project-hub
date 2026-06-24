import React, { useEffect, useMemo, useState } from "react";
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
  MessageSquareText,
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

function roleLabel(role) {
  return roleOptions.find(([value]) => value === role)?.[1] || role;
}

function canSeeManagement(session) {
  return managementRoles.includes(session?.role);
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

function normalizeProject(project) {
  const contract = Number(project.contract || 0);
  const paid = Number(project.paid || 0);
  const receivable = Number(project.receivable || Math.max(contract - paid, 0));
  const costBudget = Number(project.costBudget || project.cost_budget || 0);
  const costUsed = Number(project.costUsed || project.cost_used || 0);
  const tasks = Array.isArray(project.tasks) && project.tasks.length ? project.tasks : [["资料归档", project.files?.length ? 100 : 35], ["月度执行", 42], ["核销确认", 18]];
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
    pettyCashBudget: Number(project.extractedFields?.pettyCashBudget || project.extractedFields?.projectPettyCashBudget || 20000),
    pettyCashUsed: Number(project.extractedFields?.pettyCashUsed || project.extractedFields?.projectPettyCashUsed || Math.min(costUsed * 0.12, 12000)),
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

function projectMaterialStatus(project = {}, files = [], jobs = []) {
  const fileText = [
    ...(project.files || []),
    ...files,
    ...jobs.flatMap((job) => job.files || [])
  ].map((file) => `${file.name || ""} ${file.category || ""} ${file.source || ""}`).join(" ");
  const extracted = project.extractedFields || {};
  const hasContract = Boolean(project.contract) || /合同|contract/i.test(fileText);
  const hasQuote = Boolean(extracted.quoteRules?.length || extracted.revenueRules?.length) || /报价|quote/i.test(fileText);
  const hasCost = Boolean(project.costUsed || (project.costs || []).some(([, value]) => Number(value) > 0)) || /成本|费用|execution|cost/i.test(fileText);
  const hasVerification = Boolean(extracted.verifications?.length || extracted.verificationRecords?.length) || /核销|verification/i.test(fileText);
  const items = [
    { key: "contract", label: "合同", done: hasContract, tip: hasContract ? "合同信息已进入项目" : "请上传合同或补充合同金额" },
    { key: "quote", label: "报价表", done: hasQuote, tip: hasQuote ? "报价规则已归档" : "建议上传报价表，方便后续核销匹配" },
    { key: "cost", label: "成本表", done: hasCost, tip: hasCost ? "成本记录已沉淀" : "执行成本还不完整，建议补成本表或报销记录" },
    { key: "verification", label: "核销表", done: hasVerification, tip: hasVerification ? "核销材料已记录" : "月度核销表待补，影响回款判断" },
  ];
  return {
    items,
    missing: items.filter((item) => !item.done),
    doneCount: items.filter((item) => item.done).length
  };
}

function projectActionItems({ project, files, jobs, approvals, health, isManagement }) {
  const materials = projectMaterialStatus(project, files, jobs);
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  const receivable = Number(project.receivable || 0);
  const costRate = project.costBudget ? Math.round((Number(project.costUsed || 0) / Number(project.costBudget || 1)) * 100) : 0;
  const actions = [];
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
  const actionReply = await tryCreateAiApproval({ ...context, query });
  return actionReply || aiReplyFor({ ...context, query });
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
  const [role, setRole] = useState("全部角色");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchText, setSearchText] = useState("");
  const isAdmin = ["shareholder", "admin"].includes(session?.role);
  const isManagement = canSeeManagement(session);
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
        ["approvals", "报销"]
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
          {isAdmin && (
            <button
              type="button"
              className={`nav-admin-entry ${view === "admin" ? "active" : ""}`}
              onClick={() => setView("admin")}
            >
              <Settings2 size={18} />后台管理
            </button>
          )}
        </nav>
        <div className="integration">
          <p>{session.name} · {roleLabel(session.role)}</p>
          <button type="button" onClick={() => setNotice(feishuConfigured ? "飞书配置已保存。正式收发群文件还需要在飞书开放平台把事件订阅 URL 指向当前服务。" : "飞书未配置：请到后台管理 > 产品设置填写 App ID、App Secret 和事件订阅地址。")}><MessageSquareText size={16} />飞书机器人</button>
          <button type="button" onClick={() => setNotice(wechatConfigured ? "企业微信配置已保存。正式通知需要在企业微信后台启用机器人或应用回调。" : "企业微信未配置：请到后台管理 > 产品设置填写 Webhook 或企业应用信息。")}><MessageSquareText size={16} />企业微信</button>
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
            {isAdmin && <button type="button" className="ghost" onClick={() => setView("admin")}><UserCog size={16} />成员管理</button>}
            {isAdmin && <button type="button" className={aiConfigured ? "ghost" : "ghost warning"} onClick={() => setView("admin:ai")}><Bot size={16} />{aiConfigured ? "AI 已接入" : "接入 AI"}</button>}
            <button type="button" className="primary" onClick={() => setUploadOpen(true)}><Plus size={16} />新建项目</button>
          </div>
        </header>
        {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>知道了</button></div>}
        {filterOpen && <div className="filter-panel">
          <button type="button" className={role === "全部角色" ? "active" : ""} onClick={() => setRole("全部角色")}>全部提醒</button>
          {["PM", "销售", "管理层"].map((item) => (
            <button type="button" className={role === item ? "active" : ""} key={item} onClick={() => setRole(item)}>{item}</button>
          ))}
        </div>}

        {!projects.length && activeView !== "management" && (
          <EmptyProjectState
            isManagement={isManagement}
            onUpload={() => setUploadOpen(true)}
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
        {activeView === "management" && isManagement && <ManagementCockpit
          projects={projects}
          approvals={state?.approvals || []}
          settings={state?.settings || {}}
          session={session}
          stats={stats}
          subView={activeSubView}
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
                  onSelect={setSelectedId}
                  onUpload={() => setUploadOpen(true)}
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
                <button type="button" onClick={() => setUploadOpen(true)}><UploadCloud size={16} />上传合同/执行表</button>
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
              comments={state?.comments || []}
              auditLogs={state?.auditLogs || []}
              onDone={() => loadState()}
              onNotice={setNotice}
            />
          </section>
        )}
        {uploadOpen && <UploadDialog
          session={session}
          projects={projects}
          selected={selected}
          onClose={() => setUploadOpen(false)}
          onDone={() => loadState()}
        />}
      </main>
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

function EmptyProjectState({ isManagement, isAdmin, onUpload, onAdmin }) {
  return (
    <section className="empty-project-state">
      <div>
        <PanelTitle icon={FileText} title="还没有真实项目" />
        <h2>先上传第一份合同或报价表，OA 才会开始生成项目数据。</h2>
        <p>{isManagement ? "上传后会自动进入项目台账、审批、回款、成本复盘和经营舱统计。" : "如果你还看不到项目，可能是管理员还没有把你绑定到项目里。"}</p>
        <div className="button-row">
          <button type="button" className="primary" onClick={onUpload}><UploadCloud size={16} />上传合同创建项目</button>
          {isAdmin && <button type="button" className="ghost" onClick={onAdmin}><UserCog size={16} />成员与权限</button>}
        </div>
      </div>
      <div className="empty-steps">
        <div><strong>1</strong><span>上传合同 / 报价表</span></div>
        <div><strong>2</strong><span>AI 预览识别字段</span></div>
        <div><strong>3</strong><span>确认入库生成项目</span></div>
        <div><strong>4</strong><span>审批、回款、成本复盘开始流转</span></div>
      </div>
    </section>
  );
}

function EmployeeProjectOverview({ projects, selected, onSelect, onUpload }) {
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const health = projectHealth(selected);
  const pettyLeft = Math.max(Number(selected.pettyCashBudget || 0) - Number(selected.pettyCashUsed || 0), 0);
  const missingItems = [
    selected.contract ? null : "合同金额待补",
    selected.files?.length ? null : "项目文件待上传",
    selected.paymentDue && selected.paymentDue !== "待确认回款节点" ? null : "回款节点待确认",
    selected.costUsed ? null : "成本表待归集",
  ].filter(Boolean);
  const displayMissing = missingItems.length ? missingItems : ["合同、成本、核销材料目前没有明显缺口"];
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
            {selected.tasks.map(([name, value]) => (
              <div className="employee-task" key={name}>
                <span>{name}</span>
                <b>{value}%</b>
                <div><i style={{ width: `${value}%` }} /></div>
              </div>
            ))}
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

function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onDone, onNotice }) {
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
    let reply = "";
    try {
      reply = await answerAiQuestion({ query, session, projects, approvals, settings, stats, selected, onDone });
    } catch (error) {
      reply = `这次没办成：${error.message}`;
    }
    setMessages((items) => [
      ...items,
      { from: "user", title: session.name, text: query },
      { from: "assistant", title: "AI 项目助手", text: reply },
    ].slice(-7));
    setQuestion("");
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
      </div>

      <div className="ai-feed">
        {messages.map((message, index) => (
          <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
            <span>{message.title}</span>
            <p>{message.text}</p>
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

function ProjectDetail({ project, isManagement, session, files, parseJobs, approvals, comments, auditLogs, onDone, onNotice }) {
  const usedRate = project.costBudget ? Math.round((project.costUsed / project.costBudget) * 100) : 0;
  const health = projectHealth(project);
  const pettyCashLeft = Math.max(Number(project.pettyCashBudget || 0) - Number(project.pettyCashUsed || 0), 0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [form, setForm] = useState({});
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
  const projectComments = comments.filter((item) => item.project === project.name);
  const projectLogs = auditLogs.filter((item) => item.target === project.name);
  const materialStatus = projectMaterialStatus(project, uniqueFiles, projectJobs);
  const actionItems = projectActionItems({ project, files: uniqueFiles, jobs: projectJobs, approvals: projectApprovals, health, isManagement });
  const activityItems = [
    ...projectJobs.map((job) => ({ at: job.updatedAt || job.createdAt, title: "AI 解析", text: `${job.projectName} · ${job.status} · ${job.progress || 0}%` })),
    ...projectApprovals.map((item) => ({ at: item.updatedAt || item.createdAt, title: item.typeLabel || "审批", text: `${item.status} · ${money(item.amount)} · ${item.applicantName || ""}` })),
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

      <div className="detail-metrics">
        <Mini label="合同金额" value={money(project.contract)} />
        <Mini label="备用金余额" value={money(pettyCashLeft)} />
        <Mini label="已回款" value={money(project.paid)} />
        <Mini label={isManagement ? "毛利率" : "项目状态"} value={isManagement ? `${project.margin}%` : health.label} />
      </div>

      <section className="detail-section workbench-block">
        <div className="section-head">
          <h2>项目推进清单</h2>
          <span className="muted">{materialStatus.doneCount}/4 项关键材料已完成</span>
        </div>
        <div className="material-grid">
          {materialStatus.items.map((item) => (
            <div className={item.done ? "done" : "todo"} key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.tip}</span>
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
          ) : (
            <button type="button" onClick={() => setEditing(true)}>编辑</button>
          )}
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

      <div className="split">
        <div>
          <h3>执行进度</h3>
          {project.tasks.map(([name, value]) => (
            <div className="progress-row" key={name}>
              <span>{name}</span>
              <div><i style={{ width: `${value}%` }} /></div>
              <b>{value}%</b>
            </div>
          ))}
        </div>
        <div>
          <h3>成本构成</h3>
          {project.costs.map(([name, value]) => (
            <div className="cost-row" key={name}>
              <span>{name}</span>
              <b>{money(value)}</b>
            </div>
          ))}
        </div>
      </div>

      <section className="detail-section">
        <div className="section-head">
          <h2>文件与 AI 解析</h2>
          <span className="muted">{uniqueFiles.length} 个文件 · {projectJobs.length} 个解析任务</span>
        </div>
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
      </section>

      <section className="detail-section">
        <div className="section-head">
          <h2>审批与成本记录</h2>
          <span className="muted">{projectApprovals.length} 条审批</span>
        </div>
        <div className="detail-list">
          {projectApprovals.length ? projectApprovals.slice(0, 6).map((item) => (
            <div key={item.id}>
              <strong>{item.typeLabel || item.category || "审批"} · {money(item.amount)}</strong>
              <span>{item.status} · {item.applicantName || "提交人"} · {item.reason || "暂无说明"}</span>
            </div>
          )) : <p className="muted">暂无审批记录。报销和备用金通过后会自动沉淀到这里。</p>}
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
    </div>
  );
}

function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onDone, onNotice }) {
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
    let reply = "";
    try {
      reply = await answerAiQuestion({ query, session, projects, approvals, settings, stats, selected, onDone });
    } catch (error) {
      reply = `这次没办成：${error.message}`;
    }
    setMessages((items) => [
      ...items,
      { from: "user", title: session.name, text: query },
      { from: "assistant", title: "AI 项目助手", text: reply },
    ].slice(-8));
    setQuestion(query);
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
        </div>
        <div className="ai-feed ai-workbench-feed">
          {messages.map((message, index) => (
            <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
              <span>{message.title}</span>
              <p>{message.text}</p>
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
  useEffect(() => {
    if (selected?.id) setForm((current) => ({ ...current, projectId: current.projectId || selected.id }));
  }, [selected?.id]);
  const normalizedApprovals = approvals.map((item) => ({
    ...item,
    project: item.projectName || item.project || "未命名项目",
    user: item.applicantName || item.user || "提交人",
    typeName: item.typeLabel || item.type || "审批",
    category: item.type === "petty_cash" ? "项目备用金" : item.type === "reimbursement" ? "报销" : item.category || "待我审批",
    scope: item.reason || item.scope || "暂无说明",
    steps: Array.isArray(item.steps) ? item.steps : []
  }));
  const categories = [
    { label: "待我审批", desc: "需要当前角色处理的审批", count: normalizedApprovals.filter((item) => item.status?.includes("待")).length },
    { label: "项目备用金", desc: "项目预算、已用和剩余额度", count: normalizedApprovals.filter((item) => item.category === "项目备用金").length },
    { label: "报销", desc: "员工报销、票据和入账状态", count: normalizedApprovals.filter((item) => item.category === "报销").length },
  ];
  const activeCategory = subView || "待我审批";
  const visibleApprovals = activeCategory === "待我审批"
    ? normalizedApprovals.filter((item) => item.status?.includes("待"))
    : normalizedApprovals.filter((item) => item.category === activeCategory);
  const fallbackApproval = normalizedApprovals[0] || {
    id: "",
    typeName: "暂无审批",
    project: selected.name,
    amount: 0,
    status: "等待提交",
    steps: []
  };
  const selectedApproval = visibleApprovals.find((item) => item.id === selectedApprovalKey) || visibleApprovals[0] || fallbackApproval;
  const canAct = selectedApproval.id && selectedApproval.status?.includes("待") && ["shareholder", "admin", "director", "pm", "finance"].includes(session.role);

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
      setSubView(form.type === "petty_cash" ? "项目备用金" : "报销");
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
    try {
      await apiRequest("/api/approvals/action", session, {
        method: "POST",
        body: JSON.stringify({ id: selectedApproval.id, action })
      });
      onNotice(action === "reject" ? "审批已驳回" : "审批已通过到下一步");
      onDone();
    } catch (error) {
      onNotice(error.message);
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
        <div className="approval-list">
          {visibleApprovals.length ? visibleApprovals.map((item) => (
            <div className="approval-card" key={item.id}>
              <div>
                <strong>{item.typeName}</strong>
                <span>{item.project} · {item.user} · {item.scope}</span>
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
          <button type="button" className="primary" onClick={() => act("approve")}>通过</button>
          <button type="button" className="ghost" onClick={() => act("reject")}>驳回</button>
        </div>}
      </div>

      <div className="feature-panel">
        <PanelTitle icon={CircleDollarSign} title="项目备用金" />
        <Mini label="预算额度" value={money(selected.pettyCashBudget)} />
        <Mini label="已使用" value={money(selected.pettyCashUsed)} />
        <Mini label="剩余额度" value={money(Math.max(selected.pettyCashBudget - selected.pettyCashUsed, 0))} />
      </div>
      <div className="feature-panel">
        <PanelTitle icon={ShieldAlert} title="AI 审批提示" />
        <p className="muted">备用金只用于执行人员拍摄、差旅、现场小额支出；供应商付款单独进入供应商支出。报销通过后自动计入项目成本。</p>
      </div>
    </section>
  );
}

function CloseoutReview({ project, isManagement, subView }) {
  const costRows = (project.costs || []).filter(([, value]) => Number(value) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
  const topCost = costRows[0] || ["待归集成本", project.costUsed];
  const totalCost = costRows.reduce((sum, [, value]) => sum + Number(value || 0), 0) || Number(project.costUsed || 0);
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
            <p>当前最大支出为「{topCost[0]}」{money(topCost[1])}。建议复盘供应商报价、追加审批和月度核销节奏，沉淀到下次同类项目启动清单。</p>
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={ShieldAlert} title="复盘风险" />
          <div className="compact-list">
            <div><strong>最大支出</strong><span>{topCost[0]} · {money(topCost[1])}</span></div>
            <div><strong>成本占合同</strong><span>{project.contract ? `${Math.round((Number(project.costUsed || 0) / Number(project.contract || 1)) * 100)}%` : "待确认合同"}</span></div>
            <div><strong>回款状态</strong><span>{project.receivable > 0 ? `待回款 ${money(project.receivable)}` : "已无待回款"}</span></div>
          </div>
        </div>
      </>}
      {showRanking && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={BarChart3} title="支出排行" />
          <div className="compact-list">
            {costRows.length ? costRows.slice(0, 8).map(([name, value]) => (
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
            <LogicItem title="优先复盘" text={`先看最大支出「${topCost[0]}」，确认是否有临时追加、供应商报价偏高或审批滞后。`} />
            <LogicItem title="下次控制" text="把高占比支出前置到立项预算里，并设置超过预算阈值时必须重新审批。" />
          </div>
        </div>
      </>}
    </section>
  );
}

function ManagementCockpit({ projects, approvals = [], settings = {}, session, stats, subView, onDone, onNotice }) {
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
  const cashHealthClass = metrics.runway.runwayLabel.includes("危险") || metrics.pressureLevel === "高" ? "danger" : metrics.pressureLevel === "中" ? "ok" : "good";
  const cashHealth = (
    <div className={`health-card ${cashHealthClass}`}>
      <div><span>压力等级</span><strong>{metrics.runway.runwayLabel.includes("危险") ? "危险" : metrics.pressureLevel}</strong></div>
      <div className="health-track"><i style={{ width: `${Math.min(100, metrics.pressureScore)}%` }} /></div>
      <p>{metrics.runway.runwayLabel}。待回款 {money(stats.receivable)} · 待备用金 {money(metrics.pendingPettyCash)} · 待报销 {money(metrics.pendingReimbursements)} · 待供应商付款 {money(metrics.pendingSupplierPay)}</p>
    </div>
  );
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

function UploadDialog({ session, projects, selected, onClose, onDone }) {
  const [type, setType] = useState("create-project");
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
  const targetProject = projects.find((project) => project.id === projectId) || selected || projects[0];
  const needsProject = type !== "create-project";
  const hasProjects = projects.length > 0;

  async function pickFiles(event) {
    const picked = Array.from(event.target.files || []);
    setMessage("");
    const payloads = await Promise.all(picked.map(fileToPayload));
    const oversized = picked.find((file) => file.size > 40 * 1024 * 1024 && /pdf/i.test(file.type || file.name));
    setFiles(payloads);
    if (oversized) setMessage("已选择超过 40MB 的 PDF，完整 OCR 可能需要几分钟，请不要重复提交。");
    setPreview(null);
    setConfirmed(false);
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
    setLoading(true);
    setMessage("AI 正在预览识别结果，预览阶段不会写入项目。");
    try {
      const data = await apiRequest("/api/projects/upload-preview", session, {
        method: "POST",
        body: JSON.stringify(uploadBody()),
      });
      setPreview(data);
      setConfirmed(false);
      setMessage(data.canConfirm ? "请检查识别结果，确认无误后再入库。" : "识别结果需要处理后才能入库。");
    } catch (error) {
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
    setLoading(true);
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
      await onDone();
      setTimeout(onClose, 700);
    } catch (error) {
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

  return (
    <div className="modal-backdrop">
      <form className="upload-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>上传到项目中台</h2>
            <p>沿用现有 AI 解析流程，不改动表格统计逻辑。</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>关闭</button>
        </div>

        <label>
          <span>上传类型</span>
          <select value={type} onChange={(event) => {
            setType(event.target.value);
            setPreview(null);
            setConfirmed(false);
            setMessage("");
          }}>
            <option value="create-project">新项目：合同 / 报价表</option>
            {hasProjects && <option value="cost-sheet">已有项目：执行成本表</option>}
            {hasProjects && <option value="quote-sheet">已有项目：合同报价表</option>}
            {hasProjects && <option value="verification-sheet">已有项目：月度核销表</option>}
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

        <label className="file-drop">
          <UploadCloud size={18} />
          <strong>{files.length ? `已选择 ${files.length} 个文件` : "选择合同、报价表、成本表或核销表"}</strong>
          <span>支持 PDF / Word / Excel / CSV / 图片。大 PDF 请耐心等待 OCR。</span>
          <input type="file" multiple onChange={pickFiles} />
        </label>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((file) => (
              <div key={`${file.name}-${file.size}`}>
                <strong>{file.name}</strong>
                <span>{fileSize(file.size)}</span>
              </div>
            ))}
          </div>
        )}

        {preview && <UploadPreview preview={preview} />}

        {message && <p className="form-message">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          {preview && !confirmed && <button type="button" className="ghost" onClick={requestPreview} disabled={loading}>重新预览</button>}
          <button type="submit" className="primary" disabled={loading || (preview && !preview.canConfirm)}>{loading ? "处理中" : preview ? "确认入库" : "AI 预览识别"}</button>
        </div>
      </form>
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
                <b>{row.amount || row.unitPrice ? money(row.amount || row.unitPrice) : row.matched || ""}</b>
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
  const [adminTab, setAdminTab] = useState(initialTab);
  const [members, setMembers] = useState([]);
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
  });
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

  async function loadSettings() {
    const res = await fetch("/api/state", { headers: { "x-user-id": session.id } });
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "读取设置失败");
    const settings = payload.data?.settings || {};
    setAiSettings((current) => ({ ...current, ...(settings.aiService || {}) }));
    setProductSettings((current) => ({ ...current, ...(settings.product || {}) }));
    setFeishuSettings((current) => ({ ...current, ...(settings.feishu || {}) }));
    setWechatSettings((current) => ({ ...current, ...(settings.wechat || {}) }));
    setStorageSettings((current) => ({ ...current, ...(settings.storage || {}) }));
    setApprovalSettings((current) => ({ ...current, ...(settings.approvalRules || {}) }));
  }

  useEffect(() => {
    loadMembers().catch((err) => setMessage(err.message));
    loadSettings().catch((err) => setSettingsMessage(err.message));
  }, []);

  function edit(member) {
    setEditingId(member.id);
    setForm({
      name: member.name || "",
      email: member.email || "",
      role: member.role || "member",
      department: member.department || "",
      status: member.status || "active",
      pin: "",
    });
    setMessage("");
  }

  function resetForm() {
    setEditingId("");
    setForm({ name: "", email: "", role: "member", department: "", status: "active", pin: "123456" });
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
          <button type="button" className={`admin-nav-link ${adminTab === "members" ? "active" : ""}`} onClick={() => setAdminTab("members")}><UsersRound size={18} />成员管理</button>
          <button type="button" className={`admin-nav-link ${adminTab === "ai" ? "active" : ""}`} onClick={() => setAdminTab("ai")}><Bot size={18} />AI 接入</button>
          <button type="button" className={`admin-nav-link ${adminTab === "product" ? "active" : ""}`} onClick={() => setAdminTab("product")}><Settings2 size={18} />产品设置</button>
        </nav>
        <div className="integration">
          <p>{session.name} · {roleLabel(session.role)}</p>
          <button type="button" onClick={onLogout}><LogOut size={16} />退出登录</button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{adminTab === "members" ? "成员管理" : adminTab === "ai" ? "AI 接入" : "产品设置"}</h1>
            <p>{adminTab === "members" ? "维护内部账号、角色和后台访问权限" : adminTab === "ai" ? "配置 DeepSeek、Kimi、OpenAI 或兼容模型，用于合同和表格智能解析" : "维护产品基础参数和上传提醒"}</p>
          </div>
          {adminTab === "members" && <button type="button" className="ghost" onClick={resetForm}><Plus size={16} />新增成员</button>}
        </header>

        {adminTab === "members" && <section className="admin-grid">
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
                  <span>{member.email} · {member.department || "未分组"}</span>
                </div>
                <b className={`role-pill ${member.role}`}>{roleLabel(member.role)}</b>
                <b className={`status-pill ${member.status}`}>{member.status === "disabled" ? "已停用" : "启用中"}</b>
                <button type="button" className="ghost" onClick={() => edit(member)}>编辑</button>
                <button type="button" className="ghost" onClick={() => toggle(member)}>{member.status === "disabled" ? "启用" : "停用"}</button>
              </div>
            ))}
          </div>
        </section>}

        {adminTab === "ai" && <section className="admin-grid">
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

        {adminTab === "product" && <section className="admin-grid">
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
                ["verificationToken", "Verification Token"]
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input value={feishuSettings[key]} onChange={(event) => setFeishuSettings({ ...feishuSettings, [key]: event.target.value })} />
                </label>
              ))}
              <button type="button" className="ghost" onClick={() => saveTypedSetting("feishu", feishuSettings, "飞书配置")}>保存飞书配置</button>
            </div>
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
  if ((view === "admin" || view === "admin:ai") && ["shareholder", "admin"].includes(session.role)) {
    return <AdminMembers session={session} setView={setView} onLogout={logout} initialTab={view === "admin:ai" ? "ai" : "members"} />;
  }
  return <ProjectDashboard session={session} view={view} setView={setView} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<AppShell />);
