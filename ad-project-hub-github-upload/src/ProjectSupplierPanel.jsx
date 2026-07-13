import React from "react";

export default function ProjectSupplierPanel({
  projectSuppliers,
  approvalTypeOptions,
  money,
  onOpenSupplier,
  onPrepareSupplierPaymentApproval,
  onUploadCostSheet
}) {
  return (
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
            <button type="button" className="ghost tiny" onClick={() => onOpenSupplier?.(item)}>查看供应商</button>
          </div>
        )) : (
          <div className="action-empty supplier-action-empty">
            <strong>暂无供应商结算记录</strong>
            <span>供应商付款审批通过后会自动进入这里；如果已经有供应商账单，可以先发起付款审批或上传成本表让 AI 归集。</span>
            <div className="button-row compact">
              {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                <button type="button" className="ghost tiny" onClick={onPrepareSupplierPaymentApproval}>准备供应商付款</button>
              )}
              <button type="button" className="ghost tiny" onClick={onUploadCostSheet}>上传成本表</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
