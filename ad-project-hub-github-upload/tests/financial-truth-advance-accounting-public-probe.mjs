import assert from 'node:assert/strict';
import * as A from '../server/financial-truth/advance/index.mjs';
import {rebuildFinancialProjection} from '../server/financial-truth/projection/index.mjs';
import {PostgresProjectionRepository} from '../server/financial-truth/projection/storage/index.mjs';
import {createReconciliationProjectionSnapshot,compareRebuiltVsPersistedProjection} from '../server/financial-truth/reconciliation/index.mjs';
import {PostgresReconciliationRepository} from '../server/financial-truth/reconciliation/storage/index.mjs';
import {InMemoryReconciliationRepository} from '../server/financial-truth/reconciliation/index.mjs';
import {POSTGRES_RECONCILIATION_SQL as R} from '../server/financial-truth/reconciliation/storage/index.mjs';
const t='2026-01-01T00:00:00.000Z';
const parties=[{companyId:'A',counterpartyType:'CUSTOMER',counterpartyId:'C'},{companyId:'A',counterpartyType:'SUPPLIER',counterpartyId:'S'}];
const e=(id,type,amount,extra={})=>({eventId:id,eventType:type,amount,direction:'none',companyId:'A',currency:'CNY',occurredAt:t,effectiveAt:t,createdAt:t,status:'confirmed',createdBy:'finance',sourceType:'bank',sourceId:id,sourceEvidence:'bank proof',economicCategory:'test',idempotencyKey:id,clientId:'C',supplierId:'S',confirmedCommandId:id,evidenceRefs:['proof'],...extra});
const rebuild=events=>rebuildFinancialProjection({version:2,companyId:'A',currency:'CNY',events,counterparties:parties});
function scenario(side,obligation,amount,projectId=null){
 const customer=side==='CUSTOMER',events=customer?[]:[e('00','CASH_IN',1000,{direction:'in'})];
 if(obligation)events.push(e('01',customer?'RECEIVABLE_CREATED':'PAYABLE_CREATED',obligation,{projectId,...(customer?{receivableId:'o'}:{payableId:'o'})}));
 events.push(e('02',customer?'CLIENT_PAYMENT_CONFIRMED':'SUPPLIER_PAYMENT_CONFIRMED',amount,{direction:customer?'in':'out',projectId,...(obligation?{allocationManifestEventId:'03'}:{allocationPolicy:'NO_INITIAL_TARGET'})}));
 if(obligation)events.push(e('03',customer?'CUSTOMER_PAYMENT_ALLOCATED':'SUPPLIER_PAYMENT_ALLOCATED',Math.min(amount,obligation),{projectId,paymentEventId:'02',manifestId:'m',targetObligationId:'o',targetCreationEventId:'01',expectedOutstandingMinor:obligation,residualAmountMinor:Math.max(amount-obligation,0)}));
 return events;
}
for(const side of ['CUSTOMER','SUPPLIER']){
 const customer=side==='CUSTOMER',balance=customer?'receivableMinor':'payableMinor',advance=customer?'customerAdvanceMinor':'supplierAdvanceMinor';
 for(const [due,pay] of [[100,40],[100,100],[100,120],[0,10]]){
  const result=rebuild(scenario(side,due,pay,'P'));
  assert.equal(result.company[balance],Math.max(due-pay,0));assert.equal(result.company[advance],Math.max(pay-due,0));
  assert.equal(result.projects[0][advance],result.company[advance]);assert.equal(result.company.recognizedRevenueMinor,0);assert.equal(result.projects[0].costMinor,0);
 }
 const initial=scenario(side,0,100,'P'),lot=A.advanceLotId(side,'A','02');
 const due=e('04',customer?'RECEIVABLE_CREATED':'PAYABLE_CREATED',100,{projectId:'P',...(customer?{receivableId:'o'}:{payableId:'o'})});
 assert.equal(rebuild([...initial,due]).company[advance],100);
 const apply=(id,amount)=>e(id,customer?'CUSTOMER_ADVANCE_APPLIED':'SUPPLIER_ADVANCE_APPLIED',amount,{projectId:'P',applicationId:id,advanceLotId:lot,originatingPaymentEventId:'02',targetObligationId:'o',targetCreationEventId:'04'});
 const applied=rebuild([...initial,due,apply('05',40),apply('06',30)]);
 assert.equal(applied.company[advance],30);assert.equal(applied.company[balance],30);
 if(customer)assert.equal(applied.projects[0].paidMinor,100);
 assert.throws(()=>rebuild([...initial,due,apply('05',101)]));
 const refund=amount=>e('07',customer?'CUSTOMER_ADVANCE_REFUNDED':'SUPPLIER_ADVANCE_REFUND_RECEIVED',amount,{direction:customer?'out':'in',projectId:'P',advanceLotId:lot,originatingPaymentEventId:'02'});
 assert.equal(rebuild([...initial,refund(10)]).company[advance],90);
 if(customer)assert.equal(rebuild([...initial,refund(10)]).projects[0].paidMinor,90);
 assert.throws(()=>rebuild([...initial,refund(101)]));
 const unallocated=scenario(side,0,20);
 const attributed=rebuild([...unallocated,e('04','ADVANCE_PROJECT_ATTRIBUTED',20,{projectId:'P',advanceLotId:lot,originatingPaymentEventId:'02'})]);
 assert.equal(attributed.company[advance],20);assert.equal(attributed.projects[0][advance],20);
 const original=scenario(side,100,120);
 const bundle=[e('10','REVERSAL',120,{projectId:null,reversalOf:'02',correctionBundleId:'bundle'}),e('11','REVERSAL',100,{projectId:null,reversalOf:'03',correctionBundleId:'bundle'})];
 assert.equal(rebuild([...original,...bundle]).company[balance],100);
 assert.equal(rebuild([...original,...bundle]).company[advance],0);
 assert.throws(()=>rebuild([...initial,due,apply('05',40),e('10','REVERSAL',100,{projectId:'P',reversalOf:'02'})]));
}
const result=rebuild(scenario('CUSTOMER',0,10)),raw=result.company;
assert.equal(raw.cashMinor,10);assert.equal(raw.receivableMinor,0);assert.equal(raw.customerAdvanceMinor,10);
assert(Object.isFrozen(result.lots[0]));assert.equal(result.lots[0].remainingAmountMinor,10);
const persisted={...raw,projectId:null,projectionId:'p',projectionContractVersion:2,paidMinor:null,costMinor:null,updatedAt:null};
let row=null;const records=new Map(),tx={async query(sql,params){
 if(sql===A.ADVANCE_PROJECTION_SQL.get)return {rows:row?[structuredClone(row)]:[]};
 if(sql===A.ADVANCE_PROJECTION_SQL.insert){row=Object.fromEntries(A.ADVANCE_PROJECTION_COLUMNS.map((k,i)=>[k,params[i]]));return {rows:[row]};}
 if(sql===R.insert){if(records.has(params[0]))throw Object.assign(new Error('unique'),{code:'23505'});const r=Object.fromEntries(R.columns.map((k,i)=>[k,params[i]]));records.set(params[0],r);return {rows:[r]};}
 if(sql===R.get)return {rows:records.has(params[0])?[records.get(params[0])]:[]};
 throw new Error('unexpected SQL');
}};
const repo=new PostgresProjectionRepository({version:2});
assert.equal(await repo.saveCompanyProjection(tx,persisted,null),'SAVED');
const read=await repo.getCompanyProjection(tx,'A','CNY');assert.deepEqual(read,persisted);
assert.equal(await repo.saveCompanyProjection(tx,persisted,persisted.watermark),'SAME_STATE');
const expected=createReconciliationProjectionSnapshot(raw,{source:'P1_REBUILD_V2'}),observed=createReconciliationProjectionSnapshot(read,{source:'PERSISTED_PROJECTION_V2'});
assert.equal(compareRebuiltVsPersistedProjection({expected,observed,reconciliationId:'match',checkedAt:t}).comparisonStatus,'MATCH');
assert.equal(compareRebuiltVsPersistedProjection({expected,observed:{...observed,customerAdvanceMinor:20},reconciliationId:'diff',checkedAt:t}).comparisonStatus,'MISMATCH');
assert.equal(compareRebuiltVsPersistedProjection({expected,observed:{...observed,projectionContractVersion:'1'},reconciliationId:'cross',checkedAt:t}).comparisonStatus,'INVALID_INPUT');
const rec=compareRebuiltVsPersistedProjection({expected,observed:null,reconciliationId:'missing',checkedAt:t,sourceContext:null});
assert.equal(rec.reasonCode,'OBSERVED_STATE_MISSING');
const memory=new InMemoryReconciliationRepository(),pg=new PostgresReconciliationRepository({version:'2'});
assert.equal(memory.appendReconciliation(rec).outcome,'APPENDED');
assert.equal((await pg.appendReconciliation(tx,rec)).outcome,'APPENDED');
assert.deepEqual(await pg.getReconciliation(tx,'missing'),rec);
assert.equal((await pg.appendReconciliation(tx,rec)).outcome,'EXISTING_IDENTICAL');
assert.throws(()=>A.createAdvanceProjectionSnapshot({...read,projectionContractVersion:1},{source:'PERSISTED_PROJECTION_V2'}));
assert.throws(()=>rebuild([e('x','SUPPLIER_PAYMENT_CONFIRMED',10,{direction:'out',allocationPolicy:'NO_INITIAL_TARGET'})]));
console.log('ADVANCE_DOMAIN_PUBLIC_PROBES: PASS');
console.log('ATOMIC_IMP_005_V2_PUBLIC_CHAIN: PASS');
console.log('P1_V2_PG_SNAPSHOT_RECONCILIATION: PASS');
export {e,scenario,rebuild,parties,persisted,t};
