import React, { Suspense, useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, FileSpreadsheet, MessageSquareText, UploadCloud } from "lucide-react";
import { apiRequest, uploadedFileKey } from "./utils/api.js";
import { downloadCsv, fileSize, money } from "./utils/format.js";
import { activityLedgerRows, paymentLedgerRows, taskLedgerRows } from "./utils/ledgerRows.js";
import { approvalTypeOptionsFor, canHandleFeishuPendingRole, canHandleProjectAlertRole, canRecordPaymentRole, canUseCollectionRole, canWriteProjectRole } from "./utils/permissions.js";
import { canWithdrawApproval, currentApprovalStepInfo } from "./utils/approvalFlow.js";
import { normalizeCostRow, normalizeTask, projectHealth, taskDueInfo } from "./utils/projectMetrics.js";
import { projectActionItems, projectAiAdvice, projectMaterialStatus } from "./utils/projectMaterials.js";
import { actionItemKey, canArchiveComment, parseJobTone } from "./utils/projectDetailUi.js";
import ModuleFallback from "./ModuleFallback.jsx";
import "./project-detail.css";

const UploadDialog = React.lazy(() => import("./UploadDialog.jsx"));
const ProjectActivityPanel = React.lazy(() => import("./ProjectActivityPanel.jsx"));
const ProjectSupplierPanel = React.lazy(() => import("./ProjectSupplierPanel.jsx"));
const ProjectApprovalPanel = React.lazy(() => import("./ProjectApprovalPanel.jsx"));
const ProjectPaymentPanel = React.lazy(() => import("./ProjectPaymentPanel.jsx"));
const ProjectProgressCostPanel = React.lazy(() => import("./ProjectProgressCostPanel.jsx"));
const ProjectFilesPanel = React.lazy(() => import("./ProjectFilesPanel.jsx"));
const ProjectCommandPanel = React.lazy(() => import("./ProjectCommandPanel.jsx"));
const ProjectOverviewPanel = React.lazy(() => import("./ProjectOverviewPanel.jsx"));

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

function RiskBadge({ risk }) {
  return <b className={`risk risk-${risk}`}>{risk}风险</b>;
}

function ProjectDetailSection({ id, title, description, openSection, setOpenSection, children }) {
  const open = openSection === id;
  return <section className={`project-detail-section ${open ? "open" : ""}`}>
    <button type="button" className="project-detail-section-trigger" aria-expanded={open} onClick={() => setOpenSection(open ? "" : id)}>
      <span><strong>{title}</strong><em>{description}</em></span>
      <ChevronDown size={20} />
    </button>
    {open && <div className="project-detail-section-body">{children}</div>}
  </section>;
}

