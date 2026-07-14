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
  const { MessageSquareText } = icons;
  const materialKeys = new Set(["contract", "quote", "cost", "verification"]);
  const nonMaterialActions = actionItems.filter((item) => !/(合同|报价表|成本表|核销表).*(缺|补|上传)|补齐.*(合同|报价|成本|核销)/.test(`${item.title || ""}${item.text || ""}`));

  return (
      <section className="detail-section workbench-block project-command-center">
        <div className="section-head">
          <div>
            <h2>项目推进</h2>
            <span className="muted">材料状态就是操作入口 · {materialStatus.doneCount}/4 项关键材料已完成</span>
          </div>
          <button type="button" className="ghost tiny project-dynamic-action" onClick={onRecordDynamic}>
            <MessageSquareText size={15} />记录动态
          </button>
        </div>
        <div className="material-grid">
          {materialStatus.items.map((item) => (
            <button type="button" className={`material-card ${item.status}`} key={item.key} onClick={() => materialKeys.has(item.key) && onOpenMaterialUpload(item)}>
              <div>
                <strong>{item.label}</strong>
                <b>{item.statusLabel}</b>
              </div>
              <span>{item.tip}</span>
              <small>{item.files[0]?.name || item.jobs[0]?.status || "暂无文件记录"}</small>
              <em>{item.status === "missing" ? "上传" : item.status === "parsed" ? "查看 / 补充" : "继续处理"}</em>
            </button>
          ))}
        </div>
        {!!nonMaterialActions.length && <div className="action-list">
          {nonMaterialActions.map((item) => {
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
        </div>}
      </section>
  );
}
