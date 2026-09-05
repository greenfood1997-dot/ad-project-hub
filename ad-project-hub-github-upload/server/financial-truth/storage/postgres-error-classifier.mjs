export class FinancialEventUniqueConstraintError extends Error { constructor(code = "POSTGRES_UNIQUE_CONSTRAINT_CONFLICT") { super(code); this.code = code; } }
export function classifyPostgresError(error) {
  if (error?.code !== "23505") return null;
  const c = String(error.constraint || "");
  if (/financial_events_pkey|financial_event.*pkey|financial_events.*event_id/i.test(c)) return new FinancialEventUniqueConstraintError("EVENT_ID_CONFLICT");
  if (/idempotency/i.test(c)) return new FinancialEventUniqueConstraintError("IDEMPOTENCY_STORAGE_CONFLICT");
  return new FinancialEventUniqueConstraintError();
}
