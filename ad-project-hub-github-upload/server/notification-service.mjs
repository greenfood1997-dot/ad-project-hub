import { parseMoney } from "./service-utils.mjs";

// System notification scanning, state changes, and external delivery helpers.
function nextNotificationId(seed = "") {
  return `notice-${Date.now().toString(36)}-${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

function notificationKey(item = {}) {
  return [item.type, item.projectId || item.projectName || "", item.sourceId || ""].join("::");
}

function projectHasAssignedPm(project = {}) {
  const pm = String(project.pm || project.extractedFields?.pm || "").trim();
  return Boolean(pm && !/待分派|待确认|未分配|暂无/.test(pm));
}

export function notificationRecipientsForRole(role) {
  const map = {
    management: ["shareholder", "admin", "director"],
    finance: ["shareholder", "admin", "finance"],
    pm: ["shareholder", "admin", "director", "pm"],
    sales: ["shareholder", "admin", "director", "sales"]
  };
  return map[role] || ["shareholder", "admin"];
}

export function projectTimeHealth(project = {}, now = new Date()) {
  const start = new Date(project.startDate || project.serviceStart || project.createdAt || now);
  const end = new Date(project.endDate || project.serviceEnd || project.deadline || project.deliveryDate || now.getTime() + 30 * 86400000);
  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, now - start);
  const timeProgress = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const completion = Math.max(0, Math.min(100, Math.round(Number(project.progress || 0))));
  const diff = completion - timeProgress;
  return { completion, timeProgress, diff };
}

export function projectCostPressure(project = {}) {
  const breakdown = project.extractedFields?.profitBreakdown || {};
  const executionBudget = parseMoney(project.extractedFields?.executionBudget)
    || parseMoney(breakdown.executionBudget)
    || (project.extractedFields?.profitBreakdown ? 0 : parseMoney(project.costBudget));
  const costUsed = parseMoney(project.costUsed)
    || parseMoney(breakdown.executionCost)
    || Number((breakdown.costs || []).reduce?.((sum, item) => sum + Number(item?.[1] || item?.amount || 0), 0) || 0);
  const rate = executionBudget ? costUsed / executionBudget : 0;
  return {
    executionBudget,
    costUsed,
    rate,
    percent: Math.round(rate * 100)
  };
}

function cashRunwayForNotifications(settings = {}) {
  const finance = settings.companyFinance || {};
  const currentCash = Number(finance.currentCash || 0);
  const monthlyFixedCost = [
    finance.monthlyLaborCost,
    finance.monthlyRent,
    finance.monthlyLoan,
    finance.monthlyInterest,
    finance.monthlyOtherCost
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  if (!monthlyFixedCost) return null;
  const runwayMonths = currentCash / monthlyFixedCost;
  const safetyReserve = monthlyFixedCost * 6;
  const gap = Math.max(safetyReserve - currentCash, 0);
  return { currentCash, monthlyFixedCost, runwayMonths, safetyReserve, gap };
}

export function upsertSystemNotification(db, draft) {
  db.systemNotifications = db.systemNotifications || [];
  const key = draft.key || notificationKey(draft);
  const at = new Date().toISOString();
  const existing = db.systemNotifications.find((item) => item.key === key && !["已处理", "已忽略"].includes(item.status));
  if (existing) {
    Object.assign(existing, {
      ...draft,
      key,
      status: existing.status || "待处理",
      createdAt: existing.createdAt || at,
      updatedAt: at
    });
    return existing;
  }
  const record = {
    id: nextNotificationId(key),
    key,
    type: draft.type || "system",
    title: draft.title || "系统提醒",
    text: draft.text || "",
    severity: draft.severity || "中",
    role: draft.role || "management",
    recipients: draft.recipients || notificationRecipientsForRole(draft.role || "management"),
    projectId: draft.projectId || "",
    projectName: draft.projectName || "",
    source: draft.source || "scanner",
    sourceId: draft.sourceId || "",
    actionLabel: draft.actionLabel || "查看",
    actionView: draft.actionView || "",
    status: "待处理",
    createdAt: at,
    updatedAt: at
  };
  db.systemNotifications.unshift(record);
  return record;
}

export function scanSystemNotifications(db, user = { id: "system", name: "系统扫描" }, deps = {}) {
  db.systemNotifications = db.systemNotifications || [];
  const normalizeProjectTask = deps.normalizeProjectTask || ((task) => task);
  const taskDueInfo = deps.taskDueInfo || (() => ({ active: false }));
  const pendingSupplierRowsForProject = deps.pendingSupplierRowsForProject || (() => []);
  const currentApprovalStep = deps.currentApprovalStep || (() => null);
  const now = new Date();
  const notifications = [];

  for (const project of db.projects || []) {
    const quoteRules = project.extractedFields?.revenueRecognition?.quoteRules || [];
    const createdAt = project.createdAt ? new Date(project.createdAt) : now;
    const hoursSinceCreated = Math.max(0, (now - createdAt) / 36e5);
    if (!projectHasAssignedPm(project) && (quoteRules.length || /待补|草稿|AI解析中|筹备/.test(String(project.status || "")) || hoursSinceCreated >= 1)) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-assignment",
        title: "项目待分派 PM",
        text: `「${project.name}」还没有明确 PM。建议总监尽快分派，避免合同/报价已进来但执行没人承接。`,
        severity: hoursSinceCreated >= 24 ? "高" : "中",
        role: "management",
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "去分派",
        actionView: "admin:assignments"
      }));
    }

    const status = String(project.status || "");
    const activeProject = !/已完成|完成|结案|已结案|取消/.test(status);
    const health = projectTimeHealth(project, now);
    if (activeProject) {
      for (const task of (project.tasks || []).map(normalizeProjectTask)) {
        const due = taskDueInfo(task, now);
        if (!due.active) continue;
        notifications.push(upsertSystemNotification(db, {
          type: "project-task-due",
          title: due.tone === "overdue" ? "项目任务已逾期" : due.tone === "today" ? "项目任务今天截止" : "项目任务即将截止",
          text: `「${project.name}」任务「${task.title}」${due.label}，负责人 ${task.owner || project.pm || project.owner || "待确认"}，当前进度 ${task.progress || 0}%。请及时更新进度或标记完成。`,
          severity: due.tone === "overdue" ? "高" : "中",
          role: "pm",
          recipients: notificationRecipientsForRole("pm"),
          projectId: project.id,
          projectName: project.name,
          source: "task-scanner",
          sourceId: task.id,
          actionLabel: "看任务",
          actionView: "project-detail"
        }));
      }
    }

    if (activeProject && health.timeProgress >= 20 && health.diff <= -15) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-progress-lag",
        title: "项目进度滞后",
        text: `「${project.name}」完成度 ${health.completion}%，时间进度 ${health.timeProgress}%，已落后 ${Math.abs(health.diff)} 个百分点。建议 PM 拆出本周必须完成的交付节点。`,
        severity: health.diff <= -30 ? "高" : "中",
        role: "pm",
        recipients: notificationRecipientsForRole("pm"),
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "看项目",
        actionView: "project-detail"
      }));
    }

    const costPressure = projectCostPressure(project);
    if (activeProject && costPressure.executionBudget && costPressure.rate >= 0.8) {
      const overBudget = costPressure.rate >= 1;
      notifications.push(upsertSystemNotification(db, {
        type: overBudget ? "project-cost-overrun" : "project-cost-pressure",
        title: overBudget ? "项目成本已超预算" : "项目成本接近预算",
        text: `「${project.name}」执行成本 ${costPressure.costUsed.toLocaleString("zh-CN")} 元，预算 ${costPressure.executionBudget.toLocaleString("zh-CN")} 元，已使用 ${costPressure.percent}%。${overBudget ? "建议暂停非必要支出并做成本复盘。" : "建议 PM 先确认后续支出是否必须发生。"}`,
        severity: overBudget ? "高" : "中",
        role: "pm",
        recipients: Array.from(new Set([...notificationRecipientsForRole("pm"), "finance"])),
        projectId: project.id,
        projectName: project.name,
        source: "cost-scanner",
        sourceId: project.id,
        actionLabel: overBudget ? "看成本复盘" : "看成本压力",
        actionView: "project-detail"
      }));
    }

    const contract = Number(project.contract || 0);
    const receivable = Number(project.receivable || Math.max(contract - Number(project.paid || 0), 0));
    const receivableRate = contract ? Math.round((receivable / contract) * 100) : 0;
    if (activeProject && receivable > 0 && (receivableRate >= 50 || /逾期|本月底|月底|付款|回款/.test(String(project.paymentDue || "")))) {
      notifications.push(upsertSystemNotification(db, {
        type: "project-receivable-risk",
        title: "项目回款需要跟进",
        text: `「${project.name}」待回款 ${receivable.toLocaleString("zh-CN")} 元，占合同 ${receivableRate}%。建议销售/PM确认「${project.paymentDue || "下一笔回款节点"}」。`,
        severity: receivableRate >= 80 ? "高" : "中",
        role: "sales",
        recipients: notificationRecipientsForRole("sales"),
        projectId: project.id,
        projectName: project.name,
        source: "project-scanner",
        sourceId: project.id,
        actionLabel: "看回款",
        actionView: "project-detail"
      }));
    }

    const targetText = monthlyVerificationTargetText(project, now, deps);
    if (activeProject && targetText) {
      notifications.push(upsertSystemNotification(db, {
        type: "verification-sheet-missing",
        title: "本月核销表待上传",
        text: `「${project.name}」本月还没有核销记录。AI 已从报价表识别月度目标：${targetText}。请 PM 或执行同事完成后上传核销表。`,
        severity: "中",
        role: "pm",
        recipients: notificationRecipientsForRole("pm"),
        projectId: project.id,
        projectName: project.name,
        source: "verification-scanner",
        sourceId: project.id,
        actionLabel: "上传核销表",
        actionView: "project-files"
      }));
    }

    const pendingSupplierRows = pendingSupplierRowsForProject(db, project);
    const pendingSupplierAmount = pendingSupplierRows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (activeProject && pendingSupplierRows.length) {
      const topSuppliers = pendingSupplierRows
        .slice()
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        .slice(0, 3)
        .map((item) => `${item.supplier || "未命名供应商"} ${Number(item.amount || 0).toLocaleString("zh-CN")}元`)
        .join("、");
      notifications.push(upsertSystemNotification(db, {
        type: "supplier-settlement-pending",
        title: "供应商待结算",
        text: `「${project.name}」还有 ${pendingSupplierRows.length} 条供应商待结算，合计 ${pendingSupplierAmount.toLocaleString("zh-CN")} 元。${topSuppliers ? `主要为：${topSuppliers}。` : ""}请 PM/财务确认是否发起供应商付款或标记已付款。`,
        severity: pendingSupplierAmount >= 20000 || pendingSupplierRows.length >= 3 ? "高" : "中",
        role: "finance",
        recipients: Array.from(new Set([...notificationRecipientsForRole("finance"), ...notificationRecipientsForRole("pm")])),
        projectId: project.id,
        projectName: project.name,
        source: "supplier-scanner",
        sourceId: project.id,
        actionLabel: "看供应商结算",
        actionView: "project-detail"
      }));
    }
  }

  const runway = cashRunwayForNotifications(db.settings || {});
  if (runway && runway.runwayMonths < 6) {
    notifications.push(upsertSystemNotification(db, {
      type: "company-cash-runway",
      title: runway.runwayMonths < 3 ? "危险！你快倒闭啦！需要收缩现金流" : "公司现金流低于 6 个月安全线",
      text: `当前现金可撑 ${runway.runwayMonths.toFixed(1)} 个月，月固定支出 ${runway.monthlyFixedCost.toLocaleString("zh-CN")} 元，6个月安全线缺口 ${runway.gap.toLocaleString("zh-CN")} 元。`,
      severity: runway.runwayMonths < 3 ? "高" : "中",
      role: "finance",
      recipients: notificationRecipientsForRole("finance"),
      source: "finance-scanner",
      sourceId: "company-cash-runway",
      actionLabel: "看现金流",
      actionView: "management:cash"
    }));
  }

  for (const item of db.feishuPendingFiles || []) {
    if (item.status !== "待确认") continue;
    const createdAt = item.createdAt ? new Date(item.createdAt) : now;
    const hours = Math.max(0, (now - createdAt) / 36e5);
    notifications.push(upsertSystemNotification(db, {
      type: "feishu-pending-file",
      title: "飞书文件待确认",
      text: `「${item.file?.name || item.preview?.fileName || "飞书文件"}」来自飞书，等待确认后才会写入「${item.projectName || "待匹配项目"}」。`,
      severity: hours >= 24 ? "高" : "中",
      role: "pm",
      recipients: notificationRecipientsForRole("pm"),
      projectId: item.projectId || "",
      projectName: item.projectName || "",
      source: "feishu",
      sourceId: item.id,
      actionLabel: "处理文件",
      actionView: "project-files"
    }));
  }

  for (const approval of db.approvals || []) {
    if (!isPendingApprovalForScan(approval, { currentApprovalStep })) continue;
    const createdAt = approval.createdAt ? new Date(approval.createdAt) : now;
    const hours = Math.max(0, (now - createdAt) / 36e5);
    if (hours < 24) continue;
    const financeRole = approval.currentRole === "finance" || /财务/.test(String(approval.currentRole || ""));
    const ownerRole = approval.currentRole === "owner" || /老板/.test(String(approval.status || ""));
    notifications.push(upsertSystemNotification(db, {
      type: "approval-stale",
      title: "审批等待超过 24 小时",
      text: `「${approval.projectName || "项目"}」的${approval.typeLabel || approval.type || "审批"} ${approval.amount || 0} 元已等待较久，请${financeRole ? "财务" : ownerRole ? "老板线" : "负责人"}及时处理。`,
      severity: hours >= 48 ? "高" : "中",
      role: financeRole ? "finance" : ownerRole ? "management" : "management",
      recipients: financeRole ? notificationRecipientsForRole("finance") : approval.currentRole === "pm" ? notificationRecipientsForRole("pm") : notificationRecipientsForRole("management"),
      projectId: approval.projectId || "",
      projectName: approval.projectName || "",
      source: "approval",
      sourceId: approval.id,
      actionLabel: "看审批",
      actionView: "approvals"
    }));
  }

  db.systemNotifications = db.systemNotifications.slice(0, 200);
  db.auditLogs.unshift({
    type: "notification",
    target: "system",
    action: "scan",
    user: user.name || "系统扫描",
    meta: { active: db.systemNotifications.filter((item) => item.status === "待处理").length, generated: notifications.length },
    at: new Date().toISOString()
  });
  return db.systemNotifications;
}

function isPendingApprovalForScan(approval = {}, deps = {}) {
  const status = String(approval.status || "");
  if (!approval.id || ["已完成", "已驳回", "已撤回"].includes(status)) return false;
  if (status.includes("待") || status.includes("审批中") || status.includes("处理中")) return true;
  return Boolean(approval.currentRole && deps.currentApprovalStep?.(approval));
}

function monthlyVerificationTargetText(project = {}, now = new Date(), deps = {}) {
  const revenue = project.extractedFields?.revenueRecognition || {};
  const quoteRules = Array.isArray(revenue.quoteRules) ? revenue.quoteRules : [];
  if (!quoteRules.length) return "";
  const targetText = deps.monthlyTargetSummaryFromRules?.(quoteRules) || "";
  if (!targetText) return "";
  const currentMonth = deps.monthKey?.(now) || now.toISOString().slice(0, 7);
  const hasVerification = (revenue.verificationRecords || []).some((record) => record.month === currentMonth);
  return hasVerification ? "" : targetText;
}

export function updateSystemNotification(db, body, user) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const at = new Date().toISOString();
  const action = body?.action === "ignore" ? "ignore" : body?.action === "reopen" ? "reopen" : "resolve";
  if (action === "reopen") {
    item.status = "待处理";
    item.reopenedAt = at;
    item.reopenedBy = user.id;
    item.reopenedByName = user.name;
    item.reopenReason = String(body.note || body.reason || "").trim();
  } else {
    item.status = action === "ignore" ? "已忽略" : "已处理";
    item.handledAt = at;
    item.handledBy = user.id;
    item.handledByName = user.name;
    item.note = String(body.note || "").trim();
  }
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "notification",
    target: item.title,
    action,
    user: user.name,
    meta: { notificationId: item.id, source: item.source, sourceId: item.sourceId },
    at
  });
  return item;
}

function feishuMessageTextForNotification(item = {}) {
  const lines = [
    `【${item.title || "OA 待办"}】`,
    item.projectName ? `项目：${item.projectName}` : "",
    item.severity ? `优先级：${item.severity}` : "",
    item.text || "",
    item.actionLabel ? `建议动作：${item.actionLabel}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function candidateUsersForNotification(db, item = {}) {
  const roles = Array.isArray(item.recipients) && item.recipients.length ? item.recipients : notificationRecipientsForRole(item.role);
  const activeUsers = (db.users || []).filter((user) => user.status !== "disabled");
  const project = (db.projects || []).find((row) => row.id === item.projectId || row.name === item.projectName);
  const taskOwner = item.type === "project-task-due"
    ? (project?.tasks || []).find((task) => String(task.id || "") === String(item.sourceId || ""))?.owner
    : "";
  const projectNames = new Set([project?.pm, project?.owner, project?.sales, taskOwner, ...(Array.isArray(project?.members) ? project.members : [])].filter(Boolean).map((name) => String(name).toLowerCase()));
  let users = activeUsers.filter((user) => roles.includes(user.role));
  if (item.projectId && projectNames.size) {
    const projectUsers = activeUsers.filter((user) => projectNames.has(String(user.name || "").toLowerCase()) || projectNames.has(String(user.email || "").toLowerCase()));
    users = [...projectUsers, ...users];
  }
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

async function sendFeishuTextMessage(settings = {}, openId, text, deps = {}) {
  if (!openId) throw new Error("缺少飞书 open_id");
  const mockSend = settings.mockSend === true || settings.mockSend === "true" || settings.mockNotificationSend === true || settings.mockNotificationSend === "true";
  if (mockSend) {
    return { mocked: true, receiveId: openId, messageId: `mock-${Date.now()}` };
  }
  const token = await deps.getFeishuTenantAccessToken(settings);
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text })
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) {
    throw new Error(`飞书私聊发送失败：${payload.msg || res.status}`);
  }
  return { messageId: payload.data?.message_id || "", receiveId: openId, raw: payload.data || {} };
}

