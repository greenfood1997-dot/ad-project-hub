import { createFinancialEvent } from "../financial-event.mjs";
import { canonicalSemanticPayload } from "../idempotency.mjs";
import { requireTransactionContext } from "./transaction-context.mjs";
import { eventToRowParams, rowToFinancialEvent } from "./postgres-row-mapper.mjs";
import { APPEND_EVENT_SQL, GET_EVENT_SQL, FIND_IDEMPOTENCY_SQL, LIST_COMPANY_SQL, LIST_PROJECT_SQL } from "./postgres-sql.mjs";
import { classifyPostgresError } from "./postgres-error-classifier.mjs";
export class EventIdConflictError extends Error { constructor() { super("EVENT_ID_CONFLICT"); this.code = "EVENT_ID_CONFLICT"; } }
export class IdempotencyConflictError extends Error { constructor() { super("IDEMPOTENCY_CONFLICT"); this.code = "IDEMPOTENCY_CONFLICT"; } }
const one = (r) => r?.rows?.[0] || null;
export class PostgresFinancialEventJournalAdapter {
  async appendEvent(tx, input) {
    requireTransactionContext(tx); const event = createFinancialEvent(input);
    let inserted; try { inserted = await tx.query(APPEND_EVENT_SQL, eventToRowParams(event)); } catch (error) { const classified = classifyPostgresError(error); if (classified) throw classified; throw error; }
    if (inserted?.rows?.length) return { status: "APPENDED", event: rowToFinancialEvent(inserted.rows[0]) };
    const existingByKey = one(await tx.query(FIND_IDEMPOTENCY_SQL, [event.idempotencyKey]));
    if (existingByKey) {
      const existing = rowToFinancialEvent(existingByKey);
      if (canonicalSemanticPayload(existing) === canonicalSemanticPayload(event)) return { status: "DUPLICATE_EXISTING", event: existing };
      throw new IdempotencyConflictError();
    }
    const existingById = one(await tx.query(GET_EVENT_SQL, [event.eventId]));
    if (existingById) throw new EventIdConflictError();
    throw new Error("EVENT_APPEND_NOT_CONFIRMED");
  }
  async getEvent(tx, id) { requireTransactionContext(tx); const row = one(await tx.query(GET_EVENT_SQL, [id])); return row ? rowToFinancialEvent(row) : null; }
  async findByIdempotencyKey(tx, key) { requireTransactionContext(tx); const row = one(await tx.query(FIND_IDEMPOTENCY_SQL, [key])); return row ? rowToFinancialEvent(row) : null; }
  async listEventsForCompany(tx, id) { requireTransactionContext(tx); return (await tx.query(LIST_COMPANY_SQL, [id])).rows.map(rowToFinancialEvent); }
  async listEventsForProject(tx, id) { requireTransactionContext(tx); return (await tx.query(LIST_PROJECT_SQL, [id])).rows.map(rowToFinancialEvent); }
}
