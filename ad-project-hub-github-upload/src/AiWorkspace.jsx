import React, { useState } from "react";
import { Bot, ChevronRight, FileText, PanelRightClose, UploadCloud } from "lucide-react";
import { apiRequest, fileToPayload } from "./utils/api.js";
import { money } from "./utils/format.js";
import { canCreateProjectRole, canSeeManagement, canUseCollectionRole } from "./utils/permissions.js";
import { projectHealth } from "./utils/projectMetrics.js";
import "./ai.css";

function roleLabel(role) {
  return {
    shareholder: "股东",
    admin: "管理员",
    director: "总监",
    pm: "项目经理",
    sales: "销售",
    finance: "财务",
    member: "普通成员",
    viewer: "只读成员"
  }[role] || role;
}

function findProjectFromText(text, projects = [], selected) {
  const query = String(text || "");
  return projects.find((project) => query.includes(project.name) || (project.client && query.includes(project.client))) || selected || projects[0];
}

function amountFromText(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(万|元)?/);
  if (!match) return 0;
  const number = Number(match[1]);
  return match[2] === "万" ? number * 10000 : number;
}

async function answerAiQuestion(context) {
  const query = String(context.query || "").trim();
  const data = await apiRequest("/api/ai/assistant", context.session, {
    method: "POST",
    body: JSON.stringify({
      query,
      selectedProjectId: context.selected?.id || "",
      confirmAction: context.confirmAction || null
    })
  });
  if (data.action === "approval-created") await context.onDone?.();
  if (data.action === "task-created") await context.onDone?.();
  return data;
}

function buildAiFilingAction(result = {}, query = "", projects = [], selected = null) {
  if (result.action !== "filing-guidance") return null;
  const text = String(query || "");
  const explicitMatches = projects.filter((project) => String(query || "").includes(project.name) || (project.client && String(query || "").includes(project.client)));
  const target = explicitMatches[0] || selected || projects[0] || null;
  const ambiguous = !explicitMatches.length && projects.length > 1;
  const mentionsReimbursement = /报销|票据|发票|费用|expense/i.test(text);
  const uploadType = /核销|月度|确认收入/.test(text)
    ? "verification-sheet"
    : /报价|报价表|quote/i.test(text)
      ? "quote-sheet"
      : /合同|新项目|立项/.test(text)
        ? "create-project"
        : "cost-sheet";
  const uploadTypeLabel = uploadType === "verification-sheet"
    ? "月度核销表"
    : uploadType === "quote-sheet"
      ? "合同报价表"
      : uploadType === "create-project"
        ? "合同/报价创建项目"
        : mentionsReimbursement
          ? "项目报销/成本表"
          : "执行成本表";
  const orderedOptions = target?.id
    ? [target, ...projects.filter((project) => project.id !== target.id)]
    : projects;
  return {
    projectId: target?.id || "",
    projectName: target?.name || "",
    uploadType,
    uploadTypeLabel,
    mentionsReimbursement,
    ambiguous,
    options: ambiguous ? orderedOptions.slice(0, 4).map((project) => ({ id: project.id, name: project.name, client: project.client })) : []
  };
}

function needsRegistrationProjectChoice(query = "", projects = []) {
  const text = String(query || "");
  const hasAmount = /\d+(?:\.\d+)?\s*(?:万|元)?/.test(text);
  const isRegistration = /(提交|申请|登记|记录|记一笔|报销|备用金|费用|花了|支出)/.test(text);
  const hasExplicitProject = projects.some((project) => text.includes(project.name) || (project.client && text.includes(project.client)));
  return hasAmount && isRegistration && projects.length > 1 && !hasExplicitProject;
}

function needsTaskProjectChoice(query = "", projects = []) {
  const text = String(query || "");
  const isTask = /(任务|节点|待办)/.test(text) || /(加一个|新增|创建|安排)/.test(text);
  const hasExplicitProject = projects.some((project) => text.includes(project.name) || (project.client && text.includes(project.client)));
  return isTask && projects.length > 1 && !hasExplicitProject;
}