export async function sendSystemNotificationToFeishu(db, body, user, deps = {}) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const settings = db.settings?.feishu || {};
  const recipients = candidateUsersForNotification(db, item)
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email || "",
      role: recipient.role,
      openId: recipient.feishuOpenId || recipient.feishuUserId || "",
      feishuName: recipient.feishuName || recipient.name
    }));
  const targets = recipients.filter((recipient) => recipient.openId);
  const missingRecipients = recipients.filter((recipient) => !recipient.openId)
    .map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      role: recipient.role
    }));
  if (!targets.length) {
    const delivery = {
      sentAt: new Date().toISOString(),
      sentBy: user.id,
      sentByName: user.name,
      text: "",
      results: [],
      missingRecipients,
      okCount: 0,
      total: recipients.length,
      missingCount: missingRecipients.length,
      blocked: true,
      error: "没有找到已绑定飞书 Open ID 的收件人，请先在成员管理里填写飞书 Open ID。"
    };
    item.feishuDelivery = delivery;
    item.updatedAt = delivery.sentAt;
    throw Object.assign(new Error(delivery.error), { data: delivery });
  }
  const text = String(body.text || feishuMessageTextForNotification(item)).trim();
  const at = new Date().toISOString();
  const results = [];
  for (const target of targets) {
    try {
      const result = await sendFeishuTextMessage(settings, target.openId, text, deps);
      results.push({ ...target, ok: true, ...result });
    } catch (error) {
      results.push({ ...target, ok: false, error: error.message });
    }
  }
  item.feishuDelivery = {
    sentAt: at,
    sentBy: user.id,
    sentByName: user.name,
    text,
    results,
    missingRecipients,
    okCount: results.filter((row) => row.ok).length,
    failCount: results.filter((row) => !row.ok).length,
    missingCount: missingRecipients.length,
    total: recipients.length,
    source: body.deliverySource || "manual"
  };
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "feishu",
    target: item.title,
    action: "send-notification",
    user: user.name,
    meta: { notificationId: item.id, total: results.length, ok: results.filter((row) => row.ok).length, source: body.deliverySource || "manual" },
    at
  });
  return item.feishuDelivery;
}

