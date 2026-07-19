import React, { useMemo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

function relatedCount(items = [], project = {}, fields = []) {
  return items.filter((item) => item.projectId === project.id || fields.some((field) => item[field] === project.name)).length;
}

export default function ProjectCleanupPanel({ projects = [], state = {}, recycleBin = [], deleting, onDelete, onRestore }) {
  const [projectId, setProjectId] = useState("");
  const selected = projects.find((project) => project.id === projectId) || null;
  const impact = useMemo(() => selected ? [
    ["解析与文件", relatedCount(state.parseJobs, selected, ["projectName", "project"]), relatedCount(state.files, selected, ["projectName", "project"])],
    ["审批与回款", relatedCount(state.approvals, selected, ["projectName", "project"]), relatedCount(state.payments, selected, ["projectName", "project"])],
    ["供应商与催收", relatedCount(state.suppliers, selected, ["projectName", "project"]), relatedCount(state.collectionScripts, selected, ["projectName", "project"])],
    ["动态与待办", relatedCount(state.comments, selected, ["projectName", "project"]), relatedCount(state.systemNotifications, selected, ["projectName", "project"])]
  ] : [], [selected, state]);
  const canDelete = Boolean(selected && !deleting);

  async function submit(event) {
    event.preventDefault();
    if (!canDelete) return;
    if (!window.confirm(`确认将「${selected.name}」及全部关联业务记录移入回收站？30 天内可以恢复。`)) return;
    await onDelete(selected);
    setProjectId("");
  }

  return (
    <section className="project-cleanup-panel">
      <div className="section-head">
        <div>
          <h2>误建项目清理</h2>
          <span>删除后进入云端回收站保留 30 天，期间可恢复；到期才永久清理云端文件。</span>
        </div>
        <Trash2 size={17} />
      </div>
      <form onSubmit={submit}>
        <label>
          <span>选择要删除的项目</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">请选择项目</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name} · {project.client || "未填写客户"}</option>)}
          </select>
        </label>
        {selected && <div className="project-cleanup-impact">
          <strong>将一并清理「{selected.name}」的关联记录</strong>
          {impact.map(([label, first, second]) => <span key={label}>{label}：{first + second} 条</span>)}
          <em>项目和关联记录会先从 OA 中移除，云端原文件保留 30 天，到期由系统自动清理。</em>
        </div>}
        <button type="submit" className="danger" disabled={!canDelete}><Trash2 size={15} />{deleting ? "删除中" : "移入回收站"}</button>
      </form>
      {recycleBin.length > 0 && <div className="project-cleanup-impact">
        <strong>云端回收站</strong>
        {recycleBin.map((item) => <span key={item.id}>
          {item.projectName} · {item.fileCount} 个云端文件 · {new Date(item.expiresAt).toLocaleDateString("zh-CN")} 到期
          <button type="button" onClick={() => onRestore(item)} disabled={deleting}><RotateCcw size={14} />恢复</button>
        </span>)}
      </div>}
    </section>
  );
}
