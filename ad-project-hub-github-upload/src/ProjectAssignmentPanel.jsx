import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FileSpreadsheet, UploadCloud, UserCog } from "lucide-react";
import { downloadCsv } from "./utils/format.js";
import { assignmentLedgerRows } from "./utils/ledgerRows.js";
import { canBeAssignmentMember, canBeAssignmentPm, canBeAssignmentSales, roleLabel } from "./utils/permissions.js";
import "./assignment.css";

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

export default function ProjectAssignmentPanel({ api, members, assignments, onReload, onCreateProject, onOpenMembers, onSyncFeishuContacts, syncingFeishuContacts = false }) {
  const activeMembers = useMemo(() => members.filter((member) => member.status !== "disabled"), [members]);
  const [selectedProjectId, setSelectedProjectId] = useState(assignments[0]?.id || "");
  const selected = assignments.find((item) => item.id === selectedProjectId) || null;
  const activeMemberById = useMemo(() => new Map(activeMembers.map((member) => [member.id, member])), [activeMembers]);
  const memberByNameOrContact = useMemo(() => {
    const map = new Map();
    activeMembers.forEach((member) => {
      [member.name, member.email].filter(Boolean).forEach((key) => map.set(String(key).toLowerCase(), member.id));
    });
    return map;
  }, [activeMembers]);
  const [form, setForm] = useState({ pmId: "", salesId: "", memberIds: [], department: "" });
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [exportingAssignments, setExportingAssignments] = useState(false);
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const assignmentPreview = useMemo(() => {
    const pm = activeMemberById.get(form.pmId)?.name || "待分派";
    const sales = activeMemberById.get(form.salesId)?.name || "待确认";
    const memberNames = form.memberIds.map((id) => activeMemberById.get(id)?.name).filter(Boolean);
    return { pm, sales, memberNames };
  }, [activeMemberById, form.pmId, form.salesId, form.memberIds]);

  useEffect(() => {
    if (!assignments.length) return;
    if (selectedProjectId && !assignments.some((item) => item.id === selectedProjectId)) {
      setSelectedProjectId(assignments[0].id);
    }
  }, [assignments, selectedProjectId]);

  useEffect(() => {
    if (!selected) return;
    const pmId = memberByNameOrContact.get(String(selected.pm || "").toLowerCase()) || "";
    const salesId = memberByNameOrContact.get(String(selected.sales || "").toLowerCase()) || "";
    const memberIds = (selected.members || [])
      .map((item) => memberByNameOrContact.get(String(item || "").toLowerCase()))
      .filter(Boolean);
    setForm({
      pmId,
      salesId,
      memberIds: Array.from(new Set(memberIds)),
      department: selected.department || "",
    });
    setMessage("");
  }, [selected?.id, memberByNameOrContact]);

  async function loadSuggestions(projectId = selected?.id, { silent = false } = {}) {
    if (!projectId) return;
    setSuggesting(true);
    if (!silent) setMessage("正在刷新 AI 分派建议...");
    try {
      const data = await api(`/api/project-assignments/suggestions?projectId=${encodeURIComponent(projectId)}`);
      setSuggestions(data);
      if (!silent) setMessage("AI 分派建议已刷新，可以一键套用或手动调整。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSuggesting(false);
    }
  }

  useEffect(() => {
    if (!selected?.id) return;
    let alive = true;
    setSuggesting(true);
    api(`/api/project-assignments/suggestions?projectId=${encodeURIComponent(selected.id)}`)
      .then((data) => {
        if (alive) setSuggestions(data);
      })
      .catch((error) => {
        if (alive) setMessage(error.message);
      })
      .finally(() => {
        if (alive) setSuggesting(false);
      });
    return () => {
      alive = false;
    };
  }, [selected?.id]);

  function toggleMember(id) {
    setForm((current) => ({
      ...current,
      memberIds: current.memberIds.includes(id)
        ? current.memberIds.filter((item) => item !== id)
        : [...current.memberIds, id],
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("正在保存项目分派...");
    try {
      await api("/api/project-assignments", {
        method: "POST",
        body: JSON.stringify({
          projectId: selected.id,
          pmId: form.pmId,
          salesId: form.salesId,
          memberIds: form.memberIds,
          department: form.department,
        }),
      });
      setFocusedProjectId(selected.id);
      await onReload();
      setMessage(`项目分派已保存并刷新：PM ${assignmentPreview.pm}，销售 ${assignmentPreview.sales}，执行 ${assignmentPreview.memberNames.length} 人。员工端现在会按这里看到自己的项目。`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  function applySuggestion() {
    if (!suggestions?.recommended) return;
    const recommendedMemberIds = suggestions.recommended.memberIds || [];
    const pmName = activeMemberById.get(suggestions.recommended.pmId)?.name || "待分派";
    const salesName = activeMemberById.get(suggestions.recommended.salesId)?.name || "待确认";
    setForm((current) => ({
      ...current,
      pmId: suggestions.recommended.pmId || current.pmId,
      salesId: suggestions.recommended.salesId || current.salesId,
      memberIds: Array.from(new Set([...recommendedMemberIds])),
    }));
    setMessage(`已套用 AI 分派建议：PM ${pmName}，销售 ${salesName}，执行 ${recommendedMemberIds.length} 人。确认无误后保存。`);
  }

  async function exportAssignmentLedger() {
    if (!assignments.length) {
      setMessage("当前没有可导出的项目分派，请先上传合同创建项目。");
      return;
    }
    setExportingAssignments(true);
    try {
      downloadCsv(`项目分派表-${new Date().toISOString().slice(0, 10)}.csv`, assignmentLedgerRows(assignments));
      setMessage(`项目分派表 CSV 已导出：${assignments.length} 个项目。`);
    } catch (error) {
      setMessage(error.message || "项目分派表导出失败，请稍后再试。");
    } finally {
      setExportingAssignments(false);
    }
  }

  if (!assignments.length) {
    return (
      <section className="empty-project-state">
        <div>
          <PanelTitle icon={UserCog} title="项目分派" />
          <h2>还没有可分派的项目</h2>
          <p>先上传合同或报价表创建项目，再回来把 PM、销售和执行成员分配进去。</p>
          <div className="button-row compact assignment-empty-actions">
            <button type="button" className="primary" onClick={onCreateProject}><UploadCloud size={16} />上传合同创建项目</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="assignment-accordion-list">
      <div className="assignment-toolbar">
        <div><h2>项目分派</h2><span>{assignments.length} 个项目 · 点击项目展开设置 PM、销售和执行成员</span></div>
        <button type="button" className="ghost" disabled={exportingAssignments} onClick={exportAssignmentLedger}><FileSpreadsheet size={16} />{exportingAssignments ? "导出中" : "导出分派表"}</button>
      </div>
      {assignments.map((project) => {
        const open = project.id === selected?.id;
        return <section className={`assignment-accordion ${open ? "open" : ""} ${focusedProjectId === project.id ? "fresh" : ""}`} key={project.id}>
          <button type="button" className="assignment-accordion-trigger" aria-expanded={open} onClick={() => setSelectedProjectId(open ? "" : project.id)}>
            <span><strong>{project.name}</strong><em>{project.client || "未填写客户"} · PM {project.pm || "待分派"} · 执行 {(project.members || []).length} 人</em></span>
            <ChevronDown size={20} />
          </button>
          {open && <form className="member-form assignment-form assignment-accordion-body" onSubmit={save}>
            <div className="section-head"><h2>{selected?.name}</h2><span>{selected?.client || "未填写客户"}</span></div>
            <div className="assignment-suggestion">
              <div className="section-head"><h3>AI 分派建议</h3><div className="button-row compact"><button type="button" className="ghost tiny" onClick={() => loadSuggestions(selected?.id)} disabled={suggesting || !selected}>{suggesting ? "刷新中" : "刷新建议"}</button><button type="button" className="ghost tiny" onClick={applySuggestion} disabled={suggesting || !suggestions?.recommended}>{suggesting ? "分析中" : "一键套用推荐"}</button></div></div>
              {suggestions ? <div className="suggestion-grid"><SuggestionColumn title="推荐 PM" items={suggestions.pmCandidates} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} /><SuggestionColumn title="推荐销售" items={suggestions.salesCandidates} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} /><SuggestionColumn title="推荐执行" items={suggestions.memberCandidates?.slice(0, 3)} onRefresh={() => loadSuggestions(selected?.id)} onOpenMembers={onOpenMembers} /></div> : <div className="empty-state action-empty assignment-suggestion-empty"><strong>{suggesting ? "正在生成分派建议" : "暂无推荐数据"}</strong><span>{suggesting ? "系统正在根据项目部门、人员角色和负载匹配 PM、销售和执行成员。" : "可以刷新建议；如果候选为空，先同步飞书通讯录或去成员管理补角色、部门和飞书 ID。"}</span><div className="button-row compact"><button type="button" className="primary tiny" onClick={() => loadSuggestions(selected?.id)} disabled={suggesting || !selected}>{suggesting ? "刷新中" : "刷新建议"}</button>{onSyncFeishuContacts && <button type="button" className="ghost tiny" onClick={onSyncFeishuContacts} disabled={syncingFeishuContacts}>{syncingFeishuContacts ? "同步中" : "同步飞书通讯录"}</button>}{onOpenMembers && <button type="button" className="ghost tiny" onClick={onOpenMembers}>打开成员管理</button>}</div></div>}
            </div>
            <div className="assignment-role-grid">
              <label><span>项目部门</span><input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="例如 项目部 / 内容部" /></label>
              <label><span>PM</span><select value={form.pmId} onChange={(event) => setForm({ ...form, pmId: event.target.value })}><option value="">待分派</option>{activeMembers.filter(canBeAssignmentPm).map((member) => <option value={member.id} key={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></label>
              <label><span>销售</span><select value={form.salesId} onChange={(event) => setForm({ ...form, salesId: event.target.value })}><option value="">待确认</option>{activeMembers.filter(canBeAssignmentSales).map((member) => <option value={member.id} key={member.id}>{member.name} · {roleLabel(member.role)}</option>)}</select></label>
            </div>
            <div className="assignment-members"><span>执行成员（可多选）</span><div>{activeMembers.filter(canBeAssignmentMember).map((member) => { const checked = form.memberIds.includes(member.id); return <button type="button" className={`member-check ${checked ? "selected" : ""}`} aria-pressed={checked} key={member.id} onClick={() => toggleMember(member.id)}><i><Check size={14} /></i><strong>{member.name}</strong><small>{roleLabel(member.role)} · {member.department || "未分组"}</small></button>; })}</div></div>
            <div className="assignment-preview"><strong>本次将保存</strong><span>PM {assignmentPreview.pm} · 销售 {assignmentPreview.sales} · 执行 {assignmentPreview.memberNames.length ? assignmentPreview.memberNames.join("、") : "待选择"}</span></div>
            {message && <p className="form-message">{message}</p>}
            <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存项目分派"}</button>
          </form>}
        </section>;
      })}
    </section>
  );
}

function SuggestionColumn({ title, items = [], onRefresh, onOpenMembers }) {
  return (
    <div className="suggestion-column">
      <strong>{title}</strong>
      {items.length ? items.map((item) => (
        <div key={item.id}>
          <span>{item.name} · {roleLabel(item.role)}</span>
          <em>负载 {item.workload || 0} · 分数 {item.score || 0}</em>
          {item.reason && <small>{item.reason}</small>}
        </div>
      )) : <div className="suggestion-empty-candidate">
        <span>暂无候选</span>
        <small>先补成员角色、部门或飞书身份，再刷新建议。</small>
        <div className="button-row compact">
          {onRefresh && <button type="button" className="ghost tiny" onClick={onRefresh}>刷新</button>}
          {onOpenMembers && <button type="button" className="ghost tiny" onClick={onOpenMembers}>成员</button>}
        </div>
      </div>}
    </div>
  );
}
