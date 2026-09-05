import { encodeMinorAmountForPostgres, decodeMinorAmountFromPostgres } from "../../storage/postgres-amount-codec.mjs";
import { immutableClone } from "../../financial-event.mjs";
import { validateProjectionIdentity, assertProjectionPersistable, SUPPORTED_PROJECTION_CONTRACT_VERSION } from "./projection-storage-contract.mjs";
import { validateProjectionWatermark } from "./projection-watermark-contract.mjs";
import { encodeProjectionTimestamp } from "./projection-timestamp-codec.mjs";
import { POSTGRES_FINANCIAL_PROJECTION_ROW_FIELDS } from "./postgres-schema-contract.mjs";
const map=["projectionId","scopeType","companyId","projectId","currency","status","cashMinor","paidMinor","receivableMinor","costMinor","payableMinor","recognizedRevenueMinor","watermarkEventCount","watermarkLatestEventId","watermarkDigest","projectionContractVersion","rebuiltAt","updatedAt"];
export const PROJECTION_ROW_FIELDS=Object.freeze(map);
export function projectionRowToOrderedParams(row){return POSTGRES_FINANCIAL_PROJECTION_ROW_FIELDS.map(f=>row[f]);}
export function projectionToPostgresRow(p) {
  validateProjectionIdentity(p); assertProjectionPersistable(p);
  if (p.projectionContractVersion !== SUPPORTED_PROJECTION_CONTRACT_VERSION) throw new Error("PROJECTION_ROW_INVALID");
  validateProjectionWatermark(p.watermark);
  const validShape = p.scopeType === "COMPANY"
    ? p.projectId === null && p.cashMinor !== null && p.paidMinor === null && p.costMinor === null
    : p.scopeType === "PROJECT" && p.projectId !== null && p.cashMinor === null && p.paidMinor !== null && p.costMinor !== null;
  if (!validShape) throw new Error("PROJECTION_ROW_INVALID");
  const row = {
    projection_id: p.projectionId, scope_type: p.scopeType, company_id: p.companyId, project_id: p.projectId,
    currency: p.currency, status: p.status,
    cash_minor: p.cashMinor == null ? null : encodeMinorAmountForPostgres(p.cashMinor),
    paid_minor: p.paidMinor == null ? null : encodeMinorAmountForPostgres(p.paidMinor),
    receivable_minor: p.receivableMinor == null ? null : encodeMinorAmountForPostgres(p.receivableMinor),
    cost_minor: p.costMinor == null ? null : encodeMinorAmountForPostgres(p.costMinor),
    payable_minor: p.payableMinor == null ? null : encodeMinorAmountForPostgres(p.payableMinor),
    recognized_revenue_minor: p.recognizedRevenueMinor == null ? null : encodeMinorAmountForPostgres(p.recognizedRevenueMinor),
    watermark_event_count: String(p.watermark.eventCount), watermark_latest_event_id: p.watermark.latestCanonicalEventId,
    watermark_digest: p.watermark.canonicalDigest, projection_contract_version: p.projectionContractVersion,
    rebuilt_at: encodeProjectionTimestamp(p.rebuiltAt), updated_at: p.updatedAt == null ? null : encodeProjectionTimestamp(p.updatedAt)
  };
  return row;
}
export function postgresRowToProjection(r){const p={projectionId:r?.projection_id,scopeType:r?.scope_type,companyId:r?.company_id,projectId:r?.project_id??null,currency:r?.currency,status:r?.status,cashMinor:r?.cash_minor==null?null:decodeMinorAmountFromPostgres(r.cash_minor),paidMinor:r?.paid_minor==null?null:decodeMinorAmountFromPostgres(r.paid_minor),receivableMinor:r?.receivable_minor==null?null:decodeMinorAmountFromPostgres(r.receivable_minor),costMinor:r?.cost_minor==null?null:decodeMinorAmountFromPostgres(r.cost_minor),payableMinor:r?.payable_minor==null?null:decodeMinorAmountFromPostgres(r.payable_minor),recognizedRevenueMinor:r?.recognized_revenue_minor==null?null:decodeMinorAmountFromPostgres(r.recognized_revenue_minor),watermark:{eventCount:Number(r?.watermark_event_count),latestCanonicalEventId:r?.watermark_latest_event_id??null,canonicalDigest:r?.watermark_digest},projectionContractVersion:r?.projection_contract_version,rebuiltAt:encodeProjectionTimestamp(r?.rebuilt_at),updatedAt:r?.updated_at==null?null:encodeProjectionTimestamp(r.updated_at)};validateProjectionIdentity(p);assertProjectionPersistable(p);if(p.projectionContractVersion!==SUPPORTED_PROJECTION_CONTRACT_VERSION)throw new Error("PROJECTION_ROW_INVALID");validateProjectionWatermark(p.watermark);return immutableClone(p);}
