import React, { useEffect, useState } from "react";
import { Bot, CheckCircle2, Clock3, FileSpreadsheet, MessageSquareText, MessagesSquare } from "lucide-react";
import { apiRequest } from "./utils/api.js";
import { collectionFollowUpQueue } from "./utils/collectionMetrics.js";
import { daysFromNow, downloadCsv, money } from "./utils/format.js";
import { collectionLedgerRows } from "./utils/ledgerRows.js";
import { canUseCollectionRole } from "./utils/permissions.js";
import "./collection.css";

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function Mini({ label, value }) {
  return <div className="mini"><span>{label}</span><strong>{value}</strong></div>;
}

export default function CollectionAssistant({ projects = [], scripts = [], session, onOpenProjectPayments, onUploadVerification, onDone, onNotice }) {
  const canUseCollection = canUseCollectionRole(session);
  const receivableProjects = projects.filter((project) => Number(project.receivable || 0) > 0)
    .sort((a, b) => Number(b.receivable || 0) - Number(a.receivable || 0));
  const [selectedId, setSelectedId] = useState(receivableProjects[0]?.id || projects[0]?.id || "");
  const [style, setStyle] = useState("");
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingOutcomeId, setSavingOutcomeId] = useState("");
  const [followUpForms, setFollowUpForms] = useState({});
  const [copyingScriptId, setCopyingScriptId] = useState("");
  const [exportingCollection, setExportingCollection] = useState(false);
  const [focusedScriptId, setFocusedScriptId] = useState("");
  const selected = projects.find((project) => project.id === selectedId) || receivableProjects[0] || projects[0];
  const relatedScripts = scripts.filter((item) => !selected || item.projectId === selected.id || item.projectName === selected.name);
  const ownScripts = scripts.filter((item) => item.salesName === session.name);
  const ownDone = ownScripts.filter((item) => item.outcome || typeof item.success === "boolean");
  const ownSuccess = ownDone.filter((item) => item.success).length;
  const bestScript = [...scripts].filter((item) => item.success).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  const canGenerateSelected = canUseCollection && selected && Number(selected.receivable || 0) > 0;
  const followUpQueue = collectionFollowUpQueue(projects, scripts);

  useEffect(() => {
    if (!selectedId && receivableProjects[0]?.id) setSelectedId(receivableProjects[0].id);
  }, [selectedId, receivableProjects[0]?.id]);

  async function generateScript() {
    if (!canUseCollection) {
      onNotice("催收话术由销售、PM、财务或管理层处理。");
      return;
    }
    if (!selected) {
      onNotice("当前没有可催收的项目");
      return;
    }
    if (!Number(selected.receivable || 0)) {
      onNotice("这个项目当前没有待回款。");
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest("/api/collections/suggest", session, {
        method: "POST",
        body: JSON.stringify({ projectId: selected.id, style })
      });
      setDraft(data);
      setFocusedScriptId(data.id || "");
      await onDone();
      onNotice(`话术已生成并保存，催收记录已刷新：${data.projectName} · ${money(data.amount)}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  function followUpForm(record = {}) {
    return followUpForms[record.id] || {
      nextFollowUpAt: record.nextFollowUpAt || daysFromNow(2),
      nextAction: record.nextAction || "换一种更自然的说法二次提醒，并主动补齐客户财务需要的材料"
    };
  }

  function updateFollowUp(record, key, value) {
    setFollowUpForms((current) => ({
      ...current,
      [record.id]: {
        ...followUpForm(record),
        [key]: value
      }
    }));
  }

  async function saveOutcome(record, success) {
    if (!canUseCollection) {
      onNotice("催收结果由销售、PM、财务或管理层记录。");
      return;
    }
    const followUp = followUpForm(record);
    setSavingOutcomeId(record.id);
    try {
      await apiRequest("/api/collections/outcome", session, {
        method: "POST",
        body: JSON.stringify({
          id: record.id,
          success,
          score: success ? 5 : 2,
          outcome: success ? "客户已回复/确认付款流程" : "客户暂未回复或未推进付款",
          nextFollowUpAt: success ? "" : followUp.nextFollowUpAt,
          nextAction: success ? "" : followUp.nextAction
        })
      });
      setFocusedScriptId(record.id);
      await onDone();
      onNotice(success
        ? `已记录为有效话术，催收记录和团队学习样本已刷新：${record.projectName || "当前项目"}。`
        : `已记录为待优化话术，并创建下次跟进待办：${record.projectName || "当前项目"} · ${followUp.nextFollowUpAt || "时间待定"}。`);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSavingOutcomeId("");
    }
  }

  async function copyScript(record) {
    const copyKey = record.id || "draft";
    setCopyingScriptId(copyKey);
    try {
      await navigator.clipboard.writeText(record.script || "");
      setFocusedScriptId(record.id || "");
      onNotice(`催收话术已复制：${record.projectName || selected?.name || "当前项目"}。`);
    } catch {
      onNotice("复制失败，请手动选中话术复制。");
    } finally {
      setCopyingScriptId("");
    }
  }

  async function exportCollectionLedger() {
    if (!scripts.length) {
      onNotice("当前还没有可导出的催收记录，请先生成话术或记录跟进结果。");
      return;
    }
    setExportingCollection(true);
    try {
      downloadCsv("催收话术记录.csv", collectionLedgerRows(scripts, projects));
      onNotice(`催收话术记录 CSV 已导出：${scripts.length} 条。`);
    } finally {
      setExportingCollection(false);
    }
  }

  return (
    <section className="collection-workbench">
      <div className="feature-panel collection-hero">
        <PanelTitle icon={MessagesSquare} title="销售催收助手" />
        <p>从真实待回款项目里生成更像人说话的跟进消息，并把客户回复结果沉淀下来，后面会慢慢学出每个销售自己的有效风格。</p>
        <div className="review-summary">
          <Mini label="待跟进项目" value={receivableProjects.length} />
          <Mini label="我的成功率" value={ownDone.length ? `${Math.round((ownSuccess / ownDone.length) * 100)}%` : "待沉淀"} />
          <Mini label="历史话术" value={scripts.length} />
        </div>
        <div className="collection-priority-panel">
          <div>
            <strong>今天先跟进</strong>
            <span>{followUpQueue.length ? `按回款压力和下次跟进时间排序，优先处理前 ${Math.min(3, followUpQueue.length)} 个。` : "暂无待回款项目，可以先检查核销或回款流水。"}</span>
          </div>
          {followUpQueue.length ? followUpQueue.slice(0, 3).map((item) => (
            <button type="button" key={item.project.id} onClick={() => setSelectedId(item.project.id)}>
              <b>{item.status}</b>
              <strong>{item.project.name}</strong>
              <span>{money(item.project.receivable)} · 待收占比 {item.receivableRate}%{item.nextFollowUpAt ? ` · ${item.nextFollowUpAt}` : ""}</span>
              <em>{item.nextAction}</em>
            </button>
          )) : (
            <div className="collection-action-empty">
              <strong>暂无回款跟进队列</strong>
              <span>如果实际已有收入确认但未出现待回款，可以上传核销表或到项目回款记录补流水。</span>
              <div className="button-row compact">
                {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="feature-panel collection-generator">
        <PanelTitle icon={Bot} title="生成话术" />
        <label>
          <span>选择项目</span>
          <select value={selectedId} onChange={(event) => {
            setSelectedId(event.target.value);
            setDraft(null);
          }}>
            {receivableProjects.length ? receivableProjects.map((project) => (
              <option value={project.id} key={project.id}>{project.name} · 待回款 {money(project.receivable)}</option>
            )) : projects.map((project) => (
              <option value={project.id} key={project.id}>{project.name} · 暂无待回款</option>
            ))}
          </select>
        </label>
        <label>
          <span>我的说话风格</span>
          <input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="例如：自然一点、像微信私聊、别太硬" />
        </label>
        {selected && <div className="compact-list">
          <div><strong>{selected.name}</strong><span>{selected.client || "客户待补"} · 回款节点 {selected.paymentDue || "待确认"}</span></div>
          <div><strong>待回款</strong><span>{money(selected.receivable)}</span></div>
        </div>}
        <button type="button" className="primary" onClick={generateScript} disabled={!canUseCollection || loading || !selected || !Number(selected.receivable || 0)}>
          {loading ? "生成中" : "生成催收话术"}
        </button>
        {selected && !Number(selected.receivable || 0) && <div className="collection-action-empty">
          <strong>这个项目当前没有待回款</strong>
          <span>可以先检查回款流水，或上传月度核销表让系统更新确认收入和待收状态。</span>
          <div className="button-row compact">
            <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>
            <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>
          </div>
        </div>}
      </div>

      <div className="feature-panel wide-feature">
        <PanelTitle icon={MessageSquareText} title="当前话术" />
        {(draft || relatedScripts[0]) ? (
          <div className="collection-script-card fresh">
            <strong>{(draft || relatedScripts[0]).projectName} · {(draft || relatedScripts[0]).tone || "自然提醒"}</strong>
            <pre>{(draft || relatedScripts[0]).script}</pre>
            <span>{(draft || relatedScripts[0]).reason || (draft || relatedScripts[0]).outcome || "生成后可复制到微信/飞书跟进客户。"}</span>
            <div className="button-row">
              <button type="button" className="ghost" disabled={copyingScriptId === ((draft || relatedScripts[0]).id || "draft")} onClick={() => copyScript(draft || relatedScripts[0])}>
                {copyingScriptId === ((draft || relatedScripts[0]).id || "draft") ? "复制中" : "复制话术"}
              </button>
            </div>
          </div>
        ) : <div className="empty-state action-empty">
          <strong>{receivableProjects.length ? "还没有当前项目的话术" : "当前没有待回款项目"}</strong>
          <span>{receivableProjects.length ? "可以先为选中的待回款项目生成第一条话术，后续复制、记录有效/待优化都会沉淀为团队样本。" : "没有待回款时，建议先去项目回款记录检查流水，或上传核销表更新确认收入状态。"}</span>
          <div className="button-row compact">
            {receivableProjects.length && <button type="button" className="primary tiny" onClick={generateScript} disabled={!canGenerateSelected || loading}>{loading ? "生成中" : "生成第一条"}</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
          </div>
        </div>}
      </div>

      <div className="feature-panel">
        <PanelTitle icon={CheckCircle2} title="有效话术参考" />
        {bestScript ? <div className="idea-card">
          <strong>{bestScript.salesName} · {bestScript.projectName}</strong>
          <p>{bestScript.script}</p>
        </div> : <div className="collection-action-empty">
          <strong>还没有成功样本</strong>
          <span>先生成话术并记录“有效/待优化”，系统就会慢慢沉淀每个销售更像本人说话的表达。</span>
          <div className="button-row compact">
            {canGenerateSelected && <button type="button" className="primary tiny" onClick={generateScript} disabled={loading}>{loading ? "生成中" : "生成第一条"}</button>}
            {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>去看项目回款</button>}
          </div>
        </div>}
      </div>

      <div className="feature-panel wide-feature">
        <div className="section-head">
          <PanelTitle icon={Clock3} title="话术记录" />
          <button type="button" className="ghost" disabled={exportingCollection} onClick={exportCollectionLedger}><FileSpreadsheet size={14} />{exportingCollection ? "导出中" : "导出话术"}</button>
        </div>
        <div className="detail-list">
          {scripts.length ? scripts.slice(0, 10).map((item) => (
            <div className={`collection-history-row ${focusedScriptId === item.id ? "fresh" : ""}`} key={item.id}>
              <strong>{item.projectName} · {item.salesName || "销售"} · {money(item.amount)}</strong>
              <span>{item.outcome || item.reason || "结果待记录"}</span>
              {(item.followUpStatus === "待跟进" || item.nextFollowUpAt || item.nextAction) && (
                <div className="collection-follow-up-note">
                  <strong>下次跟进</strong>
                  <span>{item.nextFollowUpAt || "时间待定"} · {item.nextAction || "再次跟进客户付款"}</span>
                </div>
              )}
              {canUseCollection && <div className="button-row">
                <button type="button" className="ghost" disabled={copyingScriptId === item.id} onClick={() => copyScript(item)}>{copyingScriptId === item.id ? "复制中" : "复制话术"}</button>
                <button type="button" className="primary" disabled={savingOutcomeId === item.id} onClick={() => saveOutcome(item, true)}>{savingOutcomeId === item.id ? "记录中" : "有效"}</button>
              </div>}
              {canUseCollection && <div className="collection-follow-up-form">
                <label>
                  <span>下次跟进时间</span>
                  <input type="date" value={followUpForm(item).nextFollowUpAt} onChange={(event) => updateFollowUp(item, "nextFollowUpAt", event.target.value)} />
                </label>
                <label>
                  <span>下一步动作</span>
                  <input value={followUpForm(item).nextAction} onChange={(event) => updateFollowUp(item, "nextAction", event.target.value)} placeholder="例如：补发对账单后再提醒客户财务" />
                </label>
                <button type="button" className="ghost" disabled={savingOutcomeId === item.id} onClick={() => saveOutcome(item, false)}>{savingOutcomeId === item.id ? "记录中" : "待优化并提醒"}</button>
              </div>}
            </div>
          )) : (
            <div className="collection-action-empty collection-history-empty">
              <strong>暂无话术记录</strong>
              <span>可以先为待回款项目生成第一条话术；如果当前项目没有待回款，就先检查回款流水或上传核销表。</span>
              <div className="button-row compact">
                {canGenerateSelected && <button type="button" className="primary tiny" onClick={generateScript} disabled={loading}>{loading ? "生成中" : "生成第一条"}</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onOpenProjectPayments?.(selected)}>查看回款记录</button>}
                {selected && <button type="button" className="ghost tiny" onClick={() => onUploadVerification?.(selected)}>上传核销表</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
