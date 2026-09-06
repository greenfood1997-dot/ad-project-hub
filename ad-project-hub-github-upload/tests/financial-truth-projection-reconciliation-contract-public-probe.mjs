import assert from 'node:assert/strict';
import {rebuildCompanyProjection,rebuildProjectProjection} from '../server/financial-truth/projection/projection-rebuild.mjs';
import {PostgresProjectionRepository,projectionToPostgresRow} from '../server/financial-truth/projection/storage/index.mjs';
import {createReconciliationProjectionSnapshot as snapshot,compareRebuiltVsPersistedProjection as compare,reconciliationPersistenceEligibility,InMemoryReconciliationRepository} from '../server/financial-truth/reconciliation/index.mjs';
import {PostgresReconciliationRepository,POSTGRES_RECONCILIATION_SQL as SQL} from '../server/financial-truth/reconciliation/storage/index.mjs';
const time='2026-09-06T01:00:00.000Z';
for(const scope of ['COMPANY','PROJECT']){
 const rebuilt=scope==='COMPANY'?rebuildCompanyProjection('A','CNY',[]):rebuildProjectProjection('A','P','CNY',[]);
 const expected=snapshot(rebuilt,{source:'P1_REBUILD'});
 const persisted={...rebuilt,projectionId:'id',projectId:scope==='COMPANY'?null:'P',projectionContractVersion:1,updatedAt:null,...(scope==='COMPANY'?{paidMinor:null,costMinor:null}:{cashMinor:null})};
 const row=projectionToPostgresRow(persisted),pg=new PostgresProjectionRepository(),tx={async query(){return {rows:[row]};}};
 const read=scope==='COMPANY'?await pg.getCompanyProjection(tx,'A','CNY'):await pg.getProjectProjection(tx,'A','P','CNY');
 const observed=snapshot(read,{source:'PERSISTED_PROJECTION'});
 const cmp=(a,b)=>compare({expected:a,observed:b,checkedAt:time,reconciliationId:'r',sourceContext:null});
 assert.equal(cmp(expected,expected).comparisonStatus,'MATCH');
 assert.equal(cmp(observed,observed).comparisonStatus,'MATCH');
 assert.equal(cmp(expected,observed).comparisonStatus,'MATCH');
 assert(!Object.hasOwn(observed,'projectionId'));assert(!Object.hasOwn(observed,'updatedAt'));
 assert(Object.isFrozen(expected.watermark));
 for(const record of [cmp(expected,observed),cmp(expected,null)]){
  assert.equal(reconciliationPersistenceEligibility(record),'EVIDENCE_SUBJECT_TO_RECORD_VALIDATION');
  let stored;const context={async query(sql,params){if(sql===SQL.insert){if(stored)throw Object.assign(new Error('duplicate'),{code:'23505'});stored=Object.fromEntries(SQL.columns.map((c,i)=>[c,params[i]]));return {rows:[stored]};}assert.equal(sql,SQL.get);return {rows:[stored]};}};
  const repo=new PostgresReconciliationRepository(),memory=new InMemoryReconciliationRepository();
  assert.equal((await repo.appendReconciliation(context,record)).outcome,'APPENDED');
  assert.deepEqual(await repo.getReconciliation(context,'r'),record);
  assert.equal(memory.appendReconciliation(record).outcome,'APPENDED');
  assert.equal(memory.appendReconciliation(record).outcome,'EXISTING_IDENTICAL');
  assert.equal((await repo.appendReconciliation(context,record)).outcome,'EXISTING_IDENTICAL');
  const changed={...record,sourceContext:{changed:true}};
  assert.throws(()=>memory.appendReconciliation(changed));
  await assert.rejects(()=>repo.appendReconciliation(context,changed),/DUPLICATE_CONTENT_CONFLICT/);
 }
 for(const version of [null,undefined,'1','01',' 1 ',true,2])assert.throws(()=>snapshot({...persisted,projectionContractVersion:version},{source:'PERSISTED_PROJECTION'}));
 for(const change of [{currency:''},{scopeType:'BAD'},{companyId:''},{watermark:{...rebuilt.watermark,eventCount:-1}},{watermark:{...rebuilt.watermark,latestCanonicalEventId:'not-empty'}},{[scope==='COMPANY'?'cashMinor':'paidMinor']:Number.MAX_SAFE_INTEGER+1}]){
  assert.throws(()=>snapshot({...rebuilt,...change},{source:'P1_REBUILD'}));
 }
 assert.throws(()=>snapshot({...rebuilt,projectionContractVersion:1},{source:'P1_REBUILD'}));
 assert.throws(()=>snapshot(rebuilt));
}
console.log('P1_TO_TYPE_A_PROBE: PASS');
console.log('PG_PROJECTION_TO_TYPE_A_PROBE: PASS');
console.log('P1_PG_MIXED_MATCH_PROBE: PASS');
console.log('PROJECTION_TO_RECONCILIATION_PERSISTENCE_PROBE: PASS');
