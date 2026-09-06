// Immutable result construction does not imply persistence eligibility.
// INVALID_INPUT remains a transient diagnostic; see persistence-policy.mjs.
import {validateProjectionWatermark,sameProjectionWatermark} from '../projection/storage/projection-watermark-contract.mjs';
function clone(v){if(v===undefined)return v; return structuredClone(v);}
export function deepFreeze(v){ if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v); for(const x of Object.values(v)) deepFreeze(x);} return v; }
export function immutable(v){ return deepFreeze(clone(v)); }
export function createObservation(input){
 for(const side of ['expected','observed']){
  const snapshot=input[`${side}Snapshot`],w=input[`${side}Watermark`];
  if(w!=null)validateProjectionWatermark(w);
  if(snapshot!=null){validateProjectionWatermark(snapshot.watermark);if(!sameProjectionWatermark(w,snapshot.watermark))throw new Error('RECONCILIATION_WATERMARK_CONFLICT');}
 }
 return immutable({...input, reconciliationContractVersion: input.reconciliationContractVersion ?? "1", differences: input.differences ?? []});
}
export function createIndeterminateReconciliationObservation({reconciliationId, comparisonType="REBUILT_VS_PERSISTED_PROJECTION", scopeType, companyId, projectId=null, currency, reasonCode, checkedAt, createdAt=checkedAt, sourceContext}) { if(!["STALE_REBUILD","INVALID_HISTORY","INSUFFICIENT_EVIDENCE","OBSERVED_STATE_MISSING","UNSUPPORTED_COMPARISON"].includes(reasonCode)) throw new TypeError("invalid reasonCode"); return createObservation({reconciliationId,comparisonType,scopeType,companyId,projectId,currency,comparisonStatus:"INDETERMINATE",reasonCode,expectedSnapshot:null,observedSnapshot:null,expectedWatermark:null,observedWatermark:null,differences:[],checkedAt,createdAt,projectionContractVersion:null,sourceContext}); }
