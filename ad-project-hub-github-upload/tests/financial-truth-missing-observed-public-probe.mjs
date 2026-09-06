import assert from 'node:assert/strict';
import {compareRebuiltVsPersistedProjection} from '../server/financial-truth/reconciliation/comparator.mjs';
import {createIndeterminateReconciliationObservation} from '../server/financial-truth/reconciliation/observation.mjs';
import {InMemoryReconciliationRepository} from '../server/financial-truth/reconciliation/in-memory-repository.mjs';
import {PostgresReconciliationRepository, POSTGRES_RECONCILIATION_SQL as SQL} from '../server/financial-truth/reconciliation/storage/index.mjs';

const time='2026-09-06T01:00:00.000Z';
const expected={scopeType:'COMPANY',companyId:'A',projectId:null,currency:'CNY',cashMinor:10,receivableMinor:0,payableMinor:0,recognizedRevenueMinor:0,status:'CURRENT',watermark:{eventCount:1,latestCanonicalEventId:'e',canonicalDigest:'d'.repeat(64)},rebuiltAt:time,projectionContractVersion:'1'};
const compare=(observed,id='missing')=>compareRebuiltVsPersistedProjection({expected,observed,reconciliationId:id,checkedAt:time,sourceContext:{trace:'probe'}});
function harness(){
 const rows=new Map();
 const tx={async query(sql,params){
  if(sql===SQL.insert){if(rows.has(params[0]))throw Object.assign(new Error('duplicate'),{code:'23505'});const row=Object.fromEntries(SQL.columns.map((k,i)=>[k,params[i]]));rows.set(params[0],row);return {rows:[structuredClone(row)]};}
  assert.equal(sql,SQL.get);return {rows:rows.has(params[0])?[structuredClone(rows.get(params[0]))]:[]};
 }};
 return {tx,repo:new PostgresReconciliationRepository()};
}
const observation=compare(null);
assert.equal(observation.reasonCode,'OBSERVED_STATE_MISSING');
assert.equal(observation.comparisonStatus,'INDETERMINATE');
const {tx,repo}=harness(),memory=new InMemoryReconciliationRepository();
assert.equal(memory.appendReconciliation(observation).outcome,'APPENDED');
assert.equal((await repo.appendReconciliation(tx,observation)).outcome,'APPENDED');
assert.deepEqual(await repo.getReconciliation(tx,'missing'),observation);
assert.deepEqual(memory.getReconciliation('missing'),observation);
assert.equal(memory.appendReconciliation(observation).outcome,'EXISTING_IDENTICAL');
assert.equal((await repo.appendReconciliation(tx,observation)).outcome,'EXISTING_IDENTICAL');
for(const change of [{expectedSnapshot:{...expected,cashMinor:11}},{expectedWatermark:{...expected.watermark,canonicalDigest:'a'.repeat(64)}}]){
 const changed={...observation,...change};
 assert.throws(()=>memory.appendReconciliation(changed));
 await assert.rejects(()=>repo.appendReconciliation(tx,changed),change.expectedWatermark?/MALFORMED_PERSISTED_ROW/:/DUPLICATE_CONTENT_CONFLICT/);
}
for(const change of [
 {expectedSnapshot:{...expected,cashMinor:1.5}},
 {expectedSnapshot:{...expected,companyId:'B'}},
 {expectedSnapshot:{...expected,projectionContractVersion:'bad'}},
 {expectedWatermark:{...expected.watermark,eventCount:-1}},
 {expectedWatermark:{...expected.watermark,canonicalDigest:'a'.repeat(64)}},
 {observedSnapshot:expected},{observedWatermark:expected.watermark},
 {reasonCode:'BAD'},{expectedSnapshot:null},
 {differences:[{category:'FINANCIAL_VALUE_DIFFERENCE',field:'cashMinor',expected:10,observed:0}]}
]){
 const h=harness();
 await assert.rejects(()=>h.repo.appendReconciliation(h.tx,{...observation,...change}),/MALFORMED_PERSISTED_ROW/);
}
for(const reason of ['STALE_REBUILD','INVALID_HISTORY','INSUFFICIENT_EVIDENCE','UNSUPPORTED_COMPARISON','OBSERVED_STATE_MISSING']){
 const record=createIndeterminateReconciliationObservation({reconciliationId:reason,scopeType:'COMPANY',companyId:'A',currency:'CNY',reasonCode:reason,checkedAt:time,sourceContext:null});
 const h=harness();assert.equal((await h.repo.appendReconciliation(h.tx,record)).outcome,'APPENDED');
 assert.deepEqual(await h.repo.getReconciliation(h.tx,reason),record);
 if(reason!=='OBSERVED_STATE_MISSING'){const bad=harness();await assert.rejects(()=>bad.repo.appendReconciliation(bad.tx,{...record,expectedSnapshot:expected}),/MALFORMED_PERSISTED_ROW/);}
}
for(const observed of [expected,{...expected,cashMinor:9}]){
 const h=harness(),record=compare(observed);
 assert.equal((await h.repo.appendReconciliation(h.tx,record)).outcome,'APPENDED');
 assert.deepEqual(await h.repo.getReconciliation(h.tx,record.reconciliationId),record);
}
console.log('OBSERVED_STATE_MISSING_PUBLIC_PROBE: PASS');
console.log('COMPARATOR_TO_PG_ROUNDTRIP: PASS');
console.log('IN_MEMORY_PG_CONSISTENCY: PASS');
