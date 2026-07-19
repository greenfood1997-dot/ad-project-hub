import React, { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Bot, CircleDollarSign, FileSpreadsheet, HandCoins, Settings2, UsersRound } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { managementLedgerRows } from "./utils/ledgerRows.js";
import { calculateRunway, operatingMetrics } from "./utils/operatingMetrics.js";
import "./management.css";
import ManagementCostDashboard from "./ManagementCostDashboard.jsx";

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

function LogicItem({ title, text }) {
  return <div className="logic-item"><strong>{title}</strong><p>{text}</p></div>;
}

export default function ManagementCockpit({ projects, approvals = [], settings = {}, session, stats, subView, setSubView, onOpenApprovals, onOpenCollections, onOpenProjectSection, onDone, onNotice }) {
  const metrics = operatingMetrics(projects, approvals, stats, settings, { formatMoney: money });
  const [financeForm, setFinanceForm] = useState(() => ({
    currentCash: metrics.runway.currentCash || "",
    monthlyLaborCost: metrics.runway.monthlyLaborCost || "",
    monthlyRent: metrics.runway.monthlyRent || "",
    monthlyLoan: metrics.runway.monthlyLoan || "",
    monthlyInterest: metrics.runway.monthlyInterest || "",
    monthlyOtherCost: metrics.runway.monthlyOtherCost || ""
  }));
  const [savingFinance, setSavingFinance] = useState(false);
  const [exportingManagement, setExportingManagement] = useState(false);
  useEffect(() => {
    setFinanceForm({
      currentCash: metrics.runway.currentCash || "",
      monthlyLaborCost: metrics.runway.monthlyLaborCost || "",
      monthlyRent: metrics.runway.monthlyRent || "",
      monthlyLoan: metrics.runway.monthlyLoan || "",
      monthlyInterest: metrics.runway.monthlyInterest || "",
      monthlyOtherCost: metrics.runway.monthlyOtherCost || ""
    });
  }, [settings.companyFinance?.savedAt]);
  const financePreview = calculateRunway(financeForm);

  async function saveFinance(event) {
    event.preventDefault();
    setSavingFinance(true);
    try {
      const saved = await apiRequest("/api/company-finance", session, {
        method: "POST",
        body: JSON.stringify({ values: financeForm })
      });
      await onDone();
      onNotice(`公司现金流设置已保存，经营舱已刷新：月固定支出 ${money(saved.monthlyFixedCost)}，现金可撑 ${saved.monthlyFixedCost ? `${Number(saved.runwayMonths || 0).toFixed(1)} 个月` : "待设置"}，6个月缺口 ${money(saved.gap)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingFinance(false);
    }
  }

  const evidence = [
    `待回款占合同 ${metrics.receivableRate}%`,
    `待处理审批 ${metrics.pendingApprovals.length} 条`,
    `综合毛利率 ${metrics.margin}%`,
    metrics.topRisk ? `最高风险项目：${metrics.topRisk.name}` : "暂无明显高风险项目"
  ];
  const showCash = subView === "现金流压力";
  const showAdvisor = subView === "AI 商业顾问";
  const showCosts = subView === "实时全成本";
  const showDashboard = !showCash && !showAdvisor && !showCosts;
  const managementTabs = [
    { label: "公司大盘", icon: BarChart3, text: "看总额、回款、利润、项目结构" },
    { label: "现金流压力", icon: CircleDollarSign, text: "按6个月安全线判断现金能撑多久" },
    { label: "AI 商业顾问", icon: Bot, text: "把经营数据翻译成下一步动作" }
    ,{ label: "实时全成本", icon: FileSpreadsheet, text: "实时看项目全成本并下钻细项" }
  ];
  function handleAdvisorAction(action = "", index = 0) {
    if (/催收|回款|待回款/.test(action)) {
      onOpenCollections?.(metrics.highRiskProjects[0] || metrics.topRisk || null);
      return;
    }
    if (/审批|备用金|报销|供应商付款|支出/.test(action)) {
      onOpenApprovals?.();
      return;
    }
    if (/现金|安全线|缺口|固定支出|收缩/.test(action)) {
      setSubView("现金流压力");
      onNotice?.("已切到现金流压力页，可以先补现金设置，再按 6 个月安全线做收缩决策。");
      return;
    }
    setSubView("公司大盘");
    onNotice?.(`已回到公司经营大盘，查看建议 ${index + 1} 的数据来源。`);
  }
  function handleRiskProject(project) {
    if (project.actionTarget === "payments" && Number(project.receivable || 0) > 0) {
      onOpenCollections?.(project);
      return;
    }
    onOpenProjectSection?.(project, project.actionTarget === "costs" ? "costs" : "progress", `已打开「${project.name}」的${project.actionTarget === "costs" ? "成本与审批区" : "项目进度区"}，处理经营舱建议：${project.actionReason}。`);
  }
  const cashHealthClass = metrics.runway.runwayLabel.includes("危险") || metrics.pressureLevel === "高" ? "danger" : metrics.pressureLevel === "中" ? "ok" : "good";
  const cashHealth = (
    <div className={`health-card ${cashHealthClass}`}>
      <div><span>压力等级</span><strong>{metrics.runway.runwayLabel.includes("危险") ? "危险" : metrics.pressureLevel}</strong></div>
      <div className="health-track"><i style={{ width: `${Math.min(100, metrics.pressureScore)}%` }} /></div>
      <p>{metrics.runway.runwayLabel}。待回款 {money(stats.receivable)} · 待备用金 {money(metrics.pendingPettyCash)} · 待报销 {money(metrics.pendingReimbursements)} · 待供应商付款 {money(metrics.pendingSupplierPay)}</p>
    </div>
  );
  const cashFormula = [
    ["人力", metrics.runway.monthlyLaborCost],
    ["租金", metrics.runway.monthlyRent],
    ["贷款", metrics.runway.monthlyLoan],
    ["利息", metrics.runway.monthlyInterest],
    ["其他", metrics.runway.monthlyOtherCost]
  ];
  const financeTemplates = [
    {
      label: "轻团队",
      values: { monthlyLaborCost: 80000, monthlyRent: 12000, monthlyLoan: 0, monthlyInterest: 0, monthlyOtherCost: 15000 }
    },
    {
      label: "拍摄执行期",
      values: { monthlyLaborCost: 120000, monthlyRent: 18000, monthlyLoan: 20000, monthlyInterest: 3000, monthlyOtherCost: 35000 }
    },
    {
      label: "收缩现金流",
      values: { monthlyLaborCost: 70000, monthlyRent: 10000, monthlyLoan: 15000, monthlyInterest: 2500, monthlyOtherCost: 8000 }
    }
  ];
  function applyFinanceTemplate(template) {
    setFinanceForm((current) => ({ ...current, ...template.values }));
    onNotice?.(`已套用「${template.label}」现金流模板，请按真实账面现金和固定支出调整后保存。`);
  }
  async function exportManagementLedger() {
    setExportingManagement(true);
    try {
      downloadCsv("公司经营舱摘要.csv", managementLedgerRows(metrics, stats, projects));
      onNotice?.("公司经营舱摘要 CSV 已导出，包含经营建议、现金安全线和优先项目。");
    } finally {
      setExportingManagement(false);
    }
  }
  const financeSettingsForm = (
    <form className="feature-panel settings-form" onSubmit={saveFinance}>
      <PanelTitle icon={Settings2} title="经营现金设置" />
      <div className="finance-template-row">
        {financeTemplates.map((template) => (
          <button type="button" className="ghost tiny" key={template.label} onClick={() => applyFinanceTemplate(template)}>
            <HandCoins size={14} />{template.label}
          </button>
        ))}
      </div>
      {[
        ["currentCash", "当前公司现金"],
        ["monthlyLaborCost", "每月人力成本"],
        ["monthlyRent", "每月租金"],
        ["monthlyLoan", "每月贷款"],
        ["monthlyInterest", "每月利息"],
        ["monthlyOtherCost", "每月其他固定支出"]
      ].map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <input value={financeForm[key]} onChange={(event) => setFinanceForm((current) => ({ ...current, [key]: event.target.value }))} placeholder="填写金额" />
        </label>
      ))}
      <div className={`cash-settings-preview ${financePreview.runwayLabel.includes("危险") ? "danger" : financePreview.runwayLabel === "谨慎" ? "warn" : "ok"}`}>
        <strong>{financePreview.runwayLabel}</strong>
        <span>月固定支出 {money(financePreview.monthlyFixedCost)} · 6个月安全线 {money(financePreview.safetyReserve)} · 缺口 {money(financePreview.gap)}</span>
        <em>{financePreview.monthlyFixedCost ? `按当前填写，现金还能撑 ${financePreview.runwayMonths.toFixed(1)} 个月。` : "先填写每月固定支出，系统才会计算现金安全线。"}</em>
      </div>
      <button type="submit" className="primary" disabled={savingFinance}>{savingFinance ? "保存中" : "保存现金设置"}</button>
    </form>
  );
  return (
    <section className="feature-grid">
      <div className="feature-panel wide-feature management-switcher">
        <div>
          <PanelTitle icon={showCash ? CircleDollarSign : showAdvisor ? Bot : showCosts ? FileSpreadsheet : BarChart3} title={showCash ? "现金流压力" : showAdvisor ? "AI 商业顾问" : showCosts ? "实时全成本" : "公司经营大盘"} />
          <p>{showCash ? "现金安全线 = 当前公司现金 ÷（人力 + 租金 + 贷款 + 利息 + 每月其他固定支出），目标至少撑过 6 个月。" : showAdvisor ? "AI 顾问只给管理层看，会根据回款、毛利、现金压力和项目风险给经营动作。" : "这里汇总所有项目的合同、回款、支出、利润和项目风险，帮助创始人快速看公司状态。"}</p>
        </div>
        <button type="button" className="ghost" disabled={exportingManagement} onClick={exportManagementLedger}><FileSpreadsheet size={14} />{exportingManagement ? "导出中" : "导出经营摘要"}</button>
        <div className="management-tab-row">
          {managementTabs.map(({ label, icon: Icon, text }) => (
            <button
              type="button"
              className={(subView || "公司大盘") === label || (!subView && label === "公司大盘") ? "active" : ""}
              key={label}
              onClick={() => setSubView(label)}
            >
              <Icon size={16} />
              <strong>{label}</strong>
              <span>{text}</span>
            </button>
          ))}
        </div>
      </div>
      {showCosts && <ManagementCostDashboard session={session} onNotice={onNotice} />}
      {showDashboard && <>
        <div className="feature-panel founder-card wide-feature">
          <PanelTitle icon={BarChart3} title="公司经营大盘" />
          <div className="review-summary">
            <Mini label="合同总额" value={money(stats.contract)} />
            <Mini label="已回款" value={money(stats.paid)} />
            <Mini label="待回款" value={money(stats.receivable)} />
            <Mini label="总支出" value={money(metrics.spending)} />
            <Mini label="项目利润" value={money(metrics.profit)} />
            <Mini label="综合毛利率" value={`${metrics.margin}%`} />
            <Mini label="进行中项目" value={`${metrics.activeProjects.length} 个`} />
            <Mini label="已完成项目" value={`${metrics.completedProjects.length} 个`} />
            <Mini label="现金可撑" value={metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)}月` : "待设置"} />
            <Mini label="6个月缺口" value={money(metrics.runway.gap)} />
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="风险雷达" />
          <div className="compact-list">
            {metrics.highRiskProjects.slice(0, 5).map((project) => (
              <div key={project.id}><strong>{project.name}</strong><span>{project.risk}风险 · 待回款 {money(project.receivable)} · 成本占比 {project.costRate}% · 毛利率 {project.projectMargin}%</span></div>
            ))}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={UsersRound} title="项目结构" />
          <div className="compact-list">
            <div><strong>高风险项目</strong><span>{projects.filter((project) => project.risk === "高").length} 个</span></div>
            <div><strong>中风险项目</strong><span>{projects.filter((project) => project.risk === "中").length} 个</span></div>
            <div><strong>低风险项目</strong><span>{projects.filter((project) => project.risk === "低").length} 个</span></div>
            <div><strong>待审批</strong><span>{metrics.pendingApprovals.length} 条</span></div>
          </div>
        </div>
      </>}
      {showCash && <>
        <div className="feature-panel wide-feature">
          <PanelTitle icon={CircleDollarSign} title="现金流压力" />
          {cashHealth}
          <div className="cash-formula-card">
            <strong>6个月现金底线公式</strong>
            <p>月固定支出 = 人力 + 租金 + 贷款 + 利息 + 每月其他支出；可存活月数 = 当前公司现金 ÷ 月固定支出。</p>
            <div>
              {cashFormula.map(([label, value]) => <span key={label}>{label} {money(value)}</span>)}
            </div>
            <b>{money(metrics.runway.currentCash)} ÷ {money(metrics.runway.monthlyFixedCost)} = {metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)} 个月` : "待设置"}</b>
          </div>
          <div className="review-summary">
            <Mini label="当前现金" value={money(metrics.runway.currentCash)} />
            <Mini label="月固定支出" value={money(metrics.runway.monthlyFixedCost)} />
            <Mini label="6个月安全线" value={money(metrics.runway.safetyReserve)} />
            <Mini label="6个月缺口" value={money(metrics.runway.gap)} />
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="现金压力来源" />
          <div className="compact-list">
            <div><strong>现金压力总暴露</strong><span>{money(metrics.cashPressureAmount)}</span></div>
            <div><strong>待回款</strong><span>{money(stats.receivable)}</span></div>
            <div><strong>待备用金</strong><span>{money(metrics.pendingPettyCash)}</span></div>
            <div><strong>待报销</strong><span>{money(metrics.pendingReimbursements)}</span></div>
            <div><strong>待供应商付款</strong><span>{money(metrics.pendingSupplierPay)}</span></div>
          </div>
        </div>
        {financeSettingsForm}
      </>}
      {showAdvisor && <>
        <div className="feature-panel founder-card wide-feature">
          <PanelTitle icon={Bot} title="AI 商业顾问" />
          <div className="idea-card">
            <strong>经营建议：{metrics.recommendation}</strong>
            <p>{evidence.join("；")}。</p>
          </div>
          <div className="logic-list advisor-action-list">
            {metrics.advisorActions.map((action, index) => (
              <button type="button" className="advisor-action-card" key={action} onClick={() => handleAdvisorAction(action, index)}>
                <LogicItem title={`建议 ${index + 1}`} text={action} />
                <span>{/催收|回款|待回款/.test(action) ? "去催收" : /审批|备用金|报销|供应商付款|支出/.test(action) ? "去审批" : /现金|安全线|缺口|固定支出|收缩/.test(action) ? "看现金流" : "看大盘"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={BarChart3} title="判断依据" />
          <div className="compact-list">
            <div><strong>待回款占比</strong><span>{metrics.receivableRate}%</span></div>
            <div><strong>综合毛利率</strong><span>{metrics.margin}%</span></div>
            <div><strong>现金可撑</strong><span>{metrics.runway.monthlyFixedCost ? `${metrics.runway.runwayMonths.toFixed(1)}个月` : "待设置"}</span></div>
            <div><strong>待处理审批</strong><span>{metrics.pendingApprovals.length} 条</span></div>
          </div>
        </div>
        <div className="feature-panel">
          <PanelTitle icon={AlertTriangle} title="优先关注项目" />
          <div className="compact-list">
            {metrics.highRiskProjects.slice(0, 4).map((project) => (
              <button type="button" className="compact-action-row management-risk-action" key={project.id} onClick={() => handleRiskProject(project)}>
                <strong>{project.name}</strong>
                <span>评分 {project.score} · 待回款 {money(project.receivable)} · 毛利率 {project.projectMargin}%</span>
                <em>{project.actionLabel} · {project.actionReason}</em>
              </button>
            ))}
          </div>
        </div>
      </>}
    </section>
  );
}
