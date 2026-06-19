import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import * as echarts from "echarts";
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import "./styles.css";

const projects = [
  {
    id: "P-2026-0618",
    name: "青岚汽车夏季上市整合传播",
    client: "青岚汽车",
    brand: "青岚 E9",
    owner: "周敏",
    sales: "林泽",
    pm: "何佳",
    status: "执行中",
    risk: "高",
    contract: 1280000,
    costBudget: 820000,
    costUsed: 742000,
    paid: 480000,
    receivable: 800000,
    progress: 64,
    margin: 42,
    nextMilestone: "6月28日 线下发布会执行复盘",
    paymentDue: "6月30日 第二笔回款",
    aiSummary:
      "执行进度正常但成本消耗已达预算 90.5%，物料搭建与达人追加费用推高毛利风险；第二笔回款临近，需销售提前确认验收材料。",
    alerts: [
      { role: "PM", type: "成本预警", text: "成本消耗超过预算 90%，建议冻结新增供应商需求。" },
      { role: "销售", type: "回款提醒", text: "第二笔 50 万回款距到期 11 天，需确认验收单。" },
    ],
    tasks: [
      ["策略方案", 100],
      ["达人执行", 72],
      ["线下发布", 55],
      ["复盘结案", 20],
    ],
    costs: [
      ["媒介采买", 260000],
      ["达人合作", 188000],
      ["场地搭建", 212000],
      ["设计制作", 82000],
    ],
  },
  {
    id: "P-2026-0602",
    name: "星屿咖啡年度社媒代运营",
    client: "星屿咖啡",
    brand: "星屿",
    owner: "陈安",
    sales: "林泽",
    pm: "王祎",
    status: "执行中",
    risk: "中",
    contract: 960000,
    costBudget: 520000,
    costUsed: 278000,
    paid: 320000,
    receivable: 640000,
    progress: 38,
    margin: 55,
    nextMilestone: "7月5日 Q3 内容日历确认",
    paymentDue: "7月15日 季度回款",
    aiSummary:
      "项目成本健康，内容生产按月推进；客户确认链路较长，建议将选题确认节点提前 3 个工作日。",
    alerts: [{ role: "PM", type: "进度提醒", text: "Q3 内容日历尚未锁版，可能影响 7 月首周发布。" }],
    tasks: [
      ["月度选题", 80],
      ["内容制作", 42],
      ["投放优化", 35],
      ["数据周报", 50],
    ],
    costs: [
      ["内容拍摄", 96000],
      ["设计剪辑", 74000],
      ["投流测试", 85000],
      ["项目管理", 23000],
    ],
  },
  {
    id: "P-2026-0521",
    name: "森泊家居618效果投放",
    client: "森泊家居",
    brand: "森泊",
    owner: "许诺",
    sales: "郭婷",
    pm: "何佳",
    status: "已完成",
    risk: "高",
    contract: 740000,
    costBudget: 510000,
    costUsed: 536000,
    paid: 290000,
    receivable: 450000,
    progress: 100,
    margin: 28,
    nextMilestone: "等待客户确认结案报告",
    paymentDue: "已逾期 9 天",
    aiSummary:
      "项目已完成但尾款逾期，且实际成本超过预算 5.1%；建议销售推动结案确认，财务同步发起催收流程。",
    alerts: [
      { role: "销售", type: "逾期回款", text: "45 万尾款已逾期 9 天，项目结案报告需客户签收。" },
      { role: "管理层", type: "毛利预警", text: "毛利率低于 30%，需复盘追加投放审批。" },
    ],
    tasks: [
      ["账户搭建", 100],
      ["素材测试", 100],
      ["投放冲刺", 100],
      ["结案确认", 78],
    ],
    costs: [
      ["信息流投放", 420000],
      ["素材制作", 46000],
      ["数据工具", 18000],
      ["优化服务", 52000],
    ],
  },
  {
    id: "P-2026-0610",
    name: "雾岛美妆新品种草矩阵",
    client: "雾岛美妆",
    brand: "LumaMist",
    owner: "梁浅",
    sales: "赵越",
    pm: "王祎",
    status: "筹备中",
    risk: "低",
    contract: 560000,
    costBudget: 330000,
    costUsed: 92000,
    paid: 168000,
    receivable: 392000,
    progress: 18,
    margin: 61,
    nextMilestone: "6月24日 KOL 初筛名单提交",
    paymentDue: "8月20日 中期回款",
    aiSummary:
      "项目刚启动，首付款已到账；达人报价仍在收集中，建议 PM 在名单确认前锁定替补资源池。",
    alerts: [],
    tasks: [
      ["合同归档", 100],
      ["达人筛选", 24],
      ["脚本确认", 0],
      ["发布排期", 0],
    ],
    costs: [
      ["达人定金", 72000],
      ["脚本策划", 12000],
      ["样品物流", 8000],
    ],
  },
];

