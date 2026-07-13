import React from "react";

export default function ProjectCommandPanel({
  materialStatus,
  actionItems = [],
  projectAlertUpdates = [],
  focusedActionKey,
  handlingActionKey,
  canHandleProjectAlert,
  icons,
  actionItemKey,
  onUploadType,
  onRecordDynamic,
  onOpenMaterialUpload,
  onHandleActionItem,
}) {
  const { UploadCloud, FileSpreadsheet, CheckCircle2, MessageSquareText } = icons;

  return (
    <>
      <section className="detail-section project-command-center">
        <div className="section-head">
          <h2>项目工作台</h2>
          <span className="muted">围绕当前项目上传、审批、记录和查看 AI 建议</span>
        </div>
        <div className="project-command-grid">
          <button type="button" onClick={() => onUploadType("cost-sheet")}>
            <UploadCloud size={16} />
            <strong>上传成本表</strong>
            <span>执行支出、供应商费用、内部成本</span>
          </button>
          <button type="button" onClick={() => onUploadType("quote-sheet")}>
            <FileSpreadsheet size={16} />
            <strong>上传报价表</strong>
            <span>用于后续月度核销匹配</span>
          </button>
          <button type="button" onClick={() => onUploadType("verification-sheet")}>
            <CheckCircle2 size={16} />
            <strong>上传核销表</strong>
            <span>归集确认收入与核销状态</span>
          </button>
          <button type="button" onClick={onRecordDynamic}>
            <MessageSquareText size={16} />
            <strong>记录动态</strong>
            <span>客户反馈、材料补充、风险提醒</span>
          </button>
        </div>
      </section>

      <section className="detail-section workbench-block">
        <div className="section-head">
          <h2>项目推进清单</h2>
          <span className="muted">{materialStatus.doneCount}/4 项关键材料已完成</span>
        </div>
        <div className="material-grid">
          {materialStatus.items.map((item) => (
            <div className={`material-card ${item.status}`} key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <b>{item.statusLabel}</b>
              </div>
              <span>{item.tip}</span>
              <small>{item.files[0]?.name || item.jobs[0]?.status || "暂无文件记录"}</small>
              {item.key !== "contract" && <button type="button" onClick={() => onOpenMaterialUpload(item)}>
                {item.status === "missing" ? "上传" : "补充"}
              </button>}
            </div>
          ))}
        </div>
        <div className="action-list">
          {actionItems.map((item) => {
            const itemKey = actionItemKey(item);
            const handled = projectAlertUpdates.find((update) => update.alertKey === itemKey || update.title === item.title);
            return (
              <div className={`${item.tone} ${focusedActionKey === itemKey ? "fresh" : ""}`} key={`${item.title}-${item.text}`}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
                {handled ? (
                  <small>{handled.action === "ignore" ? "已忽略" : "已处理"} · {handled.user || "处理人"} · {handled.at ? new Date(handled.at).toLocaleString("zh-CN") : "刚刚"}</small>
                ) : canHandleProjectAlert && (
                  <div className="button-row compact">
                    <button type="button" className="ghost tiny" disabled={handlingActionKey === itemKey} onClick={() => onHandleActionItem(item, "resolve")}>
                      {handlingActionKey === itemKey ? "处理中" : "标记处理"}
                    </button>
                    <button type="button" className="ghost tiny" disabled={handlingActionKey === itemKey} onClick={() => onHandleActionItem(item, "ignore")}>
                      {handlingActionKey === itemKey ? "处理中" : "忽略"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
