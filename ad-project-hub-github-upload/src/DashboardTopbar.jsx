import React from "react";
import { BellRing, Bot, FileSpreadsheet, Filter, Plus, Search, UserCog } from "lucide-react";

export default function DashboardTopbar({
  canCreateProject,
  exportingProjectLedger,
  filterOpen,
  hasProjectFilters,
  isAdmin,
  isManagement,
  notice,
  onClearFilters,
  onClearNotice,
  onCreateProject,
  onExportProjectLedger,
  onOpenAdmin,
  onOpenAiSettings,
  onOpenNotifications,
  onToggleFilter,
  onUpdateProjectFilter,
  projectCount = 0,
  projectFilters,
  role,
  searchText,
  setRole,
  setSearchText,
  systemNotificationCount = 0,
  aiConfigured = false
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <h1>项目经营驾驶舱</h1>
          <p>{isManagement ? "公司经营、项目执行、资金压力与 AI 建议集中管理" : "我的项目、备用金、报销、文件归档和内容辅助"}</p>
        </div>
        <div className="actions">
          <div className="search"><Search size={16} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索项目、客户、负责人" /></div>
          <button type="button" className="ghost" onClick={onToggleFilter}><Filter size={16} />筛选</button>
          <button type="button" className="ghost" disabled={exportingProjectLedger || !projectCount} onClick={onExportProjectLedger}>
            <FileSpreadsheet size={16} />{exportingProjectLedger ? "导出中" : "导出台账"}
          </button>
          <button type="button" className={`ghost notification-trigger ${systemNotificationCount ? "has-items" : ""}`} onClick={onOpenNotifications}>
            <BellRing size={16} />待办
            {systemNotificationCount > 0 && <b>{systemNotificationCount}</b>}
          </button>
          {isAdmin && <button type="button" className="ghost" onClick={onOpenAdmin}><UserCog size={16} />成员管理</button>}
          {isAdmin && <button type="button" className={aiConfigured ? "ghost" : "ghost warning"} onClick={onOpenAiSettings}><Bot size={16} />{aiConfigured ? "AI 已接入" : "接入 AI"}</button>}
          {canCreateProject && <button type="button" className="primary" onClick={onCreateProject}><Plus size={16} />新建项目</button>}
        </div>
      </header>

      {notice && <div className="notice-bar"><span>{notice}</span><button type="button" onClick={onClearNotice}>知道了</button></div>}

      {filterOpen && <div className="filter-panel">
        <div className="filter-group">
          <strong>提醒角色</strong>
          <div>
            <button type="button" className={role === "全部角色" ? "active" : ""} onClick={() => setRole("全部角色")}>全部提醒</button>
            {["PM", "销售", "管理层"].map((item) => (
              <button type="button" className={role === item ? "active" : ""} key={item} onClick={() => setRole(item)}>{item}</button>
            ))}
          </div>
        </div>
        <label>
          <span>项目风险</span>
          <select value={projectFilters.risk} onChange={(event) => onUpdateProjectFilter("risk", event.target.value)}>
            {["全部风险", "高", "中", "低"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>项目状态</span>
          <select value={projectFilters.status} onChange={(event) => onUpdateProjectFilter("status", event.target.value)}>
            {["全部状态", "执行中", "筹备中", "草稿", "已完成"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>资金状态</span>
          <select value={projectFilters.money} onChange={(event) => onUpdateProjectFilter("money", event.target.value)}>
            {["全部资金", "有待回款", "无待回款"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>材料状态</span>
          <select value={projectFilters.material} onChange={(event) => onUpdateProjectFilter("material", event.target.value)}>
            {["全部材料", "有材料缺口", "材料较完整"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        {hasProjectFilters && <button type="button" className="ghost" onClick={onClearFilters}>清空筛选</button>}
      </div>}
    </>
  );
}