function money(value) {
  if (value >= 10000) return `${(value / 10000).toFixed(0)}万`;
  return value.toLocaleString("zh-CN");
}

function useChart(option) {
  return (node) => {
    if (!node) return;
    const chart = echarts.init(node);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
  };
}

function App() {
  const [selectedId, setSelectedId] = useState(projects[0].id);
  const [role, setRole] = useState("全部角色");
  const selected = projects.find((project) => project.id === selectedId) || projects[0];
  const stats = useMemo(() => {
    const contract = projects.reduce((sum, item) => sum + item.contract, 0);
    const used = projects.reduce((sum, item) => sum + item.costUsed, 0);
    const paid = projects.reduce((sum, item) => sum + item.paid, 0);
    const receivable = projects.reduce((sum, item) => sum + item.receivable, 0);
    return { contract, used, paid, receivable };
  }, []);

  const progressRef = useChart({
    tooltip: { trigger: "item" },
    color: ["#2f6fed", "#16a34a", "#eab308", "#ef4444"],
    series: [
      {
        type: "pie",
        radius: ["50%", "72%"],
        data: [
          { value: 2, name: "执行中" },
          { value: 1, name: "已完成" },
          { value: 1, name: "筹备中" },
          { value: 1, name: "高风险" },
        ],
      },
    ],
  });

  const cashRef = useChart({
    grid: { left: 42, right: 14, top: 18, bottom: 32 },
    tooltip: {},
    xAxis: { type: "category", data: projects.map((item) => item.client), axisLabel: { interval: 0 } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => `${v / 10000}万` } },
    color: ["#2563eb", "#f59e0b"],
    series: [
      { name: "已回款", type: "bar", data: projects.map((item) => item.paid), barMaxWidth: 26 },
      { name: "待回款", type: "bar", data: projects.map((item) => item.receivable), barMaxWidth: 26 },
    ],
  });

  const costRef = useChart({
    grid: { left: 60, right: 24, top: 20, bottom: 20 },
    tooltip: {},
    xAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
    yAxis: { type: "category", data: projects.map((item) => item.pm) },
    color: ["#0f766e"],
    series: [
      {
        type: "bar",
        data: projects.map((item) => Math.round((item.costUsed / item.costBudget) * 100)),
        label: { show: true, position: "right", formatter: "{c}%" },
        barMaxWidth: 18,
      },
    ],
  });

  const visibleAlerts = projects
    .flatMap((project) => project.alerts.map((alert) => ({ ...alert, project: project.name })))
    .filter((alert) => role === "全部角色" || alert.role === role);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">A</div>
          <div>
            <strong>广告项目中台</strong>
            <span>经营 / 执行 / 回款</span>
          </div>
        </div>
        <nav>
          <a className="active"><LayoutDashboard size={18} />经营大屏</a>
          <a><FileText size={18} />项目台账</a>
          <a><FileSpreadsheet size={18} />文件解析</a>
          <a><BellRing size={18} />预警中心</a>
          <a><UsersRound size={18} />协作空间</a>
          <a><Settings2 size={18} />接口配置</a>
        </nav>
        <div className="integration">
          <p>通知通道</p>
          <button><MessageSquareText size={16} />飞书机器人</button>
          <button><MessageSquareText size={16} />企业微信</button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>项目经营驾驶舱</h1>
            <p>合同、执行、成本、回款与风险预警集中管理</p>
          </div>
          <div className="actions">
            <div className="search"><Search size={16} /><input placeholder="搜索项目、客户、负责人" /></div>
            <button className="ghost"><Filter size={16} />筛选</button>
            <button className="primary"><Plus size={16} />新建项目</button>
          </div>
        </header>

        <section className="metrics">
          <Metric icon={CircleDollarSign} label="合同总额" value={money(stats.contract)} sub="本年度已归档项目" />
          <Metric icon={CheckCircle2} label="已回款" value={money(stats.paid)} sub={`回款率 ${Math.round((stats.paid / stats.contract) * 100)}%`} />
          <Metric icon={Clock3} label="待回款" value={money(stats.receivable)} sub="含逾期与未到期" />
          <Metric icon={ShieldAlert} label="成本消耗" value={money(stats.used)} sub="按执行表实时归集" />
        </section>

        <section className="dashboard-grid">
          <div className="panel wide">
            <PanelTitle icon={BarChart3} title="回款分布" />
            <div className="chart" ref={cashRef}></div>
          </div>
          <div className="panel">
            <PanelTitle icon={LayoutDashboard} title="进度结构" />
            <div className="chart" ref={progressRef}></div>
          </div>
          <div className="panel">
            <PanelTitle icon={AlertTriangle} title="PM 成本压力" />
            <div className="chart" ref={costRef}></div>
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

        <section className="workspace">
          <div className="project-list">
            <div className="section-head">
              <h2>项目台账</h2>
              <button><UploadCloud size={16} />上传合同/执行表</button>
            </div>
            {projects.map((project) => (
              <button
                className={`project-row ${project.id === selectedId ? "selected" : ""}`}
                key={project.id}
                onClick={() => setSelectedId(project.id)}
              >
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.client} · {project.sales} / {project.pm}</span>
                </div>
                <div className="row-right">
                  <RiskBadge risk={project.risk} />
                  <span>{project.progress}%</span>
                  <ChevronRight size={16} />
                </div>
              </button>
            ))}
          </div>

          <ProjectDetail project={selected} />
        </section>
      </main>
    </div>
  );
}

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

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function RiskBadge({ risk }) {
  return <b className={`risk risk-${risk}`}>{risk}风险</b>;
}

