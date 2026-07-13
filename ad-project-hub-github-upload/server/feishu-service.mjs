// Feishu bot event intake, project binding, and pending file confirmation helpers.
function nextFeishuEventId() {
  return `feishu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nextFeishuPendingFileId() {
  return `feishu-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeFeishuTextContent(message = {}) {
  const raw = message.content ?? message.text ?? "";
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.text || parsed.content || raw).trim();
  } catch {
    return raw.trim();
  }
}

function normalizeFeishuFileName(message = {}) {
  const raw = message.content ?? "";
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed.file_name || parsed.name || message.fileName || "";
    } catch {
      return message.fileName || "";
    }
  }
  return message.fileName || message.name || "";
}

function normalizeFeishuEvent(payload = {}) {
  const event = payload.event || payload;
  const message = event.message || payload.message || {};
  const sender = event.sender || payload.sender || {};
  const chatId = message.chat_id || event.chat_id || payload.chatId || payload.chat_id || "";
  const chatName = message.chat_name || event.chat_name || payload.chatName || payload.chat_name || "";
  const messageType = message.message_type || payload.messageType || payload.message_type || "text";
  return {
    eventId: payload.header?.event_id || payload.event_id || event.event_id || `event-${Date.now()}`,
    messageId: message.message_id || message.messageId || payload.messageId || payload.message_id || "",
    chatId,
    chatName,
    senderId: sender.sender_id?.open_id || sender.sender_id?.user_id || sender.open_id || payload.senderId || "",
    senderName: sender.sender_name || sender.name || payload.senderName || "",
    messageType,
    text: normalizeFeishuTextContent(message),
    fileName: normalizeFeishuFileName(message),
    fileKey: message.file_key || message.fileKey || payload.fileKey || ""
  };
}

function findProjectFromText(db, text = "") {
  const normalized = String(text || "").toLowerCase();
  return (db.projects || []).find((project) => {
    const keys = [project.name, project.client, project.brand].filter(Boolean).map((item) => String(item).toLowerCase());
    return keys.some((key) => key && normalized.includes(key));
  }) || null;
}

function feishuBindingFor(db, chatId) {
  return (db.feishuProjectBindings || []).find((item) => item.chatId === chatId) || null;
}

function findFeishuSenderUser(db, event) {
  const senderText = `${event.senderId || ""} ${event.senderName || ""}`.toLowerCase();
  return (db.users || []).find((user) => {
    const fields = [user.feishuOpenId, user.feishuUserId, user.feishuName, user.name, user.email]
      .filter(Boolean)
      .map((item) => String(item).toLowerCase());
    return fields.some((field) => field && senderText.includes(field));
  }) || null;
}

function inferFeishuUploadType(event = {}, text = "") {
  const sample = `${event.fileName || ""} ${text || ""}`.toLowerCase();
  if (/核销|verification/.test(sample)) return "verification-sheet";
  if (/报价|quote/.test(sample)) return "quote-sheet";
  if (/成本|支出|费用|结算|cost/.test(sample)) return "cost-sheet";
  if (/合同|contract/.test(sample)) return "create-project";
  return "file-reference";
}

