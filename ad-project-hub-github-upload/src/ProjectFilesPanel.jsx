import React from "react";

export default function ProjectFilesPanel({
  filesRef,
  uniqueFiles = [],
  projectJobs = [],
  projectFeishuPendingFiles = [],
  projectFeishuHandledFiles = [],
  materialStatus,
  canEditProject,
  canHandleFeishuPending,
  reparsingProject,
  handlingFeishuFile,
  copyingFileKey,
  archivingFileKey,
  focusedParseJobId,
  progressingParseJobId,
  fileSize,
  uploadedFileKey,
  parseJobTone,
  onReparseCurrentProject,
  onHandleFeishuPendingFile,
  onOpenMaterialUpload,
  onParsedMaterialNotice,
  onCopyFileInfo,
  onArchiveProjectFile,
  onUploadType,
  onPrepareActivityTemplate,
  onRefreshParseJob,
}) {
  return (
    <section className="detail-section" ref={filesRef} id="project-files-section">
      <div className="section-head">
        <h2>文件与 AI 解析</h2>
        <div className="section-actions">
          <span className="muted">{uniqueFiles.length} 个文件 · {projectJobs.length} 个解析任务</span>
          {canEditProject && <button type="button" className="ghost" onClick={onReparseCurrentProject} disabled={reparsingProject || (!uniqueFiles.length && !projectJobs.some((job) => (job.files || []).length))}>
            {reparsingProject ? "解析中" : "重新 AI 解析"}
          </button>}
        </div>
      </div>
      {projectFeishuPendingFiles.length > 0 && <div className="project-feishu-pending">
        <div className="section-head compact">
          <h3>飞书待确认文件</h3>
          <span className="muted">{projectFeishuPendingFiles.filter((item) => item.status === "待确认").length} 个待处理</span>
        </div>
        {projectFeishuPendingFiles.slice(0, 5).map((item) => (
          <div className="project-feishu-card" key={item.id}>
            <div>
              <strong>{item.file?.name || item.preview?.fileName || "飞书文件"}</strong>
              <span>{item.status} · {item.uploadType || "file"} · {item.senderName || "飞书成员"}</span>
              <p>{item.preview?.summary || item.note || "确认后才会写入项目。"}</p>
            </div>
            {item.status === "待确认" && canHandleFeishuPending && <div className="button-row">
              <button type="button" className="primary" disabled={handlingFeishuFile === item.id} onClick={() => onHandleFeishuPendingFile(item, "confirm")}>
                {handlingFeishuFile === item.id ? "处理中" : "确认入库"}
              </button>
              <button type="button" className="ghost" disabled={handlingFeishuFile === item.id} onClick={() => onHandleFeishuPendingFile(item, "reject")}>{handlingFeishuFile === item.id ? "处理中" : "驳回"}</button>
            </div>}
          </div>
        ))}
      </div>}
      <div className="material-intake-strip">
        <div>
          <strong>材料入库检查</strong>
          <span>{materialStatus.doneCount}/4 项已解析，{materialStatus.missing.length ? `还需处理：${materialStatus.missing.map((item) => item.label).join("、")}` : "关键材料已较完整，可以继续核销、回款和结案复盘。"}</span>
        </div>
        <div className="material-intake-grid">
          {materialStatus.items.map((item) => (
            <button
              type="button"
              className={`material-intake-item ${item.status}`}
              key={item.key}
              onClick={() => item.status === "parsed" ? onParsedMaterialNotice(item) : onOpenMaterialUpload(item)}
            >
              <b>{item.statusLabel}</b>
              <strong>{item.label}</strong>
              <span>{item.status === "parsed" ? "已入库" : item.status === "parsing" ? "等解析" : item.status === "uploaded" ? "待确认" : item.status === "review" ? "需复核" : "去补传"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="detail-list">
        {uniqueFiles.length ? uniqueFiles.slice(0, 8).map((file, index) => (
          <div key={`${file.name}-${index}`}>
            <strong>{file.name}</strong>
            <span>{file.source || file.category || "文件"} · {fileSize(file.size)} · {file.storageStatus || (file.storageUrl ? "已持久化" : "仅记录")} · {file.uploadedByName || file.uploadedBy || "未知上传人"} · {file.uploadedAt ? new Date(file.uploadedAt).toLocaleString("zh-CN") : "时间待记录"}</span>
            {file.storageUrl && !String(file.storageUrl).startsWith("/uploads/")
              ? <a className="ghost tiny file-link" href={file.storageUrl} target="_blank" rel="noreferrer">打开文件</a>
              : file.storageProvider === "local" && <span className="muted">本地暂存不可公开访问，需配置对象存储</span>}
            <button type="button" className="ghost tiny" disabled={copyingFileKey === uploadedFileKey(file)} onClick={() => onCopyFileInfo(file)}>
              {copyingFileKey === uploadedFileKey(file) ? "复制中" : "复制信息"}
            </button>
            {canEditProject && <button type="button" className="ghost tiny" disabled={archivingFileKey === uploadedFileKey(file)} onClick={() => onArchiveProjectFile(file)}>
              {archivingFileKey === uploadedFileKey(file) ? "归档中" : "归档文件"}
            </button>}
          </div>
        )) : (
          <div className="action-empty project-file-empty">
            <strong>还没有项目文件</strong>
            <span>可以先补报价表、成本表或核销表，AI 会先预览识别，确认后才写入项目。</span>
            <div className="button-row compact">
              <button type="button" className="primary tiny" onClick={() => onUploadType("quote-sheet")}>上传报价表</button>
              <button type="button" className="ghost tiny" onClick={() => onUploadType("cost-sheet")}>上传成本表</button>
              <button type="button" className="ghost tiny" onClick={() => onUploadType("verification-sheet")}>上传核销表</button>
              <button type="button" className="ghost tiny" onClick={() => onPrepareActivityTemplate("已补充项目材料，待 AI 识别后确认入库。")}>记录材料进展</button>
            </div>
          </div>
        )}
        {projectJobs.slice(0, 4).map((job) => (
          <div className={`parse-job-card ${parseJobTone(job)} ${focusedParseJobId === job.id ? "fresh" : ""}`} key={job.id}>
            <strong>解析任务：{job.status}</strong>
            <span>{job.progress || 0}% · {(job.files || []).map((file) => file.name).join("、") || "文件待识别"}</span>
            {job.error && <p>{job.error}</p>}
            {Array.isArray(job.steps) && job.steps.length > 0 && (
              <ol>
                {job.steps.map((step) => <li className={String(step.status || "")} key={step.name}>{step.name} · {step.status}</li>)}
              </ol>
            )}
            <button type="button" className="ghost tiny" disabled={progressingParseJobId === (job.id || job.projectId)} onClick={() => onRefreshParseJob(job)}>
              {progressingParseJobId === (job.id || job.projectId) ? "刷新中" : /失败/.test(String(job.status || "")) ? "重试解析" : "刷新进度"}
            </button>
          </div>
        ))}
      </div>
      {projectFeishuHandledFiles.length > 0 && <div className="project-feishu-history">
        <div className="section-head compact">
          <h3>飞书文件处理历史</h3>
          <span className="muted">{projectFeishuHandledFiles.length} 条</span>
        </div>
        {projectFeishuHandledFiles.slice(0, 5).map((item) => (
          <div className={`project-feishu-history-row ${item.status === "已驳回" ? "rejected" : "confirmed"}`} key={item.id}>
            <strong>{item.file?.name || item.preview?.fileName || "飞书文件"}</strong>
            <span>{item.status} · {item.uploadType || "file"} · {item.note || "暂无备注"}</span>
            <em>{item.handledAt ? new Date(item.handledAt).toLocaleString("zh-CN") : "时间待记录"}</em>
          </div>
        ))}
      </div>}
    </section>
  );
}