async function sendWechatWebhookMessage(settings = {}, text) {
  const webhookUrl = String(settings.webhookUrl || settings.webhook || "").trim();
  if (!webhookUrl) throw new Error("企业微信 Webhook 未配置，请先在产品设置里填写群机器人 Webhook。");
  const mockSend = settings.mockSend === true || settings.mockSend === "true" || settings.mockNotificationSend === true || settings.mockNotificationSend === "true";
  if (mockSend) {
    return { mocked: true, webhookConfigured: true, messageId: `mock-wechat-${Date.now()}` };
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: text }
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || Number(payload.errcode || 0) !== 0) {
    throw new Error(`企业微信发送失败：${payload.errmsg || res.status}`);
  }
  return { webhookConfigured: true, raw: payload };
}

export async function sendSystemNotificationToWechat(db, body, user) {
  const id = String(body?.id || "").trim();
  const item = (db.systemNotifications || []).find((notice) => notice.id === id);
  if (!item) throw new Error("系统通知不存在");
  const settings = db.settings?.wechat || {};
  const text = String(body.text || feishuMessageTextForNotification(item)).trim();
  const at = new Date().toISOString();
  const result = await sendWechatWebhookMessage(settings, text);
  item.wechatDelivery = {
    sentAt: at,
    sentBy: user.id,
    sentByName: user.name,
    text,
    ok: true,
    ...result,
    source: body.deliverySource || "manual"
  };
  item.updatedAt = at;
  db.auditLogs.unshift({
    type: "wechat",
    target: item.title,
    action: "send-notification",
    user: user.name,
    meta: { notificationId: item.id, ok: true, mocked: Boolean(result.mocked), source: body.deliverySource || "manual" },
    at
  });
  return item.wechatDelivery;
}

