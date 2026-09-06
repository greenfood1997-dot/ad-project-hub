import assert from 'node:assert/strict';
import {e,scenario,parties} from './financial-truth-advance-accounting-public-probe.mjs';
import {rebuildFinancialProjection} from '../server/financial-truth/projection/index.mjs';
const B=(events,asOf)=>rebuildFinancialProjection({version:2,companyId:'A',currency:'CNY',counterparties:parties,events,asOf});
const future='2027-01-01T00:00:00.000Z',cutoff='2026-12-31T00:00:00.000Z';
const F=e=>({...e,effectiveAt:future,occurredAt:future});
const base=scenario('CUSTOMER',100,120),past=base.filter(e=>e.eventId!=='03');
assert.throws(()=>B(past,cutoff),/DEPENDENCY_INCOMPLETE/);
assert.throws(()=>B([...past,F(base[2])],cutoff),/DEPENDENCY_INCOMPLETE/);
assert.equal(B([...past,F(base[2])],future).company.customerAdvanceMinor,20);
for(const side of ['CUSTOMER','SUPPLIER']){
 const h=scenario(side,100,120),lot=JSON.stringify([side,'A','02']),customer=side==='CUSTOMER';
 const out=B(h);assert.equal(out.lots[0].originalAmountMinor,20);assert.equal(out.lots[0].remainingAmountMinor,20);
 const attr=(id,amount=20,projectId='P')=>e(id,'ADVANCE_PROJECT_ATTRIBUTED',amount,{advanceLotId:lot,originatingPaymentEventId:'02',projectId});
 const assigned=B([...h,attr('05')]);assert.equal(assigned.company.cashMinor,out.company.cashMinor);assert.equal(assigned.company[customer?'customerAdvanceMinor':'supplierAdvanceMinor'],20);assert.equal(assigned.projects[0][customer?'customerAdvanceMinor':'supplierAdvanceMinor'],20);
 if(customer)assert.equal(assigned.projects[0].paidMinor,20);
 assert.throws(()=>B([...h,attr('05'),attr('06',20,'Q')]),/ATTRIBUTION_INVALID/);
 const due=e('04',customer?'RECEIVABLE_CREATED':'PAYABLE_CREATED',10,{receivableId:'next',payableId:'next'});
 const apply=e('05',customer?'CUSTOMER_ADVANCE_APPLIED':'SUPPLIER_ADVANCE_APPLIED',5,{applicationId:'app',advanceLotId:lot,originatingPaymentEventId:'02',targetObligationId:'next',targetCreationEventId:'04'});
 const refund=e('05',customer?'CUSTOMER_ADVANCE_REFUNDED':'SUPPLIER_ADVANCE_REFUND_RECEIVED',5,{direction:customer?'out':'in',advanceLotId:lot,originatingPaymentEventId:'02'});
 for(const event of [apply,refund]){assert.equal(B([...h,due,event]).lots[0].remainingAmountMinor,15);assert.throws(()=>B([...h,due,event,attr('06',15)]),/ATTRIBUTION_INVALID/);}
 assert.equal(B(scenario(side,100,100)).lots.length,0);
}
const initial=scenario('CUSTOMER',0,100),payment=initial[0],lot=JSON.stringify(['CUSTOMER','A','02']);
const rev=(id)=>e(id,'REVERSAL',100,{reversalOf:'02',projectId:null});
assert.throws(()=>B([F(payment),rev('10')]),/PREDECESSOR_NOT_VISIBLE/);
assert.equal(B([payment,F(rev('10'))]).company.cashMinor,0);
assert.equal(B([payment,rev('10')]).company.cashMinor,0);
assert.throws(()=>B([payment,rev('00')]),/PREDECESSOR_NOT_VISIBLE/);
const dep=[e('00','CUSTOMER_ADVANCE_APPLIED',10,{applicationId:'app',targetObligationId:'o',targetCreationEventId:'01',advanceLotId:lot,originatingPaymentEventId:'02'}),e('00','CUSTOMER_ADVANCE_REFUNDED',10,{direction:'out',advanceLotId:lot,originatingPaymentEventId:'02'}),e('00','ADVANCE_PROJECT_ATTRIBUTED',100,{projectId:'P',advanceLotId:lot,originatingPaymentEventId:'02'})];
for(const d of dep){assert.throws(()=>B([e('01','RECEIVABLE_CREATED',100,{receivableId:'o'}),payment,d]),/PREDECESSOR_NOT_VISIBLE/);assert.deepEqual(B([payment,F(d)],cutoff),B([payment],cutoff));}
const correction={...payment,eventId:'00',sourceId:'00',idempotencyKey:'00',correctionOf:'02'};
assert.throws(()=>B([payment,correction]),/PREDECESSOR_NOT_VISIBLE/);
assert.deepEqual(B([payment,F(correction)],cutoff),B([payment],cutoff));
assert.deepEqual(B([payment,F(rev('10'))],cutoff),B([payment],cutoff));
// A future dependent reversal cannot complete an earlier incomplete bundle.
const apply=e('05','CUSTOMER_ADVANCE_APPLIED',10,{applicationId:'a',targetObligationId:'o',targetCreationEventId:'01',advanceLotId:lot,originatingPaymentEventId:'02'});
const incomplete=[e('01','RECEIVABLE_CREATED',100,{receivableId:'o'}),payment,apply,{...rev('10'),correctionBundleId:'b'}];
for(const h of [incomplete,[...incomplete,F(e('11','REVERSAL',10,{reversalOf:'05',correctionBundleId:'b'}))]])assert.throws(()=>B(h,cutoff));
// v0.3 explicitly validates full input identity before relationship slicing.
assert.throws(()=>B([payment,F({...payment,eventId:'future',amount:200})],cutoff),/IDEMPOTENCY_CONFLICT/);
assert.deepEqual(B([...base].reverse()),B(base));
console.log('ADV_REVAL_001_002_003_REMEDIATION_V2_PUBLIC: PASS');
