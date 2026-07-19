import React, { useEffect, useState } from "react";
import { ChevronDown, FileSpreadsheet, RefreshCw } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { monthlyProjectCostDetailRows } from "./utils/ledgerRows.js";

export default function ManagementCostDashboard({ session, onNotice }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState({ projects: [], summary: "" });
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");

  async function load() {
    setLoading(true);
    try { setReport(await apiRequest(`/api/reports/monthly-project-costs?month=${month}`, session)); }
    catch (error) { onNotice?.(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [month]);

  function exportAll() {
    downloadCsv(`${month}-项目全成本总表及明细.csv`, monthlyProjectCostDetailRows(report));
    onNotice?.(`已导出 ${month} 项目全成本总表和全部细项。`);
  }

  const totals = (report.projects || []).reduce((result, item) => ({ cost: result.cost + Number(item.fullCost || 0), profit: result.profit + Number(item.managementProfit || 0), reimbursements: result.reimbursements + Number(item.reimbursements || 0), labor: result.labor + Number(item.laborAllocation || 0) }), { cost: 0, profit: 0, reimbursements: 0, labor: 0 });
  return <section className="management-cost-dashboard">
    <div className="management-cost-toolbar"><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><button type="button" className="ghost" onClick={load} disabled={loading}><RefreshCw size={14} />{loading ? "刷新中" : "刷新实时数据"}</button><button type="button" className="primary" onClick={exportAll} disabled={!report.projects?.length}><FileSpreadsheet size={14} />导出总表与全部细项</button></div>
    <div className="management-cost-summary"><strong>月度管理总结</strong><p>{report.summary || "正在生成本月成本总结。"}</p><small>数据更新时间：{report.generatedAt ? new Date(report.generatedAt).toLocaleString("zh-CN") : "待刷新"}</small></div>
    <div className="management-cost-metrics"><div><span>管理全成本</span><b>{money(totals.cost)}</b></div><div><span>管理利润</span><b>{money(totals.profit)}</b></div><div><span>执行报销</span><b>{money(totals.reimbursements)}</b></div><div><span>当月人力分摊</span><b>{money(totals.labor)}</b></div></div>
    <div className="management-cost-projects">{(report.projects || []).map((project) => <article key={project.projectId}><button type="button" className="management-cost-project-head" onClick={() => setExpandedId((value) => value === project.projectId ? "" : project.projectId)}><span><strong>{project.projectName}</strong><em>{project.client || "未填写客户"}</em></span><span><b>{money(project.fullCost)}</b><em>利润 {money(project.managementProfit)}</em></span><ChevronDown className={expandedId === project.projectId ? "expanded" : ""} size={18} /></button>{expandedId === project.projectId && <div className="management-cost-details"><div className="management-cost-breakdown"><span>执行报销 {money(project.reimbursements)}</span><span>供应商 {money(project.supplierPayments)}</span><span>垫付 {money(project.advance)}</span><span>利息 {money(project.interest)}</span><span>人力分摊 {money(project.laborAllocation)}</span><span>税费/其他 {money(project.other)}</span></div>{(project.details || []).map((item, index) => <div className="management-cost-detail-row" key={`${item.source}-${item.category}-${index}`}><span>{item.source}</span><strong>{item.category}</strong><em>{item.person || item.note || "-"}</em><b>{money(item.amount)}</b></div>)}{!project.details?.length && <p>该项目本月暂无可下钻细项。</p>}</div>}</article>)}</div>
  </section>;
}
