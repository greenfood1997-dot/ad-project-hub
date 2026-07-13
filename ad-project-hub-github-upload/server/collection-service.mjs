import { clientLibrary } from "./client-service.mjs";
import { parseMoney } from "./service-utils.mjs";

function nextNotificationId(seed = "") {
  return `notice-${Date.now().toString(36)}-${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

function notificationRecipientsForRole(role) {
  const map = {
    management: ["shareholder", "admin", "director"],
    finance: ["shareholder", "admin", "finance"],
    pm: ["shareholder", "admin", "director", "pm"],
    sales: ["shareholder", "admin", "director", "sales"]
  };
  return map[role] || ["shareholder", "admin"];
}

function nextCollectionScriptId() {
  return `collection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function closeCollectionFollowUpNotification(db, record = {}, user = {}, note = "") {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  for (const item of db.systemNotifications) {
    if (item.type !== "collection-follow-up" || item.sourceId !== record.id || item.status !== "待处理") continue;
    item.status = "已处理";
    item.handledAt = at;
    item.handledBy = user.id || "";
    item.handledByName = user.name || "";
    item.note = note || "催收跟进已处理。";
    item.updatedAt = at;
  }
}

function syncCollectionFollowUpNotification(db, record = {}, user = {}) {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  const hasFollowUp = !record.success && (record.nextFollowUpAt || record.nextAction);
  if (!hasFollowUp) {
    closeCollectionFollowUpNotification(db, record, user, record.success ? "催收已标记有效，系统关闭二次跟进。" : "催收未设置下一步，系统关闭二次跟进。");
    return;
  }
  const action = record.nextAction || "再次跟进客户付款";
  const dueText = record.nextFollowUpAt ? `，计划 ${record.nextFollowUpAt} 跟进` : "";
  const text = `「${record.projectName}」本次催收未推进付款${dueText}：${action}。待回款 ${Number(record.amount || 0).toLocaleString("zh-CN")} 元。`;
  const existing = db.systemNotifications.find((item) => item.type === "collection-follow-up" && item.sourceId === record.id);
  if (existing) {
    existing.status = "待处理";
    existing.title = "催收需要二次跟进";
    existing.text = text;
    existing.severity = record.nextFollowUpAt ? "中" : "低";
    existing.projectId = record.projectId || existing.projectId;
    existing.projectName = record.projectName || existing.projectName;
    existing.actionLabel = "继续催收";
    existing.actionView = "collections";
    existing.nextFollowUpAt = record.nextFollowUpAt || "";
    existing.nextAction = action;
    existing.updatedAt = at;
    return;
  }
  db.systemNotifications.unshift({
    id: nextNotificationId(`collection-follow-up-${record.id}`),
    key: `collection-follow-up::${record.id}`,
    type: "collection-follow-up",
    title: "催收需要二次跟进",
    text,
    severity: record.nextFollowUpAt ? "中" : "低",
    role: "sales",
    recipients: notificationRecipientsForRole("sales"),
    projectId: record.projectId || "",
    projectName: record.projectName || "",
    source: "collection",
    sourceId: record.id,
    actionLabel: "继续催收",
    actionView: "collections",
    nextFollowUpAt: record.nextFollowUpAt || "",
    nextAction: action,
    status: "待处理",
    createdAt: at,
    updatedAt: at
  });
}

function collectionStats(db, salesName = "") {
  const rows = db.collectionScripts || [];
  const completed = rows.filter((item) => item.outcome || typeof item.success === "boolean");
  const bySales = completed.filter((item) => item.salesName === salesName);
  const successful = completed.filter((item) => item.success);
  const best = [...successful].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  return {
    total: completed.length,
    ownTotal: bySales.length,
    ownSuccess: bySales.filter((item) => item.success).length,
    bestScript: best?.script || "",
    bestSalesName: best?.salesName || "",
    bestStyle: best?.style || ""
  };
}

function inferSalesStyle(db, user, body = {}) {
  if (body.style) return String(body.style).trim();
  const ownRows = (db.collectionScripts || []).filter((item) => item.salesName === user.name && item.style);
  if (ownRows[0]?.style) return ownRows[0].style;
  if (user.role === "sales") return "自然、轻松、先同步项目进展，再温和确认付款安排";
  return "专业、清楚、给客户留出确认空间";
}

function scriptToneFor(project, clientProfile, body = {}) {
  if (body.tone) return String(body.tone).trim();
  const due = String(project.paymentDue || "");
  if (/逾期|超期|已到期|尾款/.test(due) || Number(project.receivable || 0) > Number(project.contract || 0) * 0.5) {
    return "礼貌但要推进";
  }
  if (clientProfile?.contactStyle) return clientProfile.contactStyle;
  return "自然提醒";
}

function humanCollectionScript({ project, user, clientProfile, style, tone, stats }) {
  const clientName = project.client || project.brand || "客户";
  const amount = parseMoney(project.receivable);
  const paymentDue = project.paymentDue || "当前回款节点";
  const likes = (clientProfile?.likes || []).slice(0, 2).join("、");
  const pitfalls = (clientProfile?.pitfalls || []).slice(0, 2).join("、");
  const progress = project.nextMilestone || project.status || "项目正在推进中";
  const amountText = amount ? `${Math.round(amount).toLocaleString("zh-CN")} 元` : "这期款项";
  const lines = [
    `${clientName}老师，我跟您同步下「${project.name}」现在的进展：${progress}，我们这边已经在按节点往前推。`,
    `我想顺手跟您确认一下${paymentDue}这笔${amountText}的安排，您看大概什么时候方便走一下流程？我这边也好提前配合您补材料、开票或对账。`,
    `如果财务那边需要合同、报价明细或阶段交付说明，您直接跟我说，我今天就整理好发过去。`
  ];
  if (likes) lines.splice(1, 0, `我会按您之前比较认可的方向（${likes}）把交付资料整理得更清楚。`);
  if (pitfalls) lines.push(`另外我会避开之前提到过的点：${pitfalls}，这次沟通尽量不让您多费时间。`);
  if (stats.bestScript && stats.bestSalesName && stats.bestSalesName !== user.name) {
    lines.push(`我参考了${stats.bestSalesName}之前成功率比较高的说法，核心是先把交付和配合讲清楚，再轻轻推动付款节点。`);
  }
  return lines.join("\n");
}

export function collectionLibrary(db) {
  const rows = db.collectionScripts || [];
  return rows.map((item) => ({
    ...item,
    successRateNote: item.salesName
      ? (() => {
          const stats = collectionStats(db, item.salesName);
          return stats.ownTotal ? `${item.salesName} 已记录 ${stats.ownTotal} 次，成功 ${stats.ownSuccess} 次` : "暂无结果沉淀";
        })()
      : "暂无销售归属"
  }));
}

export function suggestCollectionScript(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const receivable = parseMoney(project.receivable);
  if (receivable <= 0) throw new Error("这个项目当前没有待回款，不需要生成催收话术");
  const clientProfile = clientLibrary(db).find((item) => item.client === (project.client || project.brand));
  const style = inferSalesStyle(db, user, body);
  const tone = scriptToneFor(project, clientProfile, body);
  const stats = collectionStats(db, user.name);
  const at = new Date().toISOString();
  const record = {
    id: nextCollectionScriptId(),
    projectId: project.id,
    projectName: project.name,
    client: project.client || project.brand || "",
    salesId: user.id,
    salesName: user.name,
    style,
    tone,
    amount: receivable,
    paymentDue: project.paymentDue || "",
    script: humanCollectionScript({ project, user, clientProfile, style, tone, stats }),
    reason: [
      `待回款 ${receivable.toLocaleString("zh-CN")} 元`,
      project.paymentDue ? `回款节点：${project.paymentDue}` : "回款节点待补",
      clientProfile?.pitfalls?.length ? `已避开客户雷区：${clientProfile.pitfalls.slice(0, 2).join("、")}` : "",
      stats.ownTotal ? `你的历史催收记录 ${stats.ownTotal} 次，成功 ${stats.ownSuccess} 次` : "暂无个人话术结果，先用稳妥模板"
    ].filter(Boolean).join("；"),
    outcome: "",
    success: null,
    score: null,
    createdAt: at,
    updatedAt: at
  };
  db.collectionScripts = db.collectionScripts || [];
  db.collectionScripts.unshift(record);
  db.auditLogs.unshift({
    type: "collection",
    target: project.name,
    action: "suggest",
    user: user.name,
    meta: { scriptId: record.id, amount: receivable },
    at
  });
  return record;
}

export function saveCollectionOutcome(db, body, user) {
  const id = String(body?.id || "").trim();
  const record = (db.collectionScripts || []).find((item) => item.id === id);
  if (!record) throw new Error("催收记录不存在");
  const at = new Date().toISOString();
  record.outcome = String(body.outcome || record.outcome || "").trim();
  record.success = Boolean(body.success);
  record.score = Number(body.score || (record.success ? 5 : 2));
  record.nextFollowUpAt = record.success ? "" : String(body.nextFollowUpAt || record.nextFollowUpAt || "").trim();
  record.nextAction = record.success ? "" : String(body.nextAction || record.nextAction || "").trim();
  record.followUpStatus = record.success ? "已关闭" : (record.nextFollowUpAt || record.nextAction ? "待跟进" : "待补计划");
  record.updatedAt = at;
  syncCollectionFollowUpNotification(db, record, user);
  db.auditLogs.unshift({
    type: "collection",
    target: record.projectName,
    action: "outcome",
    user: user.name,
    meta: { scriptId: record.id, success: record.success, score: record.score, nextFollowUpAt: record.nextFollowUpAt, nextAction: record.nextAction },
    at
  });
  return record;
}
