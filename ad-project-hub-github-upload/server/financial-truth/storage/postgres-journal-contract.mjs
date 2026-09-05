import { requireTransactionContext } from "./transaction-context.mjs";
export function appendEvent(tx, event) { requireTransactionContext(tx); return { operation: "appendEvent", tx, event }; }
export function getEvent(tx, eventId) { requireTransactionContext(tx); return { operation: "getEvent", tx, eventId }; }
export function findByIdempotencyKey(tx, key) { requireTransactionContext(tx); return { operation: "findByIdempotencyKey", tx, key }; }
export function listEventsForCompany(tx, companyId) { requireTransactionContext(tx); return { operation: "listEventsForCompany", tx, companyId }; }
export function listEventsForProject(tx, projectId) { requireTransactionContext(tx); return { operation: "listEventsForProject", tx, projectId }; }
