import React from "react";
import { FileSpreadsheet } from "lucide-react";
import "./project-progress.css";

export default function ProjectProgressCostPanel({
  progressRef,
  project,
  projectTasks = [],
  taskForm,
  taskTemplates = [],
  costRows = [],
  isManagement,
  approvalTypeOptions = [],
  exportingTaskLedger,
  savingTaskForm,
  completingTaskId,
  archivingTaskId,
  focusedTaskId,
  money,
  taskDueInfo,
  onExportTaskLedger,
  onSubmitTask,
  onUpdateTaskForm,
  onSaveTask,
  onArchiveTask,
  onPrepareTaskTemplate,
  onPrepareCostAction,
}) {
  return (
    <div className="split" ref={progressRef} id="project-progress-section">
      <div>
        <div className="section-head compact">
          <h3>执行进度</h3>
          <button type="button" className="ghost tiny" disabled={exportingTaskLedger || !(project.tasks || []).length} onClick={onExportTaskLedger}>
            <FileSpreadsheet size={14} />{exportingTaskLedger ? "导出中" : "导出任务"}
          </button>
        </div>
        <form className="task-form" onSubmit={onSubmitTask}>
          <input value={taskForm.title} onChange={(event) => onUpdateTaskForm("title", event.target.value)} placeholder="新增交付节点 / 任务" />
          <input value={taskForm.owner} onChange={(event) => onUpdateTaskForm("owner", event.target.value)} placeholder="负责人" />
          <input value={taskForm.dueDate} onChange={(event) => onUpdateTaskForm("dueDate", event.target.value)} placeholder="截止时间" />
          <input value={taskForm.progress} onChange={(event) => onUpdateTaskForm("progress", event.target.value)} placeholder="进度%" />
          <button type="submit" className="primary" disabled={savingTaskForm}>{savingTaskForm ? "保存中" : "新增任务"}</button>
        </form>
        {projectTasks.map((task) => {
          const dueInfo = taskDueInfo(task);
          return (
            <div className={`progress-row task-row ${task.status} ${dueInfo?.tone || ""} ${focusedTaskId === (task.id || task.title) ? "fresh" : ""}`} key={task.id || task.title}>
              <span>{task.title}</span>
              <div><i style={{ width: `${task.progress}%` }} /></div>
              <b>{task.progress}%</b>
              <button type="button" onClick={() => onSaveTask({ taskId: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, note: task.note, action: "complete" })} disabled={completingTaskId === (task.id || task.title) || task.progress >= 100}>
                {task.progress >= 100 ? "已完成" : completingTaskId === (task.id || task.title) ? "完成中" : "完成"}
              </button>
              <button type="button" className="ghost" onClick={() => onArchiveTask(task)} disabled={archivingTaskId === (task.id || task.title)}>
                {archivingTaskId === (task.id || task.title) ? "归档中" : "归档"}
              </button>
              <small>
                {[task.owner, task.dueDate, task.note].filter(Boolean).join(" · ") || "未补充负责人/节点"}
                {dueInfo && <em className={`task-due-badge ${dueInfo.tone}`}>{dueInfo.label}</em>}
              </small>
            </div>
          );
        })}
        {!projectTasks.length && (
          <div className="action-empty task-template-empty">
            <strong>暂无执行任务</strong>
            <span>可以先用常见广告项目节点预填任务，确认负责人和截止时间后再保存。</span>
            <div className="button-row compact">
              {taskTemplates.map((template) => (
                <button type="button" className="ghost tiny" onClick={() => onPrepareTaskTemplate(template)} key={template.title}>
                  {template.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <h3>{isManagement ? "成本与利润" : "成本构成"}</h3>
        {costRows.length ? costRows.map(({ name, value }) => (
          <div className="cost-row" key={name}>
            <span>{name}</span>
            <b>{money(value)}</b>
          </div>
        )) : (
          <div className="action-empty cost-action-empty">
            <strong>暂无成本明细</strong>
            <span>上传成本表、提交报销或供应商付款通过后，会自动进入这里形成成本构成。</span>
            <div className="button-row compact">
              <button type="button" className="ghost tiny" onClick={() => onPrepareCostAction("cost-sheet")}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={() => onPrepareCostAction("reimbursement")}>提交报销</button>
              {approvalTypeOptions.some(([value]) => value === "supplier_payment") && (
                <button type="button" className="ghost tiny" onClick={() => onPrepareCostAction("supplier_payment")}>供应商付款</button>
              )}
            </div>
          </div>
        )}
        {isManagement && <div className="cost-row strong">
          <span>项目利润</span>
          <b>{money(project.extractedFields?.profitBreakdown?.profit ?? Number(project.contract || 0) - Number(project.costUsed || 0))}</b>
        </div>}
        {isManagement && <div className="cost-row strong">
          <span>毛利率</span>
          <b>{project.margin || 0}%</b>
        </div>}
      </div>
    </div>
  );
}
