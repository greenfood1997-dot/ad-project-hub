import React, { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

function relatedCount(items = [], project = {}, fields = []) {
  return items.filter((item) => item.projectId === project.id || fields.some((field) => item[field] === project.name)).length;
}

export default function ProjectCleanupPanel({ projects = [], state = {}, deleting, onDelete }) {
  const [projectId, setProjectId] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const selected = projects.find((project) => project.id === projectId) || null;
  const impact = useMemo(() => selected ? [
    ["解析与文件", relatedCount(state.parseJobs, selected, ["projectName", "project"]), relatedCount(state.files, selected, ["projectName", "project"])],
    ["审批与回款", relatedCount(state.approvals, selected, ["projectName", "project"]), relatedCount(state.payments, selected, ["projectName", "project"])],
    ["供应商与催收", relatedCount(state.suppliers, selected, ["projectName", "project"]), relatedCount(state.collectionScripts, selected, ["projectName", "project"])],
    ["动态与待办", relatedCount(state.comments, selected, ["projectName", "project"]), relatedCount(state.systemNotifications, selected, ["projectName", "project"])]
  ] : [], [selected, state]);
  const canDelete = Boolean(selected && confirmName.trim() === selected.name && !deleting);

  async function submit(event) {
    event.preventDefault();
    if (!canDelete) return;
    await onDelete(selected);
    setProjectId("");
    setConfirmName("");
  }

  return (
    <section className="project-cleanup-panel">
      <div className="section-head">
        <div>
          <h2>误建项目清理</h2>
          <span>仅用于上传错合同、重复建项等误操作。删除后不可恢复，请先导出 OA 备份。</span>
        </div>
        <Trash2 size={17} />
      </div>
      <form onSubmit={submit}>
        <label>
          <span>选择要删除的项目</span>
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setConfirmName(""); }}>
            <option value="">请选择项目</option>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name} · {project.client || "未填写客户"}</option>)}
          </select>
        </label>
        {selected && <div className="project-cleanup-impact">
          <strong>将一并清理「{selected.name}」的关联记录</strong>
          {impact.map(([label, first, second]) => <span key={label}>{label}：{first + second} 条</span>)}
          <em>项目删除会保留一条审计记录，但业务文件、审批、回款、供应商、催收、动态和待办会从 OA 中移除。</em>
        </div>}
        <label>
          <span>请输入完整项目名确认删除</span>
          <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={selected ? selected.name : "先选择项目"} disabled={!selected} />
        </label>
        <button type="submit" className="danger" disabled={!canDelete}><Trash2 size={15} />{deleting ? "删除中" : "永久删除此项目"}</button>
      </form>
    </section>
  );
}
