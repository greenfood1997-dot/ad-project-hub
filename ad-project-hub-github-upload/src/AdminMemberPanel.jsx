import React from "react";

export default function AdminMemberPanel({
  members = [],
  activeMembers = [],
  feishuBoundCount,
  feishuMissingMembers = [],
  editingId,
  form,
  message,
  savingMember,
  togglingMemberId,
  deletingMemberId,
  insecureDefaultAccountCount = 0,
  cleaningDefaultAccounts = false,
  roleOptions = [],
  roleLabel,
  onSave,
  onEdit,
  onToggle,
  onDelete,
  onCleanDefaultAccounts,
  onUpdateForm,
  editorRef,
}) {
  return (
    <section className="admin-grid">
      <form className="member-form" onSubmit={onSave} ref={editorRef}>
        <div className="section-head"><h2>{editingId ? "编辑成员" : "新增成员"}</h2></div>
        <label><span>姓名</span><input name="member-name" value={form.name} onChange={(event) => onUpdateForm({ ...form, name: event.target.value })} /></label>
        <label><span>邮箱</span><input value={form.email} onChange={(event) => onUpdateForm({ ...form, email: event.target.value })} /></label>
        <label>
          <span>角色</span>
          <select value={form.role} onChange={(event) => onUpdateForm({ ...form, role: event.target.value })}>
            {roleOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label><span>部门</span><input value={form.department} onChange={(event) => onUpdateForm({ ...form, department: event.target.value })} /></label>
        <label><span>飞书 Open ID</span><input value={form.feishuOpenId} onChange={(event) => onUpdateForm({ ...form, feishuOpenId: event.target.value })} placeholder="用于机器人私聊通知" /></label>
        <label><span>飞书 User ID（可选）</span><input value={form.feishuUserId} onChange={(event) => onUpdateForm({ ...form, feishuUserId: event.target.value })} /></label>
        <label><span>飞书姓名（可选）</span><input value={form.feishuName} onChange={(event) => onUpdateForm({ ...form, feishuName: event.target.value })} /></label>
        <label><span>临时 PIN</span><input value={form.pin} type="password" inputMode="numeric" placeholder={editingId ? "留空则保持不变" : "填写 6-12 位数字，不能使用 123456"} onChange={(event) => onUpdateForm({ ...form, pin: event.target.value })} /></label>
        {message && <p className="form-message">{message}</p>}
        <button type="submit" className="primary" disabled={savingMember}>{savingMember ? "保存中" : "保存成员"}</button>
      </form>

      <div className="member-table">
        <div className="section-head"><h2>成员列表</h2><span>{members.length} 人</span></div>
        {insecureDefaultAccountCount > 0 && <div className="member-sync-status warn account-risk-card">
          <strong>账号安全风险：{insecureDefaultAccountCount} 个启用账号仍使用默认 PIN</strong>
          <span>请先在员工端修改你自己的 PIN，再停用其余内置默认账号。真实员工账号可随后逐个设置临时 PIN 并启用。</span>
          <button type="button" className="ghost" disabled={cleaningDefaultAccounts} onClick={onCleanDefaultAccounts}>{cleaningDefaultAccounts ? "处理中" : "停用其余默认账号"}</button>
        </div>}
        <div className={`member-sync-status ${feishuMissingMembers.length ? "warn" : "ok"}`}>
          <strong>飞书私聊绑定：{feishuBoundCount}/{activeMembers.length || 0}</strong>
          <span>{feishuMissingMembers.length ? `还差 ${feishuMissingMembers.slice(0, 5).map((member) => member.name || member.email).join("、")}${feishuMissingMembers.length > 5 ? `等 ${feishuMissingMembers.length} 人` : ""}，这些成员暂时收不到 OA 私聊提醒。` : "启用中的成员都已绑定飞书，可以接收 OA 私聊提醒。"}</span>
        </div>
        {members.map((member) => (
          <div className={`member-row ${editingId === member.id ? "editing" : ""}`} key={member.id}>
            <div>
              <strong>{member.name}</strong>
              <span>{member.email} · {member.department || "未分组"}{member.feishuOpenId || member.feishuUserId ? " · 已绑飞书" : " · 未绑飞书"}</span>
            </div>
            <b className={`role-pill ${member.role}`}>{roleLabel(member.role)}</b>
            <b className={`status-pill ${member.status}`}>{member.status === "disabled" ? "已停用" : "启用中"}</b>
            <button type="button" className="ghost" aria-pressed={editingId === member.id} disabled={savingMember || togglingMemberId === member.id || deletingMemberId === member.id} onClick={() => onEdit(member)}>{editingId === member.id ? "编辑中" : "编辑"}</button>
            <button type="button" className="ghost" disabled={togglingMemberId === member.id || deletingMemberId === member.id} onClick={() => onToggle(member)}>{togglingMemberId === member.id ? "处理中" : member.status === "disabled" ? "启用" : "停用"}</button>
            <button type="button" className="danger-button member-delete-button" disabled={deletingMemberId === member.id || togglingMemberId === member.id} onClick={() => onDelete(member)}>{deletingMemberId === member.id ? "删除中" : "删除"}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
