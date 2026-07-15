import React from "react";

function BackupDiffPreview({ diff }) {
  const items = (diff?.changed?.length ? diff.changed : diff?.items || []).filter((item) => item && item.key).slice(0, 8);
  if (!diff || !items.length) return <span className="backup-diff-empty">恢复预演：备份数量与当前 OA 基本一致。</span>;
  return (
    <div className="backup-diff-preview">
      <strong>恢复预演影响：{diff.summary || `${diff.changedCount || items.length} 类数据会变化`}</strong>
      <div>
        {items.map((item) => (
          <span className={item.direction || (item.delta > 0 ? "increase" : item.delta < 0 ? "decrease" : "same")} key={item.key}>
            {item.label || item.key}：当前 {item.current ?? 0} → 备份 {item.backup ?? 0}{Number(item.delta || 0) !== 0 ? `（${item.delta > 0 ? "+" : ""}${item.delta}）` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BackupRestorePanel({
  backupText,
  backupCheck,
  backupRestoreConfirm,
  exportingBackup,
  validatingBackup,
  restoringBackup,
  onExport,
  onValidate,
  onRestore,
  onBackupTextChange,
  onRestoreConfirmChange,
  onClear
}) {
  return (
    <>
      <div className="button-row compact">
        <button type="button" className="ghost" onClick={onExport} disabled={exportingBackup}>{exportingBackup ? "导出中" : "导出 OA 备份 JSON"}</button>
      </div>
      <div className="settings-block backup-validate-block">
        <h3>备份校验 / 安全恢复</h3>
        <p className="settings-next-step">先校验备份 JSON。恢复会覆盖当前业务数据，但会保留当前账号和环境密钥；原始合同/发票不写入备份，需由对象存储长期保存。备份中新成员会先停用，管理员设置临时 PIN 后才能启用。</p>
        <textarea rows={5} value={backupText} onChange={(event) => onBackupTextChange(event.target.value)} placeholder="粘贴 ad-project-hub-backup-YYYY-MM-DD.json 的内容" />
        <div className="button-row compact">
          <button type="button" className="ghost" onClick={onValidate} disabled={validatingBackup}>{validatingBackup ? "校验中" : "校验备份 JSON"}</button>
          <button type="button" className="ghost tiny" onClick={onClear} disabled={validatingBackup || restoringBackup || (!backupText && !backupCheck)}>清空</button>
        </div>
        {backupCheck && (
          <div className={`backup-check-result ${backupCheck.ok ? "ok" : "warn"}`}>
            <strong>{backupCheck.restored ? "备份已恢复" : backupCheck.ok ? "备份格式可用" : "备份暂不可用"}</strong>
            <span>格式：{backupCheck.format || "未识别"}{backupCheck.exportedAt ? ` · 导出时间 ${new Date(backupCheck.exportedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</span>
            <span>项目 {backupCheck.counts?.projects ?? 0} 个 / 审批 {backupCheck.counts?.approvals ?? 0} 条 / 文件 {backupCheck.counts?.files ?? 0} 个</span>
            <span>当前 OA：项目 {backupCheck.currentCounts?.projects ?? 0} 个 / 审批 {backupCheck.currentCounts?.approvals ?? 0} 条 / 文件 {backupCheck.currentCounts?.files ?? 0} 个</span>
            <BackupDiffPreview diff={backupCheck.diff} />
            {(backupCheck.warnings || []).map((warning) => <em key={warning}>{warning}</em>)}
            {backupCheck.error && <em>{backupCheck.error}</em>}
          </div>
        )}
        <div className="backup-restore-box">
          <label>
            <span>恢复确认语</span>
            <input value={backupRestoreConfirm} onChange={(event) => onRestoreConfirmChange(event.target.value)} placeholder="输入：确认恢复OA备份" />
          </label>
          <button type="button" className="danger-button" onClick={onRestore} disabled={restoringBackup || validatingBackup || backupRestoreConfirm.trim() !== "确认恢复OA备份"}>
            {restoringBackup ? "恢复中" : "执行恢复备份"}
          </button>
        </div>
      </div>
    </>
  );
}