function automaticChannels(settings = {}) {
  const raw = settings.autoNotifyChannels;
  if (Array.isArray(raw)) return raw.filter((item) => ["feishu", "wechat"].includes(item));
  return String(raw || "").split(",").map((item) => item.trim()).filter((item) => ["feishu", "wechat"].includes(item));
}

export async function dispatchNewHighSeverityNotifications(db, notices = [], user = { id: "system-scheduler", name: "后台定时巡检" }, deps = {}) {
  const settings = db.settings?.alertSettings || {};
  const enabled = settings.autoNotifyEnabled === true || settings.autoNotifyEnabled === "true";
  const channels = automaticChannels(settings);
  const highRiskNotices = (notices || []).filter((item) => item?.status === "待处理" && item.severity === "高");
  const summary = { enabled, channels, attempted: 0, sent: 0, failed: 0, skipped: highRiskNotices.length };
  if (!enabled || !channels.length || !highRiskNotices.length) return summary;

  summary.skipped = 0;
  for (const item of highRiskNotices) {
    const result = { sentAt: new Date().toISOString(), channels: {} };
    for (const channel of channels) {
      summary.attempted += 1;
      try {
        const delivery = channel === "feishu"
          ? await sendSystemNotificationToFeishu(db, { id: item.id, deliverySource: "automatic" }, user, deps)
          : await sendSystemNotificationToWechat(db, { id: item.id, deliverySource: "automatic" }, user);
        result.channels[channel] = { ok: true, delivery };
        summary.sent += 1;
      } catch (error) {
        result.channels[channel] = { ok: false, error: error.message, data: error.data || null };
        summary.failed += 1;
      }
    }
    item.autoDelivery = result;
    item.updatedAt = result.sentAt;
  }
  return summary;
}
