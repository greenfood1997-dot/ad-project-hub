import { parseMoney } from "./service-utils.mjs";

function nextPaymentId() {
  return `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

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

function sameProject(row, project) {
  return row.projectId === project.id || row.projectName === project.name || row.project === project.name;
}

function syncRevenuePaymentStatus(project) {
  const revenue = project.extractedFields?.revenueRecognition;
  if (!revenue) return;
  const records = Array.isArray(revenue.verificationRecords) ? revenue.verificationRecords : [];
  let remainingPaid = Number(project.paid || 0);
  const syncedRecords = records.map((record) => {
    const amount = Number(record.amount || 0);
    const paidAmount = Math.min(amount, Math.max(remainingPaid, 0));
    remainingPaid -= paidAmount;
    return {
      ...record,
      paidAmount,
      unpaidAmount: Math.max(amount - paidAmount, 0),
      paymentStatus: amount && paidAmount >= amount ? "已回款" : paidAmount > 0 ? "部分回款" : "未回款"
    };
  });
  const recognizedRevenue = Number(revenue.recognizedRevenue || records.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  project.extractedFields.revenueRecognition = {
    ...revenue,
    recognizedUnpaid: Math.max(recognizedRevenue - Number(project.paid || 0), 0),
    verificationRecords: syncedRecords,
    updatedAt: new Date().toISOString()
  };
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

function syncReceivableNotificationAfterPayment(db, project = {}, user = {}, action = "record") {
  db.systemNotifications = db.systemNotifications || [];
  const at = new Date().toISOString();
  const receivable = Number(project.receivable || 0);
  const notices = db.systemNotifications.filter((item) => {
    const sameProjectNotice = item.projectId === project.id || item.projectName === project.name;
    return sameProjectNotice && item.type === "project-receivable-risk";
  });
  if (receivable <= 0) {
    for (const notice of notices) {
      if (notice.status !== "待处理") continue;
      notice.status = "已处理";
      notice.handledAt = at;
      notice.handledBy = user.id || "";
      notice.handledByName = user.name || "";
      notice.note = "项目已无待回款，系统在记录回款后自动处理。";
      notice.updatedAt = at;
    }
    return;
  }

  if (action !== "void") return;
  const existing = notices.find((item) => item.status === "待处理");
  if (existing) {
    existing.updatedAt = at;
    existing.text = `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`;
    return;
  }
  const reopen = notices.find((item) => ["已处理", "已忽略"].includes(item.status));
  if (reopen) {
    reopen.status = "待处理";
    reopen.reopenedAt = at;
    reopen.reopenedBy = user.id || "";
    reopen.reopenedByName = user.name || "";
    reopen.reopenReason = "回款作废后项目重新出现待回款。";
    reopen.text = `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`;
    reopen.updatedAt = at;
    return;
  }
  db.systemNotifications.unshift({
    id: nextNotificationId(`receivable-${project.id}`),
    key: `project-receivable-risk::${project.id}::payment-void`,
    type: "project-receivable-risk",
    title: "项目回款需要跟进",
    text: `「${project.name}」回款作废后仍待回款 ${receivable.toLocaleString("zh-CN")} 元，请销售/PM重新跟进客户付款。`,
    severity: "中",
    role: "sales",
    recipients: notificationRecipientsForRole("sales"),
    projectId: project.id,
    projectName: project.name,
    source: "payment",
    sourceId: project.id,
    actionLabel: "看回款",
    actionView: "project-detail",
    status: "待处理",
    createdAt: at,
    updatedAt: at
  });
}

function syncCollectionScriptsAfterPayment(db, project = {}, user = {}, action = "record") {
  const rows = db.collectionScripts || [];
  if (!project?.id || !rows.length) return;
  const at = new Date().toISOString();
  const receivable = Number(project.receivable || 0);
  for (const row of rows) {
    if (!sameProject(row, project)) continue;
    if (action === "record" && receivable <= 0) {
      closeCollectionFollowUpNotification(db, row, user, "项目已无待回款，系统在记录回款后自动关闭催收跟进。");
      if (row.followUpStatus === "待跟进" || row.nextFollowUpAt || row.nextAction) {
        row.followUpStatus = "已关闭";
        row.followUpClosedAt = at;
        row.updatedAt = at;
        row.updatedBy = user.id || "";
        row.updatedByName = user.name || "";
      }
    }
    if (action === "record" && receivable <= 0 && !row.outcome && typeof row.success !== "boolean") {
      row.outcome = "项目已完成回款，系统自动标记为待复核成功样本";
      row.success = true;
      row.score = Number(row.score || 4);
      row.autoResolvedByPayment = true;
      row.paymentSyncedAt = at;
      row.updatedAt = at;
      row.updatedBy = user.id || "";
      row.updatedByName = user.name || "";
      continue;
    }
    if (action === "void" && row.autoResolvedByPayment) {
      row.outcome = "回款已作废，需重新跟进客户付款";
      row.success = false;
      row.score = 2;
      row.autoResolvedByPayment = false;
      row.paymentVoidedAt = at;
      row.updatedAt = at;
      row.updatedBy = user.id || "";
      row.updatedByName = user.name || "";
    }
  }
}

function refreshProjectAfterPayment(project, { inferRisk, projectRiskAlerts }) {
  const contract = parseMoney(project.contract);
  const recognizedRevenue = Number(project.extractedFields?.revenueRecognition?.recognizedRevenue || 0);
  project.receivable = Math.max(contract - recognizedRevenue - Number(project.paid || 0), 0);
  project.risk = inferRisk({
    contract,
    costBudget: project.costBudget,
    costUsed: project.costUsed,
    receivable: project.receivable
  });
  syncRevenuePaymentStatus(project);
  project.alerts = projectRiskAlerts(project);
  return project;
}

export function recordProjectPayment(db, body, user, deps = {}) {
  const { inferRisk, projectRiskAlerts } = deps;
  if (typeof inferRisk !== "function" || typeof projectRiskAlerts !== "function") throw new Error("回款服务缺少项目风险计算依赖");
  const project = (db.projects || []).find((item) => item.id === body?.projectId || item.id === body?.id);
  if (!project) throw new Error("项目不存在");
  const amount = parseMoney(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("请填写正确的回款金额");
  const contract = parseMoney(project.contract);
  const currentPaid = parseMoney(project.paid);
  if (contract && currentPaid + amount > contract * 1.05) throw new Error("回款金额超过合同金额过多，请核对后再记录");

  const at = new Date().toISOString();
  const payment = {
    id: nextPaymentId(),
    projectId: project.id,
    projectName: project.name,
    client: project.client || "",
    amount,
    payer: String(body.payer || body.client || project.client || "").trim(),
    method: String(body.method || "").trim(),
    note: String(body.note || body.remark || "").trim(),
    receivedAt: body.receivedAt || at,
    recordedBy: user.id,
    recordedByName: user.name,
    createdAt: at
  };

  db.payments = db.payments || [];
  db.payments.unshift(payment);
  project.paid = currentPaid + amount;
  refreshProjectAfterPayment(project, { inferRisk, projectRiskAlerts });
  project.updatedAt = at;
  syncReceivableNotificationAfterPayment(db, project, user, "record");
  syncCollectionScriptsAfterPayment(db, project, user, "record");
  db.auditLogs.unshift({
    type: "payment",
    target: project.name,
    action: "record",
    user: user.name,
    meta: { paymentId: payment.id, amount, paid: project.paid, receivable: project.receivable },
    at
  });
  return { payment, project };
}

export function voidProjectPayment(db, body, user, deps = {}) {
  const { inferRisk, projectRiskAlerts } = deps;
  if (typeof inferRisk !== "function" || typeof projectRiskAlerts !== "function") throw new Error("回款服务缺少项目风险计算依赖");
  const payment = (db.payments || []).find((item) => item.id === body?.id || item.id === body?.paymentId);
  if (!payment) throw new Error("回款记录不存在");
  if (payment.status === "已作废" || payment.voidedAt) throw new Error("该回款记录已作废");
  const project = (db.projects || []).find((item) => item.id === payment.projectId || item.name === payment.projectName);
  if (!project) throw new Error("项目不存在");
  const at = new Date().toISOString();
  const amount = Number(payment.amount || 0);
  project.paid = Math.max(parseMoney(project.paid) - amount, 0);
  refreshProjectAfterPayment(project, { inferRisk, projectRiskAlerts });
  project.updatedAt = at;
  syncReceivableNotificationAfterPayment(db, project, user, "void");
  syncCollectionScriptsAfterPayment(db, project, user, "void");
  payment.status = "已作废";
  payment.voidedAt = at;
  payment.voidedBy = user.id;
  payment.voidedByName = user.name;
  payment.voidReason = String(body.reason || body.note || "").trim() || "手动作废";
  db.auditLogs.unshift({
    type: "payment",
    target: project.name,
    action: "void",
    user: user.name,
    meta: { paymentId: payment.id, amount, paid: project.paid, receivable: project.receivable, reason: payment.voidReason },
    at
  });
  return { payment, project };
}