function AiFilingActions({ action, onOpen }) {
  return (
    <div className="ai-filing-actions">
      <strong>{action.ambiguous ? `选择要归档的项目 · ${action.uploadTypeLabel}` : `准备上传${action.uploadTypeLabel}到「${action.projectName || "当前项目"}」`}</strong>
      {action.ambiguous && <div className="ai-project-options">
        {action.options.map((project) => (
          <button type="button" className="ghost tiny" key={project.id} onClick={() => onOpen(action, project.id)}>
            {project.name}
          </button>
        ))}
      </div>}
      <button type="button" className="primary tiny" onClick={() => onOpen(action)}>
        {action.ambiguous ? "用当前项目上传" : "打开上传"}
      </button>
      <span>{action.mentionsReimbursement ? "报销表会先按内部报销明细预览，确认后才进入项目成本。" : "会先进入 AI 预览，确认后才写入成本、报价或核销数据。"}</span>
    </div>
  );
}

function AiFileProjectActions({ action, onOpen }) {
  return (
    <div className="ai-filing-actions ai-file-project-actions">
      <strong>选择这些文件要登记到哪个项目</strong>
      <span>{action.fileCount || 0} 个文件 · {action.uploadTypeLabel || "项目文件"} · 确认前不会写入项目</span>
      <div className="ai-project-options">
        {(action.options || []).map((project) => (
          <button type="button" className="ghost tiny" key={project.id} onClick={() => onOpen(action, project.id)}>
            {project.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildAiNavigationActions(query = "", projects = [], selected = null, session = {}) {
  const text = String(query || "");
  const target = findProjectFromText(text, projects, selected) || selected || projects[0] || null;
  const actions = [];
  if (/备用金|报销|审批|票据/.test(text)) {
    actions.push({
      label: /备用金|预算/.test(text) ? "查看项目备用金" : "查看审批记录",
      view: "approvals",
      subView: /备用金|预算/.test(text) ? "项目备用金" : "报销",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」相关审批与备用金。`
    });
  }
  if (/进度|节点|滞后|超前|完成度|材料|文件|解析/.test(text)) {
    actions.push({
      label: /材料|文件|解析/.test(text) ? "打开文件解析区" : "打开项目进度",
      view: "dashboard",
      focus: /材料|文件|解析/.test(text) ? "files" : "progress",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」的${/材料|文件|解析/.test(text) ? "文件与 AI 解析区" : "项目进度区"}。`
    });
  }
  if (/回款|收款|催收|待收|尾款|首款/.test(text)) {
    actions.push({
      label: canUseCollectionRole(session) ? "打开催收助手" : "查看回款记录",
      view: canUseCollectionRole(session) ? "collections" : "dashboard",
      focus: "payments",
      projectId: target?.id || "",
      notice: canUseCollectionRole(session)
        ? `已打开催收助手：${target?.name || "当前项目"}。`
        : `已打开「${target?.name || "当前项目"}」的回款记录区。`
    });
  }
  if (/创意|内容|过稿|脚本|客户|偏好|雷区/.test(text)) {
    actions.push({
      label: "查看客户偏好",
      view: "dashboard",
      focus: "client",
      projectId: target?.id || "",
      notice: `已打开「${target?.name || "当前项目"}」的客户偏好与交接信息。`
    });
  }
  if (/现金流|经营|倒闭|安全线|老板|公司/.test(text) && canSeeManagement(session)) {
    actions.push({
      label: "打开现金流压力",
      view: "management",
      subView: "现金流压力",
      projectId: target?.id || "",
      notice: "已打开经营舱现金流压力页。"
    });
  }
  return actions.slice(0, 2);
}

function AiNavigationActions({ actions = [], onOpen }) {
  if (!actions.length) return null;
  return (
    <div className="ai-filing-actions">
      <strong>下一步可以直接处理</strong>
      <div className="ai-project-options">
        {actions.map((action) => (
          <button type="button" className="ghost tiny" key={`${action.view}-${action.subView || action.focus || action.label}`} onClick={() => onOpen(action)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return <div className="panel-title"><Icon size={18} /><h2>{title}</h2></div>;
}

function useAiMessages({ session, projects, approvals, settings, stats, selected, onDone, onNotice, onApprovalCreated, maxMessages }) {
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(() => [
    {
      from: "assistant",
      title: "AI 项目助手",
      text: "我会结合你的账号权限、当前项目和上传记录回答问题。你可以问备用金、报销、进度，也可以说“帮我登记到我的项目里”。",
    },
  ]);

  async function ask(text = question, options = {}) {
    const query = String(text || "").trim();
    if (!query) {
      onNotice("先输入一句话，比如“我的项目备用金还有多少？”");
      return;
    }
    if (!options.skipProjectChoice && (needsRegistrationProjectChoice(query, projects) || needsTaskProjectChoice(query, projects))) {
      const orderedProjects = selected?.id
        ? [selected, ...projects.filter((project) => project.id !== selected.id)]
        : projects;
      setMessages((items) => [
        ...items,
        { from: "user", title: session.name, text: query },
        {
          from: "assistant",
          title: "AI 项目助手",
          text: needsTaskProjectChoice(query, projects) ? "这条任务需要先确认归属项目，避免记错项目。" : "这笔登记需要先确认归属项目，避免记错账。",
          registrationAction: { query, kind: needsTaskProjectChoice(query, projects) ? "task" : "registration", options: orderedProjects.slice(0, 6).map((project) => ({ id: project.id, name: project.name, client: project.client })) }
        }
      ].slice(-maxMessages));
      setQuestion("");
      return;
    }
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query, session, projects, approvals, settings, stats, selected: options.selectedProjectId ? projects.find((project) => project.id === options.selectedProjectId) || selected : selected, onDone });
    } catch (error) {
      result = { reply: `这次没办成：${error.message}` };
    }
    setMessages((items) => [
      ...items,
      { from: "user", title: session.name, text: query },
      { from: "assistant", title: "AI 项目助手", text: result.reply || "我已经处理完成。", pendingAction: result.pendingAction || null, filingAction: buildAiFilingAction(result, query, projects, selected), navActions: buildAiNavigationActions(query, projects, selected, session), query },
    ].slice(-maxMessages));
    setQuestion("");
    setSending(false);
  }

  async function confirmPending(message) {
    if (!message.pendingAction || sending) return;
    setSending(true);
    let result = null;
    try {
      result = await answerAiQuestion({ query: message.query, confirmAction: message.pendingAction, session, projects, approvals, settings, stats, selected, onDone });
      if (result.approval) onApprovalCreated?.(result.approval);
      onNotice("AI 已按你的确认提交审批，审批列表已刷新。");
    } catch (error) {
      result = { reply: `确认失败：${error.message}` };
    }
    setMessages((items) => [
      ...items.map((item) => item === message ? { ...item, pendingAction: null } : item),
      { from: "assistant", title: "AI 项目助手", text: result.reply || "已确认处理。" },
    ].slice(-maxMessages));
    setSending(false);
  }

  function appendAssistant(text, extra = {}) {
    setMessages((items) => [...items, { from: "assistant", title: "AI 项目助手", text, ...extra }].slice(-maxMessages));
  }

  return { question, setQuestion, sending, messages, setMessages, ask, confirmPending, appendAssistant };
}

function AiRegistrationProjectActions({ action, onOpen, onCancel }) {
  const isTask = action.kind === "task";
  return (
    <div className="ai-filing-actions ai-file-project-actions">
      <strong>选择这{isTask ? "条任务" : "笔登记"}归属的项目</strong>
      <span>{isTask ? "选择后我会先生成任务确认，不会直接写入项目。" : "选择后我会先生成审批确认，不会直接入账。"}</span>
      <div className="ai-project-options">
        {(action.options || []).map((project) => (
          <button type="button" className="ghost tiny" key={project.id} onClick={() => onOpen(action, project.id)}>{project.name}{project.client ? ` · ${project.client}` : ""}</button>
        ))}
      </div>
      <button type="button" className="ghost tiny" onClick={onCancel}>取消{isTask ? "任务" : "登记"}</button>
    </div>
  );
}

function inferAiDropUploadType(files = [], session = {}, selected = null) {
  const text = files.map((file) => file.name || "").join(" ");
  if (/核销|月度|确认收入|verification/i.test(text)) return "verification-sheet";
  if (/报价|quote|合同|contract/i.test(text)) return canCreateProjectRole(session) ? "create-project" : "quote-sheet";
  if (/报销|费用|成本|cost|expense|执行/i.test(text)) return "cost-sheet";
  return selected?.id ? "cost-sheet" : "create-project";
}

function uploadTypeLabel(type = "cost-sheet") {
  return type === "verification-sheet"
    ? "月度核销表"
    : type === "quote-sheet"
      ? "合同报价表"
      : type === "create-project"
        ? "合同/报价创建项目"
        : "项目报销/成本表";
}

function buildAiFileProjectAction({ uploadType, payloads = [], projects = [], selected = null }) {
  const orderedProjects = selected?.id
    ? [selected, ...projects.filter((project) => project.id !== selected.id)]
    : projects;
  return {
    uploadType,
    uploadTypeLabel: uploadTypeLabel(uploadType),
    fileCount: payloads.length,
    files: payloads,
    options: orderedProjects.slice(0, 6).map((project) => ({ id: project.id, name: project.name, client: project.client }))
  };
}

function createFilingHandler({ session, projects, selected, onUpload, onSelectProject, onNotice }) {
  return function handleFilingAction(action, projectId = "") {
    const targetId = projectId || action?.projectId || selected?.id || projects[0]?.id || "";
    const target = projects.find((project) => project.id === targetId) || selected || projects[0];
    const canCreate = canCreateProjectRole(session);
    const uploadType = action?.uploadType === "create-project" && !canCreate ? "cost-sheet" : action?.uploadType || "cost-sheet";
    if (!target?.id && uploadType !== "create-project") {
      onNotice("当前没有可上传归档的项目，请先让管理员分派项目。");
      return;
    }
    if (target?.id) onSelectProject?.(target.id);
    onUpload?.(uploadType, uploadType === "create-project" ? null : target);
    const targetName = uploadType === "create-project" ? "新项目" : target.name;
    const downgraded = action?.uploadType === "create-project" && !canCreate;
    onNotice(downgraded
      ? `当前账号不能创建新项目，已改为给「${target.name}」打开项目文件上传，AI 会先预览识别。`
      : `已为「${targetName}」打开${action?.uploadTypeLabel || "项目文件"}上传，AI 会先预览识别，确认后才写入项目。`);
  };
}

function createFileProjectHandler({ projects, onUpload, onSelectProject, onNotice }) {
  return function handleFileProjectAction(action, projectId = "") {
    const target = projects.find((project) => project.id === projectId) || null;
    if (!target?.id) {
      onNotice("请选择一个项目后再登记这些文件。");
      return;
    }
    onSelectProject?.(target.id);
    onUpload?.(action.uploadType || "cost-sheet", target, action.files || []);
    onNotice(`已为「${target.name}」打开${action.uploadTypeLabel || "项目文件"}上传预览，确认后才会写入项目。`);
  };
}

async function handleDroppedFiles({ event, session, projects, selected, onUpload, onSelectProject, onNotice, appendAssistant }) {
  event.preventDefault();
  const picked = Array.from(event.dataTransfer?.files || []);
  if (!picked.length) return;
  const uploadType = inferAiDropUploadType(picked, session, selected);
  let payloads = [];
  try {
    payloads = await Promise.all(picked.map(fileToPayload));
  } catch (error) {
    onNotice(`AI 读取文件失败：${error.message}`);
    return;
  }
  const target = uploadType === "create-project" ? null : selected || projects[0] || null;
  if (uploadType !== "create-project" && !target?.id) {
    onNotice("当前没有可归档的项目，请先让销售、PM 或管理层上传合同创建项目。");
    return;
  }
  if (uploadType !== "create-project" && projects.length > 1) {
    appendAssistant("我已经读到文件，但需要你先点一下要登记到哪个项目。", {
      fileAction: buildAiFileProjectAction({ uploadType, payloads, projects, selected })
    });
    onNotice("AI 已接收文件，请在对话框里选择要登记的项目。");
    return;
  }
  if (target?.id) onSelectProject?.(target.id);
  onUpload?.(uploadType, target, payloads);
  appendAssistant(`已接收 ${payloads.length} 个文件，并打开上传预览。确认前不会写入项目。`);
  onNotice(`AI 已接收 ${payloads.length} 个文件，已打开上传预览，确认后才会写入项目。`);
}

export function DashboardAiPanel({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated, onSelectProject, onNavigate, collapsed = false, onToggleCollapsed }) {
  const { question, setQuestion, sending, messages, setMessages, ask, confirmPending, appendAssistant } = useAiMessages({
    session, projects, approvals, settings, stats, selected, onDone, onNotice, onApprovalCreated, maxMessages: 7
  });
  const weatherText = "上海 29°C · 多云，外拍注意补水";
  const timeText = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  const handleFilingAction = createFilingHandler({ session, projects, selected, onUpload, onSelectProject, onNotice });
  const handleFileProjectAction = createFileProjectHandler({ projects, onUpload, onSelectProject, onNotice });
  function handleRegistrationProjectAction(message, projectId) {
    setMessages((items) => items.map((item) => item === message ? { ...item, registrationAction: null } : item));
    onSelectProject?.(projectId);
    ask(message.registrationAction?.query, { skipProjectChoice: true, selectedProjectId: projectId });
  }

  function handleAiFileDrop(event) {
    return handleDroppedFiles({ event, session, projects, selected, onUpload, onSelectProject, onNotice, appendAssistant });
  }

  if (collapsed) {
    return (
      <aside className="ai-activity-panel collapsed">
        <button type="button" className="ai-collapsed-button" onClick={onToggleCollapsed} aria-label="展开 AI 助手">
          <Bot size={18} />
          <span>AI</span>
          <ChevronRight size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-activity-panel" onDrop={handleAiFileDrop} onDragOver={(event) => event.preventDefault()}>
      <div className="ai-profile">
        <div className="ai-avatar">{session.name?.slice(0, 1) || "A"}</div>
        <div>
          <strong>{session.name}</strong>
          <span>{roleLabel(session.role)} · AI 项目伙伴</span>
        </div>
        <button type="button" className="ai-panel-toggle" onClick={onToggleCollapsed} aria-label="收起 AI 助手">
          <PanelRightClose size={17} />
        </button>
      </div>

      <div className="ai-activity-head">
        <div>
          <span>{timeText}</span>
          <strong>{weatherText}</strong>
        </div>
        <Bot size={18} />
      </div>

      <div className="ai-project-context">
        <span>当前项目</span>
        <strong>{selected?.name || "等待第一个项目"}</strong>
        <span>{projects.length ? `${projects.length} 个可见项目 · 当前 ${projectHealth(selected).label}` : "可先拖入合同创建项目；票据将在项目建立后归档"}</span>
      </div>

      <div className="ai-quick-tags">
        <button type="button" onClick={() => ask("我的项目备用金还有多少？")}>备用金</button>
        <button type="button" onClick={() => ask("这个项目进度怎么样？")}>进度</button>
        <button type="button" onClick={() => ask("帮我生成一个更容易过稿的内容方向")}>内容</button>
        <button type="button" onClick={() => onUpload?.()}><UploadCloud size={14} />上传文件</button>
      </div>
      <div className="ai-drop-hint"><UploadCloud size={14} />把合同、报价、成本、报销或核销表拖到这里</div>

      <div className="ai-feed">
        {messages.map((message, index) => (
          <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
            <span>{message.title}</span>
            <p>{message.text}</p>
            {message.pendingAction && <div className="ai-confirm-actions">
              <button type="button" className="primary" onClick={() => confirmPending(message)} disabled={sending}>确认提交</button>
              <button type="button" className="ghost" onClick={() => setMessages((items) => items.map((item) => item === message ? { ...item, pendingAction: null, text: `${item.text}\n已取消，未提交。` } : item))}>取消</button>
            </div>}
            {message.filingAction && <AiFilingActions action={message.filingAction} onOpen={handleFilingAction} />}
            {message.fileAction && <AiFileProjectActions action={message.fileAction} onOpen={handleFileProjectAction} />}
            {message.registrationAction && <AiRegistrationProjectActions action={message.registrationAction} onOpen={(_, projectId) => handleRegistrationProjectAction(message, projectId)} onCancel={() => setMessages((items) => items.map((item) => item === message ? { ...item, registrationAction: null, text: `${item.text}\n已取消，未提交。` } : item))} />}
            {message.navActions && <AiNavigationActions actions={message.navActions} onOpen={onNavigate} />}
          </div>
        ))}
      </div>

      <div className="ai-compose">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }}
          placeholder="随心输入，问项目、报销、备用金或内容创意"
        />
        <button type="button" onClick={() => ask()} disabled={sending}><ChevronRight size={18} /></button>
      </div>
    </aside>
  );
}

export function AiWorkbench({ session, projects, approvals = [], settings = {}, stats = {}, selected, onUpload, onDone, onNotice, onApprovalCreated, onSelectProject, onNavigate }) {
  const visibleProjects = projects.slice(0, 4);
  const { question, setQuestion, sending, messages, setMessages, ask, confirmPending, appendAssistant } = useAiMessages({
    session, projects, approvals, settings, stats, selected, onDone, onNotice, onApprovalCreated, maxMessages: 8
  });
  const handleFilingAction = createFilingHandler({ session, projects, selected, onUpload, onSelectProject, onNotice });
  const handleFileProjectAction = createFileProjectHandler({ projects, onUpload, onSelectProject, onNotice });
  function handleRegistrationProjectAction(message, projectId) {
    setMessages((items) => items.map((item) => item === message ? { ...item, registrationAction: null } : item));
    onSelectProject?.(projectId);
    ask(message.registrationAction?.query, { skipProjectChoice: true, selectedProjectId: projectId });
  }

  function handleAiFileDrop(event) {
    return handleDroppedFiles({ event, session, projects, selected, onUpload, onSelectProject, onNotice, appendAssistant });
  }

  return (
    <section className="ai-workbench" onDrop={handleAiFileDrop} onDragOver={(event) => event.preventDefault()}>
      <div className="ai-chat-shell">
        <div className="ai-chat-head">
          <PanelTitle icon={Bot} title="AI 项目助手" />
          <span>{session.name} 的项目上下文</span>
        </div>
        <div className="ai-message ai-message-assistant">
          <strong>你可以直接把项目里的事情丢给我。</strong>
          <p>问备用金、报销、进度、材料缺口，或者把合同、报价表、成本表、票据、核销表拖到这个对话区，我会先识别你的账号和项目权限，再帮你归档或登记。</p>
        </div>
        <div className="prompt-list">
          <button type="button" onClick={() => ask("我的项目备用金还有多少？")}>我的项目备用金还有多少？</button>
          <button type="button" onClick={() => ask(`帮我提交500元报销到${selected.name}`)}>帮我提交一笔报销</button>
          <button type="button" onClick={() => ask("这个项目进度怎么样？")}>这个项目进度怎么样？</button>
          <button type="button" onClick={() => ask("给我生成一个更容易过稿的内容方向")}>给我生成一个更容易过稿的内容方向</button>
          <button type="button" onClick={() => onUpload?.()}><UploadCloud size={14} />让 AI 识别项目文件</button>
        </div>
        <div className="ai-feed ai-workbench-feed">
          {messages.map((message, index) => (
            <div className={`ai-feed-item ${message.from}`} key={`${message.from}-${index}`}>
              <span>{message.title}</span>
              <p>{message.text}</p>
              {message.pendingAction && <div className="ai-confirm-actions">
                <button type="button" className="primary" onClick={() => confirmPending(message)} disabled={sending}>确认提交</button>
                <button type="button" className="ghost" onClick={() => setMessages((items) => items.map((item) => item === message ? { ...item, pendingAction: null, text: `${item.text}\n已取消，未提交。` } : item))}>取消</button>
              </div>}
              {message.filingAction && <AiFilingActions action={message.filingAction} onOpen={handleFilingAction} />}
              {message.fileAction && <AiFileProjectActions action={message.fileAction} onOpen={handleFileProjectAction} />}
              {message.registrationAction && <AiRegistrationProjectActions action={message.registrationAction} onOpen={(_, projectId) => handleRegistrationProjectAction(message, projectId)} onCancel={() => setMessages((items) => items.map((item) => item === message ? { ...item, registrationAction: null, text: `${item.text}\n已取消，未提交。` } : item))} />}
              {message.navActions && <AiNavigationActions actions={message.navActions} onOpen={onNavigate} />}
            </div>
          ))}
        </div>
        <div className="ai-context-strip">
          {visibleProjects.map((project) => (
            <div key={project.id}>
              <span>{projectHealth(project).label}</span>
              <strong>{project.name}</strong>
            </div>
          ))}
        </div>
        <div className="chat-input ai-main-input">
          <UploadCloud size={16} />
          <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }} placeholder="输入问题，或先用上传入口让 AI 识别项目文件" />
          <button type="button" className="ghost" onClick={() => onUpload?.()}>上传</button>
          <button type="button" onClick={() => ask()} disabled={sending}>{sending ? "处理中" : "发送"}</button>
        </div>
      </div>

      <div className="ai-side-panel">
        <PanelTitle icon={FileText} title="当前项目建议" />
        <div className="idea-card">
          <strong>{selected.client || selected.name} 内容建议</strong>
          <p>优先用“真实场景 + 明确卖点 + 可执行路径”，避免只给概念不落地。新 PM 接手时自动生成客户雷区和交接摘要。</p>
        </div>
        <div className="compact-list">
          {visibleProjects.map((project) => (
            <div key={project.id}>
              <strong>{project.name}</strong>
              <span>{project.pm} · {projectHealth(project).label} · 备用金余 {money(Math.max(project.pettyCashBudget - project.pettyCashUsed, 0))}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
