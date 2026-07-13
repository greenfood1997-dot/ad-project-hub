import React, { Suspense, lazy } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Search,
  ShieldAlert,
  UploadCloud
} from "lucide-react";
import { money } from "./utils/format.js";
import { normalizeTask, projectHealth } from "./utils/projectMetrics.js";
import ModuleFallback from "./ModuleFallback.jsx";

const SupplierLibrary = lazy(() => import("./SupplierLibrary.jsx"));
const UploadDialog = lazy(() => import("./UploadDialog.jsx"));
const ApprovalFunds = lazy(() => import("./ApprovalFunds.jsx"));
const ManagementCockpit = lazy(() => import("./ManagementCockpit.jsx"));
const CollectionAssistant = lazy(() => import("./CollectionAssistant.jsx"));
const ClientLibrary = lazy(() => import("./ClientLibrary.jsx"));
const CloseoutReview = lazy(() => import("./CloseoutReview.jsx"));
const AiWorkbench = lazy(() => import("./AiWorkspace.jsx").then((module) => ({ default: module.AiWorkbench })));
const DashboardAiPanel = lazy(() => import("./AiWorkspace.jsx").then((module) => ({ default: module.DashboardAiPanel })));
const EmployeeProjectOverview = lazy(() => import("./EmployeeProjectOverview.jsx"));
const EmptyProjectState = lazy(() => import("./EmptyProjectState.jsx"));
const ManagementDashboardOverview = lazy(() => import("./ManagementDashboardOverview.jsx"));
const ProjectDetail = lazy(() => import("./ProjectDetail.jsx"));

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

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function RiskBadge({ risk }) {
  return <b className={`risk risk-${risk}`}>{risk}风险</b>;
}

function approvalWorkbenchSubView(approval = {}) {
  if (approval.type === "petty_cash") return "项目备用金";
  if (approval.type === "reimbursement") return "报销";
  if (approval.type === "supplier_payment") return "供应商付款";
  return "待我审批";
}

