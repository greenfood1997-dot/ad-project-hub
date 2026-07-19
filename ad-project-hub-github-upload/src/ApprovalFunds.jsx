import React, { useEffect, useState } from "react";
import { BellRing, CircleDollarSign, Clock3, FileSpreadsheet, Plus, ShieldAlert } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { approvalPriorityQueue, approvalRuntimeInfo, canHandleApproval, canWithdrawApproval, currentApprovalStepInfo } from "./utils/approvalFlow.js";
import { downloadCsv, money } from "./utils/format.js";
import { approvalLedgerRows, reimbursementSummaryRows } from "./utils/ledgerRows.js";
import { approvalTypeOptionsFor, canSubmitSupplierPaymentRole } from "./utils/permissions.js";
import "./approval.css";

const expenseCategories = ["自动识别", "拍摄交通", "餐饮", "住宿", "道具", "场地", "达人/KOL", "制作", "投放", "快递", "办公杂费", "其他"];
const expenseCategoryValues = expenseCategories.filter((item) => item !== "自动识别");
function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

export default function ApprovalFunds({ projects, approvals, selected, session, subView, setSubView, focusApprovalId = "", onFocusConsumed, onDone, onNotice }) {
  const [selectedApprovalKey, setSelectedApprovalKey] = useState("");
  const [form, setForm] = useState({
    projectId: selected?.id || "",
    type: "reimbursement",
    amount: "",
    payee: "",
    reason: "",
    expenseCategory: "自动识别",
    voucherType: "none", invoiceNo: "", transactionNo: "", taxRate: "", voucherNote: ""
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
      setForm({ projectId: form.projectId, type: "reimbursement", amount: "", payee: "", reason: "", expenseCategory: "自动识别", voucherType: "none", invoiceNo: "", transactionNo: "", taxRate: "", voucherNote: "" });
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
      downloadCsv(filename, approvalLedgerRows(visibleApprovals, { runtimeInfo: approvalRuntimeInfo }));
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
      downloadCsv(`${project?.name || "单项目"}-${reimbursementMonth}-报销表.csv`, reimbursementSummaryRows(rows, projects, reimbursementMonth, { runtimeInfo: approvalRuntimeInfo }));
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
      downloadCsv(`${reimbursementMonth}-全部项目报销汇总.csv`, reimbursementSummaryRows(monthlyReimbursements, projects, reimbursementMonth, { runtimeInfo: approvalRuntimeInfo }));
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
        {form.type === "reimbursement" && <>
          <label><span>凭证类型（优先提供发票）</span><select value={form.voucherType} onChange={(event) => updateForm("voucherType", event.target.value)}><option value="none">暂未提供凭证</option><option value="vat-special">增值税专用发票</option><option value="invoice">普通/电子发票</option><option value="payment-screenshot">支付截图</option></select></label>
          {["vat-special", "invoice"].includes(form.voucherType) && <><label><span>发票号码</span><input value={form.invoiceNo} onChange={(event) => updateForm("invoiceNo", event.target.value)} placeholder="用于查重和补票关联" /></label><label><span>票面税率</span><input value={form.taxRate} onChange={(event) => updateForm("taxRate", event.target.value)} placeholder="例如 1 或 6" /></label></>}
          {form.voucherType === "payment-screenshot" && <label><span>支付交易号</span><input value={form.transactionNo} onChange={(event) => updateForm("transactionNo", event.target.value)} placeholder="用于防止支付截图重复报销" /></label>}
          <label><span>凭证说明</span><input value={form.voucherNote} onChange={(event) => updateForm("voucherNote", event.target.value)} placeholder="未开票原因、补票时间或票据说明" /></label>
        </>}
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
              <div className="approval-card-actions">
                <button type="button" onClick={() => setSelectedApprovalKey(item.id)}>查看</button>
                {canWithdrawApproval(session, item) && <button type="button" className="ghost" onClick={() => withdraw(item)} disabled={withdrawingApprovalId === item.id}>
                  {withdrawingApprovalId === item.id ? "撤回中" : "撤回"}
                </button>}
              </div>
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
