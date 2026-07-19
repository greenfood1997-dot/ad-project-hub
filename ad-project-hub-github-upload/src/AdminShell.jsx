import React, { Suspense, useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, Cloud, Coins, DatabaseBackup, HeartPulse, LayoutDashboard, LogOut, Plus, Settings2, Trash2, UserCog, UsersRound, WalletCards } from "lucide-react";
import { downloadFile } from "./utils/api.js";
import { money } from "./utils/format.js";
import { canManageAssignmentsRole, canUseAdminRole, roleLabel, roleOptions } from "./utils/permissions.js";
import { deployReadinessActions } from "./utils/deployReadiness.js";
import ModuleFallback from "./ModuleFallback.jsx";
import "./admin-settings.css";
import "./member.css";

const ProjectAssignmentPanel = React.lazy(() => import("./ProjectAssignmentPanel.jsx"));
const FeishuBotPanel = React.lazy(() => import("./FeishuBotPanel.jsx"));
const DeployHealthPanel = React.lazy(() => import("./DeployHealthPanel.jsx"));
const BackupRestorePanel = React.lazy(() => import("./BackupRestorePanel.jsx"));
const IntegrationSettingsPanel = React.lazy(() => import("./IntegrationSettingsPanel.jsx"));
const AiSettingsPanel = React.lazy(() => import("./AiSettingsPanel.jsx"));
const ProductSettingsForm = React.lazy(() => import("./ProductSettingsForm.jsx"));
const AdminMemberPanel = React.lazy(() => import("./AdminMemberPanel.jsx"));
const InterestRatePanel = React.lazy(() => import("./InterestRatePanel.jsx"));
const ProjectCleanupPanel = React.lazy(() => import("./ProjectCleanupPanel.jsx"));
const CompensationSettingsPanel = React.lazy(() => import("./CompensationSettingsPanel.jsx"));

const PRODUCT_SETTING_SECTIONS = [
  { id: "basics", title: "基础参数", short: "产品名称与运行规则", icon: Settings2 },
  { id: "interest", title: "利率与垫资", short: "LPR 与资金成本", icon: Coins },
  { id: "compensation", title: "人力与分红", short: "工资分摊与股东分红", icon: WalletCards },
  { id: "collaboration", title: "协同与存储", short: "飞书、微信与对象存储", icon: Cloud },
  { id: "feishu-bot", title: "飞书机器人", short: "绑定、文件与消息记录", icon: Bot },
  { id: "health", title: "上线健康检查", short: "部署与服务状态", icon: HeartPulse },
  { id: "backup", title: "备份与恢复", short: "业务数据安全恢复", icon: DatabaseBackup },
  { id: "cleanup", title: "项目回收站", short: "误建项目与云端文件", icon: Trash2 },
];

function ProductSettingsSection({ id, title, description, openSection, children }) {
  if (openSection !== id) return null;
  return (
    <section className="product-settings-section open">
      <header className="product-settings-page-head"><strong>{title}</strong><span>{description}</span></header>
      <div className="product-settings-body">{children}</div>
    </section>
  );
}

