import React, { useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileText, MessageSquareText } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { downloadCsv, money } from "./utils/format.js";
import { clientHandoffRows } from "./utils/ledgerRows.js";
import "./supplier-client.css";

function PanelTitle({ icon: Icon, title }) {
  return <h2>{Icon && <Icon size={18} />}{title}</h2>;
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

export default function ClientLibrary({ clients = [], projects = [], session, focusClientName = "", onFocusConsumed, onUpload, onOpenProjects, onDone, onNotice }) {
  const [selectedName, setSelectedName] = useState(clients[0]?.client || "");
  const [form, setForm] = useState({ likes: "", dislikes: "", pitfalls: "", handoffNote: "", contactStyle: "" });
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [exportingHandoff, setExportingHandoff] = useState(false);
  const [focusedClient, setFocusedClient] = useState("");
  useEffect(() => {
    if (!selectedName && clients[0]?.client) setSelectedName(clients[0].client);
  }, [clients, selectedName]);
  useEffect(() => {
    if (!focusClientName) return;
    setSelectedName(focusClientName);
    setFocusedClient(focusClientName);
    onFocusConsumed?.();
  }, [focusClientName, onFocusConsumed]);
  const selected = clients.find((item) => item.client === selectedName) || clients[0] || null;
  useEffect(() => {
    if (!selected) return;
    setForm({
      likes: (selected.likes || []).join("\n"),
      dislikes: (selected.dislikes || []).join("\n"),
      pitfalls: (selected.pitfalls || []).join("\n"),
      handoffNote: selected.handoffNote || "",
      contactStyle: selected.contactStyle || ""
    });
  }, [selected?.client]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function primeClientHandoffTemplate() {
    if (!selected?.client) return;
    setForm((current) => ({
      likes: current.likes || "真实场景\n明确执行路径\n有数据或案例支撑",
      dislikes: current.dislikes || "空概念\n临时大改方向\n只讲创意不讲落地",
      pitfalls: current.pitfalls || "不要临时改报价\n不要跳过客户确认节点\n不要只给抽象口号",
      contactStyle: current.contactStyle || "先给依据，再给建议，表达直接但不生硬",
      handoffNote: current.handoffNote || `${selected.client} 新 PM 交接：先看历史方案、报价/核销节点、客户反馈和雷区，沟通前准备可确认的执行路径。`
    }));
    setFocusedClient(selected.client);
    onNotice(`已为「${selected.client}」预填客户交接模板，请按真实情况调整后保存。`);
  }

  async function copyHandoff() {
    if (!selected) return;
    setCopying(true);
    const handoff = selected.handoffPackage || {};
    const lines = [
      `客户：${selected.client}`,
      `项目数：${selected.projectCount || 0} 个`,
      `最近项目：${selected.latestProject || "待补充"}${selected.latestStatus ? `（${selected.latestStatus}）` : ""}`,
      `自动交接摘要：${handoff.summary || selected.handoffSummary || "待补充"}`,
      `接手先做：${handoff.firstActions?.join("；") || "先确认项目状态、回款节点和客户雷区"}`,
      `重点回款：${handoff.receivableProjects?.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") || "暂无待回款"}`,
      `客户喜欢：${selected.likes?.join("；") || "待沉淀"}`,
      `客户不喜欢：${selected.dislikes?.join("；") || "待沉淀"}`,
      `雷区：${selected.pitfalls?.join("；") || "待沉淀"}`,
      `沟通风格：${selected.contactStyle || "待沉淀"}`,
      `交接备注：${selected.handoffNote || selected.handoffSummary || "待补充"}`
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setFocusedClient(selected.client);
      onNotice(`客户交接清单已复制：${selected.client}。`);
    } catch {
      onNotice("复制失败，请手动选中交接摘要复制");
    } finally {
      setCopying(false);
    }
  }

  async function exportHandoff() {
    if (!selected) {
      onNotice("暂无可导出的客户交接包。");
      return;
    }
    setExportingHandoff(true);
    try {
      downloadCsv(`${selected.client || "客户"}-PM交接包.csv`, clientHandoffRows(selected));
      setFocusedClient(selected.client);
      onNotice(`客户交接包 CSV 已导出：${selected.client}。`);
    } finally {
      setExportingHandoff(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected?.client) {
      onNotice("暂无可维护的客户");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/clients/profile", session, {
        method: "POST",
        body: JSON.stringify({ client: selected.client, ...form })
      });
      setFocusedClient(selected.client);
      await onDone();
      onNotice(`客户偏好和交接备注已保存，交接摘要已刷新：${selected.client}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!clients.length) {
    return (
      <section className="feature-panel">
        <PanelTitle icon={MessageSquareText} title="客户偏好" />
        <div className="empty-state action-empty">
          <strong>暂无客户项目</strong>
          <span>上传合同创建项目后，客户偏好、雷区、交接摘要会从项目资料和后续评论里持续沉淀。</span>
          <div className="button-row compact">
            <button type="button" className="primary tiny" onClick={() => onUpload?.("create-project", null)}>上传合同创建项目</button>
            <button type="button" className="ghost tiny" onClick={onOpenProjects}>{projects.length ? "打开我的项目" : "查看项目入口"}</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="client-library">
      <div className="feature-panel wide-feature">
        <PanelTitle icon={MessageSquareText} title="客户偏好 / 交接雷区" />
        <div className="supplier-card-grid">
          {clients.map((item) => (
            <button
              type="button"
              className={`supplier-card ${item.client === selected?.client ? "active" : ""} ${focusedClient === item.client ? "fresh" : ""}`}
              key={item.client}
              onClick={() => setSelectedName(item.client)}
            >
              <strong>{item.client}</strong>
              <em>{item.projectCount || 0} 个项目 · 待回款 {money(item.receivable)}</em>
              <b className={`client-handoff-badge ${item.handoffPackage?.activeProjectCount ? "active" : item.receivable ? "warn" : ""}`}>
                {item.handoffPackage?.activeProjectCount ? `${item.handoffPackage.activeProjectCount} 个在执行` : item.receivable ? "先看回款" : "可交接"}
              </b>
              <small>{item.handoffSummary}</small>
            </button>
          ))}
        </div>
      </div>

      {selected && <div className="feature-panel wide-feature supplier-detail-panel">
        <div className="section-head">
          <PanelTitle icon={FileText} title="交接摘要" />
          <div className="section-head-actions">
            <button type="button" className="ghost" disabled={copying} onClick={copyHandoff}>{copying ? "复制中" : "复制交接清单"}</button>
            <button type="button" className="ghost" disabled={exportingHandoff} onClick={exportHandoff}><FileSpreadsheet size={14} />{exportingHandoff ? "导出中" : "导出交接包"}</button>
          </div>
        </div>
        <div className="review-summary">
          <Mini label="项目数" value={`${selected.projectCount || 0} 个`} />
          <Mini label="合同总额" value={money(selected.totalContract)} />
          <Mini label="待回款" value={money(selected.receivable)} />
          <Mini label="动态记录" value={`${selected.commentCount || 0} 条`} />
          <Mini label="在执行项目" value={`${selected.handoffPackage?.activeProjectCount || 0} 个`} />
        </div>
        <div className="client-handoff-pack">
          <div>
            <strong>{selected.handoffPackage?.title || `${selected.client} PM 自动交接包`}</strong>
            <span>{selected.handoffPackage?.summary || selected.handoffSummary}</span>
          </div>
          <div className="client-handoff-actions">
            {(selected.handoffPackage?.firstActions?.length ? selected.handoffPackage.firstActions : ["先补充客户偏好、雷区、最近项目状态和回款节点。"]).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
        <div className="compact-list">
          <div><strong>客户喜欢</strong><span>{selected.likes?.join("；") || "待沉淀"}</span></div>
          <div><strong>客户不喜欢</strong><span>{selected.dislikes?.join("；") || "待沉淀"}</span></div>
          <div><strong>雷区</strong><span>{selected.pitfalls?.join("；") || "待沉淀"}</span></div>
          <div><strong>重点回款</strong><span>{selected.handoffPackage?.receivableProjects?.length ? selected.handoffPackage.receivableProjects.map((item) => `${item.name} ${money(item.amount)}${item.paymentDue ? `（${item.paymentDue}）` : ""}`).join("；") : "暂无待回款"}</span></div>
          <div><strong>最近反馈</strong><span>{selected.handoffPackage?.latestFeedback?.join("；") || "暂无可交接反馈"}</span></div>
          <div><strong>交接摘要</strong><span>{selected.handoffSummary}</span></div>
        </div>
      </div>}

      {selected && <form className="feature-panel settings-form" onSubmit={submit}>
        <div className="section-head">
          <PanelTitle icon={CheckCircle2} title="维护客户档案" />
          <button type="button" className="ghost tiny" onClick={primeClientHandoffTemplate}>预填交接模板</button>
        </div>
        <label><span>客户喜欢</span><textarea value={form.likes} onChange={(event) => update("likes", event.target.value)} placeholder="一行一条，例如：喜欢真实场景、喜欢明确执行路径" /></label>
        <label><span>客户不喜欢</span><textarea value={form.dislikes} onChange={(event) => update("dislikes", event.target.value)} placeholder="一行一条" /></label>
        <label><span>雷区</span><textarea value={form.pitfalls} onChange={(event) => update("pitfalls", event.target.value)} placeholder="一行一条，例如：不要空概念、不要临时改报价" /></label>
        <label><span>沟通风格</span><input value={form.contactStyle} onChange={(event) => update("contactStyle", event.target.value)} placeholder="例如 直接、重细节、需要先给依据" /></label>
        <label><span>交接备注</span><textarea value={form.handoffNote} onChange={(event) => update("handoffNote", event.target.value)} placeholder="给新 PM 的简短交接说明" /></label>
        <button type="submit" className="primary" disabled={saving}>{saving ? "保存中" : "保存客户档案"}</button>
      </form>}
    </section>
  );
}
