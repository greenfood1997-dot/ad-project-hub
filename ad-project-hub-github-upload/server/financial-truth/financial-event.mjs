import { EVENT_TYPE_SET } from "./event-types.mjs";

const REQUIRED = ["eventId", "eventType", "occurredAt", "effectiveAt", "companyId", "amount", "currency", "direction", "economicCategory", "sourceType", "sourceId", "status", "createdBy", "idempotencyKey", "createdAt"];
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function iso(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
export function validateFinancialEvent(input = {}) {
  const e = clone(input); const errors = [];
  for (const key of REQUIRED) if (e[key] === undefined || e[key] === null || e[key] === "") errors.push(`missing:${key}`);
  if (!EVENT_TYPE_SET.has(e.eventType)) errors.push("invalid:eventType");
  if (!Number.isSafeInteger(e.amount) || e.amount < 0) errors.push("invalid:amountMinor");
  if (!/^[A-Z]{3}$/.test(String(e.currency || ""))) errors.push("invalid:currency");
  if (!["in", "out", "none"].includes(e.direction)) errors.push("invalid:direction");
  if (e.eventType === "CLIENT_PAYMENT_CONFIRMED" && !e.sourceEvidence) errors.push("missing:sourceEvidence");
  for (const key of ["occurredAt", "effectiveAt", "createdAt"]) if (!iso(e[key])) errors.push(`invalid:${key}`);
  if (e.confirmedAt !== undefined && e.confirmedAt !== null && (!iso(e.confirmedAt) || Date.parse(e.confirmedAt) < Date.parse(e.occurredAt))) errors.push("invalid:confirmedAt");
  if (errors.length) return { ok: false, errors };
  return { ok: true, event: deepFreeze(e) };
}
export function createFinancialEvent(input) { const result = validateFinancialEvent(input); if (!result.ok) throw new Error(`Invalid FinancialEvent: ${result.errors.join(",")}`); return result.event; }
export function immutableClone(value) { return deepFreeze(clone(value)); }
export { REQUIRED as REQUIRED_FINANCIAL_EVENT_FIELDS };