export async function getFeishuTenantAccessToken(settings = {}) {
  if (settings.mockTenantAccessToken) return settings.mockTenantAccessToken;
  if (settings.tenantAccessToken) return settings.tenantAccessToken;
  const appId = settings.appId || settings.app_id;
  const appSecret = settings.appSecret || settings.app_secret;
  if (!appId || !appSecret) throw new Error("飞书 App ID / App Secret 未配置，无法下载文件");
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：${payload.msg || res.status}`);
  }
  return payload.tenant_access_token;
}

async function downloadFeishuMessageFile(settings = {}, event = {}) {
  if (settings.mockFileBase64) {
    return {
      name: settings.mockFileName || event.fileName || "飞书模拟文件.csv",
      type: settings.mockFileType || "text/csv",
      base64: settings.mockFileBase64,
      size: Buffer.byteLength(settings.mockFileBase64, "base64"),
      source: "feishu-mock"
    };
  }
  if (!event.messageId || !event.fileKey) throw new Error("飞书消息缺少 message_id 或 file_key，无法下载文件");
  const token = await getFeishuTenantAccessToken(settings);
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(event.messageId)}/resources/${encodeURIComponent(event.fileKey)}?type=file`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`下载飞书文件失败：${res.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return {
    name: event.fileName || `飞书文件-${event.fileKey}`,
    type: res.headers.get("content-type") || "application/octet-stream",
    base64: buffer.toString("base64"),
    size: buffer.length,
    source: "feishu"
  };
}

function requireFeishuDep(deps, key) {
  if (typeof deps[key] !== "function") throw new Error(`飞书服务缺少依赖：${key}`);
  return deps[key];
}

async function applyFeishuDownloadedFile(db, project, file, uploadType, sender, event, deps = {}) {
  const payloadFile = {
    ...file,
    uploadedBy: sender.id,
    uploadedByName: sender.name || "飞书成员",
    uploadedAt: new Date().toISOString(),
    source: "feishu",
    feishuFileKey: event.fileKey,
    feishuMessageId: event.messageId
  };
  const actor = {
    id: sender.id || "feishu-bot",
    name: sender.name || "飞书成员",
    role: sender.role || "member"
  };
  if (uploadType === "cost-sheet") {
    return await requireFeishuDep(deps, "uploadProjectCostSheet")(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "quote-sheet") {
    return await requireFeishuDep(deps, "uploadProjectQuoteSheet")(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "verification-sheet") {
    return await requireFeishuDep(deps, "uploadProjectVerificationSheet")(db, { id: project.id, files: [payloadFile] }, actor);
  }
  if (uploadType === "create-project") {
    return await requireFeishuDep(deps, "createProject")(db, { "项目名称": project?.name || file.name.replace(/\.[^.]+$/, "") }, [payloadFile], actor);
  }
  if (project?.id) {
    project.files = [...(project.files || []), payloadFile];
    project.updatedAt = new Date().toISOString();
    db.files = db.files || [];
    db.files.unshift({
      files: [payloadFile],
      projectId: project.id,
      projectName: project.name,
      user: actor.name,
      at: payloadFile.uploadedAt,
      source: "feishu"
    });
    db.auditLogs.unshift({
      type: "upload",
      target: project.name,
      action: "feishu-file-reference",
      user: actor.name,
      meta: { fileName: payloadFile.name, source: "feishu", uploadType },
      at: payloadFile.uploadedAt
    });
    return { project, file: payloadFile };
  }
  return null;
}

function createFeishuPendingFile(db, { event, project, file, uploadType, sender, note = "" }) {
  const at = new Date().toISOString();
  const preview = {
    fileName: file.name,
    size: file.size || 0,
    type: file.type || "",
    uploadType,
    projectName: project?.name || "",
    canConfirm: Boolean(project?.id && file.base64),
    summary: file.text
      ? String(file.text).slice(0, 300)
      : `飞书文件已下载，等待人工确认后写入「${project?.name || "待匹配项目"}」。`
  };
  const record = {
    id: nextFeishuPendingFileId(),
    eventId: event.eventId,
    chatId: event.chatId,
    chatName: event.chatName,
    senderId: event.senderId,
    senderName: sender.name || event.senderName || "飞书成员",
    projectId: project?.id || "",
    projectName: project?.name || "",
    uploadType,
    file,
    preview,
    status: "待确认",
    note,
    createdAt: at,
    handledAt: "",
    handledBy: ""
  };
  db.feishuPendingFiles = db.feishuPendingFiles || [];
  db.feishuPendingFiles.unshift(record);
  return record;
}

export function feishuProjectBindings(db) {
  return (db.feishuProjectBindings || []).map((item) => ({
    ...item,
    projectExists: (db.projects || []).some((project) => project.id === item.projectId)
  }));
}

export function feishuPendingFiles(db) {
  return db.feishuPendingFiles || [];
}

export function saveFeishuProjectBinding(db, body, user) {
  const chatId = String(body.chatId || body.chat_id || "").trim();
  const project = (db.projects || []).find((item) => item.id === body.projectId || item.name === body.projectName);
  if (!chatId) throw new Error("请填写飞书群 Chat ID");
  if (!project) throw new Error("请选择要绑定的项目");
  const at = new Date().toISOString();
  db.feishuProjectBindings = db.feishuProjectBindings || [];
  const existing = db.feishuProjectBindings.find((item) => item.chatId === chatId);
  const record = {
    chatId,
    chatName: String(body.chatName || body.chat_name || existing?.chatName || "").trim(),
    projectId: project.id,
    projectName: project.name,
    boundBy: user.id,
    boundAt: existing?.boundAt || at,
    updatedAt: at
  };
  if (existing) Object.assign(existing, record);
  else db.feishuProjectBindings.unshift(record);
  db.auditLogs.unshift({
    type: "feishu",
    target: record.chatName || record.chatId,
    action: "bind-project",
    user: user.name,
    meta: { projectId: project.id, projectName: project.name },
    at
  });
  return record;
}

export async function handleFeishuEvent(db, payload, user = { id: "system", name: "飞书机器人", role: "system" }, deps = {}) {
  if (payload?.challenge) return { challenge: payload.challenge };
  const token = db.settings?.feishu?.verificationToken;
  if (token && payload?.token && payload.token !== token) throw new Error("飞书 Verification Token 不匹配");
  const event = normalizeFeishuEvent(payload);
  const binding = feishuBindingFor(db, event.chatId);
  const textProject = findProjectFromText(db, `${event.text} ${event.fileName}`);
  const project = textProject || (binding ? (db.projects || []).find((item) => item.id === binding.projectId) : null);
  const sender = findFeishuSenderUser(db, event) || user;
  const text = event.text || "";
  const asksNewProject = /新谈|新项目|登记.*项目|创建项目|立项/.test(text);
  const fileLike = event.messageType !== "text" || event.fileName || event.fileKey;
  const uploadType = inferFeishuUploadType(event, text);
  const at = new Date().toISOString();
  let action = "message";
  let status = "已记录";
  let reply = "已收到，我会把这条消息沉淀到 OA。";

  if (asksNewProject && !project) {
    const projectName = event.fileName
      ? event.fileName.replace(/\.[^.]+$/, "")
      : `飞书新项目-${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    const draft = {
      id: `P-${Date.now()}`,
      name: projectName,
      client: "",
      owner: sender.name || user.name || "飞书机器人",
      contract: 0,
      costBudget: 0,
      costUsed: 0,
      paid: 0,
      receivable: 0,
      status: "待补合同/报价",
      risk: "低",
      aiSummary: "飞书机器人已接收销售的新项目线索。请在 OA 上传/补齐合同与报价表后确认入库。",
      nextMilestone: "等待销售补齐合同/报价表",
      paymentDue: "",
      margin: 0,
      tasks: [],
      costs: [],
      extractedFields: { source: "feishu-bot", feishuChatId: event.chatId, feishuEventId: event.eventId },
      createdAt: at,
      createdBy: sender.id || user.id,
      files: []
    };
    draft.alerts = requireFeishuDep(deps, "projectRiskAlerts")(draft);
    db.projects.unshift(draft);
    action = "create-project-draft";
    status = "已创建项目草稿";
    reply = `已创建「${draft.name}」项目草稿。请补齐合同/报价表，AI 会继续解析项目金额、客户和回款节点。`;
  } else if (project && fileLike) {
    const fileRecord = {
      name: event.fileName || `飞书文件-${event.eventId}`,
      size: 0,
      type: event.messageType,
      category: "feishu-intake",
      storageUrl: event.fileKey ? `feishu://${event.fileKey}` : "",
      uploadedAt: at,
      uploadedBy: sender.id || user.id,
      uploadedByName: sender.name || event.senderName || "飞书成员",
      source: "feishu"
    };
    try {
      const downloaded = await downloadFeishuMessageFile(db.settings?.feishu || {}, event);
      const pending = createFeishuPendingFile(db, { event, project, file: downloaded, uploadType, sender });
      action = `download-and-pending-${uploadType}`;
      status = "待人工确认";
      reply = `已下载飞书文件「${downloaded.name}」，已进入待确认队列。确认后才会写入「${project.name}」。`;
      fileRecord.pendingFileId = pending.id;
    } catch (error) {
      fileRecord.downloadStatus = `下载/解析待处理：${error.message}`;
      project.files = [...(project.files || []), fileRecord];
      db.files.unshift({ files: [fileRecord], projectId: project.id, projectName: project.name, user: fileRecord.uploadedByName, at });
      action = "record-file-reference";
      status = "已记录文件引用";
      reply = `已把飞书文件「${fileRecord.name}」登记到「${project.name}」，但暂未完成下载解析：${error.message}`;
    }
  } else if (project) {
    db.comments.unshift({
      project: project.name,
      body: `飞书群消息：${text || "无文本内容"}`,
      mentions: "",
      user: sender.name || event.senderName || "飞书成员",
      at
    });
    action = "record-comment";
    status = "已记录到项目动态";
    reply = `已把消息记录到「${project.name}」项目动态。`;
  } else {
    status = "待匹配项目";
    reply = "已收到，但还没匹配到项目。请在后台把飞书群 Chat ID 绑定项目，或在消息里写清项目/客户名称。";
  }

  const record = {
    id: nextFeishuEventId(),
    ...event,
    projectId: project?.id || "",
    projectName: project?.name || "",
    action,
    status,
    reply,
    createdAt: at
  };
  db.feishuEvents = db.feishuEvents || [];
  db.feishuEvents.unshift(record);
  db.auditLogs.unshift({
    type: "feishu",
    target: project?.name || event.chatName || event.chatId || "飞书事件",
    action,
    user: sender.name || event.senderName || "飞书机器人",
    meta: { eventId: record.id, chatId: event.chatId, status },
    at
  });
  return { event: record, reply };
}