export default function ProjectDetail({ project, isManagement, session, files, parseJobs, approvals, suppliers = [], clients = [], payments = [], collectionScripts = [], feishuPendingFiles = [], comments, alertUpdates = [], auditLogs, focusTarget = "", onFocusConsumed, onOpenApproval, onOpenSupplier, onOpenClient, onDone, onNotice }) {
  const usedRate = project.costBudget ? Math.round((project.costUsed / project.costBudget) * 100) : 0;
  const health = projectHealth(project);
  const pettyCashLeft = Math.max(Number(project.pettyCashBudget || 0) - Number(project.pettyCashUsed || 0), 0);
  const canEditProject = canWriteProjectRole(session);
  const canRecordPayment = canRecordPaymentRole(session);
  const canUseCollection = canUseCollectionRole(session);
  const canHandleFeishuPending = canHandleFeishuPendingRole(session);
  const canHandleProjectAlert = canHandleProjectAlertRole(session);
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
  const [openSection, setOpenSection] = useState("overview");
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
    setOpenSection("overview");
  }, [project.id]);

  useEffect(() => {
    const target = localFocusTarget || focusTarget;
    if (!target) return;
    const sectionByTarget = { advice: "overview", client: "overview", progress: "progress", files: "files", payments: "payments", approvals: "approvals", activity: "activity" };
    const nextSection = sectionByTarget[target];
    if (nextSection && openSection !== nextSection) {
      setOpenSection(nextSection);
      return;
    }
    if (!focusRefs[target]?.current) return;
    window.setTimeout(() => {
      focusRefs[target]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (localFocusTarget) setLocalFocusTarget("");
      if (focusTarget) onFocusConsumed?.();
    }, 120);
  }, [focusTarget, localFocusTarget, openSection, project.id]);

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
    setApprovalForm((current) => ({
      ...current,
      type: allowedType,
      payee: current.payee || session.name || "",
      reason: current.reason || reason
    }));
    setOpenSection("approvals");
    setLocalFocusTarget("approvals");
    onNotice(`已预填${allowedType === "petty_cash" ? "项目备用金" : allowedType === "supplier_payment" ? "供应商付款" : "报销"}申请，请补金额后提交。`);
  }

  function openMaterialUpload(item) {
    if (!item?.uploadType) return;
    if (item.uploadType === "create-project") {
      goProjectSection("files", `${item.label}已归档，已打开文件与 AI 解析区查看。`);
      return;
    }
    setQuickUploadType(item.uploadType);
    onNotice(`已为「${project.name}」准备上传${uploadTypeNames[item.uploadType] || item.label}，会先 AI 预览，确认后才写入项目。`);
  }

  function goProjectSection(target, message) {
    if (!target || !focusRefs[target]) return;
    const sectionByTarget = { advice: "overview", client: "overview", progress: "progress", files: "files", payments: "payments", approvals: "approvals", activity: "activity" };
    if (sectionByTarget[target]) setOpenSection(sectionByTarget[target]);
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

  async function downloadProjectFile(file) {
    try {
      const response = await fetch("/api/files/download", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token || ""}`, "x-user-id": session.id },
        body: JSON.stringify({ projectId: project.id, fileId: file.id || "", name: file.name, storageUrl: file.storageUrl })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "文件下载失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "项目文件";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onNotice(`已下载「${file.name || "项目文件"}」，请使用 WPS、Word 或 Excel 打开。`);
    } catch (error) {
      onNotice(error.message);
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
      <ProjectDetailSection id="overview" title="项目概览" description="客户交接、关键财务与 AI 建议" openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="项目概览加载中" variant="detail" />}>
        <ProjectOverviewPanel
          project={project}
          clientProfile={clientProfile}
          clientRef={focusRefs.client}
          health={health}
          pettyCashLeft={pettyCashLeft}
          isManagement={isManagement}
          baseInfoFresh={baseInfoFresh}
          editing={editing}
          saving={saving}
          canEditProject={canEditProject}
          form={form}
          aiAdvice={aiAdvice}
          adviceRef={focusRefs.advice}
          money={money}
          Mini={Mini}
          RiskBadge={RiskBadge}
          BotIcon={Bot}
          onOpenClient={onOpenClient}
          onSetEditing={setEditing}
          onSaveProject={saveProject}
          onUpdateForm={updateForm}
          onRunAdviceAction={runAdviceAction}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="command" title="项目工作台" description="材料状态、行动项与快捷操作" openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="项目工作台加载中" variant="detail" />}>
        <ProjectCommandPanel
          materialStatus={materialStatus}
          actionItems={actionItems}
          projectAlertUpdates={projectAlertUpdates}
          focusedActionKey={focusedActionKey}
          handlingActionKey={handlingActionKey}
          canHandleProjectAlert={canHandleProjectAlert}
          icons={{ UploadCloud, FileSpreadsheet, CheckCircle2, MessageSquareText }}
          actionItemKey={actionItemKey}
          onUploadType={setQuickUploadType}
          onRecordDynamic={() => setCommentText((current) => current || "客户已确认：")}
          onOpenMaterialUpload={openMaterialUpload}
          onHandleActionItem={handleActionItem}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="progress" title="进度与成本" description="任务节点、执行成本与预算使用" openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="项目进度加载中" variant="detail" />}>
        <ProjectProgressCostPanel
          progressRef={focusRefs.progress}
          project={project}
          projectTasks={projectTasks}
          taskForm={taskForm}
          taskTemplates={taskTemplates}
          costRows={costRows}
          isManagement={isManagement}
          approvalTypeOptions={approvalTypeOptions}
          exportingTaskLedger={exportingTaskLedger}
          savingTaskForm={savingTaskForm}
          completingTaskId={completingTaskId}
          archivingTaskId={archivingTaskId}
          focusedTaskId={focusedTaskId}
          money={money}
          taskDueInfo={taskDueInfo}
          onExportTaskLedger={exportTaskLedger}
          onSubmitTask={submitTask}
          onUpdateTaskForm={updateTaskForm}
          onSaveTask={saveTask}
          onArchiveTask={archiveTask}
          onPrepareTaskTemplate={prepareTaskTemplate}
          onPrepareCostAction={prepareCostAction}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="files" title="文件与 AI 解析" description={`${uniqueFiles.length} 个文件 · ${projectJobs.length} 个解析任务`} openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="文件与 AI 解析加载中" variant="detail" />}>
        <ProjectFilesPanel
          filesRef={focusRefs.files}
          uniqueFiles={uniqueFiles}
          projectJobs={projectJobs}
          projectFeishuPendingFiles={projectFeishuPendingFiles}
          projectFeishuHandledFiles={projectFeishuHandledFiles}
          materialStatus={materialStatus}
          canEditProject={canEditProject}
          canHandleFeishuPending={canHandleFeishuPending}
          reparsingProject={reparsingProject}
          handlingFeishuFile={handlingFeishuFile}
          copyingFileKey={copyingFileKey}
          archivingFileKey={archivingFileKey}
          focusedParseJobId={focusedParseJobId}
          progressingParseJobId={progressingParseJobId}
          fileSize={fileSize}
          uploadedFileKey={uploadedFileKey}
          parseJobTone={parseJobTone}
          onReparseCurrentProject={reparseCurrentProject}
          onHandleFeishuPendingFile={handleFeishuPendingFile}
          onOpenMaterialUpload={openMaterialUpload}
          onParsedMaterialNotice={(item) => onNotice(`${item.label}已解析：${item.files[0]?.name || item.jobs[0]?.status || "项目数据已入库"}`)}
          onCopyFileInfo={copyFileInfo}
          onArchiveProjectFile={archiveProjectFile}
          onUploadType={setQuickUploadType}
          onPrepareActivityTemplate={prepareActivityTemplate}
          onRefreshParseJob={refreshParseJob}
          onDownloadProjectFile={downloadProjectFile}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="approvals" title="审批与成本记录" description={`${projectApprovals.length} 条项目审批`} openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="审批与成本记录加载中" variant="detail" />}>
        <ProjectApprovalPanel
          approvalRef={focusRefs.approvals}
          project={project}
          session={session}
          approvalTypeOptions={approvalTypeOptions}
          approvalForm={approvalForm}
          projectApprovals={projectApprovals}
          submittingApproval={submittingApproval}
          withdrawingProjectApprovalId={withdrawingProjectApprovalId}
          money={money}
          currentApprovalStepInfo={currentApprovalStepInfo}
          canWithdrawApproval={canWithdrawApproval}
          onUpdateApprovalForm={updateApprovalForm}
          onSubmitProjectApproval={submitProjectApproval}
          onOpenApproval={onOpenApproval}
          onWithdrawProjectApproval={withdrawProjectApproval}
          onPrepareProjectApproval={prepareProjectApproval}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="payments" title="回款与催收" description={`${projectPayments.length} 条回款记录 · 待回款 ${money(project.receivable || 0)}`} openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="回款记录加载中" variant="detail" />}>
        <ProjectPaymentPanel
          paymentRef={focusRefs.payments}
          project={project}
          projectPayments={projectPayments}
          projectCollectionScripts={projectCollectionScripts}
          collectionDraft={collectionDraft}
          paymentForm={paymentForm}
          canRecordPayment={canRecordPayment}
          canUseCollection={canUseCollection}
          generatingCollection={generatingCollection}
          recordingPayment={recordingPayment}
          voidingPaymentId={voidingPaymentId}
          exportingPaymentLedger={exportingPaymentLedger}
          copyingCollectionId={copyingCollectionId}
          savingCollectionOutcomeId={savingCollectionOutcomeId}
          focusedPaymentId={focusedPaymentId}
          money={money}
          collectionFollowUpForm={collectionFollowUpForm}
          onExportPaymentLedger={exportPaymentLedger}
          onGenerateCollectionScript={generateCollectionScript}
          onCopyCollectionScript={copyCollectionScript}
          onMarkCollectionOutcome={markCollectionOutcome}
          onUpdateCollectionFollowUp={updateCollectionFollowUp}
          onSubmitPayment={submitPayment}
          onUpdatePaymentForm={updatePaymentForm}
          onVoidPayment={voidPayment}
          onPreparePaymentEntry={preparePaymentEntry}
          onUploadVerification={() => setQuickUploadType("verification-sheet")}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="suppliers" title="供应商结算" description={`${projectSuppliers.length} 条项目供应商记录`} openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="供应商结算加载中" variant="detail" />}>
        <ProjectSupplierPanel
          projectSuppliers={projectSuppliers}
          approvalTypeOptions={approvalTypeOptions}
          money={money}
          onOpenSupplier={onOpenSupplier}
          onPrepareSupplierPaymentApproval={prepareSupplierPaymentApproval}
          onUploadCostSheet={() => setQuickUploadType("cost-sheet")}
        />
      </Suspense>
      </ProjectDetailSection>

      <ProjectDetailSection id="activity" title="项目动态" description="评论、审计与最近操作记录" openSection={openSection} setOpenSection={setOpenSection}>
      <Suspense fallback={<ModuleFallback title="项目动态加载中" variant="detail" />}>
        <ProjectActivityPanel
          activityRef={focusRefs.activity}
          activityItems={activityItems}
          activityTemplates={activityTemplates}
          commentText={commentText}
          commenting={commenting}
          exportingActivityLedger={exportingActivityLedger}
          copyingActivityKey={copyingActivityKey}
          archivingActivityKey={archivingActivityKey}
          session={session}
          canArchiveComment={canArchiveComment}
          onCommentTextChange={setCommentText}
          onSubmitComment={submitComment}
          onExportActivityLedger={exportActivityLedger}
          onGoProjectSection={goProjectSection}
          onCopyActivityItem={copyActivityItem}
          onArchiveActivityItem={archiveActivityItem}
          onPrepareActivityTemplate={prepareActivityTemplate}
        />
      </Suspense>
      </ProjectDetailSection>

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
      {quickUploadType && <Suspense fallback={<ModuleFallback title="上传窗口加载中" variant="detail" />}>
        <UploadDialog
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
        />
      </Suspense>}
    </div>
  );
}