export default function DashboardContent({
  activeSubView,
  activeView,
  approvalFocusId,
  auditLogs,
  canCreateProject,
  canManageAssignments,
  clearProjectFiltersLabel = "清空搜索和筛选",
  cashOption,
  clientFocusName,
  collectionScripts,
  comments,
  costOption,
  dashboardAiCollapsed,
  emptyProjectResultText = "当前搜索或筛选没有结果。",
  feishuPendingFiles,
  files,
  isAdmin,
  isManagement,
  LazyChart,
  loadState,
  onOpenAiAction,
  onClearProjectFilters,
  onSetActiveSubView,
  onSetActiveView,
  onSetApprovalFocusId,
  onSetClientFocusName,
  onSetNotice,
  onSetProjectFocus,
  onSetSelectedId,
  onSetSupplierFocusName,
  onSetView,
  onToggleDashboardAiCollapsed,
  onOpenUpload,
  parseJobs,
  payments,
  progressOption,
  projects,
  projectFocus,
  selected,
  selectedId,
  session,
  settings,
  stats,
  state,
  supplierFocusName,
  suppliers,
  uploadInitialFiles,
  uploadInitialType,
  uploadInstanceId,
  uploadMinimized,
  uploadOpen,
  uploadTargetProject,
  visibleAlerts,
  visibleProjects,
  role,
  setRole,
  setUploadInitialFiles,
  setUploadInstanceId,
  setUploadMinimized,
  setUploadOpen,
  setUploadTargetProject
}) {
  const setApprovalFocusId = onSetApprovalFocusId;
  const setActiveView = onSetActiveView;

  function openApprovalWorkbench(approval) {
    if (approval?.projectId) onSetSelectedId(approval.projectId);
    setApprovalFocusId(approval?.id || "");
    setActiveView("approvals");
    onSetActiveSubView(approvalWorkbenchSubView(approval));
    onSetNotice(`已打开审批流程：${approval?.typeLabel || approval?.category || "审批"} ${money(approval?.amount)}。`);
  }

  return (
    <>
      {!projects.length && activeView !== "management" && !(activeView === "dashboard" && activeSubView === "项目大盘") && (
        <Suspense fallback={<ModuleFallback title="项目入口加载中" />}>
          <EmptyProjectState
            isManagement={isManagement}
            canManageAssignments={canManageAssignments}
            canCreateProject={canCreateProject}
            onUpload={() => onOpenUpload("create-project")}
            onAdmin={() => onSetView("admin")}
            onAssignments={() => onSetView("admin:assignments")}
            isAdmin={isAdmin}
            PanelTitle={PanelTitle}
          />
        </Suspense>
      )}

      {!!projects.length && !visibleProjects.length && (
        <section className="empty-project-state">
          <div>
            <PanelTitle icon={Search} title="没有匹配的项目" />
            <h2>{emptyProjectResultText}</h2>
            <p>换一个项目名、客户名、负责人、PM，或清空项目筛选条件。</p>
            <button type="button" className="ghost" onClick={onClearProjectFilters}>{clearProjectFiltersLabel}</button>
          </div>
        </section>
      )}

      {!!visibleProjects.length && activeView === "ai" && <Suspense fallback={<ModuleFallback title="AI 助手加载中" />}>
        <AiWorkbench
          session={session}
          projects={visibleProjects}
          approvals={state?.approvals || []}
          settings={settings || {}}
          stats={stats}
          selected={selected}
          onUpload={(type = selected ? "cost-sheet" : "create-project", targetProject = selected, initialFiles = []) => onOpenUpload(type, targetProject, initialFiles)}
          onSelectProject={onSetSelectedId}
          onNavigate={onOpenAiAction}
          onDone={() => loadState()}
          onNotice={onSetNotice}
          onApprovalCreated={(approval) => {
            if (approval?.projectId) onSetSelectedId(approval.projectId);
            onSetApprovalFocusId(approval?.id || "");
            onSetActiveView("approvals");
            onSetActiveSubView("待我审批");
          }}
        />
      </Suspense>}

      {!!visibleProjects.length && activeView === "approvals" && <Suspense fallback={<ModuleFallback title="审批工作台加载中" />}>
        <ApprovalFunds
          projects={visibleProjects}
          approvals={state?.approvals || []}
          selected={selected}
          session={session}
          subView={activeSubView}
          setSubView={onSetActiveSubView}
          focusApprovalId={approvalFocusId}
          onFocusConsumed={() => onSetApprovalFocusId("")}
          onDone={() => loadState()}
          onNotice={onSetNotice}
        />
      </Suspense>}

      {!!visibleProjects.length && activeView === "closeout" && <Suspense fallback={<ModuleFallback title="成本复盘加载中" />}>
        <CloseoutReview
          project={selected}
          isManagement={isManagement}
          session={session}
          subView={activeSubView}
          onNotice={onSetNotice}
          onSetSubView={onSetActiveSubView}
          onUpload={(type = "cost-sheet", targetProject = selected) => onOpenUpload(type, targetProject)}
          onDone={() => loadState()}
          onOpenProjectSection={(target, message) => {
            onSetActiveView("dashboard");
            onSetActiveSubView("我的项目");
            onSetProjectFocus(target);
            if (message) onSetNotice(message);
          }}
          onOpenSupplier={(supplier) => {
            const name = supplier?.supplier || "";
            if (!name) return;
            onSetSupplierFocusName(name);
            onSetActiveView("suppliers");
            onSetActiveSubView("供应商库");
            onSetNotice(`已从结案复盘打开供应商画像：${name}。`);
          }}
          onOpenCollection={() => {
            onSetActiveView("collections");
            onSetActiveSubView("催收助手");
            onSetNotice(`已打开催收助手：${selected.name} 当前待回款 ${money(selected.receivable)}。`);
          }}
        />
      </Suspense>}

      {!!visibleProjects.length && activeView === "suppliers" && <Suspense fallback={<ModuleFallback title="供应商库加载中" />}>
        <SupplierLibrary
          suppliers={state?.supplierProfiles || []}
          settlements={suppliers || []}
          projects={visibleProjects}
          session={session}
          focusSupplierName={supplierFocusName}
          onFocusConsumed={() => onSetSupplierFocusName("")}
          onUpload={(type = "cost-sheet", targetProject = selected) => onOpenUpload(type, targetProject)}
          onOpenProjects={() => {
            onSetActiveView("dashboard");
            onSetActiveSubView("我的项目");
            onSetProjectFocus("files");
            onSetNotice("已回到我的项目，可以先选择项目并上传成本表，供应商会自动沉淀到供应商库。");
          }}
          onDone={() => loadState()}
          onNotice={onSetNotice}
        />
      </Suspense>}

      {!!visibleProjects.length && activeView === "clients" && <Suspense fallback={<ModuleFallback title="客户偏好加载中" />}>
        <ClientLibrary
          clients={state?.clientProfiles || []}
          projects={visibleProjects}
          session={session}
          focusClientName={clientFocusName}
          onFocusConsumed={() => onSetClientFocusName("")}
          onUpload={(type = "create-project", targetProject = null) => onOpenUpload(type, targetProject)}
          onOpenProjects={() => {
            onSetActiveView("dashboard");
            onSetActiveSubView("我的项目");
            onSetProjectFocus("client");
            onSetNotice("已回到我的项目，可以从项目里的客户交接摘要继续维护偏好和雷区。");
          }}
          onDone={() => loadState()}
          onNotice={onSetNotice}
        />
      </Suspense>}

      {!!visibleProjects.length && activeView === "collections" && <Suspense fallback={<ModuleFallback title="催收助手加载中" />}>
        <CollectionAssistant
          projects={visibleProjects}
          scripts={collectionScripts || []}
          session={session}
          onOpenProjectPayments={(project = selected) => {
            if (project?.id) onSetSelectedId(project.id);
            onSetActiveView("dashboard");
            onSetActiveSubView("我的项目");
            onSetProjectFocus("payments");
            onSetNotice(`已打开「${project?.name || "当前项目"}」的回款记录区，可以记录回款或检查尾款状态。`);
          }}
          onUploadVerification={(project = selected) => onOpenUpload("verification-sheet", project)}
          onDone={() => loadState()}
          onNotice={onSetNotice}
        />
      </Suspense>}

      {activeView === "management" && isManagement && <Suspense fallback={<ModuleFallback title="经营舱加载中" />}>
        <ManagementCockpit
          projects={projects}
          approvals={state?.approvals || []}
          settings={settings || {}}
          session={session}
          stats={stats}
          subView={activeSubView}
          setSubView={onSetActiveSubView}
          onOpenApprovals={() => {
            onSetActiveView("approvals");
            onSetActiveSubView("待我审批");
            onSetNotice("已打开审批工作台，优先处理备用金、报销和供应商付款。");
          }}
          onOpenCollections={(project = null) => {
            if (project?.id) onSetSelectedId(project.id);
            onSetActiveView("collections");
            onSetActiveSubView("催收助手");
            onSetNotice(project?.name ? `已打开催收助手：优先跟进 ${project.name} 待回款。` : "已打开催收助手，优先处理待回款项目。");
          }}
          onOpenProjectSection={(project = null, focus = "progress", message = "") => {
            if (project?.id) onSetSelectedId(project.id);
            onSetActiveView("dashboard");
            onSetActiveSubView("我的项目");
            onSetProjectFocus(focus);
            onSetNotice(message || `已打开「${project?.name || "项目"}」的${focus === "costs" ? "成本与审批区" : focus === "payments" ? "回款记录区" : "项目进度区"}。`);
          }}
          onDone={() => loadState()}
          onNotice={onSetNotice}
        />
      </Suspense>}

      {activeView === "dashboard" && activeSubView === "项目大盘" && (
        <section className={`overview-layout ${dashboardAiCollapsed ? "ai-collapsed" : ""}`}>
          <div className="overview-center">
            {!projects.length ? (
              <Suspense fallback={<ModuleFallback title="项目入口加载中" />}>
                <EmptyProjectState
                  isManagement={isManagement}
                  canManageAssignments={canManageAssignments}
                  canCreateProject={canCreateProject}
                  onUpload={() => onOpenUpload("create-project")}
                  onAdmin={() => onSetView("admin")}
                  onAssignments={() => onSetView("admin:assignments")}
                  isAdmin={isAdmin}
                  PanelTitle={PanelTitle}
                />
              </Suspense>
            ) : isManagement ? (
              <Suspense fallback={<ModuleFallback title="项目大盘加载中" />}>
                <ManagementDashboardOverview
                  stats={stats}
                  cashOption={cashOption}
                  progressOption={progressOption}
                  costOption={costOption}
                  role={role}
                  setRole={setRole}
                  visibleAlerts={visibleAlerts}
                  money={money}
                  LazyChart={LazyChart}
                  PanelTitle={PanelTitle}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<ModuleFallback title="我的项目概览加载中" />}>
                <EmployeeProjectOverview
                  projects={visibleProjects}
                  selected={selected}
                  feishuPendingFiles={feishuPendingFiles || []}
                  onSelect={onSetSelectedId}
                  onUpload={() => onOpenUpload("cost-sheet")}
                  onOpenProject={(focus = "progress") => {
                    onSetActiveSubView("我的项目");
                    onSetProjectFocus(focus);
                    onSetNotice(focus === "approvals"
                      ? "已打开我的项目审批区，可以提交报销、备用金或查看流程。"
                      : focus === "files"
                        ? "已打开我的项目文件区，可以上传项目资料或查看 AI 解析进度。"
                        : "已打开我的项目进度区，可以新增任务或更新完成度。");
                  }}
                  projectHealth={projectHealth}
                  normalizeTask={normalizeTask}
                  money={money}
                  Metric={Metric}
                  PanelTitle={PanelTitle}
                  icons={{ UploadCloud, LayoutDashboard, Clock3, CircleDollarSign, FileText, Bot, CheckCircle2, ShieldAlert, FileSpreadsheet }}
                />
              </Suspense>
            )}
          </div>
          <Suspense fallback={<ModuleFallback title="AI 助手加载中" />}>
            <DashboardAiPanel
              session={session}
              projects={visibleProjects}
              approvals={state?.approvals || []}
              settings={settings || {}}
              stats={stats}
              selected={selected}
              onUpload={(type = selected ? "cost-sheet" : "create-project", targetProject = selected, initialFiles = []) => onOpenUpload(type, targetProject, initialFiles)}
              onSelectProject={onSetSelectedId}
              onNavigate={onOpenAiAction}
              onDone={() => loadState()}
              onNotice={onSetNotice}
              collapsed={dashboardAiCollapsed}
              onToggleCollapsed={onToggleDashboardAiCollapsed}
              onApprovalCreated={(approval) => {
                if (approval?.projectId) onSetSelectedId(approval.projectId);
                onSetApprovalFocusId(approval?.id || "");
                onSetActiveView("approvals");
                onSetActiveSubView("待我审批");
              }}
            />
          </Suspense>
        </section>
      )}

      {!!visibleProjects.length && activeView === "dashboard" && activeSubView === "我的项目" && (
        <section className="workspace">
          <div className="project-list">
            <div className="section-head">
              <h2>我的项目</h2>
              <button type="button" onClick={() => onOpenUpload(selected ? "cost-sheet" : "create-project")}><UploadCloud size={16} />上传项目文件</button>
            </div>
            {visibleProjects.map((project) => (
              <button
                type="button"
                className={`project-row ${project.id === selectedId ? "selected" : ""}`}
                key={project.id}
                onClick={() => onSetSelectedId(project.id)}
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
            files={files || []}
            parseJobs={parseJobs || []}
            approvals={state?.approvals || []}
            suppliers={suppliers || []}
            clients={state?.clientProfiles || []}
            payments={payments || []}
            collectionScripts={collectionScripts || []}
            feishuPendingFiles={feishuPendingFiles || []}
            comments={comments || []}
            alertUpdates={state?.alertUpdates || []}
            auditLogs={auditLogs || []}
            focusTarget={projectFocus}
            onFocusConsumed={() => onSetProjectFocus("")}
            onOpenApproval={(approval) => {
              if (approval?.projectId) onSetSelectedId(approval.projectId);
              setApprovalFocusId(approval?.id || "");
              setActiveView("approvals");
              onSetActiveSubView(approvalWorkbenchSubView(approval));
              onSetNotice(`已打开审批流程：${approval?.typeLabel || approval?.category || "审批"} ${money(approval?.amount)}。`);
            }}
            onOpenSupplier={(supplier) => {
              const name = supplier?.supplier || "";
              if (!name) return;
              onSetSupplierFocusName(name);
              onSetActiveView("suppliers");
              onSetActiveSubView("供应商库");
              onSetNotice(`已打开供应商画像：${name}。`);
            }}
            onOpenClient={(client) => {
              const name = client?.client || selected.client || "";
              if (!name) return;
              onSetClientFocusName(name);
              onSetActiveView("clients");
              onSetActiveSubView("客户偏好");
              onSetNotice(`已打开客户档案：${name}。`);
            }}
            onDone={() => loadState()}
            onNotice={onSetNotice}
          />
        </section>
      )}

      {uploadOpen && <Suspense fallback={<ModuleFallback title="上传窗口加载中" />}>
        <UploadDialog
          key={`upload-${uploadInstanceId}`}
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
            setUploadInstanceId((value) => value + 1);
          }}
          onDone={async () => {
            await loadState();
            setUploadTargetProject(null);
            setUploadInitialFiles([]);
          }}
        />
      </Suspense>}
    </>
  );
}
