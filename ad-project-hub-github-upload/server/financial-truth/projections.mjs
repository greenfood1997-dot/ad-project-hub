import { resolveEffectiveFinancialEvents } from "./history.mjs";
const sum = (events, predicate) => resolveEffectiveFinancialEvents(events).filter(predicate).reduce((n, e) => n + (e.direction === "out" ? -e.amount : e.amount), 0);
export function projectPaymentProjection(events = []) { return sum(events, e => ["CLIENT_PAYMENT_CONFIRMED"].includes(e.eventType)); }
export function projectCostProjection(events = []) { return sum(events, e => ["COST_INCURRED", "EXPENSE_CONFIRMED", "REIMBURSEMENT_PAID", "COST_REVERSED"].includes(e.eventType)); }
export function receivableProjection(events = []) { return resolveEffectiveFinancialEvents(events).reduce((n,e)=>n + (["CLIENT_PAYMENT_CONFIRMED","RECEIVABLE_REVERSED"].includes(e.eventType) ? -e.amount : ["RECEIVABLE_CREATED","REVENUE_RECOGNIZED"].includes(e.eventType) ? e.amount : 0),0); }
export function payableProjection(events = []) { return sum(events, e => ["PAYABLE_CREATED", "REIMBURSEMENT_APPROVED", "SUPPLIER_PAYMENT_CONFIRMED", "REIMBURSEMENT_PAID"].includes(e.eventType)); }
export function cashProjection(events = []) { return sum(events, e => ["CLIENT_PAYMENT_CONFIRMED", "SUPPLIER_PAYMENT_CONFIRMED", "REIMBURSEMENT_PAID", "PAYROLL_PAID", "CASH_IN", "CASH_OUT", "DIVIDEND", "TAX_PAYMENT", "PETTY_CASH_ISSUED"].includes(e.eventType)); }
export function revenueProjection(events = []) { return sum(events, e => e.eventType === "REVENUE_RECOGNIZED"); }
