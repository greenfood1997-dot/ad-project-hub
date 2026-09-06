import {immutable} from '../reconciliation/observation.mjs';
import {createReconciliationProjectionSnapshotV1 as v1Snapshot} from '../reconciliation/projection-snapshot.mjs';
import {compareRebuiltVsPersistedProjectionV1 as compareV1} from '../reconciliation/comparator.mjs';
import {projectionToPostgresRow,postgresRowToProjection} from '../projection/storage/projection-row-mapper.mjs';
import {sameProjectionWatermark,sameMaterializedProjectionState} from '../projection/storage/projection-watermark-contract.mjs';
export const ADVANCE_PROJECTION_VERSION=2;
const fields=['customerAdvanceMinor','supplierAdvanceMinor'];
const fail=()=>{throw new Error('PROJECTION_V2_INVALID');};
function advances(p){for(const key of fields)if(!Number.isSafeInteger(p?.[key])||p[key]<0)fail();}
export function createAdvanceProjectionSnapshot(p,{source}={}){
 advances(p);let base;
 if(source==='P1_REBUILD_V2'){
  if(Object.hasOwn(p,'projectionContractVersion'))fail();
  base=v1Snapshot(p,{source:'P1_REBUILD'});
 }else if(source==='PERSISTED_PROJECTION_V2'){
  if(p.projectionContractVersion!==2)fail();
  base=v1Snapshot({...p,projectionContractVersion:1},{source:'PERSISTED_PROJECTION'});
 }else fail();
 for(const [key,value] of Object.entries(base))if(key.endsWith('Minor')&&value<0)fail();
 return immutable({...base,...Object.fromEntries(fields.map(k=>[k,p[k]])),projectionContractVersion:'2'});
}
export function compareAdvanceProjectionSnapshots({expected,observed,...args}){
 const diagnostic=()=>immutable({...args,comparisonType:'REBUILT_VS_PERSISTED_PROJECTION',comparisonStatus:'INVALID_INPUT',reasonCode:null,differences:[],reconciliationContractVersion:'2'});
 try{
  if(expected?.projectionContractVersion!=='2'||observed!==null&&observed?.projectionContractVersion!=='2')return diagnostic();
  advances(expected);if(observed)advances(observed);
  for(const p of [expected,observed].filter(Boolean))for(const [k,v] of Object.entries(p))if(k.endsWith('Minor')&&(!Number.isSafeInteger(v)||v<0))return diagnostic();
  const result=compareV1({...args,expected:{...expected,projectionContractVersion:'1'},observed:observed===null?null:{...observed,projectionContractVersion:'1'}});
  if(result.comparisonStatus==='INVALID_INPUT')return diagnostic();
  const differences=[...result.differences];
  if(observed)for(const field of fields)if(expected[field]!==observed[field])differences.push({category:'FINANCIAL_VALUE_DIFFERENCE',field,expected:expected[field],observed:observed[field]});
  return immutable({...result,expectedSnapshot:expected,observedSnapshot:observed,differences,comparisonStatus:observed?(differences.length?'MISMATCH':'MATCH'):result.comparisonStatus,projectionContractVersion:'2',reconciliationContractVersion:'2'});
 }catch{return diagnostic();}
}
export function advanceProjectionToRow(p){
 createAdvanceProjectionSnapshot(p,{source:'PERSISTED_PROJECTION_V2'});
 const row=projectionToPostgresRow({...p,projectionContractVersion:1});
 return {...row,projection_contract_version:2,customer_advance_minor:String(p.customerAdvanceMinor),supplier_advance_minor:String(p.supplierAdvanceMinor)};
}
export function rowToAdvanceProjection(row){
 if(row?.projection_contract_version!==2)fail();
 const decode=v=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]*)$/.test(v)||!Number.isSafeInteger(Number(v)))fail();return Number(v);};
 const base=postgresRowToProjection({...row,projection_contract_version:1});
 const p={...base,projectionContractVersion:2,customerAdvanceMinor:decode(row.customer_advance_minor),supplierAdvanceMinor:decode(row.supplier_advance_minor)};
 createAdvanceProjectionSnapshot(p,{source:'PERSISTED_PROJECTION_V2'});return immutable(p);
}
// Isolated query contract only; never creates or activates a schema.
export const ADVANCE_PROJECTION_COLUMNS=Object.freeze(['projection_id','scope_type','company_id','project_id','currency','status','cash_minor','paid_minor','receivable_minor','cost_minor','payable_minor','recognized_revenue_minor','watermark_event_count','watermark_latest_event_id','watermark_digest','projection_contract_version','rebuilt_at','updated_at','customer_advance_minor','supplier_advance_minor']);
const cols=ADVANCE_PROJECTION_COLUMNS.join(', ');
export const ADVANCE_PROJECTION_SQL=Object.freeze({
 get:`SELECT ${cols} FROM financial_projections WHERE scope_type=$1 AND company_id=$2 AND project_id IS NOT DISTINCT FROM $3 AND currency=$4`,
 insert:`INSERT INTO financial_projections (${cols}) VALUES (${ADVANCE_PROJECTION_COLUMNS.map((_,i)=>'$'+(i+1)).join(', ')}) RETURNING ${cols}`,
 update:`UPDATE financial_projections SET ${ADVANCE_PROJECTION_COLUMNS.filter(k=>!['projection_id','scope_type','company_id','project_id','currency'].includes(k)).map(k=>k+'=$'+(ADVANCE_PROJECTION_COLUMNS.indexOf(k)+1)).join(', ')} WHERE projection_contract_version=2 AND scope_type=$2 AND company_id=$3 AND project_id IS NOT DISTINCT FROM $4 AND currency=$5 AND watermark_event_count=$21 AND watermark_latest_event_id IS NOT DISTINCT FROM $22 AND watermark_digest=$23 RETURNING ${cols}`
});
export class PostgresAdvanceProjectionRepository{
 async getProjection(tx,scope){const r=await tx.query(ADVANCE_PROJECTION_SQL.get,[scope.scopeType,scope.companyId,scope.projectId??null,scope.currency]);if(r.rows.length>1)fail();return r.rows.length?rowToAdvanceProjection(r.rows[0]):null;}
 async saveProjection(tx,p,expected){
  const row=advanceProjectionToRow(p),current=await this.getProjection(tx,p);
  if(current&&sameMaterializedProjectionState(current,p)&&fields.every(k=>current[k]===p[k]))return 'SAME_STATE';
  if(!sameProjectionWatermark(current?.watermark??null,expected))throw new Error('PROJECTION_STALE_WRITE');
  const params=ADVANCE_PROJECTION_COLUMNS.map(k=>k==='projection_id'&&current?current.projectionId:row[k]);
  if(!current){
   try{const r=await tx.query(ADVANCE_PROJECTION_SQL.insert,params);if(r.rows.length!==1)fail();rowToAdvanceProjection(r.rows[0]);return 'SAVED';}
   catch(e){if(e.code!=='23505')throw e;const winner=await this.getProjection(tx,p);if(winner&&sameMaterializedProjectionState(winner,p)&&fields.every(k=>winner[k]===p[k]))return 'SAME_STATE';throw new Error('PROJECTION_STALE_WRITE');}
  }
  const r=await tx.query(ADVANCE_PROJECTION_SQL.update,[...params,String(expected.eventCount),expected.latestCanonicalEventId,expected.canonicalDigest]);if(!r.rows.length)throw new Error('PROJECTION_STALE_WRITE');rowToAdvanceProjection(r.rows[0]);return 'SAVED';
 }
}