export async function handleFeishuPendingFile(db, body, user, deps = {}) {
  const id = String(body?.id || "").trim();
  const action = body?.action === "reject" ? "reject" : "confirm";
  const pending = (db.feishuPendingFiles || []).find((item) => item.id === id);
  if (!pending) throw new Error("飞书待确认文件不存在");
  if (pending.status !== "待确认") throw new Error(`该文件已处理：${pending.status}`);
  const at = new Date().toISOString();
  if (action === "reject") {
    pending.status = "已驳回";
    pending.note = String(body.note || "人工驳回").trim();
    pending.handledAt = at;
    pending.handledBy = user.id;
    db.auditLogs.unshift({
      type: "feishu",
      target: pending.projectName || pending.file?.name || pending.id,
      action: "reject-pending-file",
      user: user.name,
      meta: { pendingFileId: pending.id, uploadType: pending.uploadType },
      at
    });
    requireFeishuDep(deps, "syncFeishuPendingNotificationAfterAction")(db, pending, user, "reject");
    return pending;
  }

  const project = (db.projects || []).find((item) => item.id === pending.projectId);
  if (!project && pending.uploadType !== "create-project") throw new Error("待确认文件未匹配到项目，无法确认入库");
  await applyFeishuDownloadedFile(db, project, pending.file, pending.uploadType, user, {
    eventId: pending.eventId,
    fileKey: pending.file?.feishuFileKey || "",
    messageId: pending.file?.feishuMessageId || ""
  }, deps);
  pending.status = "已确认入库";
  pending.note = String(body.note || "人工确认入库").trim();
  pending.handledAt = at;
  pending.handledBy = user.id;
  db.auditLogs.unshift({
    type: "feishu",
    target: pending.projectName || pending.file?.name || pending.id,
    action: "confirm-pending-file",
    user: user.name,
    meta: { pendingFileId: pending.id, uploadType: pending.uploadType },
    at
  });
  requireFeishuDep(deps, "syncFeishuPendingNotificationAfterAction")(db, pending, user, "confirm");
  return pending;
}
