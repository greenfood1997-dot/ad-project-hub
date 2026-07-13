import React from "react";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  LayoutDashboard,
  ShieldAlert,
} from "lucide-react";

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="metric">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{sub}</p>
    </div>
  );
}

export default function ManagementDashboardOverview({ stats, cashOption, progressOption, costOption, role, setRole, visibleAlerts, money, LazyChart, PanelTitle }) {
  const payRate = stats.contract ? Math.round((stats.paid / stats.contract) * 100) : 0;
  return (
    <>
      <section className="metrics">
        <Metric icon={CircleDollarSign} label="合同总额" value={money(stats.contract)} sub="本年度已归档项目" />
        <Metric icon={CheckCircle2} label="已回款" value={money(stats.paid)} sub={`回款率 ${payRate}%`} />
        <Metric icon={Clock3} label="待回款" value={money(stats.receivable)} sub="含逾期与未到期" />
        <Metric icon={ShieldAlert} label="成本消耗" value={money(stats.used)} sub="按执行表实时归集" />
      </section>

      <section className="dashboard-grid">
        <div className="panel wide">
          <PanelTitle icon={BarChart3} title="回款分布" />
          <LazyChart option={cashOption} />
        </div>
        <div className="panel">
          <PanelTitle icon={LayoutDashboard} title="进度结构" />
          <LazyChart option={progressOption} />
        </div>
        <div className="panel">
          <PanelTitle icon={AlertTriangle} title="PM 成本压力" />
          <LazyChart option={costOption} />
        </div>
        <div className="panel alert-panel">
          <div className="panel-row">
            <PanelTitle icon={BellRing} title="智能预警" />
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option>全部角色</option>
              <option>PM</option>
              <option>销售</option>
              <option>管理层</option>
            </select>
          </div>
          <div className="alert-list">
            {visibleAlerts.map((alert, index) => (
              <div className="alert-item" key={`${alert.project}-${index}`}>
                <strong>{alert.type}</strong>
                <span>{alert.role} · {alert.project}</span>
                <p>{alert.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
