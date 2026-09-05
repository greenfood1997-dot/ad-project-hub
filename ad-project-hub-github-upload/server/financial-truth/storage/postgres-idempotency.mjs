import { canonicalSemanticPayload } from "../idempotency.mjs";

export function classifyIdempotencyConflict(existing, incoming) {
  if (!existing) return { kind: "NEW" };
  return canonicalSemanticPayload(existing) === canonicalSemanticPayload(incoming)
    ? { kind: "DUPLICATE_EXISTING", event: existing }
    : { kind: "IDEMPOTENCY_CONFLICT", event: existing };
}

export const IDEMPOTENCY_INSERT_SQL = "INSERT INTO financial_events (event_id, event_type, company_id, amount_minor, currency, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *";
