import { getFeishuTenantAccessToken } from "./feishu-service.mjs";

const ROLE_USERS = {
  pm: ["pm", "director"],
  director: ["director"],
  finance: ["finance"],
  owner: ["shareholder"]
};

function money(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function recipientsForApproval(db, approval, target = "current") {
  if (target === "applicant") return (db.users || []).filter((user) => user.id === approval.applicantId);
  const active = (db.users || []).filter((user) => user.status !== "disabled");
  const roles = ROLE_USERS[approval.currentRole] || [];
  let users = active.filter((user) => roles.includes(user.role));
  if (approval.currentRole === "pm") {
    const project = (db.projects || []).find((item) => item.id === approval.projectId);
    const names = new Set([project?.pm, project?.owner].filter(Boolean).map((name) => String(name).toLowerCase()));
    const assigned = users.filter((user) => names.has(String(user.name || "").toLowerCase()) || names.has(String(user.email || "").toLowerCase()));
    if (assigned.length) users = assigned;
  }
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

async function sendText(settings, openId, text) {
  if (settings.mockSend === true || settings.mockSend === "true") return { ok: true, mocked: true, messageId: `mock-${Date.now()}` };
  const token = await getFeishuTenantAccessToken(settings);
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: "text", content: JSON.stringify({ text }) })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) throw new Error(payload.msg || `飞书返回 ${res.status}`);
  return { ok: true, messageId: payload.data?.message_id || "" };
}

export async function notifyApprovalInFeishu(db, approval, event = "submitted", options = {}) {
  const terminal = ["已完成", "已驳回", "已撤回"].includes(approval.status);
  const target = terminal ? "applicant" : "current";
  const eventKey = `${event}:${approval.status}:${approval.currentRole || "applicant"}`;
  approval.feishuDeliveries ||= [];
  if (approval.feishuDeliveries.some((item) => item.eventKey === eventKey)) return { duplicate: true };
  const recipients = recipientsForApproval(db, approval, target);
  const actionText = terminal
    ? `你的${approval.typeLabel || "审批"}申请状态已更新为：${approval.status}`
    : `有一笔${approval.typeLabel || "审批"}等待你处理（${approval.status}）`;
  const detailUrl = `${String(options.origin || "").replace(/\/$/, "")}/?view=approvals&approvalId=${encodeURIComponent(approval.id)}`;
  const text = [
    `【OA 审批通知】${actionText}`,
    `项目：${approval.projectName}`,
    `申请人：${approval.applicantName}`,
    `金额：${money(approval.amount)}`,
    `事由：${approval.reason || "未填写"}`,
    approval.type === "reimbursement" ? `凭证：${approval.voucher?.status === "valid-invoice" ? "已提供发票" : "待补发票/支付凭证"}` : "",
    options.note ? `审批意见：${options.note}` : "",
    detailUrl ? `去 OA 处理：${detailUrl}` : ""
  ].filter(Boolean).join("\n");
  const results = [];
  for (const user of recipients) {
    const openId = user.feishuOpenId || user.feishuUserId || "";
    if (!openId) {
      results.push({ userId: user.id, name: user.name, ok: false, missingOpenId: true });
      continue;
    }
    try {
      results.push({ userId: user.id, name: user.name, openId, ...(await sendText(db.settings?.feishu || {}, openId, text)) });
    } catch (error) {
      results.push({ userId: user.id, name: user.name, openId, ok: false, error: error.message });
    }
  }
  const delivery = { eventKey, event, target, text, results, sentAt: new Date().toISOString() };
  approval.feishuDeliveries.unshift(delivery);
  approval.feishuDelivery = delivery;
  db.auditLogs ||= [];
  db.auditLogs.unshift({ type: "approval-feishu", target: approval.id, action: event, user: options.actorName || "OA 审批系统", meta: { ok: results.filter((item) => item.ok).length, total: results.length }, at: delivery.sentAt });
  return delivery;
}
