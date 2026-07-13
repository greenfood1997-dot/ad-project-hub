import React from "react";
import { FileSpreadsheet } from "lucide-react";
import "./collection.css";

export default function ProjectPaymentPanel({
  paymentRef,
  project,
  projectPayments = [],
  projectCollectionScripts = [],
  collectionDraft,
  paymentForm,
  canRecordPayment,
  canUseCollection,
  generatingCollection,
  recordingPayment,
  voidingPaymentId,
  exportingPaymentLedger,
  copyingCollectionId,
  savingCollectionOutcomeId,
  focusedPaymentId,
  money,
  collectionFollowUpForm,
  onExportPaymentLedger,
  onGenerateCollectionScript,
  onCopyCollectionScript,
  onMarkCollectionOutcome,
  onUpdateCollectionFollowUp,
  onSubmitPayment,
  onUpdatePaymentForm,
  onVoidPayment,
  onPreparePaymentEntry,
  onUploadVerification,
}) {
  return (
    <section className="detail-section" ref={paymentRef} id="project-payments-section">
      <div className="section-head">
        <h2>回款记录</h2>
        <div className="section-head-actions">
          <span className="muted">已回款 {money(project.paid)} · 待回款 {money(project.receivable)}</span>
          <button type="button" className="ghost tiny" disabled={exportingPaymentLedger || !projectPayments.length} onClick={onExportPaymentLedger}>
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
        {canUseCollection && <button type="button" className="ghost" onClick={onGenerateCollectionScript} disabled={generatingCollection || !Number(project.receivable || 0)}>
          {generatingCollection ? "生成中" : "生成话术"}
        </button>}
      </div>
      {collectionDraft && <div className="collection-script-card fresh">
        <strong>{collectionDraft.projectName} · {collectionDraft.tone}</strong>
        <pre>{collectionDraft.script}</pre>
        <span>{collectionDraft.reason}</span>
        <div className="button-row">
          <button type="button" className="ghost" disabled={copyingCollectionId === (collectionDraft.id || "draft")} onClick={() => onCopyCollectionScript(collectionDraft)}>
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
            <button type="button" className="ghost" disabled={copyingCollectionId === item.id} onClick={() => onCopyCollectionScript(item)}>{copyingCollectionId === item.id ? "复制中" : "复制话术"}</button>
            <button type="button" className="primary" disabled={savingCollectionOutcomeId === item.id} onClick={() => onMarkCollectionOutcome(item, true)}>{savingCollectionOutcomeId === item.id ? "记录中" : "有效"}</button>
          </div>}
          {canUseCollection && <div className="collection-follow-up-form">
            <label>
              <span>下次跟进时间</span>
              <input type="date" value={collectionFollowUpForm(item).nextFollowUpAt} onChange={(event) => onUpdateCollectionFollowUp(item, "nextFollowUpAt", event.target.value)} />
            </label>
            <label>
              <span>下一步动作</span>
              <input value={collectionFollowUpForm(item).nextAction} onChange={(event) => onUpdateCollectionFollowUp(item, "nextAction", event.target.value)} placeholder="例如：补发对账单后再提醒客户财务" />
            </label>
            <button type="button" className="ghost" disabled={savingCollectionOutcomeId === item.id} onClick={() => onMarkCollectionOutcome(item, false)}>{savingCollectionOutcomeId === item.id ? "记录中" : "待优化并提醒"}</button>
          </div>}
        </div>
      ))}
      {canRecordPayment && <form className="project-approval-mini" onSubmit={onSubmitPayment}>
        <input value={paymentForm.amount} onChange={(event) => onUpdatePaymentForm("amount", event.target.value)} placeholder="回款金额" />
        <input value={paymentForm.payer} onChange={(event) => onUpdatePaymentForm("payer", event.target.value)} placeholder="付款方 / 客户" />
        <input value={paymentForm.method} onChange={(event) => onUpdatePaymentForm("method", event.target.value)} placeholder="方式：银行 / 票据等" />
        <input value={paymentForm.note} onChange={(event) => onUpdatePaymentForm("note", event.target.value)} placeholder="备注：首款 / 尾款 / 第几期" />
        <button type="submit" className="primary" disabled={recordingPayment}>{recordingPayment ? "记录中" : "记录回款"}</button>
      </form>}
      <div className="detail-list">
        {projectPayments.length ? projectPayments.slice(0, 6).map((item) => {
          const voided = item.status === "已作废" || item.voidedAt;
          return (
            <div className={`${focusedPaymentId === item.id ? "fresh" : ""} ${voided ? "voided" : ""}`} key={item.id}>
              <strong>{item.payer || item.client || project.client || "客户"} · {money(item.amount)}{voided ? " · 已作废" : ""}</strong>
              <span>{item.method || "方式待补"} · {item.note || "暂无备注"} · {item.recordedByName || "记录人"} · {item.receivedAt ? new Date(item.receivedAt).toLocaleString("zh-CN") : "时间待记录"}{voided ? ` · 作废人 ${item.voidedByName || "未知"} · ${item.voidReason || "手动作废"}` : ""}</span>
              {canRecordPayment && !voided && <button type="button" className="ghost tiny" disabled={voidingPaymentId === item.id} onClick={() => onVoidPayment(item)}>
                {voidingPaymentId === item.id ? "作废中" : "作废回款"}
              </button>}
            </div>
          );
        }) : (
          <div className="action-empty payment-action-empty">
            <strong>暂无回款流水</strong>
            <span>销售或财务记录后，会自动更新项目已回款和待回款；如果是月度核销，请先上传核销表让 AI 做收入匹配。</span>
            <div className="button-row compact">
              {canRecordPayment && <button type="button" className="ghost tiny" onClick={onPreparePaymentEntry}>准备记录回款</button>}
              <button type="button" className="ghost tiny" onClick={onUploadVerification}>上传核销表</button>
              {canUseCollection && Number(project.receivable || 0) > 0 && (
                <button type="button" className="ghost tiny" onClick={onGenerateCollectionScript} disabled={generatingCollection}>
                  {generatingCollection ? "生成中" : "生成催收话术"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
