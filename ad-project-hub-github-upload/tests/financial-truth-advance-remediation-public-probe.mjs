import assert from 'node:assert/strict';
import {e,scenario,parties,t} from './financial-truth-advance-accounting-public-probe.mjs';
import {rebuildFinancialProjection} from '../server/financial-truth/projection/index.mjs';
import {advanceLotId} from '../server/financial-truth/advance/index.mjs';
import {createReconciliationProjectionSnapshot,compareRebuiltVsPersistedProjection} from '../server/financial-truth/reconciliation/index.mjs';
import {createObservation} from '../server/financial-truth/reconciliation/observation.mjs';
import {PostgresReconciliationRepository} from '../server/financial-truth/reconciliation/storage/index.mjs';
const rebuild=(events,asOf)=>rebuildFinancialProjection({version:2,companyId:'A',currency:'CNY',counterparties:parties,events,asOf});
const initial=scenario('CUSTOMER',0,100),pay=initial[0];
assert.throws(()=>rebuild([pay,structuredClone(pay)]),/ADVANCE_NON_CANONICAL_REPLAY_HISTORY/);
for(const change of [{amount:101},{companyId:'B'},{projectId:'P'},{currency:'USD'},{sourceId:'other'}]){
 assert.throws(()=>rebuild([pay,{...pay,eventId:'other',...change}]),/IDEMPOTENCY_CONFLICT/);
}
assert.equal(rebuild([pay,{...pay,eventId:'other',sourceId:'other',idempotencyKey:'other'}]).company.cashMinor,200);
console.log('ADV_DUPLICATE_IDEMPOTENCY_SAFE / EXACT_FAIL_CLOSED / CONFLICT_FAIL_CLOSED: PASS');
const snapshot=events=>createReconciliationProjectionSnapshot(rebuild(events).company,{source:'P1_REBUILD_V2'});
const valid=snapshot(initial),compare=(expected,observed)=>compareRebuiltVsPersistedProjection({expected,observed,reconciliationId:'probe',checkedAt:t});
for(const events of [[],initial]){const s=snapshot(events);assert.equal(compare(s,s).comparisonStatus,'MATCH');}
const bads=[{...valid.watermark,latestCanonicalEventId:null},{...valid.watermark,eventCount:0},{...valid.watermark,canonicalDigest:'bogus'},{eventCount:1,canonicalDigest:valid.watermark.canonicalDigest},{...valid.watermark,eventCount:Number.MAX_SAFE_INTEGER+1}];
for(const version of ['1','2']){
 const good={...valid,projectionContractVersion:version};
 if(version==='1'){delete good.customerAdvanceMinor;delete good.supplierAdvanceMinor;}
 for(const watermark of bads){
  const bad={...good,watermark};
  assert.equal(compare(bad,bad).comparisonStatus,'INVALID_INPUT');
  assert.equal(compare(good,bad).comparisonStatus,'INVALID_INPUT');
  const record=compare(good,good),forged={...record,expectedSnapshot:bad,observedSnapshot:bad,expectedWatermark:watermark,observedWatermark:watermark};
  let calls=0;const tx={async query(){calls++;throw new Error('must not query');}};
  await assert.rejects(()=>new PostgresReconciliationRepository({version}).appendReconciliation(tx,forged));
  assert.equal(calls,0);assert.throws(()=>createObservation(forged));
 }
 const record=compare(good,good);
 assert.throws(()=>createObservation({...record,expectedWatermark:{...good.watermark,canonicalDigest:'a'.repeat(64)}}));
}
console.log('ADV_CANONICAL_WATERMARK / TYPE_A / PREWRITE_PERSISTENCE: PASS');
const future='2027-01-01T00:00:00.000Z',middle='2026-06-01T00:00:00.000Z',cutoff='2026-12-31T23:59:59.999Z';
const futureEvent=x=>({...x,effectiveAt:future,occurredAt:future});
const allocation=scenario('CUSTOMER',100,100).map(x=>x.eventId==='03'?futureEvent(x):x);
assert.throws(()=>rebuild(allocation,cutoff),/ADVANCE_DEPENDENCY_INCOMPLETE/);
assert.throws(()=>rebuild(allocation.filter(x=>x.eventId!=='03'),cutoff),/ADVANCE_DEPENDENCY_INCOMPLETE/);
assert.equal(rebuild(allocation,future).company.receivableMinor,0);
assert.deepEqual(rebuild([...allocation].reverse(),future),rebuild(allocation,future));
assert.deepEqual(rebuild([...scenario('CUSTOMER',100,100)].reverse()),rebuild(scenario('CUSTOMER',100,100)));
const lot=advanceLotId('CUSTOMER','A','02');
const refund=e('refund','CUSTOMER_ADVANCE_REFUNDED',20,{direction:'out',advanceLotId:lot,originatingPaymentEventId:'02',effectiveAt:middle,occurredAt:middle});
// v0.2 strict completeness supersedes the former future-manifest exemption.
assert.throws(()=>rebuild([...allocation,refund],cutoff),/ADVANCE_DEPENDENCY_INCOMPLETE/);
assert.throws(()=>rebuild([...allocation,refund],future),/ADVANCE_LOT_MISSING/);
// Legitimate NO_INITIAL_TARGET advances still support intermediate refunds.
assert.equal(rebuild([...initial,refund],cutoff).company.customerAdvanceMinor,80);
assert.equal(rebuild([...initial,refund],cutoff).company.cashMinor,80);
const due=e('04','RECEIVABLE_CREATED',100,{receivableId:'o'});
const app=futureEvent(e('05','CUSTOMER_ADVANCE_APPLIED',40,{advanceLotId:lot,originatingPaymentEventId:'02',applicationId:'app',targetObligationId:'o',targetCreationEventId:'04'}));
assert.equal(rebuild([...initial,due,app],cutoff).company.customerAdvanceMinor,100);
assert.equal(rebuild([...initial,due,app],future).company.customerAdvanceMinor,60);
assert.equal(rebuild([...initial,futureEvent(refund)],cutoff).company.customerAdvanceMinor,100);
assert.equal(rebuild([...initial,futureEvent(refund)],future).company.customerAdvanceMinor,80);
const attribution=futureEvent(e('05','ADVANCE_PROJECT_ATTRIBUTED',100,{advanceLotId:lot,originatingPaymentEventId:'02',projectId:'P'}));
assert.deepEqual(rebuild([...initial,attribution],cutoff).projects,[]);
assert.equal(rebuild([...initial,attribution],future).projects[0].customerAdvanceMinor,100);
// The broader audit found future reversal/correction resolution too. Bound it
// before resolving history, not after calculating monetary effects.
const reversal=futureEvent(e('reverse','REVERSAL',100,{reversalOf:'02',projectId:null}));
assert.equal(rebuild([...initial,reversal],cutoff).company.cashMinor,100);
assert.equal(rebuild([...initial,reversal],future).company.cashMinor,0);
const correction=futureEvent({...pay,eventId:'correct',sourceId:'correct',idempotencyKey:'correct',correctionOf:'02',amount:80});
assert.equal(rebuild([...initial,reversal,correction],cutoff).company.cashMinor,100);
assert.equal(rebuild([...initial,reversal,correction],future).company.cashMinor,80);
// createdAt does not activate an event. Equal effective times use occurredAt,
// then eventId. A manifest ordered before its payment must fail closed.
assert.throws(()=>rebuild(allocation.map(x=>({...x,createdAt:future})),cutoff),/ADVANCE_DEPENDENCY_INCOMPLETE/);
assert.throws(()=>rebuild(scenario('CUSTOMER',100,100).map(x=>x.eventId==='03'?{...x,eventId:'00'}:x.eventId==='02'?{...x,allocationManifestEventId:'00'}:x)),/ADVANCE_PREDECESSOR_NOT_VISIBLE/);
console.log('ADV_NO_FUTURE_ALLOCATION_APPLICATION_REFUND_ATTRIBUTION / INTERMEDIATE_STATE / REVERSAL_CORRECTION: PASS');
