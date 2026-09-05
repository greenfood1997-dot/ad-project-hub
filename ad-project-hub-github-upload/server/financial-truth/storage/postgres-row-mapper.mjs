import { createFinancialEvent } from "../financial-event.mjs";
import { encodeMinorAmountForPostgres, decodeMinorAmountFromPostgres } from "./postgres-amount-codec.mjs";
const fields = [
  ["eventId","event_id"],["eventType","event_type"],["companyId","company_id"],["departmentId","department_id"],["projectId","project_id"],["clientId","client_id"],["supplierId","supplier_id"],["employeeId","employee_id"],["approvalId","approval_id"],["paymentId","payment_id"],["amount","amount_minor"],["currency","currency"],["direction","direction"],["economicCategory","economic_category"],["accountCategory","account_category"],["occurredAt","occurred_at"],["effectiveAt","effective_at"],["confirmedAt","confirmed_at"],["createdAt","created_at"],["sourceType","source_type"],["sourceId","source_id"],["sourceEvidence","source_evidence"],["status","status"],["createdBy","created_by"],["confirmedBy","confirmed_by"],["confirmationAuthority","confirmation_authority"],["idempotencyKey","idempotency_key"],["reversalOf","reversal_of"],["correctionOf","correction_of"],["metadata","metadata"]
];
export const POSTGRES_EVENT_COLUMNS = Object.freeze(fields.map(([, db]) => db));
export function eventToRowParams(event) {
  return fields.map(([domain]) => domain === "amount" ? encodeMinorAmountForPostgres(event[domain]) : event[domain] ?? null);
}
export function rowToFinancialEvent(row) {
  const out = {};
  for (const [domain, db] of fields) { let value = row?.[db] ?? null; if (["occurredAt","effectiveAt","confirmedAt","createdAt"].includes(domain)) { if (value instanceof Date) { if (Number.isNaN(value.getTime())) throw new RangeError("invalid timestamp"); value = value.toISOString(); } else if (typeof value === "string" && value && !value.endsWith("Z")) { if (!/[+-]\d{2}:\d{2}$/.test(value)) throw new RangeError("timezone required"); const d = new Date(value); if (Number.isNaN(d.getTime())) throw new RangeError("invalid timestamp"); value = d.toISOString(); } } out[domain] = domain === "amount" ? decodeMinorAmountFromPostgres(value) : value; }
  return createFinancialEvent(out);
}
