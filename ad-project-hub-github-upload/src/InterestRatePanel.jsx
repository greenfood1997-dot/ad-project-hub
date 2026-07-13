import React from "react";
import { RefreshCw } from "lucide-react";

export default function InterestRatePanel({ interestRate = {}, refreshing, onRefresh }) {
  const annualRate = Number(interestRate.annualRate ?? interestRate["年化利率"] ?? 0);
  const updatedAt = interestRate.updatedAt || interestRate.checkedAt;
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未联网刷新";

  return (
    <section className="interest-rate-panel">
      <div className="section-head">
        <div>
          <h2>利率与垫资成本</h2>
          <span>用于后续项目垫资利息与利润测算，不会改动既有项目账。</span>
        </div>
        <button type="button" className="ghost tiny" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} />{refreshing ? "刷新中" : "刷新 1 年期 LPR"}
        </button>
      </div>
      <div className="interest-rate-values">
        <div><span>当前年化</span><strong>{annualRate ? `${annualRate}%` : "待获取"}</strong></div>
        <div><span>状态</span><strong>{interestRate.status || "使用默认利率"}</strong></div>
        <div><span>最近检查</span><strong>{updatedLabel}</strong></div>
      </div>
      <p>{interestRate.note || "默认使用 1 年期 LPR；联网失败时保留兜底利率。"}</p>
    </section>
  );
}
