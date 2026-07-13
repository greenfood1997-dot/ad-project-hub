import React from "react";
import { CheckCircle2 } from "lucide-react";
import "./notification.css";

function nextStepText(item = {}) {
  if (item.actionView === "admin:assignments") return "下一步：打开项目分派，确认 PM 和执行人员。";
  if (item.actionView === "approvals") return "下一步：进入审批工作台，通过、驳回或查看流程。";
  if (item.actionView === "management:cash") return "下一步：查看现金流压力，按 6 个月安全线处理。";
  if (item.actionView === "project-files") return "下一步：打开文件与 AI 解析区，确认资料是否入库。";
  if (item.type === "collection-follow-up" || item.actionView === "collections") return "下一步：打开催收助手，按计划继续跟进客户。";
  if (item.type === "project-task-due") return "下一步：打开项目进度区，更新任务进度或标记完成。";
  if (item.type === "supplier-settlement-pending") return "下一步：打开供应商结算区，确认付款审批或标记已付款。";
  if (item.type === "project-receivable-risk") return "下一步：打开回款记录，生成催收建议或记录回款。";
  if (["project-cost-pressure", "project-cost-overrun"].includes(item.type)) return "下一步：打开项目进度区，核对执行预算、已发生成本和后续支出。";
  if (item.actionView === "project-detail") return "下一步：打开项目详情，检查进度、材料和待处理事项。";
  return "下一步：打开相关页面处理这个待办。";
}

export default function NotificationDrawer({
  items = [],
  onClose,
  onOpenTarget,
  onQuickAction,
  onAction,
  onReopen,
  onSendFeishu,
  onSendWechat,
  handlingId = "",
  sendingFeishuId = "",
  sendingWechatId = "",
  lastAction = null,
  onScan,
  canScan,
  canManageAssignments,
  canCreateProject,
  isManagement,
  hasProject,
  scanning,
  notificationPriorityQueue,
  money,
}) {
  const highCount = items.filter((item) => item.severity === "高").length;
  const priorityQueue = notificationPriorityQueue(items);
  return (
    <div className="notification-backdrop" onClick={onClose}>
      <aside className="notification-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="notification-head">
          <div>
            <span>智能待办</span>
            <h2>需要处理的 OA 提醒</h2>
            <p>{highCount ? `${highCount} 个高优先级事项需要先看。` : "系统会从项目、审批和飞书文件里自动扫描。"}</p>
          </div>
          <div className="notification-head-actions">
            {canScan && <button type="button" className="ghost" onClick={onScan} disabled={scanning}>{scanning ? "巡检中" : "立即巡检"}</button>}
            <button type="button" className="ghost" onClick={onClose}>关闭</button>
          </div>
        </div>
        {lastAction?.text && <div className={`notification-last-action ${lastAction.tone || ""}`}>
          <strong>最近操作</strong>
          <span>{lastAction.text}</span>
          {lastAction.canReopen && <button type="button" className="ghost tiny" disabled={handlingId === lastAction.id} onClick={() => onReopen?.(lastAction.item)}>
            {handlingId === lastAction.id ? "恢复中" : "恢复待办"}
          </button>}
        </div>}
        {priorityQueue.length > 0 && <div className="notification-priority-panel">
          <div>
            <strong>今天先处理</strong>
            <span>按高危、等待时间、金额压力和业务类型自动排序。</span>
          </div>
          {priorityQueue.map(({ item, reason, ageHours, amount }) => (
            <button type="button" key={`priority-${item.id}`} onClick={() => onOpenTarget(item)}>
              <b className={item.severity === "高" ? "danger" : ""}>{item.severity === "高" ? "先看" : "建议"}</b>
              <strong>{item.title}</strong>
              <span>{item.projectName || "公司"} · {reason}{ageHours ? ` · 等待 ${ageHours}h` : ""}</span>
              <em>{amount ? `涉及 ${money(amount)}` : item.actionLabel || "打开处理"}</em>
            </button>
          ))}
        </div>}
        <div className="notification-list">
          {items.length ? items.map((item) => (
            <div className={`notification-card ${item.severity === "高" ? "high" : ""} ${lastAction?.id === item.id ? "fresh" : ""}`} key={item.id}>
              <div className="notification-title">
                <strong>{item.title}</strong>
                <span>{item.severity || "中"}</span>
              </div>
              <p>{item.text}</p>
              <em>{item.projectName || "系统"} · {item.source || "scanner"}</em>
              <small className="notification-next-step">{nextStepText(item)}</small>
              <div className="notification-actions">
                <button type="button" className="primary" onClick={() => onOpenTarget(item)}>{item.actionLabel || "查看"}</button>
                <button type="button" className="ghost" disabled={sendingFeishuId === item.id} onClick={() => onSendFeishu(item)}>{sendingFeishuId === item.id ? "发送中" : "发送飞书"}</button>
                <button type="button" className="ghost" disabled={sendingWechatId === item.id} onClick={() => onSendWechat(item)}>{sendingWechatId === item.id ? "发送中" : "发送企业微信"}</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "resolve")}>{handlingId === item.id ? "处理中" : "标记处理"}</button>
                <button type="button" className="ghost" disabled={handlingId === item.id} onClick={() => onAction(item, "ignore")}>{handlingId === item.id ? "处理中" : "忽略"}</button>
              </div>
              {item.feishuDelivery?.sentAt && <small className="notification-delivery">飞书已发送 · {new Date(item.feishuDelivery.sentAt).toLocaleString("zh-CN", { hour12: false })}</small>}
              {item.feishuDelivery?.missingRecipients?.length > 0 && <small className="notification-delivery warn">未收到飞书：{item.feishuDelivery.missingRecipients.map((row) => row.name || row.email || row.id).slice(0, 4).join("、")}{item.feishuDelivery.missingRecipients.length > 4 ? `等 ${item.feishuDelivery.missingRecipients.length} 人` : ""}</small>}
              {item.wechatDelivery?.sentAt && <small className="notification-delivery">企业微信已发送 · {new Date(item.wechatDelivery.sentAt).toLocaleString("zh-CN", { hour12: false })}</small>}
            </div>
          )) : (
            <div className="notification-empty">
              <CheckCircle2 size={22} />
              <strong>当前没有待办</strong>
              <span>项目分派、飞书文件、逾期审批出现时会自动进入这里。</span>
              <div className="notification-empty-actions">
                {canScan && <button type="button" className="ghost tiny" onClick={onScan} disabled={scanning}>{scanning ? "巡检中" : "立即巡检一次"}</button>}
                {canManageAssignments && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("assignments")}>项目分派</button>}
                {isManagement && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("cash")}>现金流压力</button>}
                <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("approvals")}>审批工作台</button>
                {hasProject && <button type="button" className="ghost tiny" onClick={() => onQuickAction?.("dashboard")}>我的项目</button>}
                {canCreateProject
                  ? <button type="button" className="primary tiny" onClick={() => onQuickAction?.("create-project")}>上传合同创建项目</button>
                  : hasProject && <button type="button" className="primary tiny" onClick={() => onQuickAction?.("upload-file")}>上传项目材料</button>}
              </div>
              {!canScan && <small>普通成员只会看到自己项目相关提醒。</small>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
