import React from "react";
import "./approval.css";

export default function ProjectApprovalPanel({
  approvalRef,
  project,
  session,
  approvalTypeOptions,
  approvalForm,
  projectApprovals,
  submittingApproval,
  withdrawingProjectApprovalId,
  money,
  currentApprovalStepInfo,
  canWithdrawApproval,
  onUpdateApprovalForm,
  onSubmitProjectApproval,
  onOpenApproval,
  onWithdrawProjectApproval,
  onPrepareProjectApproval
}) {
  return (
    <section className="detail-section" ref={approvalRef} id="project-approvals-section">
      <div className="section-head">
        <h2>审批与成本记录</h2>
        <span className="muted">{projectApprovals.length} 条审批</span>
      </div>
      <form className="project-approval-mini" onSubmit={onSubmitProjectApproval}>
        <select value={approvalForm.type} onChange={(event) => onUpdateApprovalForm("type", event.target.value)}>
          {approvalTypeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <input value={approvalForm.amount} onChange={(event) => onUpdateApprovalForm("amount", event.target.value)} placeholder="金额" />
        <input value={approvalForm.payee} onChange={(event) => onUpdateApprovalForm("payee", event.target.value)} placeholder="收款人 / 用途" />
        <input value={approvalForm.reason} onChange={(event) => onUpdateApprovalForm("reason", event.target.value)} placeholder="说明" />
        <button type="submit" className="primary" disabled={submittingApproval}>{submittingApproval ? "提交中" : "提交审批"}</button>
      </form>
      <div className="detail-list">
        {projectApprovals.length ? projectApprovals.slice(0, 6).map((item) => (
          <div key={item.id}>
            <strong>{item.typeLabel || item.category || "审批"} · {money(item.amount)}</strong>
            <span>{item.status} · {currentApprovalStepInfo(item)?.label || (item.appliedAt ? "已入账/付款" : "流程中")} · {item.applicantName || "提交人"} · {item.reason || "暂无说明"}</span>
            <button type="button" className="ghost tiny" onClick={() => onOpenApproval?.(item)}>查看流程</button>
            {canWithdrawApproval(session, item) && <button type="button" className="ghost tiny" onClick={() => onWithdrawProjectApproval(item)} disabled={withdrawingProjectApprovalId === item.id}>
              {withdrawingProjectApprovalId === item.id ? "撤回中" : "撤回"}
            </button>}
          </div>
        )) : (
          <div className="action-empty project-approval-empty">
            <strong>暂无审批记录</strong>
            <span>报销、备用金和供应商付款提交后会自动生成流程进度，并沉淀到项目成本里。</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => onPrepareProjectApproval("reimbursement", "项目执行报销")}>提交报销</button>
              <button type="button" className="ghost tiny" onClick={() => onPrepareProjectApproval("petty_cash", "项目执行备用金")}>申请备用金</button>
              {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                <button type="button" className="ghost tiny" onClick={() => onPrepareProjectApproval("supplier_payment", `${project.name} 供应商费用付款`)}>供应商付款</button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
