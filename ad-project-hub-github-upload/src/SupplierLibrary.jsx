import React, { useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  FileSpreadsheet,
  MessageSquareText,
  UsersRound,
} from "lucide-react";
import { apiRequest, downloadFile } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { supplierProfileRows } from "./utils/ledgerRows.js";
import { isSupplierSettlementPayable } from "./utils/supplierMetrics.js";
import "./supplier-client.css";

function Mini({ label, value }) {
  return (
    <div className="mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return (
    <div className="panel-title">
      {Icon && <Icon size={18} />}
      <strong>{title}</strong>
    </div>
  );
}

export default function SupplierLibrary({
  suppliers = [],
  settlements = [],
  projects = [],
  session,
  focusSupplierName = "",
  onFocusConsumed,
  onUpload,
  onOpenProjects,
  onDone,
  onNotice
}) {
  const [selectedName, setSelectedName] = useState(suppliers[0]?.supplier || "");
  const [form, setForm] = useState({ score: 5, market: "", contact: "", comment: "" });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingProfiles, setExportingProfiles] = useState(false);
  const [settlementNote, setSettlementNote] = useState("");
  const [settlementSavingId, setSettlementSavingId] = useState("");
  const [focusedSupplier, setFocusedSupplier] = useState("");
  const [focusedRatingKey, setFocusedRatingKey] = useState("");
  const [deletingSupplier, setDeletingSupplier] = useState(false);
  const canDeleteSupplier = ["shareholder", "admin"].includes(session?.role);
  useEffect(() => {
    if (!selectedName && suppliers[0]?.supplier) setSelectedName(suppliers[0].supplier);
  }, [suppliers, selectedName]);
  useEffect(() => {
    if (!focusSupplierName) return;
    setSelectedName(focusSupplierName);
    setFocusedSupplier(focusSupplierName);
    onFocusConsumed?.();
  }, [focusSupplierName, onFocusConsumed]);
  const selected = suppliers.find((item) => item.supplier === selectedName) || suppliers[0] || null;
  const selectedSettlements = settlements.filter((item) => item.supplier === selected?.supplier);
  const pendingSettlementAmount = selectedSettlements
    .filter(isSupplierSettlementPayable)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const supplierRatingTags = [
    { label: "配合快", comment: "配合快，响应及时，现场沟通顺畅。" },
    { label: "报价稳", comment: "报价稳定，临时追加少，适合长期复用。" },
    { label: "质量好", comment: "交付质量稳定，返工少，客户反馈相对安全。" },
    { label: "交付准", comment: "交付准时，排期可靠，适合时间紧的项目。" },
    { label: "发票慢", comment: "交付可用，但发票/结算配合偏慢，下次需提前约定。" },
    { label: "需比价", comment: "报价偏高，下次同类型项目建议至少再找两家比价。" }
  ];

  function applySupplierRatingTag(tag) {
    setForm((current) => ({
      ...current,
      market: current.market || selected?.types?.[0] || selected?.market || "制作 / 执行",
      comment: current.comment ? `${current.comment}；${tag.comment}` : tag.comment
    }));
    onNotice(`已加入「${tag.label}」评价标签，请按真实情况调整后保存评分。`);
  }

  async function exportSuppliers() {
    setExporting(true);
    try {
      await downloadFile("/api/suppliers/export", session, "supplier-settlements.csv");
      onNotice("供应商结算 CSV 已导出");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setExporting(false);
    }
  }

  async function exportSupplierProfiles() {
    if (!suppliers.length) {
      onNotice("当前没有可导出的供应商画像，请先上传成本表或保存供应商评分。");
      return;
    }
    setExportingProfiles(true);
    try {
      downloadCsv("供应商画像推荐表.csv", supplierProfileRows(suppliers));
      onNotice(`供应商画像推荐表 CSV 已导出：${suppliers.length} 家供应商。`);
    } catch (error) {
      onNotice(error.message || "供应商画像导出失败，请稍后再试。");
    } finally {
      setExportingProfiles(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected?.supplier) {
      onNotice("暂无可评价的供应商");
      return;
    }
    setSaving(true);
    try {
      const savedSupplier = await apiRequest("/api/suppliers/rate", session, {
        method: "POST",
        body: JSON.stringify({ supplier: selected.supplier, ...form })
      });
      const latestRating = savedSupplier?.ratings?.[0];
      setFocusedSupplier(selected.supplier);
      setFocusedRatingKey(`${latestRating?.user || session.name || session.email}-${latestRating?.at || ""}`);
      setForm({ score: 5, market: "", contact: "", comment: "" });
      await onDone();
      onNotice(`供应商评分已保存，推荐星级和评分记录已刷新：${savedSupplier?.supplier || selected.supplier}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateSettlement(row, status) {
    const rowKey = row.id || `${row.project}-${row.supplier}-${row.amount}`;
    setSettlementSavingId(rowKey);
    try {
      const data = await apiRequest("/api/suppliers/settlement", session, {
        method: "POST",
        body: JSON.stringify({
          id: row.id,
          supplier: row.supplier,
          project: row.project,
          status,
          note: settlementNote
        })
      });
      setFocusedSupplier(data?.supplier?.supplier || row.supplier);
      setSettlementNote("");
      await onDone();
      onNotice(`${row.supplier} · ${row.project || "项目"} 已更新为${status}，供应商结算和导出 CSV 已刷新。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSettlementSavingId("");
    }
  }

  async function deleteSupplier() {
    if (!selected?.supplier || !window.confirm(`确认删除误建供应商“${selected.supplier}”？\n\n已有真实付款的供应商不会被删除。`)) return;
    setDeletingSupplier(true);
    try {
      let result;
      try {
        result = await apiRequest("/api/suppliers/delete", session, { method: "POST", body: JSON.stringify({ supplier: selected.supplier }) });
      } catch (error) {
        if (!error.message.includes("强制清理")) throw error;
        const confirmedName = window.prompt(`“${selected.supplier}”存在付款标记。仅在确认属于历史误识别时继续。\n\n请输入完整供应商名称：`);
        if (confirmedName !== selected.supplier) throw new Error("名称不一致，已取消强制清理");
        result = await apiRequest("/api/suppliers/delete", session, { method: "POST", body: JSON.stringify({ supplier: selected.supplier, forceMistake: true, confirmSupplierName: confirmedName }) });
      }
      setSelectedName("");
      await onDone();
      onNotice(`${result.supplier} 已从供应商库${result.forced ? "强制清理" : "删除"}${result.rolledBack ? `，并回滚项目成本 ${money(result.rolledBack)}` : ""}${result.needsCostReview ? "。成本表解析形成的项目成本请在项目成本复盘中确认" : ""}。`);
    } catch (error) { onNotice(error.message); }
    finally { setDeletingSupplier(false); }
  }

  if (!suppliers.length) {
    const targetProject = projects[0] || null;
    return (
      <section className="feature-panel">
        <PanelTitle icon={UsersRound} title="供应商库" />
        <div className="empty-state action-empty">
          <strong>暂无供应商记录</strong>
          <span>上传成本表、提交供应商付款审批，或在项目里记录供应商结算后，这里会自动沉淀供应商画像和推荐星级。</span>
          <div className="button-row compact">
            <button type="button" className="primary tiny" onClick={() => onUpload?.("cost-sheet", targetProject)}>上传成本表</button>
            <button type="button" className="ghost tiny" onClick={onOpenProjects}>打开我的项目</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="supplier-library">
      <div className="feature-panel wide-feature">
        <div className="section-head">
          <PanelTitle icon={UsersRound} title="供应商库" />
          <div className="button-row compact">
            <button type="button" className="ghost" disabled={exportingProfiles} onClick={exportSupplierProfiles}><FileSpreadsheet size={14} />{exportingProfiles ? "导出中" : "导出画像 CSV"}</button>
            <button type="button" className="ghost" disabled={exporting} onClick={exportSuppliers}><FileSpreadsheet size={14} />{exporting ? "导出中" : "导出结算 CSV"}</button>
          </div>
        </div>
        <div className="supplier-card-grid">
          {suppliers.map((item) => (
            <button
              type="button"
              className={`supplier-card ${item.supplier === selected?.supplier ? "active" : ""} ${focusedSupplier === item.supplier ? "fresh" : ""}`}
              key={item.supplier}
              onClick={() => setSelectedName(item.supplier)}
            >
              <strong>{item.supplier}</strong>
              <span>{"★".repeat(item.star || 1)}{"☆".repeat(Math.max(0, 5 - (item.star || 1)))}</span>
              <b className={`supplier-action action-${item.recommendationAction === "谨慎使用" ? "danger" : item.recommendationAction === "先比价" ? "warn" : "ok"}`}>
                {item.recommendationAction || "可试用"}
              </b>
              <em>{item.cooperationCount || 0} 次合作 · {item.projectCount || 0} 个项目</em>
              <small>{item.recommendationReason}</small>
            </button>
          ))}
        </div>
      </div>

      {selected && <div className="feature-panel wide-feature supplier-detail-panel">
        <div className="section-head"><PanelTitle icon={BarChart3} title="供应商画像" />{canDeleteSupplier && <button type="button" className="ghost supplier-delete-action" onClick={deleteSupplier} disabled={deletingSupplier}>{deletingSupplier ? "删除中" : "删除误建供应商"}</button>}</div>
        <div className="review-summary">
          <Mini label="推荐星级" value={`${selected.star || 1} 星`} />
          <Mini label="合作次数" value={`${selected.cooperationCount || 0} 次`} />
          <Mini label="合作项目" value={`${selected.projectCount || 0} 个`} />
          <Mini label="累计金额" value={money(selected.totalAmount)} />
          <Mini label="待结算金额" value={money(pendingSettlementAmount)} />
          <Mini label="内部评分" value={selected.averageRating ? `${selected.averageRating}/5` : "待评分"} />
          <Mini label="评分人数" value={`${selected.ratingCount || 0} 人`} />
          <Mini label="风险等级" value={selected.riskLevel || "低"} />
        </div>
        <div className={`supplier-risk-panel risk-${selected.riskLevel === "高" ? "high" : selected.riskLevel === "中" ? "medium" : "low"}`}>
          <div>
            <strong>{selected.recommendationAction || "可试用"}</strong>
            <span>{selected.selectionAdvice || "暂无足够历史数据，建议合作后补充评分。"}</span>
          </div>
          <div className="supplier-risk-tags">
            {(selected.riskTags?.length ? selected.riskTags : ["暂无明显风险"]).map((tag) => <b key={tag}>{tag}</b>)}
          </div>
        </div>
        <div className="compact-list">
          <div><strong>合作项目</strong><span>{selected.projects?.join("、") || "暂无"}</span></div>
          <div><strong>合作类型</strong><span>{selected.types?.join("、") || selected.market || "待沉淀"}</span></div>
          <div><strong>推荐原因</strong><span>{selected.recommendationReason}</span></div>
          <div><strong>选择建议</strong><span>{selected.selectionAdvice || "暂无足够历史数据，建议从小额或低风险项目开始合作并补充评分。"}</span></div>
          <div><strong>推荐逻辑</strong><span>星级由合作次数、合作项目数、累计金额和内部评分共同计算，多人使用且评分稳定的供应商会优先推荐。</span></div>
        </div>
      </div>}

      {selected && <div className="feature-panel wide-feature supplier-settlement-panel">
        <PanelTitle icon={CircleDollarSign} title="供应商结算记录" />
        <label className="supplier-settlement-note">
          <span>付款备注</span>
          <input value={settlementNote} onChange={(event) => setSettlementNote(event.target.value)} placeholder="例如：已转账，待发票；或合同尾款暂缓" />
        </label>
        <div className="compact-list">
          {selectedSettlements.length ? selectedSettlements.map((item) => {
            const itemKey = item.id || `${item.project}-${item.supplier}-${item.amount}`;
            const paid = /已付|已结/.test(String(item.status || ""));
            const payable = isSupplierSettlementPayable(item);
            return (
              <div className={settlementSavingId === itemKey ? "fresh" : ""} key={itemKey}>
                <strong>{item.project || "未绑定项目"} · {money(item.amount)}</strong>
                <span>{item.type || "项目费用"} · {item.status || "待结算"}{item.paidAt ? ` · ${new Date(item.paidAt).toLocaleString("zh-CN")}` : ""}{item.paymentNote ? ` · ${item.paymentNote}` : ""}</span>
                <div className="button-row compact">
                  {payable && <button type="button" className={paid ? "ghost tiny" : "primary tiny"} disabled={settlementSavingId === itemKey} onClick={() => updateSettlement(item, "已付款")}>
                    {settlementSavingId === itemKey ? "更新中" : "标记已付款"}
                  </button>}
                  {paid && <button type="button" className="ghost tiny" disabled={settlementSavingId === itemKey} onClick={() => updateSettlement(item, "待结算")}>
                    退回待结算
                  </button>}
                </div>
              </div>
            );
          }) : <div className="empty-state action-empty supplier-settlement-empty">
            <strong>暂无结算流水</strong>
            <span>上传成本表或通过供应商付款审批后，这里会出现可标记付款的结算记录。</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => onUpload?.("cost-sheet", projects[0] || null)}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={onOpenProjects}>打开我的项目</button>
            </div>
          </div>}
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <PanelTitle icon={CheckCircle2} title="内部评分" />
        <div className="supplier-rating-tags">
          {supplierRatingTags.map((tag) => (
            <button type="button" className="ghost tiny" onClick={() => applySupplierRatingTag(tag)} key={tag.label}>
              {tag.label}
            </button>
          ))}
        </div>
        <label><span>评分 1-5</span><input value={form.score} onChange={(event) => update("score", event.target.value)} /></label>
        <label><span>合作市场 / 类型</span><input value={form.market} onChange={(event) => update("market", event.target.value)} placeholder="例如 制作 / 达人 / 场地 / 投放" /></label>
        <label><span>联系方式</span><input value={form.contact} onChange={(event) => update("contact", event.target.value)} placeholder="可选" /></label>
        <label><span>评价</span><input value={form.comment} onChange={(event) => update("comment", event.target.value)} placeholder="例如 配合快、报价稳、发票慢等" /></label>
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存评分"}</button>
      </form>}

      {selected?.ratings?.length > 0 && <div className="feature-panel">
        <PanelTitle icon={MessageSquareText} title="评分记录" />
        <div className="compact-list">
          {selected.ratings.slice(0, 6).map((item) => (
            <div className={focusedRatingKey === `${item.user}-${item.at || ""}` ? "fresh" : ""} key={`${item.user}-${item.at}`}>
              <strong>{item.score}/5 · {item.user}</strong>
              <span>{item.comment || "暂无评价"} · {item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}</span>
            </div>
          ))}
        </div>
      </div>}
    </section>
  );
}
