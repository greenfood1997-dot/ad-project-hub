const MONEY = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function memberKeys(member = {}) {
  return [member.id, member.name, member.email, member.feishuName].filter(Boolean).map((item) => String(item).toLowerCase());
}

function projectParticipantKeys(project = {}) {
  return [project.owner, project.pm, project.sales, ...(project.members || []), ...(project.extractedFields?.members || [])]
    .filter(Boolean).map((item) => String(item).toLowerCase());
}

function isProjectActiveInMonth(project = {}, month = "") {
  if (!month) return !/已删除|已取消/.test(String(project.status || ""));
  const monthStart = new Date(`${month}-01T00:00:00`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
  const start = project.startDate ? new Date(project.startDate) : null;
  const end = project.endDate || project.deadline ? new Date(project.endDate || project.deadline) : null;
  return (!start || Number.isNaN(start.valueOf()) || start <= monthEnd)
    && (!end || Number.isNaN(end.valueOf()) || end >= monthStart)
    && !/已删除|已取消/.test(String(project.status || ""));
}

export function compensationOverview(db, year = new Date().getFullYear()) {
  const settings = db.settings?.compensation || { members: [], allocations: [], dividends: [] };
  const members = (db.users || []).filter((item) => item.status !== "disabled");
  const projects = db.projects || [];
  const allocations = settings.allocations || [];
  const dividends = (settings.dividends || []).filter((item) => Number(item.year) === Number(year));
  const dividendRows = dividends.map((item) => {
    const project = projects.find((row) => row.id === item.projectId) || {};
    const profit = Number(project.extractedFields?.profitBreakdown?.profit ?? Number(project.contract || 0) - Number(project.costUsed || 0));
    const distributable = MONEY(Math.max(profit, 0) * (Number(item.distributionRate || 0) / 100));
    const shareholders = (item.shareholders || []).map((row) => ({ ...row, amount: MONEY(distributable * (Number(row.weight || 0) / 100)) }));
    return { ...item, projectName: project.name || item.projectName || "项目已删除", profit: MONEY(profit), distributable, retained: MONEY(Math.max(profit, 0) - distributable), shareholders };
  });
  const shareholderTotals = new Map();
  dividendRows.forEach((item) => item.shareholders.forEach((row) => {
    const current = shareholderTotals.get(row.userId) || { userId: row.userId, name: row.name, expected: 0, confirmed: 0, paid: 0 };
    current.expected = MONEY(current.expected + row.amount);
    if (["confirmed", "paid"].includes(item.status)) current.confirmed = MONEY(current.confirmed + row.amount);
    if (item.status === "paid") current.paid = MONEY(current.paid + row.amount);
    shareholderTotals.set(row.userId, current);
  }));
  return { year: Number(year), members, projects, compensationMembers: settings.members || [], allocations, dividends: dividendRows, shareholderTotals: [...shareholderTotals.values()] };
}

export function saveCompensationMember(db, body = {}, user = {}) {
  db.settings = db.settings || {};
  const settings = db.settings.compensation || { members: [], allocations: [], dividends: [] };
  const member = (db.users || []).find((item) => item.id === body.userId);
  if (!member) throw new Error("成员不存在");
  const row = {
    userId: member.id, name: member.name, role: member.role,
    monthlyCost: MONEY(Math.max(0, Number(body.monthlyCost || 0))),
    projectRate: Math.min(100, Math.max(0, Number(body.projectRate ?? 100))),
    includesSocialSecurity: body.includesSocialSecurity !== false,
    updatedAt: new Date().toISOString(), updatedBy: user.id
  };
  settings.members = [...(settings.members || []).filter((item) => item.userId !== row.userId), row];
  db.settings.compensation = settings;
  db.auditLogs.unshift({ type: "finance", target: `compensation:${member.id}`, action: "save-member-cost", user: user.name, at: row.updatedAt });
  return row;
}

export function generateLaborAllocation(db, body = {}, user = {}) {
  const month = String(body.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("请选择分摊月份");
  const settings = db.settings?.compensation || { members: [], allocations: [], dividends: [] };
  const rows = [];
  for (const config of settings.members || []) {
    const member = (db.users || []).find((item) => item.id === config.userId);
    if (!member) continue;
    const keys = new Set(memberKeys(member));
    const participating = (db.projects || []).filter((project) => isProjectActiveInMonth(project, month) && projectParticipantKeys(project).some((key) => keys.has(key)));
    const projectPool = MONEY(Number(config.monthlyCost || 0) * (Number(config.projectRate || 0) / 100));
    const perProject = participating.length ? MONEY(projectPool / participating.length) : 0;
    participating.forEach((project) => rows.push({ month, userId: member.id, memberName: member.name, projectId: project.id, projectName: project.name, amount: perProject, method: "equal", status: "preview" }));
    if (!participating.length || Number(config.projectRate || 0) < 100) rows.push({ month, userId: member.id, memberName: member.name, projectId: "company-overhead", projectName: "公司管理公摊", amount: MONEY(Number(config.monthlyCost || 0) - projectPool), method: "overhead", status: "preview" });
  }
  settings.allocations = [...(settings.allocations || []).filter((item) => item.month !== month), ...rows];
  db.settings.compensation = settings;
  db.auditLogs.unshift({ type: "finance", target: `labor:${month}`, action: "generate-labor-allocation", user: user.name, meta: { rows: rows.length }, at: new Date().toISOString() });
  return rows;
}

export function saveProjectDividend(db, body = {}, user = {}) {
  const project = (db.projects || []).find((item) => item.id === body.projectId);
  if (!project) throw new Error("项目不存在");
  const rate = Math.min(100, Math.max(0, Number(body.distributionRate || 0)));
  const shareholders = (body.shareholders || []).map((item) => ({ userId: item.userId, name: item.name, weight: Number(item.weight || 0) }));
  if (shareholders.reduce((sum, item) => sum + item.weight, 0) > 100.0001) throw new Error("股东分红权重合计不能超过 100%");
  const settings = db.settings?.compensation || { members: [], allocations: [], dividends: [] };
  const row = { projectId: project.id, projectName: project.name, year: Number(body.year || new Date().getFullYear()), distributionRate: rate, shareholders, status: body.status || "draft", updatedAt: new Date().toISOString(), updatedBy: user.id };
  settings.dividends = [...(settings.dividends || []).filter((item) => !(item.projectId === row.projectId && Number(item.year) === row.year)), row];
  db.settings = db.settings || {};
  db.settings.compensation = settings;
  db.auditLogs.unshift({ type: "finance", target: `dividend:${project.id}:${row.year}`, action: "save-project-dividend", user: user.name, at: row.updatedAt });
  return row;
}
