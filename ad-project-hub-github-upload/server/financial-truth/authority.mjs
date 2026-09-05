const allowed = {
  sales: new Set(["CLIENT_PAYMENT_REPORTED"]),
  pm: new Set(["COST_INCURRED", "EXPENSE_CONFIRMED"]),
  finance: new Set(["CLIENT_PAYMENT_CONFIRMED", "SUPPLIER_PAYMENT_CONFIRMED", "PAYROLL_PAID", "REIMBURSEMENT_PAID"]),
  member: new Set(["EXPENSE_ALLOCATED", "EXPENSE_CONFIRMED"]),
  director: new Set(["REIMBURSEMENT_APPROVED", "SUPPLIER_PAYMENT_APPROVED", "PAYROLL_APPROVED"]),
  shareholder: new Set(["DIVIDEND", "OTHER_ADJUSTMENT"]),
  admin: new Set(["DIVIDEND", "OTHER_ADJUSTMENT"])
};
export function canConfirmFinancialEvent({ actorRole, eventType } = {}) { return Boolean(allowed[String(actorRole || "").toLowerCase()]?.has(eventType)); }
