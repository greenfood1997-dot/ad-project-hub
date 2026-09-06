import assert from 'node:assert/strict';
import {e,parties} from './financial-truth-advance-accounting-public-probe.mjs';
import {rebuildFinancialProjection,compareCanonicalEventTime,buildProjectionWatermark} from '../server/financial-truth/projection/index.mjs';
import {buildCanonicalFinancialHistory} from '../server/financial-truth/history.mjs';
const sec='2026-02-01T00:00:00Z',zero='2026-02-01T00:00:00.000Z',ms='2026-02-01T00:00:00.001Z';
const stamp=(x,t)=>({...x,effectiveAt:t,occurredAt:t,createdAt:t});
const payment=stamp(e('20','CLIENT_PAYMENT_CONFIRMED',100,{direction:'in',projectId:null,allocationPolicy:'NO_INITIAL_TARGET'}),sec);
const B=(events,asOf)=>rebuildFinancialProjection({version:2,companyId:'A',currency:'CNY',counterparties:parties,events,asOf});
const lot=JSON.stringify(['CUSTOMER','A','20']);
const due=stamp(e('10','RECEIVABLE_CREATED',100,{receivableId:'o'}),'2026-01-01T00:00:00Z');
const dependencies=[
 e('30','REVERSAL',100,{reversalOf:'20',projectId:null}),
 e('30','CUSTOMER_ADVANCE_APPLIED',10,{advanceLotId:lot,originatingPaymentEventId:'20',targetCreationEventId:'10',targetObligationId:'o',applicationId:'a'}),
 e('30','CUSTOMER_ADVANCE_REFUNDED',10,{direction:'out',advanceLotId:lot,originatingPaymentEventId:'20'}),
 e('30','ADVANCE_PROJECT_ATTRIBUTED',100,{projectId:'P',advanceLotId:lot,originatingPaymentEventId:'20'}),
 {...payment,eventId:'30',sourceId:'30',idempotencyKey:'30',correctionOf:'20',amount:80}
];
for(const dep of dependencies){
 const history=[due,payment,stamp(dep,ms)];
 const out=B(history);
 for(const permutation of [[history[2],history[1],history[0]],[history[1],history[0],history[2]]]){
  assert.deepEqual(B(permutation),out);
 }
 assert.throws(()=>B([due,stamp(payment,ms),stamp(dep,sec)]),/ADVANCE_PREDECESSOR_NOT_VISIBLE/);
 // Same effective instant: occurredAt decides, not raw effectiveAt spelling.
 B([due,{...payment,effectiveAt:zero},{...stamp(dep,ms),effectiveAt:sec}]);
 assert.throws(()=>B([due,{...stamp(payment,ms),effectiveAt:zero},{...stamp(dep,sec),effectiveAt:sec}]),/ADVANCE_PREDECESSOR_NOT_VISIBLE/);
}
assert.equal(B([payment,stamp(dependencies[0],ms)]).company.cashMinor,0);
assert.equal(B([payment],zero).company.cashMinor,100);
assert.equal(B([stamp(payment,ms)],sec).company.cashMinor,0);
assert.equal(compareCanonicalEventTime(payment,{...payment,effectiveAt:zero,occurredAt:zero}),0);
assert(compareCanonicalEventTime(payment,stamp(payment,ms))<0);
assert(compareCanonicalEventTime(stamp(payment,ms),payment)>0);
assert(compareCanonicalEventTime({...payment,eventId:'a'},{...payment,eventId:'b',effectiveAt:zero,occurredAt:zero})<0);
assert.throws(()=>compareCanonicalEventTime({...payment,effectiveAt:'bad'},payment));
const facts=[payment,stamp(e('40','CASH_IN',10,{direction:'in'}),ms),{...payment,eventId:'21',sourceId:'21',idempotencyKey:'21',effectiveAt:zero,occurredAt:zero}];
for(const permutation of [[facts[2],facts[0],facts[1]],[...facts].reverse()]){
 assert.deepEqual(buildCanonicalFinancialHistory(permutation),buildCanonicalFinancialHistory(facts));
 assert.deepEqual(buildProjectionWatermark(permutation),buildProjectionWatermark(facts));
 assert.deepEqual(B(permutation),B(facts));
}
assert.equal(B(facts).company.rebuiltAt,ms);
console.log('MIXED_PRECISION_PUBLIC_HISTORY_PROJECTION_DEPENDENCIES_DIGEST: PASS');