export default function AdminShell({ session, setView, onLogout, initialTab = "members", buildVersion }) {
  const memberEditorRef = useRef(null);
  const isAdmin = canUseAdminRole(session);
  const canManageAssignments = canManageAssignmentsRole(session);
  const [adminTab, setAdminTab] = useState(initialTab);
  const [openProductSection, setOpenProductSection] = useState("basics");
  const [members, setMembers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [projectRecords, setProjectRecords] = useState([]);
  const [adminState, setAdminState] = useState({});
  const [feishuBindings, setFeishuBindings] = useState([]);
  const [feishuEvents, setFeishuEvents] = useState([]);
  const [feishuPendingFiles, setFeishuPendingFiles] = useState([]);
  const [systemNotifications, setSystemNotifications] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [savingMember, setSavingMember] = useState(false);
  const [togglingMemberId, setTogglingMemberId] = useState("");
  const [cleaningDefaultAccounts, setCleaningDefaultAccounts] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [testingAi, setTestingAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [savingProductSettings, setSavingProductSettings] = useState(false);
  const [savingSettingType, setSavingSettingType] = useState("");
  const [testingStorage, setTestingStorage] = useState(false);
  const [refreshingInterestRate, setRefreshingInterestRate] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
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
  const [focusFeishuField, setFocusFeishuField] = useState(null);
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
  const [alertSettings, setAlertSettings] = useState({ autoNotifyEnabled: false, autoNotifyChannels: [] });
  const [interestRate, setInterestRate] = useState({});
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
  const aiReady = Boolean(aiSettings["API Key"] || aiSettings.configured || deployHealth?.aiEnv?.databaseConfigured);
  const activeMembers = members.filter((member) => member.status !== "disabled");
  const feishuBoundCount = activeMembers.filter((member) => member.feishuOpenId || member.feishuUserId).length;
  const feishuMissingMembers = activeMembers.filter((member) => !member.feishuOpenId && !member.feishuUserId);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token || ""}`,
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
    const res = await fetch("/api/state", { headers: { authorization: `Bearer ${session.token || ""}`, "x-user-id": session.id } });
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "读取设置失败");
    const settings = payload.data?.settings || {};
    setProjectRecords(payload.data?.projects || []);
    setAdminState(payload.data || {});
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
    setAlertSettings((current) => ({ ...current, ...(settings.alertSettings || {}), autoNotifyChannels: Array.isArray(settings.alertSettings?.autoNotifyChannels) ? settings.alertSettings.autoNotifyChannels : [] }));
    setInterestRate(settings.interestRate || {});
  }

  async function loadDeployHealth({ silent = false } = {}) {
    setCheckingDeployHealth(true);
    if (!silent) setSettingsMessage("正在检查线上部署状态...");
    try {
      const res = await fetch("/api/health");
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "健康检查失败");
      setDeployHealth(payload.data || null);
      if (!silent) setSettingsMessage(payload.data?.version === buildVersion ? "线上版本检查通过，后台和服务端是同一版。" : "线上版本可能不是最新版，请重新部署或检查是否上传了旧包。");
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
    requestAnimationFrame(() => {
      memberEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      memberEditorRef.current?.querySelector('input[name="member-name"]')?.focus({ preventScroll: true });
    });
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

  async function cleanDefaultAccounts() {
    if (!window.confirm("将停用其余仍使用默认 PIN 的内置账号。确认继续？")) return;
    setCleaningDefaultAccounts(true);
    try {
      const result = await api("/api/members/disable-insecure-defaults", { method: "POST", body: "{}" });
      await Promise.all([loadMembers(), loadDeployHealth({ silent: true })]);
      setMessage(`已停用 ${result.disabledCount || 0} 个默认账号。需要使用的员工请逐个设置临时 PIN 后再启用。`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setCleaningDefaultAccounts(false);
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
    if (type === "alertSettings") return "下一步：只会在后台巡检发现新的高风险待办时自动发送，不会重复推送旧待办。";
    return "配置已写入后台。";
  }
  const automaticNotificationChannels = Array.isArray(alertSettings.autoNotifyChannels) ? alertSettings.autoNotifyChannels : [];
  const automaticNotificationStatus = (() => {
    if (!(alertSettings.autoNotifyEnabled === true || alertSettings.autoNotifyEnabled === "true")) return { ready: true, text: "当前保持关闭。保存后不会自动向外发送任何提醒。" };
    if (!automaticNotificationChannels.length) return { ready: false, text: "已开启自动提醒，但尚未选择飞书或企业微信渠道。" };
    const missing = [
      automaticNotificationChannels.includes("feishu") && !(feishuSettings.appId && feishuSettings.appSecret) ? "飞书 App ID / Secret" : "",
      automaticNotificationChannels.includes("wechat") && !wechatSettings.webhookUrl ? "企业微信 Webhook" : ""
    ].filter(Boolean);
    return missing.length
      ? { ready: false, text: `自动提醒已开启，但还缺少：${missing.join("、")}。高风险待办仍会保留在 OA。` }
      : { ready: true, text: `已准备自动推送：${automaticNotificationChannels.includes("feishu") ? "飞书" : ""}${automaticNotificationChannels.length === 2 ? " + " : ""}${automaticNotificationChannels.includes("wechat") ? "企业微信" : ""}。请确保相关成员已绑定飞书 Open ID。` };
  })();
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
    },
    {
      type: "alertSettings",
      title: "自动外部提醒",
      ok: automaticNotificationStatus.ready,
      status: automaticNotificationStatus.text,
      next: settingNextStep("alertSettings")
    }
  ];
  const deployCheckItems = [
    {
      title: "前后端版本",
      ok: deployHealth?.version === buildVersion,
      status: deployHealth?.version ? `页面 ${buildVersion} / 服务端 ${deployHealth.version}${deployHealth.deployedCommit ? ` · 提交 ${deployHealth.deployedCommit.slice(0, 8)}` : ""}` : "正在读取版本",
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
      title: "AI 配置与环境兜底",
      ok: aiReady || Boolean(deployHealth?.aiEnv?.apiKey),
      status: aiReady
        ? `后台已保存 AI Key${deployHealth?.aiEnv?.apiKey ? " · Render 兜底已配置" : " · Render 兜底未配置"}`
        : deployHealth?.aiEnv?.apiKey ? "Render 已配置 AI_API_KEY" : "后台与 Render 均未检测到 AI Key",
      next: aiReady && !deployHealth?.aiEnv?.apiKey
        ? "后台 AI 可正常使用；如需部署级兜底，可选配 AI_API_KEY、AI_BASE_URL、AI_MODEL。"
        : "如果后台 Key 丢失，可在 Render 环境变量配置 AI_API_KEY、AI_BASE_URL、AI_MODEL。"
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
      title: "原始文件存储",
      ok: deployHealth?.filePersistenceReady === true,
      status: deployHealth?.objectStorageConfigured ? "已配置对象存储" : "未配置对象存储",
      next: deployHealth?.filePersistenceReady ? "合同、发票和票据具备长期保存条件。" : "生产环境请配置 S3、R2 或 MinIO Bucket，Render 本地文件只适合测试。"
    },
    {
      title: "后台定时巡检",
      ok: Boolean(deployHealth?.scheduler?.enabled),
      status: deployHealth?.scheduler?.enabled ? `每 ${Math.round((deployHealth.scheduler.intervalMs || 0) / 60000)} 分钟 · 已跑 ${deployHealth.scheduler.runCount || 0} 次` : "未启用",
      next: deployHealth?.scheduler?.lastError ? `最近错误：${deployHealth.scheduler.lastError}` : "用于自动扫描项目分派、进度、审批、现金流和文件待办。"
    }
  ];
  const deployReadyCount = deployCheckItems.filter((item) => item.ok).length;
  const deployReadinessSteps = deployReadinessActions(deployHealth || {}, deployCheckItems, buildVersion);

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

  async function refreshInterestRate() {
    setRefreshingInterestRate(true);
    setSettingsMessage("正在联网刷新 1 年期 LPR...");
    try {
      const data = await api("/api/settings/interest-rate/refresh", { method: "POST", body: JSON.stringify({}) });
      setInterestRate(data || {});
      setSettingsMessage(data?.status === "已刷新"
        ? `利率已刷新：当前年化 ${data.annualRate}% 。`
        : `联网未成功，已继续使用兜底利率 ${data.annualRate}% 。`);
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setRefreshingInterestRate(false);
    }
  }

  async function deleteMistakenProject(project) {
    setDeletingProject(true);
    setSettingsMessage(`正在将「${project.name}」及关联记录移入回收站...`);
    try {
      await api("/api/projects/delete", { method: "POST", body: JSON.stringify({ id: project.id }) });
      await Promise.all([loadAssignments(), loadSettings()]);
      setSettingsMessage(`项目「${project.name}」已移入回收站，云端文件保留 30 天。`);
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setDeletingProject(false);
    }
  }

  async function restoreRecycledProject(item) {
    setDeletingProject(true);
    try {
      await api("/api/projects/restore", { method: "POST", body: JSON.stringify({ id: item.id }) });
      await Promise.all([loadAssignments(), loadSettings()]);
      setSettingsMessage(`项目「${item.projectName}」及关联云端文件已恢复。`);
    } catch (err) {
      setSettingsMessage(err.message);
    } finally {
      setDeletingProject(false);
    }
  }

  async function loadFeishuBindings() {
    setFeishuBindings(await api("/api/integrations/feishu/bindings"));
    const res = await fetch("/api/state", { headers: { authorization: `Bearer ${session.token || ""}`, "x-user-id": session.id } });
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

        {isAdmin && adminTab === "members" && (
          <Suspense fallback={<ModuleFallback title="成员管理加载中" />}>
            <AdminMemberPanel
              members={members}
              activeMembers={activeMembers}
              feishuBoundCount={feishuBoundCount}
              feishuMissingMembers={feishuMissingMembers}
              editingId={editingId}
              form={form}
              message={message}
              savingMember={savingMember}
              togglingMemberId={togglingMemberId}
              insecureDefaultAccountCount={Number(deployHealth?.insecureDefaultAccountCount || 0)}
              cleaningDefaultAccounts={cleaningDefaultAccounts}
              roleOptions={roleOptions}
              roleLabel={roleLabel}
              onSave={save}
              onEdit={edit}
              onToggle={toggle}
              onCleanDefaultAccounts={cleanDefaultAccounts}
              onUpdateForm={setForm}
              editorRef={memberEditorRef}
            />
          </Suspense>
        )}

        {canManageAssignments && adminTab === "assignments" && (
          <Suspense fallback={<ModuleFallback title="项目分派加载中" />}>
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
          </Suspense>
        )}

        {isAdmin && adminTab === "ai" && (
          <Suspense fallback={<ModuleFallback title="AI 接入加载中" />}>
            <AiSettingsPanel
              aiSettings={aiSettings}
              setAiSettings={setAiSettings}
              aiReady={aiReady}
              settingsMessage={settingsMessage}
              testingAi={testingAi}
              savingAi={savingAi}
              onApplyProviderPreset={applyProviderPreset}
              onTestAi={testAi}
              onSaveAi={saveAi}
            />
          </Suspense>
        )}

        {isAdmin && adminTab === "product" && <section className="product-settings-layout">
          <nav className="product-settings-nav" aria-label="产品设置分类">
            <div className="product-settings-nav-head"><strong>设置分类</strong><span>每次只处理一类设置</span></div>
            {PRODUCT_SETTING_SECTIONS.map(({ id, title, short, icon: Icon }) => <button type="button" key={id} className={openProductSection === id ? "active" : ""} aria-current={openProductSection === id ? "page" : undefined} onClick={() => setOpenProductSection(id)}>
              <Icon size={18} /><span><strong>{title}</strong><em>{short}</em></span><ChevronRight size={16} />
            </button>)}
          </nav>
          <div className="product-settings-content">
          <ProductSettingsSection id="basics" title="基础参数" description="公司名称、默认预算比例和自动巡检频率" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="基础参数加载中" />}>
            <ProductSettingsForm
              productSettings={productSettings}
              setProductSettings={setProductSettings}
              settingsMessage={settingsMessage}
              savingProductSettings={savingProductSettings}
              onSaveProductSettings={saveProductSettings}
            />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="interest" title="利率与垫资成本" description="刷新 LPR，维护项目垫资利息计算口径" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="利率配置加载中" />}>
            <InterestRatePanel
              interestRate={interestRate}
              refreshing={refreshingInterestRate}
              onRefresh={refreshInterestRate}
            />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="compensation" title="人力成本与股东分红" description="成员工资分摊、股东项目分红和全年汇总" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="薪酬与分红配置加载中" />}>
              <CompensationSettingsPanel api={api} session={session} />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="cleanup" title="误建项目清理" description="清理重复建项或上传错误的项目及关联记录" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="项目清理加载中" />}>
            <ProjectCleanupPanel
              projects={projectRecords}
              state={adminState}
              recycleBin={adminState.cloudRecycleBin || []}
              deleting={deletingProject}
              onDelete={deleteMistakenProject}
              onRestore={restoreRecycledProject}
            />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="backup" title="备份与安全恢复" description="导出、校验和恢复 OA 业务数据" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="备份校验加载中" />}>
              <BackupRestorePanel
                backupText={backupText}
                backupCheck={backupCheck}
                backupRestoreConfirm={backupRestoreConfirm}
                exportingBackup={exportingBackup}
                validatingBackup={validatingBackup}
                restoringBackup={restoringBackup}
                onExport={exportBackup}
                onValidate={validateBackup}
                onRestore={restoreBackup}
                onBackupTextChange={setBackupText}
                onRestoreConfirmChange={setBackupRestoreConfirm}
                onClear={() => {
                  setBackupText("");
                  setBackupCheck(null);
                  setBackupRestoreConfirm("");
                }}
              />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="health" title="上线健康检查" description={`${deployReadyCount}/${deployCheckItems.length} 项就绪 · 部署、数据库、文件、AI 与 OCR`} openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="上线健康检查加载中" />}>
              <DeployHealthPanel
                items={deployCheckItems}
                actions={deployReadinessSteps}
                readyCount={deployReadyCount}
                total={deployCheckItems.length}
                checkedAt={deployHealth?.checkedAt}
                rootDirectory={deployHealth?.rootDirectory}
                nodeEnv={deployHealth?.nodeEnv}
                scheduler={deployHealth?.scheduler}
                checking={checkingDeployHealth}
                onRefresh={() => loadDeployHealth()}
              />
            </Suspense>
            <div className="integration-status-grid">
              {integrationStatusCards.map((item) => (
                <div className={item.ok ? "ok" : "warn"} key={item.type}>
                  <strong>{item.title}</strong>
                  <span>{item.status}</span>
                  <em>{item.next}</em>
                </div>
              ))}
            </div>
          </ProductSettingsSection>
          <ProductSettingsSection id="collaboration" title="协同与生产配置" description="飞书、企业微信、对象存储、审批阈值与自动提醒" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="协同配置加载中" />}>
              <IntegrationSettingsPanel
                feishuSettings={feishuSettings}
                setFeishuSettings={setFeishuSettings}
                wechatSettings={wechatSettings}
                setWechatSettings={setWechatSettings}
                storageSettings={storageSettings}
                setStorageSettings={setStorageSettings}
                approvalSettings={approvalSettings}
                setApprovalSettings={setApprovalSettings}
                alertSettings={alertSettings}
                setAlertSettings={setAlertSettings}
                savingSettingType={savingSettingType}
                syncingFeishuContacts={syncingFeishuContacts}
                feishuSyncResult={feishuSyncResult}
                testingStorage={testingStorage}
                storageTestResult={storageTestResult}
                settingNextStep={settingNextStep}
                automaticNotificationStatus={automaticNotificationStatus}
                onSaveTypedSetting={saveTypedSetting}
                onSyncFeishuContacts={syncFeishuContacts}
                focusFeishuField={focusFeishuField}
                onTestStorageUpload={testStorageUpload}
              />
            </Suspense>
          </ProductSettingsSection>
          <ProductSettingsSection id="feishu-bot" title="飞书机器人工作台" description="项目绑定、待确认文件、事件记录和消息发送" openSection={openProductSection} setOpenSection={setOpenProductSection}>
            <Suspense fallback={<ModuleFallback title="飞书机器人加载中" />}>
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
                onConfigureField={(field) => {
                  setFocusFeishuField({ field, requestedAt: Date.now() });
                  setOpenProductSection("collaboration");
                }}
              />
            </Suspense>
          </ProductSettingsSection>
          </div>
        </section>}
      </main>
    </div>
  );
}
