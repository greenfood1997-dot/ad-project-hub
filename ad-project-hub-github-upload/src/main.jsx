import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  ChevronRight,
  LogOut,
  MessageSquareText,
  Settings2,
} from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { projectLedgerRows } from "./utils/ledgerRows.js";
import { defaultProjectFilters, filterProjects, hasActiveProjectFilters, projectDashboardStats } from "./utils/dashboardFilters.js";
import { cashChartOption, costChartOption, progressChartOption } from "./utils/dashboardCharts.js";
import { dashboardNavGroups } from "./utils/dashboardNavigation.js";
import { canCreateProjectRole, canManageAssignmentsRole, canSeeManagement, canUseAdminRole, canUseCollectionRole, roleLabel } from "./utils/permissions.js";
import { normalizeTask, projectHealth } from "./utils/projectMetrics.js";
import { projectMaterialStatus } from "./utils/projectMaterials.js";
import { notificationPriorityQueue } from "./utils/notifications.js";
import { normalizeProject } from "./utils/projectNormalize.js";
import DashboardTopbar from "./DashboardTopbar.jsx";
import LazyChart from "./LazyChart.jsx";
import ModuleFallback from "./ModuleFallback.jsx";
import "./styles.css";
import "./project-filter.css";

const SESSION_KEY = "ad-project-hub-session";
const DASHBOARD_AI_COLLAPSED_KEY = "ad-project-hub-dashboard-ai-collapsed";
const BUILD_VERSION = "2026-07-13-production-readiness-pass";
const NotificationDrawer = lazy(() => import("./NotificationDrawer.jsx"));
const LoginScreen = lazy(() => import("./LoginScreen.jsx"));
const DashboardContent = lazy(() => import("./DashboardContent.jsx"));

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
  const [uploadInstanceId, setUploadInstanceId] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dashboardAiCollapsed, setDashboardAiCollapsed] = useState(() => {
    try {
      return localStorage.getItem(DASHBOARD_AI_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [approvalFocusId, setApprovalFocusId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [handlingNotificationId, setHandlingNotificationId] = useState("");
  const [sendingNotificationId, setSendingNotificationId] = useState("");
  const [sendingWechatNotificationId, setSendingWechatNotificationId] = useState("");
  const [notificationLastAction, setNotificationLastAction] = useState(null);
  const [notice, setNotice] = useState("");
  const [exportingProjectLedger, setExportingProjectLedger] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [projectFilters, setProjectFilters] = useState(defaultProjectFilters);
  const [health, setHealth] = useState(null);
  const isAdmin = canUseAdminRole(session);
  const canManageAssignments = canManageAssignmentsRole(session);
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
  const visibleProjects = useMemo(() => filterProjects(projects, searchText, projectFilters, { materialStatus: projectMaterialStatus }), [projects, searchText, projectFilters]);
  const hasProjectFilters = hasActiveProjectFilters(searchText, projectFilters);
  const emptyProjectResultText = "当前搜索或筛选没有结果。";
  const clearProjectFiltersLabel = "清空搜索和筛选";
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

  useEffect(() => {
    if (view !== "app:create-project") return;
    setActiveView("dashboard");
    setActiveSubView("项目大盘");
    openUpload("create-project");
    setNotice("已打开新建项目上传，请上传合同或报价表，确认入库后就能回到项目分派。");
    setView("app");
  }, [view]);

  function openUpload(type = "create-project", targetProject = null, initialFiles = []) {
    if (targetProject?.id) setSelectedId(targetProject.id);
    setUploadTargetProject(targetProject || null);
    setUploadInitialType(type);
    setUploadInitialFiles(Array.isArray(initialFiles) ? initialFiles : []);
    setUploadInstanceId((value) => value + 1);
    setUploadOpen(true);
    setUploadMinimized(false);
  }

  function toggleDashboardAiCollapsed() {
    setDashboardAiCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(DASHBOARD_AI_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures so the UI toggle still works in private or restricted browsers.
      }
      return next;
    });
  }

  function updateProjectFilter(field, value) {
    setProjectFilters((current) => ({ ...current, [field]: value }));
  }

  function clearProjectFilters() {
    setSearchText("");
    setProjectFilters(defaultProjectFilters);
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
      downloadCsv(filename, projectLedgerRows(visibleProjects, isManagement, { materialStatus: projectMaterialStatus }));
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

  const stats = useMemo(() => projectDashboardStats(visibleProjects), [visibleProjects]);

  const progressOption = useMemo(() => progressChartOption(visibleProjects), [visibleProjects]);
  const cashOption = useMemo(() => cashChartOption(visibleProjects), [visibleProjects]);
  const costOption = useMemo(() => costChartOption(visibleProjects), [visibleProjects]);

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

  const navGroups = useMemo(() => dashboardNavGroups({ canUseCollection, isManagement }), [canUseCollection, isManagement]);

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
        <DashboardTopbar
          aiConfigured={aiConfigured}
          canCreateProject={canCreateProject}
          exportingProjectLedger={exportingProjectLedger}
          filterOpen={filterOpen}
          hasProjectFilters={hasProjectFilters}
          isAdmin={isAdmin}
          isManagement={isManagement}
          notice={notice}
          onClearFilters={clearProjectFilters}
          onClearNotice={() => setNotice("")}
          onCreateProject={() => openUpload("create-project")}
          onExportProjectLedger={exportProjectLedger}
          onOpenAdmin={() => setView("admin")}
          onOpenAiSettings={() => setView("admin:ai")}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onToggleFilter={() => setFilterOpen(!filterOpen)}
          onUpdateProjectFilter={updateProjectFilter}
          projectCount={visibleProjects.length}
          projectFilters={projectFilters}
          role={role}
          searchText={searchText}
          setRole={setRole}
          setSearchText={setSearchText}
          systemNotificationCount={systemNotifications.length}
        />
        {notificationsOpen && (
          <Suspense fallback={<ModuleFallback title="智能待办加载中" />}>
            <NotificationDrawer
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
              notificationPriorityQueue={notificationPriorityQueue}
              money={money}
            />
          </Suspense>
        )}
        <Suspense fallback={<ModuleFallback title="工作台加载中" />}>
          <DashboardContent
            activeSubView={activeSubView}
            activeView={activeView}
            approvalFocusId={approvalFocusId}
            auditLogs={state?.auditLogs || []}
            canCreateProject={canCreateProject}
            canManageAssignments={canManageAssignments}
            cashOption={cashOption}
            clientFocusName={clientFocusName}
            collectionScripts={state?.collectionScripts || []}
            comments={state?.comments || []}
            costOption={costOption}
            dashboardAiCollapsed={dashboardAiCollapsed}
            emptyProjectResultText={emptyProjectResultText}
            feishuPendingFiles={state?.feishuPendingFiles || []}
            files={state?.files || []}
            isAdmin={isAdmin}
            isManagement={isManagement}
            LazyChart={LazyChart}
            loadState={loadState}
            onOpenAiAction={openAiAction}
            onClearProjectFilters={clearProjectFilters}
            clearProjectFiltersLabel={clearProjectFiltersLabel}
            onOpenUpload={openUpload}
            onSetActiveSubView={setActiveSubView}
            onSetActiveView={setActiveView}
            onSetApprovalFocusId={setApprovalFocusId}
            onSetClientFocusName={setClientFocusName}
            onSetNotice={setNotice}
            onSetProjectFocus={setProjectFocus}
            onSetSelectedId={setSelectedId}
            onSetSupplierFocusName={setSupplierFocusName}
            onSetView={setView}
            onToggleDashboardAiCollapsed={toggleDashboardAiCollapsed}
            parseJobs={state?.parseJobs || []}
            payments={state?.payments || []}
            progressOption={progressOption}
            projects={projects}
            projectFocus={projectFocus}
            role={role}
            selected={selected}
            selectedId={selectedId}
            session={session}
            setRole={setRole}
            settings={state?.settings || {}}
            setUploadInitialFiles={setUploadInitialFiles}
            setUploadInstanceId={setUploadInstanceId}
            setUploadMinimized={setUploadMinimized}
            setUploadOpen={setUploadOpen}
            setUploadTargetProject={setUploadTargetProject}
            state={state || {}}
            stats={stats}
            supplierFocusName={supplierFocusName}
            suppliers={state?.suppliers || []}
            uploadInitialFiles={uploadInitialFiles}
            uploadInitialType={uploadInitialType}
            uploadInstanceId={uploadInstanceId}
            uploadMinimized={uploadMinimized}
            uploadOpen={uploadOpen}
            uploadTargetProject={uploadTargetProject}
            visibleAlerts={visibleAlerts}
            visibleProjects={visibleProjects}
          />
        </Suspense>
      </main>
    </div>
  );
}

const AdminShell = lazy(() => import("./AdminShell.jsx"));
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

  if (!session) return <Suspense fallback={<ModuleFallback title="登录页加载中" />}><LoginScreen onLogin={setSession} sessionKey={SESSION_KEY} /></Suspense>;
  const adminRouteMap = {
    admin: "members",
    "admin:ai": "ai",
    "admin:product": "product",
    "admin:assignments": "assignments"
  };
  const isAdmin = canUseAdminRole(session);
  const canManageAssignments = canManageAssignmentsRole(session);
  if (adminRouteMap[view] && (isAdmin || (view === "admin:assignments" && canManageAssignments))) {
    return <Suspense fallback={<ModuleFallback title="后台管理加载中" />}><AdminShell session={session} setView={setView} onLogout={logout} initialTab={adminRouteMap[view]} buildVersion={BUILD_VERSION} /></Suspense>;
  }
  return <ProjectDashboard session={session} view={view} setView={setView} onLogout={logout} />;
}

createRoot(document.getElementById("root")).render(<AppShell />);
