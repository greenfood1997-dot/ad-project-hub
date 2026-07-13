import React from "react";
import "./employee.css";

export default function EmployeeProjectOverview({
  projects = [],
  selected,
  feishuPendingFiles = [],
  onSelect,
  onUpload,
  onOpenProject,
  projectHealth,
  normalizeTask,
  money,
  Metric,
  PanelTitle,
  icons,
}) {
  const { UploadCloud, LayoutDashboard, Clock3, CircleDollarSign, FileText, Bot, CheckCircle2, ShieldAlert, FileSpreadsheet } = icons;
  const activeProjects = projects.filter((project) => project.status !== "已完成");
  const health = projectHealth(selected);
  const tasks = (selected.tasks || []).map(normalizeTask);
  const pettyLeft = Math.max(Number(selected.pettyCashBudget || 0) - Number(selected.pettyCashUsed || 0), 0);
  const missingItems = [
    selected.contract ? null : "合同金额待补",
    selected.files?.length ? null : "项目文件待上传",
    selected.paymentDue && selected.paymentDue !== "待确认回款节点" ? null : "回款节点待确认",
    selected.costUsed ? null : "成本表待归集",
  ].filter(Boolean);
  const projectPendingFeishu = feishuPendingFiles.filter((item) => item.status === "待确认" && (item.projectId === selected.id || item.projectName === selected.name));
  const displayMissing = [
    ...projectPendingFeishu.map((item) => `飞书文件待确认：${item.file?.name || item.preview?.fileName || "未命名文件"}`),
    ...(missingItems.length ? missingItems : ["合同、成本、核销材料目前没有明显缺口"])
  ];

  return (
    <>
      <section className="employee-hero">
        <div>
          <span>我的项目工作台</span>
          <h2>{selected.name}</h2>
          <p>{selected.client} · {selected.pm} 负责 · 下一节点：{selected.nextMilestone}</p>
        </div>
        <button type="button" className="primary hero-upload" onClick={onUpload}><UploadCloud size={16} /><span>上传项目文件</span></button>
      </section>

      <section className="metrics employee-metrics">
        <Metric icon={LayoutDashboard} label="项目进度" value={`${selected.progress}%`} sub={`AI 判断：${health.label}`} />
        <Metric icon={Clock3} label="时间进度" value={`${health.timeProgress}%`} sub="按合同周期粗略估算" />
        <Metric icon={CircleDollarSign} label="备用金余额" value={money(pettyLeft)} sub={`已用 ${money(selected.pettyCashUsed)}`} />
        <Metric icon={FileText} label="当前项目数" value={`${activeProjects.length || projects.length} 个`} sub="仅展示你可见的项目" />
      </section>

      <section className={`employee-grid ${projects.length <= 1 ? "single-project" : ""}`}>
        <div className={`panel employee-focus ${health.tone}`}>
          <PanelTitle icon={Bot} title="AI 项目巡检" />
          <div className="employee-health-number">
            <strong>{health.label}</strong>
            <span>时间 {health.timeProgress}% · 完成 {health.completion}%</span>
          </div>
          <div className="health-track">
            <i style={{ width: `${health.completion}%` }} />
          </div>
          <p>{health.text}</p>
        </div>

        <div className="panel">
          <PanelTitle icon={CheckCircle2} title="当前任务" />
          <div className="employee-task-list">
            {tasks.map((task) => (
              <div className="employee-task" key={task.id || task.title}>
                <span>{task.title}</span>
                <b>{task.progress}%</b>
                <div><i style={{ width: `${task.progress}%` }} /></div>
                <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("progress")}>打开进度</button>
              </div>
            ))}
            {!tasks.length && (
              <div className="action-empty employee-task-empty">
                <strong>暂无执行任务</strong>
                <span>可以先进入项目详情，用广告项目节点模板新增任务，也可以让 AI 帮你归档材料。</span>
                <div className="button-row compact">
                  <button type="button" className="primary tiny" onClick={() => onOpenProject?.("progress")}>新增项目任务</button>
                  <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("files")}>上传项目材料</button>
                  <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("approvals")}>提交报销/备用金</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <PanelTitle icon={ShieldAlert} title="材料与报销提醒" />
          <div className="compact-list">
            {displayMissing.map((item) => (
              <div key={item}>
                <strong>{item}</strong>
                <span>可直接从右侧 AI 输入，或点上传让 AI 识别后归档。</span>
                <div className="button-row compact">
                  {/报销|备用金/.test(item)
                    ? <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("approvals")}>去审批区</button>
                    : <button type="button" className="ghost tiny" onClick={() => onOpenProject?.("files")}>去文件区</button>}
                  <button type="button" className="ghost tiny" onClick={onUpload}>上传文件</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {projects.length > 1 && (
          <div className="panel">
            <PanelTitle icon={FileSpreadsheet} title="我的项目列表" />
            <div className="employee-project-strip">
              {projects.slice(0, 5).map((project) => (
                <button
                  type="button"
                  className={project.id === selected.id ? "active" : ""}
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{projectHealth(project).label} · {project.progress}% · 余 {money(Math.max(project.pettyCashBudget - project.pettyCashUsed, 0))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
