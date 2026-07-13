import { money } from "./format.js";

export function parseNoticeAmount(text = "") {
  const normalized = String(text || "").replace(/,/g, "");
  const wan = normalized.match(/([\d.]+)\s*万/);
  if (wan) return Number(wan[1] || 0) * 10000;
  const yuan = normalized.match(/([\d.]+)\s*元/);
  return yuan ? Number(yuan[1] || 0) : 0;
}

export function notificationPriorityQueue(items = [], now = Date.now()) {
  const typeWeight = {
    "company-cash-runway": 100,
    "project-receivable-risk": 88,
    "approval-stale": 86,
    "project-cost-overrun": 84,
    "project-assignment": 78,
    "supplier-settlement-pending": 74,
    "project-task-due": 70,
    "project-progress-lag": 66,
    "project-cost-pressure": 62,
    "feishu-pending-file": 58,
    "verification-sheet-missing": 52,
    "collection-follow-up": 50
  };
  return items
    .map((item) => {
      const created = new Date(item.createdAt || item.updatedAt || now).getTime();
      const ageHours = Number.isFinite(created) ? Math.max(0, Math.round((now - created) / 36e5)) : 0;
      const amount = parseNoticeAmount(`${item.text || ""} ${item.title || ""}`);
      const score = (typeWeight[item.type] || 40)
        + (item.severity === "高" ? 45 : item.severity === "中" ? 18 : 0)
        + Math.min(ageHours, 72) * 0.7
        + Math.min(amount / 10000, 30);
      const reason = item.severity === "高"
        ? "高优先级"
        : amount >= 100000
          ? `金额压力 ${money(amount)}`
          : ageHours >= 24
            ? `已等待 ${ageHours} 小时`
            : item.actionLabel || "建议今天处理";
      return { item, score, ageHours, amount, reason };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