function ProjectDetail({ project }) {
  const usedRate = Math.round((project.costUsed / project.costBudget) * 100);
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="id">{project.id}</span>
          <h2>{project.name}</h2>
          <p>{project.client} · {project.brand} · {project.status}</p>
        </div>
        <RiskBadge risk={project.risk} />
      </div>

      <div className="summary">
        <Bot size={18} />
        <p>{project.aiSummary}</p>
      </div>

      <div className="detail-metrics">
        <Mini label="合同金额" value={money(project.contract)} />
        <Mini label="成本使用" value={`${usedRate}%`} />
        <Mini label="已回款" value={money(project.paid)} />
        <Mini label="毛利率" value={`${project.margin}%`} />
      </div>

      <div className="split">
        <div>
          <h3>执行进度</h3>
          {project.tasks.map(([name, value]) => (
            <div className="progress-row" key={name}>
              <span>{name}</span>
              <div><i style={{ width: `${value}%` }} /></div>
              <b>{value}%</b>
            </div>
          ))}
        </div>
        <div>
          <h3>成本构成</h3>
          {project.costs.map(([name, value]) => (
            <div className="cost-row" key={name}>
              <span>{name}</span>
              <b>{money(value)}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="timeline">
        <div>
          <span>下一节点</span>
          <strong>{project.nextMilestone}</strong>
        </div>
        <div>
          <span>回款节点</span>
          <strong>{project.paymentDue}</strong>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

createRoot(document.getElementById("root")).render(<App />);
