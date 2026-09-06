import {immutable} from '../reconciliation/observation.mjs';
import {assertReconciliationDiagnosticPolicy} from '../reconciliation/persistence-policy.mjs';
import {POSTGRES_RECONCILIATION_SQL as SQL} from '../reconciliation/storage/postgres-reconciliation-sql.mjs';
import {observationToPostgresParams,sameImmutableContent} from '../reconciliation/storage/postgres-reconciliation-row-mapper.mjs';
import {compareAdvanceProjectionSnapshots} from './projection-v2.mjs';
import {stableSerialize} from '../projection/projection-watermark.mjs';
export function validateAdvanceObservation(record){
 assertReconciliationDiagnosticPolicy(record);
 if(record?.reconciliationContractVersion!=='2'||record.projectionContractVersion!=='2')throw new Error('MALFORMED_PERSISTED_ROW');
 const canonical=compareAdvanceProjectionSnapshots({expected:record.expectedSnapshot,observed:record.observedSnapshot,checkedAt:record.checkedAt,reconciliationId:record.reconciliationId,sourceContext:record.sourceContext});
 if(canonical.comparisonStatus==='INVALID_INPUT'||!sameImmutableContent(canonical,record))throw new Error('MALFORMED_PERSISTED_ROW');
 return immutable(record);
}
export class PostgresAdvanceReconciliationRepository{
 async getReconciliation(tx,id){
  const out=await tx.query(SQL.get,[id]);if(out.rows.length>1)throw new Error('MALFORMED_PERSISTED_ROW');if(!out.rows.length)return null;
  const r=out.rows[0],parse=v=>typeof v==='string'?JSON.parse(v):v;
  try{return validateAdvanceObservation({reconciliationId:r.reconciliation_id,comparisonType:r.comparison_type,scopeType:r.scope_type,companyId:r.company_id,projectId:r.project_id,currency:r.currency,comparisonStatus:r.comparison_status,reasonCode:r.reason_code,projectionContractVersion:r.projection_contract_version,reconciliationContractVersion:r.reconciliation_contract_version,checkedAt:r.checked_at,createdAt:r.created_at,expectedSnapshot:parse(r.expected_snapshot),observedSnapshot:parse(r.observed_snapshot),expectedWatermark:parse(r.expected_watermark),observedWatermark:parse(r.observed_watermark),differences:parse(r.differences),sourceContext:parse(r.source_context)});}catch{throw Object.assign(new Error('MALFORMED_PERSISTED_ROW'),{code:'MALFORMED_PERSISTED_ROW'});}
 }
 async appendReconciliation(tx,record){
  validateAdvanceObservation(record);
  try{await tx.query(SQL.insert,observationToPostgresParams(record));}
  catch(e){if(e.code!=='23505')throw e;const old=await this.getReconciliation(tx,record.reconciliationId);if(old&&sameImmutableContent(old,record))return {outcome:'EXISTING_IDENTICAL',record:old};throw new Error('DUPLICATE_CONTENT_CONFLICT');}
  const read=await this.getReconciliation(tx,record.reconciliationId);if(!read||!sameImmutableContent(read,record))throw new Error('MALFORMED_PERSISTED_ROW');return {outcome:'APPENDED',record:read};
 }
}
