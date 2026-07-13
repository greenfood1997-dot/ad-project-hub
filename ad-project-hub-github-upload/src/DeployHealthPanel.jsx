import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function DeployHealthPanel({ items = [], actions = [], readyCount = 0, total = 0, checkedAt = "", rootDirectory = "", nodeEnv = "", scheduler = null, checking = false, onRefresh }) {
  const nextIssue = items.find((item) => !item.ok);
  return (
    <div className="settings-block deploy-health-panel">
      <div className="section-head">
        <div>
          <h3>上线健康检查</h3>
          <span>检查 Render 部署、版本、AI 和 OCR 环境，避免更新后还是旧页面。</span>
        </div>
        <button type="button" className="ghost tiny" onClick={onRefresh} disabled={checking}>{checking ? "检查中" : "刷新检查"}</button>
      </div>
      {scheduler?.lastAutomaticDelivery?.enabled && <p className={`automatic-delivery-summary ${scheduler.lastAutomaticDelivery.failed ? "warn" : "ok"}`}>
        最近自动提醒：尝试 {scheduler.lastAutomaticDelivery.attempted || 0} 次，成功 {scheduler.lastAutomaticDelivery.sent || 0} 次，失败 {scheduler.lastAutomaticDelivery.failed || 0} 次。
      </p>}
      <div className={`deploy-health-summary ${nextIssue ? "warn" : "ok"}`}>
        <div>
          {nextIssue ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{nextIssue ? `还差：${nextIssue.title}` : "上线检查通过"}</strong>
        </div>
        <span>{readyCount}/{total} 项就绪{checkedAt ? ` · ${new Date(checkedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}</span>
        {rootDirectory && <em>Render Root Directory：{rootDirectory}{nodeEnv ? ` · ${nodeEnv}` : ""}</em>}
      </div>
      {actions.length > 0 && (
        <div className="deploy-readiness-actions">
          <strong>上线下一步</strong>
          {actions.map((action) => (
            <div className={action.tone} key={action.title}>
              {action.tone === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{action.title}</span>
              <em>{action.text}</em>
            </div>
          ))}
        </div>
      )}
      <div className="deploy-health-grid">
        {items.map((item) => (
          <div className={item.ok ? "ok" : "warn"} key={item.title}>
            {item.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <strong>{item.title}</strong>
            <span>{item.status}</span>
            <em>{item.next}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
