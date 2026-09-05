export function buildBusinessIdempotencyKey(input = {}) {
  const fields = ["eventType","companyId","projectId","clientId","supplierId","employeeId","approvalId","paymentId","sourceType","sourceId","amount","currency","effectiveAt","reversalOf","correctionOf"];
  return `ft1:${Buffer.from(JSON.stringify(Object.fromEntries(fields.map(k => [k, input[k] ?? null])))).toString("base64url")}`;
}
export function validateIdempotencyKey(key) { return typeof key === "string" && key.length >= 8 && key.length <= 1024 && /^ft1:[A-Za-z0-9_-]+$/.test(key); }
export function canonicalSemanticPayload(event = {}) { return JSON.stringify(Object.fromEntries(["companyId","eventType","amount","currency","direction","projectId","clientId","supplierId","employeeId","approvalId","paymentId","sourceType","sourceId","reversalOf","correctionOf"].map(k => [k, event[k] ?? null]))); }
export function duplicateEvent(existing, key) { return (existing || []).find((e) => e.idempotencyKey === key) || null; }
