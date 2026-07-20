import React from "react";
import "./supplier-client.css";

export default function ProjectOverviewPanel({
  project,
  clientProfile,
  clientRef,
  health,
  pettyCashLeft,
  isManagement,
  baseInfoFresh,
  editing,
  saving,
  canEditProject,
  form,
  aiAdvice = [],
  adviceRef,
  money,
  Mini,
  RiskBadge,
  BotIcon,
  onOpenClient,
  onSetEditing,
  onSaveProject,
  onUpdateForm,
  onRunAdviceAction,
}) {
  return (
    <>
      <div className="detail-head">
        <div>
          <span className="id">{project.id}</span>
          <h2>{project.name}</h2>
          <p>{project.client} · {project.brand} · {project.status}</p>
        </div>
        <RiskBadge risk={project.risk} />
      </div>

      <div className="summary">
        <BotIcon size={18} />
        <p>{project.aiSummary}</p>
      </div>

      {clientProfile && <section className="detail-section client-handoff" ref={clientRef}>
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

      <section className={`detail-section ${baseInfoFresh ? "fresh" : ""}`}>
        <div className="section-head">
          <h2>项目基础信息</h2>
          {editing ? (
            <div className="button-row">
              <button type="button" className="ghost" onClick={() => onSetEditing(false)}>取消</button>
              <button type="button" className="primary" onClick={onSaveProject} disabled={saving}>{saving ? "保存中" : "保存"}</button>
            </div>
          ) : canEditProject ? (
            <button type="button" onClick={() => onSetEditing(true)}>编辑</button>
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
            ["taxRate", "项目税率（%）"],
            ["contractTaxIncluded", "合同金额口径"],
            ["paid", "已回款"],
            ["nextMilestone", "下一节点"],
            ["paymentDue", "回款节点"]
          ].map(([field, label]) => (
            <label key={field}>
              <span>{label}</span>
              {editing ? field === "contractTaxIncluded" ? (
                <select value={form[field] === false ? "未税" : "含税"} onChange={(event) => onUpdateForm(field, event.target.value === "含税")}><option value="含税">含税金额</option><option value="未税">未税金额</option></select>
              ) : (
                <input value={form[field] ?? ""} onChange={(event) => onUpdateForm(field, event.target.value)} />
              ) : (
                <strong>{["contract", "paid"].includes(field) ? money(form[field]) : field === "contractTaxIncluded" ? (form[field] === false ? "未税金额" : "含税金额") : form[field] || "待补充"}</strong>
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

      <section className="detail-section" ref={adviceRef} id="project-advice-section">
        <div className="section-head">
          <h2>AI 项目建议</h2>
          <span className="muted">基于当前项目材料、进度、审批和回款</span>
        </div>
        <div className="ai-advice-list">
          {aiAdvice.map((item, index) => (
            <div key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
              <button type="button" className="ghost tiny" onClick={() => onRunAdviceAction(item)}>去处理</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
