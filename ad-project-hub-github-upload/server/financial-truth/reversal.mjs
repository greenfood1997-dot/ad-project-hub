import { createFinancialEvent } from "./financial-event.mjs";
export function createReversalEvent(original, input = {}) {
  if (!original?.eventId) throw new Error("original event required");
  if (original.status !== "confirmed") throw new Error("only confirmed event can be reversed");
  if (original.eventType === "REVERSAL" || original.reversalOf) throw new Error("cannot reverse reversal");
  if (input.eventId === original.eventId || input.amount !== undefined && input.amount !== original.amount || input.currency && input.currency !== original.currency || input.companyId && input.companyId !== original.companyId || input.projectId && input.projectId !== original.projectId) throw new Error("reversal identity mismatch");
  if (original.reversedBy) throw new Error("event already reversed");
  return createFinancialEvent({ ...original, ...input, eventId: input.eventId, eventType: "REVERSAL", amount: original.amount, reversalOf: original.eventId, status: "confirmed", createdAt: input.createdAt || original.createdAt, sourceType: input.sourceType || "reversal", sourceId: input.sourceId || original.eventId, idempotencyKey: input.idempotencyKey });
}
export function createCorrectionEvent(original, input = {}) {
  if (!original?.eventId) throw new Error("original event required");
  if (!input.amount || !Number.isInteger(input.amount) || input.amount < 0) throw new Error("correction amount required");
  if (original.status !== "confirmed" || !input.reversalEvent || input.reversalEvent.reversalOf !== original.eventId) throw new Error("valid reversal required");
  if (input.currency && input.currency !== original.currency || input.companyId && input.companyId !== original.companyId || input.projectId && input.projectId !== original.projectId || input.eventId === original.eventId) throw new Error("correction identity mismatch");
  return createFinancialEvent({ ...original, ...input, eventId: input.eventId, eventType: "CORRECTION", correctionOf: original.eventId, status: "confirmed", createdAt: input.createdAt || original.createdAt, sourceType: input.sourceType || "correction", sourceId: input.sourceId || original.eventId, idempotencyKey: input.idempotencyKey });
}
