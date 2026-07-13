import { approvalRuleNumber, approvalSteps, canRoleHandleApproval, currentApprovalStep, enrichApprovalRuntimeFields, inferExpenseCategory, syncApprovalSteps } from "./approval-flow.mjs";

// Approval workflow and supplier settlement finance write-back helpers.
function requireApprovalDep(deps, key) {
  if (typeof deps[key] !== "function") throw new Error(`审批服务缺少依赖：${key}`);
  return deps[key];
}

const APPROVAL_LABELS = {
  petty_cash: "项目备用金",
  reimbursement: "报销",
  supplier_payment: "供应商付款"
};
function nextApprovalId() {
  return `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function applyApprovedFinanceImpact(db, approval, deps = {}) {
  if (approval.status !== "已完成" || approval.appliedAt) return;
  const project = (db.projects || []).find((item) => item.id === approval.projectId);
  if (!project) return;
  project.extractedFields = project.extractedFields || {};
  const amount = Number(approval.amount || 0);
  if (approval.type === "petty_cash") {
    const currentBudget = Number(project.extractedFields.pettyCashBudget || project.extractedFields.projectPettyCashBudget || 0);
    project.extractedFields.pettyCashBudget = currentBudget + amount;
  }
  if (approval.type === "reimbursement") {
    const currentUsed = Number(project.extractedFields.pettyCashUsed || project.extractedFields.projectPettyCashUsed || 0);
    const category = approval.expenseCategory || "其他";
    const costName = `员工报销-${category}`;
    project.extractedFields.pettyCashUsed = currentUsed + amount;
    project.costUsed = Number(project.costUsed || 0) + amount;
    const costs = Array.isArray(project.costs) ? project.costs : [];
    const row = costs.find((item) => Array.isArray(item) && item[0] === costName);
    if (row) row[1] = Number(row[1] || 0) + amount;
    else costs.push([costName, amount]);
    project.costs = costs;
  }
  if (approval.type === "supplier_payment") {
    project.costUsed = Number(project.costUsed || 0) + amount;
    const costs = Array.isArray(project.costs) ? project.costs : [];
    const supplierName = approval.payee || "供应商付款";
    const row = costs.find((item) => Array.isArray(item) && item[0] === supplierName);
    if (row) row[1] = Number(row[1] || 0) + amount;
    else costs.push([supplierName, amount]);
    project.costs = costs;
    db.suppliers = db.suppliers || [];
    const at = new Date().toISOString();
    const pendingRow = db.suppliers.find((item) => {
      if (item.status === "已付款") return false;
      const sameProject = item.projectId === project.id || item.project === project.name;
      const sameSupplier = String(item.supplier || "").trim() === supplierName;
      const sameAmount = Math.abs(Number(item.amount || 0) - amount) <= 0.01;
      return sameProject && sameSupplier && sameAmount;
    });
    const supplierRow = pendingRow || {
      supplier: supplierName,
      projectId: project.id,
      project: project.name,
      type: approval.reason || "供应商付款",
      amount,
      status: "待结算"
    };
    supplierRow.status = "已付款";
    supplierRow.approvalId = approval.id;
    supplierRow.paidAt = supplierRow.paidAt || at;
    supplierRow.paidBy = approval.completedBy || "审批完成";
    supplierRow.paymentNote = supplierRow.paymentNote || "供应商付款审批完成后自动标记已付款";
    supplierRow.updatedAt = at;
    supplierRow.updatedBy = approval.completedBy || "";
    if (!pendingRow) db.suppliers.unshift(supplierRow);
    requireApprovalDep(deps, "syncSupplierSettlementNotificationAfterUpdate")(db, supplierRow, { id: approval.completedBy || "", name: approval.completedBy || "审批完成" }, "已付款");
  }
  project.receivable = Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0);
  project.margin = Number(project.contract || 0)
    ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100)
    : 0;
  project.updatedAt = new Date().toISOString();
  approval.appliedAt = project.updatedAt;
}

function syncSupplierSettlementAfterApprovalStopped(db, approval = {}, user = {}, action = "reject", deps = {}) {
  if (approval.type !== "supplier_payment" || !approval.id) return null;
  const at = new Date().toISOString();
  const stoppedStatus = action === "withdraw" ? "审批已撤回" : "审批已驳回";
  let affected = null;
  for (const row of db.suppliers || []) {
    if (row.approvalId !== approval.id) continue;
    if (row.status === "已付款" || row.paidAt) continue;
    row.status = stoppedStatus;
    row.paymentNote = [row.paymentNote, approval.logs?.[0]?.note || ""].filter(Boolean).join("；") || stoppedStatus;
    row.updatedAt = at;
    row.updatedBy = user.id || "";
    row.updatedByName = user.name || "";
    row.approvalStoppedAt = at;
    row.approvalStoppedBy = user.id || "";
    row.approvalStoppedAction = action;
    affected = row;
    requireApprovalDep(deps, "syncSupplierSettlementNotificationAfterUpdate")(db, row, user, stoppedStatus);
  }
  return affected;
}

function settlementCostRowId(row = {}) {
  const id = row.id || row.supplierId || "";
  if (id) return `supplier-settlement:${id}`;
  return `supplier-settlement:${row.projectId || row.project || ""}:${row.supplier || ""}:${row.amount || 0}:${row.createdAt || ""}`;
}

export function findProjectForSupplierSettlement(db, row = {}) {
  return (db.projects || []).find((item) => {
    if (row.projectId && item.id === row.projectId) return true;
    return row.project && item.name === row.project;
  });
}

function recalculateProjectMargin(project = {}) {
  project.receivable = Math.max(Number(project.contract || 0) - Number(project.paid || 0), 0);
  project.margin = Number(project.contract || 0)
    ? Math.round(((Number(project.contract || 0) - Number(project.costUsed || 0)) / Number(project.contract || 1)) * 100)
    : 0;
  project.updatedAt = new Date().toISOString();
}

function applySupplierSettlementCost(db, row = {}, user = {}) {
  if (row.costAppliedAt) return null;
  const project = findProjectForSupplierSettlement(db, row);
  if (!project) return null;
  const amount = Number(row.amount || 0);
  if (!amount) return null;
  const costRow = {
    id: settlementCostRowId(row),
    name: row.supplier || "供应商结算",
    type: row.type || "供应商结算",
    amount,
    source: "supplier-settlement",
    supplier: row.supplier || "",
    settlementId: row.id || "",
    appliedBy: user.id || "",
    appliedByName: user.name || "",
    appliedAt: new Date().toISOString()
  };
  const costs = Array.isArray(project.costs) ? project.costs : [];
  if (!costs.some((item) => item?.source === "supplier-settlement" && item?.settlementId && item.settlementId === costRow.settlementId)) {
    costs.push(costRow);
  }
  project.costs = costs;
  project.costUsed = Number(project.costUsed || 0) + amount;
  recalculateProjectMargin(project);
  row.costAppliedAt = costRow.appliedAt;
  row.costAppliedBy = user.id || "";
  row.costAppliedByName = user.name || "";
  return project;
}

function rollbackSupplierSettlementCost(db, row = {}, user = {}) {
  if (!row.costAppliedAt) return null;
  const project = findProjectForSupplierSettlement(db, row);
  if (!project) return null;
  const rowId = settlementCostRowId(row);
  const amount = Number(row.amount || 0);
  project.costs = (Array.isArray(project.costs) ? project.costs : []).filter((item) => {
    if (item?.source === "supplier-settlement" && item?.settlementId && row.id && item.settlementId === row.id) return false;
    if (item?.id && item.id === rowId) return false;
    return true;
  });
  project.costUsed = Math.max(0, Number(project.costUsed || 0) - amount);
  recalculateProjectMargin(project);
  row.costRolledBackAt = new Date().toISOString();
  row.costRolledBackBy = user.id || "";
  row.costAppliedAt = "";
  row.costAppliedBy = "";
  row.costAppliedByName = "";
  return project;
}


export function createApproval(db, body, user) {
  const project = (db.projects || []).find((item) => item.id === body.projectId);
  if (!project) throw new Error("项目不存在");
  const type = body.type || "reimbursement";
  if (!APPROVAL_LABELS[type]) throw new Error("不支持的审批类型");
  const amount = Number(body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("请填写正确的审批金额");
  const at = new Date().toISOString();
  const rules = db.settings?.approvalRules || {};
  const steps = approvalSteps(type, amount, rules);
  const current = steps.find((step) => step.status === "current");
  const expenseCategory = type === "reimbursement" ? inferExpenseCategory(body) : null;
  const approval = {
    id: nextApprovalId(),
    type,
    typeLabel: APPROVAL_LABELS[type],
    projectId: project.id,
    projectName: project.name,
    amount,
    reason: String(body.reason || "").trim() || "未填写说明",
    payee: String(body.payee || "").trim(),
    category: body.category || APPROVAL_LABELS[type],
    expenseCategory: expenseCategory?.category || "",
    expenseCategorySource: expenseCategory?.source || "",
    expenseCategoryConfidence: expenseCategory?.confidence || 0,
    status: `待${current?.label || "PM确认"}`,
    currentRole: current?.role || "pm",
    applicantId: user.id,
    applicantName: user.name,
    applicantRole: user.role,
    createdAt: at,
    updatedAt: at,
    steps,
    ruleSnapshot: {
      pettyCashDirectorLimit: approvalRuleNumber(rules, "pettyCashDirectorLimit", 3000),
      financeRequiredAmount: approvalRuleNumber(rules, "financeRequiredAmount", 1000),
      ownerRequiredAmount: approvalRuleNumber(rules, "ownerRequiredAmount", 10000)
    },
    logs: [{ action: "submit", user: user.name, role: user.role, note: body.reason || "", at }]
  };
  enrichApprovalRuntimeFields(approval, at);
  db.approvals = db.approvals || [];
  db.approvals.unshift(approval);
  db.auditLogs.unshift({ type: "approval", target: project.name, action: "submit", user: user.name, meta: { approvalId: approval.id, approvalType: type, amount }, at });
  return approval;
}

export function actOnApproval(db, body, user, deps = {}) {
  const approval = (db.approvals || []).find((item) => item.id === body.id);
  if (!approval) throw new Error("审批不存在");
  if (["已完成", "已驳回"].includes(approval.status)) throw new Error("该审批已结束");
  const step = currentApprovalStep(approval);
  if (!step || !canRoleHandleApproval(user.role, step.role)) throw new Error("当前角色不能处理这一步审批");
  const action = body.action === "reject" ? "reject" : "approve";
  const at = new Date().toISOString();
  syncApprovalSteps(approval, action, user);
  approval.updatedAt = at;
  enrichApprovalRuntimeFields(approval, at);
  approval.logs = approval.logs || [];
  approval.logs.unshift({
    action,
    user: user.name,
    role: user.role,
    step: step.label,
    note: String(body.note || "").trim(),
    at
  });
  const stoppedSupplierSettlement = action === "reject"
    ? syncSupplierSettlementAfterApprovalStopped(db, approval, user, "reject", deps)
    : null;
  applyApprovedFinanceImpact(db, approval, deps);
  db.auditLogs.unshift({
    type: "approval",
    target: approval.projectName,
    action,
    user: user.name,
    meta: {
      approvalId: approval.id,
      approvalType: approval.type,
      amount: approval.amount,
      status: approval.status,
      stoppedSupplierSettlementId: stoppedSupplierSettlement?.id || ""
    },
    at
  });
  requireApprovalDep(deps, "syncApprovalNotificationAfterAction")(db, approval, user, action);
  return approval;
}

export function withdrawApproval(db, body, user, deps = {}) {
  const approval = (db.approvals || []).find((item) => item.id === body.id);
  if (!approval) throw new Error("审批不存在");
  if (["已完成", "已驳回", "已撤回"].includes(approval.status)) throw new Error("该审批已结束，不能撤回");
  const canWithdraw = approval.applicantId === user.id || ["shareholder", "admin", "director"].includes(user.role);
  if (!canWithdraw) throw new Error("只有提交人或管理层可以撤回该审批");
  const at = new Date().toISOString();
  approval.status = "已撤回";
  approval.currentRole = "";
  approval.withdrawnAt = at;
  approval.withdrawnBy = user.id;
  approval.withdrawnByName = user.name;
  approval.updatedAt = at;
  approval.steps = (approval.steps || []).map((step) => step.status === "current" ? { ...step, status: "pending" } : step);
  enrichApprovalRuntimeFields(approval, at);
  approval.logs = approval.logs || [];
  approval.logs.unshift({
    action: "withdraw",
    user: user.name,
    role: user.role,
    note: String(body.note || body.reason || "").trim() || "提交人撤回审批",
    at
  });
  const stoppedSupplierSettlement = syncSupplierSettlementAfterApprovalStopped(db, approval, user, "withdraw", deps);
  db.auditLogs.unshift({
    type: "approval",
    target: approval.projectName,
    action: "withdraw",
    user: user.name,
    meta: {
      approvalId: approval.id,
      approvalType: approval.type,
      amount: approval.amount,
      reason: String(body.reason || body.note || "").trim(),
      stoppedSupplierSettlementId: stoppedSupplierSettlement?.id || ""
    },
    at
  });
  requireApprovalDep(deps, "syncApprovalNotificationAfterAction")(db, approval, user, "withdraw");
  return approval;
}

export function updateSupplierSettlement(db, body, user, deps = {}) {
  const supplierId = String(body.id || body.supplierId || "").trim();
  const supplierName = String(body.supplier || "").trim();
  const projectName = String(body.project || body.projectName || "").trim();
  const row = (db.suppliers || []).find((item) => {
    if (supplierId && item.id === supplierId) return true;
    return supplierName
      && String(item.supplier || "").trim() === supplierName
      && (!projectName || String(item.project || "").trim() === projectName);
  });
  if (!row) throw new Error("供应商结算记录不存在");
  const status = body.status === "待结算" ? "待结算" : "已付款";
  const at = new Date().toISOString();
  row.status = status;
  row.paymentNote = String(body.note || body.paymentNote || row.paymentNote || "").trim();
  row.updatedAt = at;
  row.updatedBy = user.id;
  let affectedProject = null;
  if (status === "已付款") {
    row.paidAt = body.paidAt || row.paidAt || at;
    row.paidBy = user.name;
    affectedProject = applySupplierSettlementCost(db, row, user);
  } else {
    affectedProject = rollbackSupplierSettlementCost(db, row, user);
    row.paidAt = "";
    row.paidBy = "";
  }
  requireApprovalDep(deps, "syncSupplierSettlementNotificationAfterUpdate")(db, row, user, status);
  if (affectedProject) requireApprovalDep(deps, "syncProjectHealthNotificationsAfterUpdate")(db, affectedProject, user);
  db.auditLogs.unshift({
    type: "supplier",
    target: row.project || row.supplier,
    action: status === "已付款" ? "settlement-paid" : "settlement-pending",
    user: user.name,
    meta: {
      supplierId: row.id || "",
      supplier: row.supplier,
      project: row.project,
      amount: row.amount,
      status,
      note: row.paymentNote,
      costAppliedAt: row.costAppliedAt || "",
      projectCostUsed: affectedProject?.costUsed ?? null
    },
    at
  });
  return {
    settlement: row,
    project: affectedProject,
    supplier: requireApprovalDep(deps, "supplierLibrary")(db).find((item) => item.supplier === row.supplier)
  };
}
