import React from "react";
import { FileSpreadsheet } from "lucide-react";

export default function ProjectActivityPanel({
  activityRef,
  activityItems,
  activityTemplates,
  commentText,
  commenting,
  exportingActivityLedger,
  copyingActivityKey,
  archivingActivityKey,
  session,
  canArchiveComment,
  onCommentTextChange,
  onSubmitComment,
  onExportActivityLedger,
  onGoProjectSection,
  onCopyActivityItem,
  onArchiveActivityItem,
  onPrepareActivityTemplate
}) {
  return (
    <section className="detail-section" ref={activityRef} id="project-activity-section">
      <div className="section-head">
        <h2>项目动态</h2>
        <div className="section-head-actions">
          <span className="muted">{activityItems.length} 条</span>
          <button type="button" className="ghost tiny" disabled={exportingActivityLedger || !activityItems.length} onClick={onExportActivityLedger}>
            <FileSpreadsheet size={14} />{exportingActivityLedger ? "导出中" : "导出动态"}
          </button>
        </div>
      </div>
      <form className="comment-form" onSubmit={onSubmitComment}>
        <input
          value={commentText}
          onChange={(event) => onCommentTextChange(event.target.value)}
          placeholder="记录一句项目进展、客户反馈、材料补充或风险提醒"
        />
        <button type="submit" className="primary" disabled={commenting}>{commenting ? "记录中" : "记录"}</button>
      </form>
      <div className="activity-list">
        {activityItems.length ? activityItems.map((item, index) => (
          <div key={`${item.title}-${index}`}>
            <i />
            <div>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
              <em>{item.at ? new Date(item.at).toLocaleString("zh-CN") : "时间待记录"}</em>
              <div className="button-row compact">
                {item.target && item.target !== "activity" && <button type="button" className="ghost tiny" onClick={() => onGoProjectSection(item.target, `已打开「${item.title}」相关区域。`)}>打开相关</button>}
                <button type="button" className="ghost tiny" disabled={copyingActivityKey === `${item.title}-${index}`} onClick={() => onCopyActivityItem(item, index)}>
                  {copyingActivityKey === `${item.title}-${index}` ? "复制中" : "复制动态"}
                </button>
                {item.kind === "comment" && canArchiveComment(session, item) && <button type="button" className="ghost tiny" disabled={archivingActivityKey === `${item.id || item.title}-${item.at || index}`} onClick={() => onArchiveActivityItem(item, index)}>
                  {archivingActivityKey === `${item.id || item.title}-${item.at || index}` ? "归档中" : "归档动态"}
                </button>}
              </div>
            </div>
          </div>
        )) : (
          <div className="action-empty activity-action-empty">
            <strong>暂无项目动态</strong>
            <span>可以先记录一次客户反馈、材料补充或进度风险，后续上传、解析、审批也会自动出现在这里。</span>
            <div className="button-row compact">
              {activityTemplates.map((text) => (
                <button type="button" className="ghost tiny" onClick={() => onPrepareActivityTemplate(text)} key={text}>
                  {text.slice(0, 12)}
                </button>
              ))}
              <button type="button" className="ghost tiny" onClick={() => onGoProjectSection("files", "已打开文件区，可以上传合同、报价、成本或核销材料。")}>上传项目文件</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
