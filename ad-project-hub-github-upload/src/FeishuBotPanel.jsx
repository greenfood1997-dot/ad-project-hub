import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { downloadCsv } from "./utils/format.js";
import { feishuPendingLedgerRows } from "./utils/ledgerRows.js";
import "./feishu.css";

export default function FeishuBotPanel({ api, settings = {}, projects = [], members = [], bindings = [], events = [], pendingFiles = [], notifications = [], onReload, onConfigureField }) {
  const [form, setForm] = useState({
    projectId: projects[0]?.id || "",
    chatId: "",
    chatName: ""
  });
  const [message, setMessage] = useState("");
  const [operationLogs, setOperationLogs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [handlingId, setHandlingId] = useState("");
  const [exportingPendingFiles, setExportingPendingFiles] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sampleText, setSampleText] = useState("这是项目群测试消息，帮我记录到项目动态里");
  const [focusedBindingId, setFocusedBindingId] = useState("");
  const [focusedEventId, setFocusedEventId] = useState("");
  const [focusedPendingId, setFocusedPendingId] = useState("");
  const latestDownload = events.find((item) => /download|下载|解析|引用/.test(`${item.action || ""} ${item.status || ""} ${item.reply || ""}`));
  const feishuNotices = notifications.filter((item) => item.type === "feishu-pending-file" && item.status === "待处理");
  const feishuNoticeReady = notifications.filter((item) => item.status === "待处理" && item.recipients?.length);
  const pendingQueueRef = useRef(null);
  const bindingFormRef = useRef(null);
  const eventListRef = useRef(null);
  const activeMembers = members.filter((item) => item.status !== "disabled");
  const boundMembers = activeMembers.filter((item) => item.feishuOpenId || item.feishuUserId);
  const missingFeishuMembers = activeMembers.filter((item) => !item.feishuOpenId && !item.feishuUserId);
  const pendingCount = pendingFiles.filter((item) => item.status === "待确认").length;
  const handledFileCount = pendingFiles.filter((item) => item.status && item.status !== "待确认").length;
  const latestEvent = events[0];
  const latestSyncAt = settings.lastContactSyncAt || "";
  const latestSync = settings.lastContactSyncResult || null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const callbackPath = "/api/integrations/feishu/events";
  const callbackUrl = settings.eventUrl || (origin ? `${origin}${callbackPath}` : callbackPath);
  const setupChecks = [
    { label: "App ID", ok: Boolean(settings.appId), text: settings.appId ? "已填写" : "待填写", action: "后台上方填写并保存" },
    { label: "App Secret", ok: Boolean(settings.appSecret), text: settings.appSecret ? "已填写" : "待填写", action: "后台上方填写并保存" },
    { label: "Verification Token", ok: Boolean(settings.verificationToken), text: settings.verificationToken ? "已填写" : "建议填写", action: "飞书事件订阅页复制过来" },
    { label: "事件订阅 URL", ok: Boolean(settings.eventUrl || origin), text: callbackUrl, action: "复制到飞书开放平台" },
    { label: "项目群绑定", ok: bindings.length > 0, text: `${bindings.length} 个群`, action: "把 Chat ID 绑定到 OA 项目" },
    { label: "成员飞书身份", ok: boundMembers.length > 0 && missingFeishuMembers.length === 0, text: `${boundMembers.length}/${activeMembers.length || 0} 已绑定`, action: "同步通讯录或手动填写 Open ID" },
    { label: "机器人事件", ok: events.length > 0, text: latestEvent ? `${latestEvent.status || latestEvent.action || "已接收"} · ${latestEvent.chatName || latestEvent.projectName || latestEvent.chatId || "最近事件"}` : "暂无事件", action: "自测消息入库或在群里 @机器人" },
    { label: "待确认队列", ok: pendingCount === 0, text: pendingCount ? `${pendingCount} 个待处理` : `${handledFileCount} 个已处理记录`, action: "确认或驳回飞书文件" },
    { label: "飞书私聊通知", ok: Boolean(settings.mockSend === true || settings.mockSend === "true" || settings.appId && settings.appSecret && boundMembers.length > 0), text: settings.mockSend === true || settings.mockSend === "true" ? "模拟发送开启" : `${feishuNoticeReady.length} 条可提醒`, action: "给待办负责人发送飞书" },
    { label: "通讯录同步", ok: Boolean(latestSyncAt), text: latestSyncAt ? `${new Date(latestSyncAt).toLocaleString("zh-CN", { hour12: false })}` : "未同步", action: "点击同步飞书通讯录" }
  ];
  const readyCount = setupChecks.filter((item) => item.ok).length;
  const nextSetupAction = setupChecks.find((item) => !item.ok);

  useEffect(() => {
    if (!form.projectId && projects[0]?.id) setForm((current) => ({ ...current, projectId: projects[0].id }));
  }, [projects[0]?.id, form.projectId]);

  function pushOperation(text, tone = "ok") {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      tone,
      at: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };
    setOperationLogs((current) => [item, ...current].slice(0, 5));
    setMessage(text);
  }

  async function save(event) {
    event.preventDefault();
    if (!form.chatId.trim()) {
      pushOperation("请填写飞书群 Chat ID", "warn");
      return;
    }
    if (!form.projectId) {
      pushOperation("请先选择要绑定的项目", "warn");
      return;
    }
    setSaving(true);
    setMessage("正在保存飞书群绑定...");
    try {
      const savedBinding = await api("/api/integrations/feishu/bindings", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setFocusedBindingId(savedBinding.id || savedBinding.chatId || form.chatId);
      setForm((current) => ({ ...current, chatId: "", chatName: "" }));
      await onReload();
      pushOperation(`飞书群绑定已保存并刷新：${savedBinding.chatName || form.chatName || form.chatId} -> ${savedBinding.projectName || projects.find((project) => project.id === form.projectId)?.name || "已选项目"}。`);
    } catch (error) {
      pushOperation(error.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  async function handlePendingFile(item, action) {
    setHandlingId(item.id);
    setMessage(action === "reject" ? "正在驳回飞书文件..." : "正在确认入库飞书文件...");
    try {
      const handled = await api("/api/integrations/feishu/pending-files/action", {
        method: "POST",
        body: JSON.stringify({ id: item.id, action })
      });
      const leftCount = Math.max(pendingFiles.filter((file) => file.status === "待确认").length - 1, 0);
      setFocusedPendingId(handled.id || item.id);
      await onReload();
      pushOperation(`${action === "reject" ? "飞书文件已驳回，队列已刷新" : "飞书文件已确认入库，项目数据和队列已刷新"}，当前还剩 ${leftCount} 个待确认文件。`);
    } catch (error) {
      pushOperation(error.message, "danger");
    } finally {
      setHandlingId("");
    }
  }

  async function exportPendingFiles() {
    if (!pendingFiles.length) {
      pushOperation("当前没有可导出的飞书文件队列。", "warn");
      return;
    }
    setExportingPendingFiles(true);
    try {
      downloadCsv("飞书文件入库队列.csv", feishuPendingLedgerRows(pendingFiles));
      pushOperation(`飞书文件入库队列 CSV 已导出：${pendingFiles.length} 条。`);
    } finally {
      setExportingPendingFiles(false);
    }
  }

  async function copyCallbackUrl() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      pushOperation("事件订阅 URL 已复制，可以粘贴到飞书开放平台。");
    } catch {
      pushOperation(`请复制这个地址：${callbackUrl}`, "warn");
    }
  }

  async function testCallback() {
    setTesting(true);
    setMessage("正在自测 OA 飞书事件地址...");
    try {
      const res = await fetch(callbackPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge: "ad-project-hub-feishu-check", token: settings.verificationToken || undefined })
      });
      const payload = await res.json();
      if (payload.challenge !== "ad-project-hub-feishu-check") throw new Error(payload.error || "事件地址没有返回飞书需要的 challenge");
      pushOperation("OA 事件地址自测通过。下一步去飞书开放平台保存事件订阅。");
    } catch (error) {
      pushOperation(error.message || "事件地址自测失败", "danger");
    } finally {
      setTesting(false);
    }
  }

  async function testMessageIntake() {
    const chatId = form.chatId.trim() || bindings[0]?.chatId || "";
    if (!chatId) {
      pushOperation("请先填写或保存一个飞书群 Chat ID，再测试消息入库。", "warn");
      return;
    }
    setTesting(true);
    setMessage("正在模拟飞书群消息...");
    try {
      const res = await fetch(callbackPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: settings.verificationToken || undefined,
          event: {
            message: {
              chat_id: chatId,
              chat_name: form.chatName || bindings.find((item) => item.chatId === chatId)?.chatName || "OA 测试群",
              message_type: "text",
              content: JSON.stringify({ text: sampleText })
            },
            sender: {
              sender_name: "OA 接入测试",
              sender_id: { open_id: "oa-feishu-setup-test" }
            }
          }
        })
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "模拟消息没有成功进入 OA");
      setFocusedEventId(payload.data?.event?.id || "");
      await onReload();
      pushOperation(payload.data?.reply ? `模拟飞书消息已入库，事件列表已刷新：${payload.data.reply}` : "模拟飞书消息已入库，事件列表已刷新。");
    } catch (error) {
      pushOperation(error.message || "模拟飞书消息失败", "danger");
    } finally {
      setTesting(false);
    }
  }

  function prepareFirstBinding() {
    const target = projects[0];
    if (!target) {
      pushOperation("当前还没有项目，请先上传合同创建项目，再绑定飞书项目群。", "warn");
      return;
    }
    setForm((current) => ({
      ...current,
      projectId: current.projectId || target.id,
      chatName: current.chatName || `${target.name}项目群`
    }));
    pushOperation(`已预选「${target.name}」，请补飞书群 Chat ID 后保存绑定。`, "warn");
  }

  function scrollToFeishuArea(ref, messageText) {
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (messageText) pushOperation(messageText, "warn");
  }

  async function handleSetupCheckAction(item) {
    if (!item) return;
    if (["App ID", "App Secret", "Verification Token"].includes(item.label)) {
      const field = item.label === "App ID" ? "appId" : item.label === "App Secret" ? "appSecret" : "verificationToken";
      onConfigureField?.(field);
      return;
    }
    if (item.label === "事件订阅 URL") {
      await copyCallbackUrl();
      return;
    }
    if (item.label === "项目群绑定") {
      prepareFirstBinding();
      scrollToFeishuArea(bindingFormRef, "已定位到群绑定表单，请补 Chat ID 后保存。");
      return;
    }
    if (item.label === "成员飞书身份" || item.label === "通讯录同步") {
      pushOperation("请点击上方「同步飞书通讯录」；如果没有权限，可在成员管理里手动填写 Open ID。", "warn");
      return;
    }
    if (item.label === "机器人事件") {
      if (bindings.length) await testMessageIntake();
      else await testCallback();
      scrollToFeishuArea(eventListRef, "已定位到最近机器人事件列表。");
      return;
    }
    if (item.label === "待确认队列") {
      scrollToFeishuArea(pendingQueueRef, "已定位到待确认文件队列，可以确认入库或驳回。");
      return;
    }
    if (item.label === "飞书私聊通知") {
      pushOperation("飞书私聊通知从顶部「待办」里发送；如果没有收件人，请先补成员飞书 Open ID。", "warn");
    }
  }

  return (
    <div className="settings-block feishu-bot-panel">
      <div className="feishu-setup-head">
        <div>
          <h3>飞书机器人接入向导</h3>
          <p>把飞书项目群、合同/报价/成本/核销文件，接进 OA 的待确认入库流程。</p>
        </div>
        <span>{readyCount}/{setupChecks.length} 已就绪</span>
      </div>
      <div className="feishu-status-grid">
        {setupChecks.map((item) => (
          <div className={item.ok ? "ok" : "warn"} key={item.label}>
            {item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <strong>{item.label}</strong>
            <span>{item.text}</span>
            {!item.ok && <em>{item.action}</em>}
            {!item.ok && <button type="button" className="ghost tiny" onClick={() => handleSetupCheckAction(item)}>去处理</button>}
          </div>
        ))}
      </div>
      <div className={`feishu-health-card ${nextSetupAction ? "warn" : "ok"}`}>
        <div>
          {nextSetupAction ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{nextSetupAction ? `下一步：${nextSetupAction.action}` : "飞书接入清单已完成"}</strong>
        </div>
        <span>
          {nextSetupAction
            ? `当前卡在「${nextSetupAction.label}」。补完后再点自测事件地址 / 测试消息入库，就能判断链路是否通。`
            : "现在可以从飞书群收消息和文件，文件会先进入待确认队列，确认后才写入 OA 项目。"}
        </span>
      </div>
      <div className="feishu-ops-strip">
        <div><strong>{activeMembers.length}</strong><span>启用成员</span></div>
        <div><strong>{missingFeishuMembers.length}</strong><span>缺飞书 ID</span></div>
        <div><strong>{bindings.length}</strong><span>项目群</span></div>
        <div><strong>{events.length}</strong><span>机器人事件</span></div>
        <div><strong>{pendingCount}</strong><span>待确认文件</span></div>
        <div><strong>{notifications.length}</strong><span>系统待办</span></div>
      </div>
      {latestSync && <div className="feishu-download-state">
        <strong>最近通讯录同步</strong>
        <span>新增 {latestSync.created || 0} 人，更新 {latestSync.updated || 0} 人，跳过 {latestSync.skipped || 0} 人。同步后成员的飞书 Open ID 会用于机器人私聊通知。</span>
      </div>}
      {missingFeishuMembers.length > 0 && <div className="feishu-mini-list feishu-missing-list">
        <strong>还缺飞书身份的成员</strong>
        {missingFeishuMembers.slice(0, 6).map((member) => (
          <div key={member.id}>
            <span>{member.name}</span>
            <em>{member.email} · {member.department || "未分组"} · 缺 Open ID / User ID</em>
          </div>
        ))}
        {missingFeishuMembers.length > 6 && <p>还有 {missingFeishuMembers.length - 6} 人未展示，建议先同步飞书通讯录。</p>}
      </div>}
      <div className="feishu-guide">
        <div>
          <strong>1. 飞书开放平台创建企业自建应用</strong>
          <span>复制 App ID、App Secret、Verification Token，填到上面的飞书配置并保存。</span>
        </div>
        <div>
          <strong>2. 配置事件订阅地址</strong>
          <span>{callbackUrl}</span>
          <button type="button" className="ghost" onClick={copyCallbackUrl}>复制 URL</button>
        </div>
        <div>
          <strong>3. 开启消息与文件权限</strong>
          <span>给机器人开通读取群消息、读取消息资源文件、接收群消息/被 @ 消息事件，以及发送单聊消息权限，然后把机器人拉进项目群。</span>
        </div>
        <div>
          <strong>4. 绑定项目群并测试</strong>
          <span>在下方把 Chat ID 绑定到 OA 项目，并在成员管理里填写成员飞书 Open ID。群里 @机器人发文件会进待确认，待办也可以私聊提醒负责人。</span>
        </div>
      </div>
      <div className="button-row">
        <button type="button" className="ghost" onClick={testCallback} disabled={testing}>{testing ? "自测中" : "自测事件地址"}</button>
      </div>

      <h3>飞书项目群绑定</h3>
      <form className="feishu-bind-form" onSubmit={save} ref={bindingFormRef}>
        <label>
          <span>项目</span>
          <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          <span>群 Chat ID</span>
          <input value={form.chatId} onChange={(event) => setForm({ ...form, chatId: event.target.value })} placeholder="飞书群聊 chat_id" />
        </label>
        <label>
          <span>群名称</span>
          <input value={form.chatName} onChange={(event) => setForm({ ...form, chatName: event.target.value })} placeholder="例如 捷途汽车项目群" />
        </label>
        <button type="submit" className="ghost" disabled={saving}>{saving ? "保存中" : "保存群绑定"}</button>
      </form>
      <div className="feishu-intake-test">
        <label>
          <span>模拟群消息</span>
          <textarea value={sampleText} onChange={(event) => setSampleText(event.target.value)} rows={2} />
        </label>
        <button type="button" className="ghost" onClick={testMessageIntake} disabled={testing}>{testing ? "测试中" : "测试消息入库"}</button>
      </div>
      {message && <p className="form-message">{message}</p>}
      {operationLogs.length > 0 && <div className="feishu-operation-log">
        <strong>最近操作</strong>
        {operationLogs.map((item) => (
          <div className={item.tone} key={item.id}>
            <span>{item.text}</span>
            <em>{item.at}</em>
          </div>
        ))}
      </div>}
      <div className="feishu-download-state">
        <strong>文件下载与解析</strong>
        <span>{latestDownload ? `${latestDownload.status || latestDownload.action}：${latestDownload.reply || "已接收飞书文件事件"}` : "配置 App ID / App Secret 后，机器人会尝试用 message_id + file_key 下载文件；下载成功后先进入待确认队列，人工确认后才写入项目。"}</span>
      </div>
      <div className="feishu-download-state">
        <strong>自动提醒</strong>
        <span>{feishuNotices.length ? `系统已生成 ${feishuNotices.length} 条飞书待办，会出现在顶部「待办」里。超过 24 小时未处理会升为高优先级。` : "暂无飞书待办。待确认文件出现后，系统会自动生成 PM/管理层提醒。"}</span>
      </div>
      <div className="feishu-mini-list feishu-pending-list" ref={pendingQueueRef}>
        <div className="section-head">
          <strong>待确认文件</strong>
          <button type="button" className="ghost tiny" disabled={exportingPendingFiles} onClick={exportPendingFiles}><FileSpreadsheet size={14} />{exportingPendingFiles ? "导出中" : "导出队列"}</button>
        </div>
        {pendingFiles.length ? pendingFiles.slice(0, 6).map((item) => (
          <div className={focusedPendingId === item.id ? "fresh" : ""} key={item.id}>
            <span>{item.file?.name || item.preview?.fileName || "飞书文件"} · {item.status}</span>
            <em>{item.projectName || "待匹配项目"} · {item.uploadType || "file"} · {item.preview?.summary || item.note || "等待确认"}</em>
            {item.status === "待确认" && <div className="feishu-pending-actions">
              <button type="button" className="primary" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "confirm")}>
                {handlingId === item.id ? "处理中" : "确认入库"}
              </button>
              <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => handlePendingFile(item, "reject")}>{handlingId === item.id ? "处理中" : "驳回"}</button>
            </div>}
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无待确认文件</span>
            <em>飞书群发来的成本/报价/核销文件下载成功后会先出现在这里，确认后才写入项目。</em>
            <button type="button" className="ghost tiny" onClick={testMessageIntake} disabled={testing}>{testing ? "测试中" : "测试消息入库"}</button>
          </div>
        )}
      </div>
      <div className="feishu-mini-list" ref={eventListRef}>
        <strong>已绑定群</strong>
        {bindings.length ? bindings.slice(0, 5).map((item) => (
          <div className={focusedBindingId === (item.id || item.chatId) ? "fresh" : ""} key={item.chatId}>
            <span>{item.chatName || item.chatId}</span>
            <em>{item.projectName}</em>
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无绑定</span>
            <em>先把飞书项目群 Chat ID 绑定到 OA 项目，群里 @机器人发文件才知道归到哪个项目。</em>
            <button type="button" className="ghost tiny" onClick={prepareFirstBinding}>预填第一个项目</button>
          </div>
        )}
      </div>
      <div className="feishu-mini-list">
        <strong>最近机器人事件</strong>
        {events.length ? events.slice(0, 5).map((item) => (
          <div className={focusedEventId === item.id ? "fresh" : ""} key={item.id}>
            <span>{item.status || item.action}</span>
            <em>{item.projectName || item.chatName || item.chatId || "待匹配项目"} · {item.reply || item.text || item.fileName || "无内容"}</em>
          </div>
        )) : (
          <div className="feishu-empty-action">
            <span>暂无事件</span>
            <em>配置飞书事件订阅后，飞书消息会显示在这里；也可以先自测 OA 事件地址。</em>
            <button type="button" className="ghost tiny" onClick={testCallback} disabled={testing}>{testing ? "自测中" : "自测事件地址"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
