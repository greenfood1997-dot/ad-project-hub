import React, { useEffect, useState } from "react";
import { AlertTriangle, Bot, RefreshCw } from "lucide-react";
import { apiRequest } from "./utils/api.js";

function displayTime(value) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

export default function ManagementAdvisor({ session, onNotice }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAnalysis(force = false) {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/api/management/advisor", session, { method: "POST", body: JSON.stringify({ force }) });
      setAnalysis(data);
      if (force) onNotice?.(data.mode === "ai-deep-analysis" ? "AI 已基于最新公司数据重新完成深度分析。" : "已刷新经营计算；AI 不可用，当前展示可复核的系统分析。");
    } catch (requestError) {
      setError(requestError.message);
      onNotice?.(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAnalysis(false); }, [session?.id]);

  if (!analysis && loading) return <div className="feature-panel wide-feature advisor-loading"><Bot size={22} /><strong>正在读取合同、回款、成本和现金流，生成公司级分析...</strong><span>深度分析通常需要几秒，请不要关闭页面。</span></div>;
  if (!analysis) return <div className="feature-panel wide-feature advisor-loading danger"><AlertTriangle size={22} /><strong>暂时无法生成经营分析</strong><span>{error || "请稍后重试"}</span><button type="button" className="primary" onClick={() => loadAnalysis(true)}>重新分析</button></div>;

  return <>
    <div className="feature-panel founder-card wide-feature management-advisor-hero">
      <div className="advisor-heading">
        <div><span className={`advisor-risk risk-${analysis.riskLevel}`}>{analysis.riskLevel}风险</span><strong>{analysis.decisionMode}</strong></div>
        <button type="button" className="ghost" disabled={loading} onClick={() => loadAnalysis(true)}><RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "分析中" : "按最新数据重算"}</button>
      </div>
      <h2>{analysis.executiveConclusion}</h2>
      <p className="advisor-meta">分析数据截至 {displayTime(analysis.dataAsOf)} · 生成于 {displayTime(analysis.generatedAt)} · {analysis.mode === "ai-deep-analysis" ? "AI 深度分析" : "确定性计算兜底（非 AI 生成）"}</p>
    </div>
    <div className="feature-panel wide-feature">
      <div className="panel-title"><Bot size={18} /><h2>优先决策与止损线</h2></div>
      <div className="advisor-decision-list">{(analysis.actions || []).map((item, index) => <article key={`${item.priority}-${item.action}-${index}`}>
        <div className="advisor-decision-title"><span>{item.priority || `P${index}`}</span><strong>{item.action}</strong></div><p>{item.rationale}</p>
        <div className="advisor-decision-grid"><span><small>预计影响</small>{item.estimatedImpact || "待测算"}</span><span><small>完成期限</small>{item.deadline || "待确定"}</span><span><small>责任角色</small>{item.ownerRole || "待分配"}</span><span className="stop-loss"><small>止损 / 触发条件</small>{item.stopLoss || "待确定"}</span></div>
      </article>)}</div>
    </div>
    <div className="feature-panel"><div className="panel-title"><Bot size={18} /><h2>内部事实</h2></div><div className="compact-list advisor-fact-list">{(analysis.facts || []).map((fact, index) => <div key={`${fact}-${index}`}><strong>{index + 1}</strong><span>{fact}</span></div>)}</div></div>
    <div className="feature-panel"><div className="panel-title"><AlertTriangle size={18} /><h2>市场依据边界</h2></div><div className="advisor-market-list">{(analysis.marketAssumptions || []).map((item, index) => <article key={`${item.statement}-${index}`}><strong>{item.statement}</strong><span>来源：{item.source} · 日期：{item.date} · 置信度：{item.confidence}</span></article>)}</div></div>
    <div className="feature-panel wide-feature"><div className="panel-title"><Bot size={18} /><h2>现金情景推演</h2></div><div className="advisor-scenario-grid">{(analysis.scenarios || []).map((item, index) => <article key={`${item.name}-${index}`}><strong>{item.name}</strong><b>{item.result}</b><span>{item.implication}</span></article>)}</div></div>
    {(analysis.unknowns || []).length > 0 && <div className="feature-panel wide-feature advisor-unknowns"><div className="panel-title"><AlertTriangle size={18} /><h2>当前缺失信息与结论边界</h2></div><div className="compact-list">{analysis.unknowns.map((item, index) => <div key={`${item}-${index}`}><strong>待补充</strong><span>{item}</span></div>)}</div></div>}
  </>;
}
