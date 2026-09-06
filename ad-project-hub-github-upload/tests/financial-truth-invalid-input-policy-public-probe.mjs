import assert from 'node:assert/strict';
import {compareRebuiltVsPersistedProjection as compare,createObservation,InMemoryReconciliationRepository,reconciliationPersistenceEligibility} from '../server/financial-truth/reconciliation/index.mjs';
import {PostgresReconciliationRepository,POSTGRES_RECONCILIATION_SQL as SQL} from '../server/financial-truth/reconciliation/storage/index.mjs';
const time='2026-09-06T01:00:00.000Z';
const expected={scopeType:'COMPANY',companyId:'A',projectId:null,currency:'CNY',cashMinor:10,receivableMinor:0,payableMinor:0,recognizedRevenueMinor:0,status:'CURRENT',watermark:{eventCount:1,latestCanonicalEventId:'e',canonicalDigest:'d'.repeat(64)},rebuiltAt:time,projectionContractVersion:'1'};
const base={expected,checkedAt:time,reconciliationId:'probe',sourceContext:null};
for(const diagnostic of [
 compare({...base,expected:null,observed:null}),
 compare({...base,observed:{...expected,companyId:'B'}}),
 createObservation({comparisonStatus:'INVALID_INPUT',scopeType:'PROJECT',companyId:'A',projectId:'P',currency:'CNY',reconciliationId:'factory'})
]){
 assert.equal(diagnostic.comparisonStatus,'INVALID_INPUT');
 assert.equal(reconciliationPersistenceEligibility(diagnostic),'TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY');
 const memory=new InMemoryReconciliationRepository();let calls=0;
 const tx={async query(){calls++;throw new Error('must not query');}};
 const policy=e=>e.code==='NON_PERSISTABLE_RECONCILIATION_DIAGNOSTIC';
 assert.throws(()=>memory.appendReconciliation(diagnostic),policy);
 await assert.rejects(()=>new PostgresReconciliationRepository().appendReconciliation(tx,diagnostic),policy);
 assert.equal(calls,0);assert.equal(memory.records.size,0);
}
for(const observed of [expected,{...expected,cashMinor:9},null]){
 const record=compare({...base,observed});
 assert.equal(reconciliationPersistenceEligibility(record),'EVIDENCE_SUBJECT_TO_RECORD_VALIDATION');
 let row;const tx={async query(sql,params){
  if(sql===SQL.insert){if(row)throw Object.assign(new Error('duplicate'),{code:'23505'});row=Object.fromEntries(SQL.columns.map((c,i)=>[c,params[i]]));return {rows:[row]};}
  assert.equal(sql,SQL.get);return {rows:[row]};
 }};
 const memory=new InMemoryReconciliationRepository(),pg=new PostgresReconciliationRepository();
 assert.equal(memory.appendReconciliation(record).outcome,'APPENDED');
 assert.equal((await pg.appendReconciliation(tx,record)).outcome,'APPENDED');
 assert.deepEqual(await pg.getReconciliation(tx,record.reconciliationId),record);
 assert.equal(memory.appendReconciliation(record).outcome,'EXISTING_IDENTICAL');
 assert.equal((await pg.appendReconciliation(tx,record)).outcome,'EXISTING_IDENTICAL');
}
console.log('INVALID_INPUT_POLICY_PROBE: PASS');
console.log('IN_MEMORY_PG_INVALID_INPUT_CONSISTENCY: PASS');
