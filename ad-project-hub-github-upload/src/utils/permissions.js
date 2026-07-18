export const roleOptions = [
  ["shareholder", "股东"],
  ["admin", "管理员"],
  ["director", "总监"],
  ["pm", "项目经理"],
  ["sales", "销售"],
  ["finance", "财务"],
  ["member", "普通成员"],
  ["viewer", "只读成员"],
];

export const managementRoles = ["shareholder", "admin", "director", "finance"];
export const adminRoles = ["shareholder", "admin"];
export const assignmentManageRoles = ["shareholder", "admin", "director"];
export const projectCreateRoles = ["shareholder", "admin", "director", "pm", "sales"];
export const projectWriteRoles = ["shareholder", "admin", "director", "pm", "sales"];
export const collectionRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
export const feishuPendingHandleRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
export const supplierPaymentSubmitRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
export const paymentRecordRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
export const projectAlertHandleRoles = ["shareholder", "admin", "director", "pm", "sales", "finance"];
export const assignmentPmCandidateRoles = ["pm", "director", "admin", "member"];
export const assignmentSalesCandidateRoles = ["sales", "director", "admin"];
export const assignmentMemberExcludedRoles = ["shareholder", "viewer"];

export function roleLabel(role) {
  return roleOptions.find(([value]) => value === role)?.[1] || role;
}

export function canSeeManagement(session) {
  return managementRoles.includes(session?.role);
}

export function canUseAdminRole(session) {
  return adminRoles.includes(session?.role);
}

export function canManageAssignmentsRole(session) {
  return assignmentManageRoles.includes(session?.role);
}

export function canCreateProjectRole(session) {
  return projectCreateRoles.includes(session?.role);
}

export function canWriteProjectRole(session) {
  return projectWriteRoles.includes(session?.role);
}

export function canUseCollectionRole(session) {
  return collectionRoles.includes(session?.role);
}

export function canHandleFeishuPendingRole(session) {
  return feishuPendingHandleRoles.includes(session?.role);
}

export function canSubmitSupplierPaymentRole(session) {
  return supplierPaymentSubmitRoles.includes(session?.role);
}

export function canRecordPaymentRole(session) {
  return paymentRecordRoles.includes(session?.role);
}

export function canHandleProjectAlertRole(session) {
  return projectAlertHandleRoles.includes(session?.role);
}

export function canBeAssignmentPm(member = {}) {
  return assignmentPmCandidateRoles.includes(member?.role);
}

export function canBeAssignmentSales(member = {}) {
  return assignmentSalesCandidateRoles.includes(member?.role);
}

export function canBeAssignmentMember(member = {}) {
  return !assignmentMemberExcludedRoles.includes(member?.role);
}

export function approvalTypeOptionsFor(session) {
  return [
    ["reimbursement", "报销"],
    ["petty_cash", "项目备用金"],
    ...(canSubmitSupplierPaymentRole(session) ? [["supplier_payment", "供应商付款"]] : [])
  ];
}
