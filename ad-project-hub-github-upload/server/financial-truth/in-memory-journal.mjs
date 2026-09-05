import { createFinancialEvent, immutableClone } from "./financial-event.mjs";
import { canonicalSemanticPayload } from "./idempotency.mjs";
export class InMemoryFinancialEventJournal {
  #events = [];
  appendEvent(input) { const event = createFinancialEvent(input); const existing = this.#events.find(e => e.idempotencyKey === event.idempotencyKey); if (existing) { if (canonicalSemanticPayload(existing) !== canonicalSemanticPayload(event)) throw new Error("IDEMPOTENCY_CONFLICT"); return { event: immutableClone(existing), duplicate: true }; } if (this.#events.some(e => e.eventId === event.eventId)) throw new Error("duplicate eventId"); const copy = immutableClone(event); this.#events.push(copy); return { event: immutableClone(copy), duplicate: false }; }
  getEvent(id) { const e = this.#events.find(e => e.eventId === id); return e ? immutableClone(e) : null; }
  findByIdempotencyKey(key) { const e = this.#events.find(e => e.idempotencyKey === key); return e ? immutableClone(e) : null; }
  listEvents() { return this.#events.map(e => immutableClone(e)); }
  listEventsForProject(id) { return this.#events.filter(e => e.projectId === id).map(e => immutableClone(e)); }
  listEventsForCompany(id) { return this.#events.filter(e => e.companyId === id).map(e => immutableClone(e)); }
}
