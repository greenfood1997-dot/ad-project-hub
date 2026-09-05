import { POSTGRES_EVENT_COLUMNS } from "./postgres-row-mapper.mjs";
const cols = POSTGRES_EVENT_COLUMNS.join(", "); const params = POSTGRES_EVENT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
export const APPEND_EVENT_SQL = `INSERT INTO financial_events (${cols}) VALUES (${params}) ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${cols}`;
export const GET_EVENT_SQL = `SELECT ${cols} FROM financial_events WHERE event_id = $1`;
export const FIND_IDEMPOTENCY_SQL = `SELECT ${cols} FROM financial_events WHERE idempotency_key = $1`;
export const LIST_COMPANY_SQL = `SELECT ${cols} FROM financial_events WHERE company_id = $1 ORDER BY effective_at, occurred_at, event_id`;
export const LIST_PROJECT_SQL = `SELECT ${cols} FROM financial_events WHERE project_id = $1 ORDER BY effective_at, occurred_at, event_id`;
