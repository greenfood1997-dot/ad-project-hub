import {createFinancialEvent,immutableClone} from '../financial-event.mjs';
import {buildFinancialRelationshipGraph,resolveEffectiveFinancialEvents} from '../history.mjs';
import {buildProjectionWatermark} from '../projection/projection-watermark.mjs';
import {canonicalSemanticPayload} from '../idempotency.mjs';
import {canonicalTimestampMillis,compareCanonicalEventTime} from '../canonical-event-time.mjs';

export const ADVANCE_EVENT_TYPES=Object.freeze(['CUSTOMER_PAYMENT_ALLOCATED','SUPPLIER_PAYMENT_ALLOCATED','CUSTOMER_ADVANCE_APPLIED','SUPPLIER_ADVANCE_APPLIED','CUSTOMER_ADVANCE_REFUNDED','SUPPLIER_ADVANCE_REFUND_RECEIVED','ADVANCE_PROJECT_ATTRIBUTED']);
const extension=new Set(ADVANCE_EVENT_TYPES);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const text=x=>typeof x==='string'&&x.trim().length>0;
const money=x=>Number.isSafeInteger(x)&&x>=0;
// Same UTC representation as FinancialEvent, plus round-trip calendar validity.
function temporal(value,code='ADVANCE_INVALID_TEMPORAL_INPUT'){
 return canonicalTimestampMillis(value,code);
}
export const advanceLotId=(type,company,payment)=>JSON.stringify([type,company,payment]);
// V2 events are isolated: v1's accepted event vocabulary is unchanged.
export function createAdvanceFinancialEvent(input){
 if(!input||!text(input.eventType))fail('ADVANCE_INVALID_EVENT');
 if(extension.has(input.eventType)){
  createFinancialEvent({...input,eventType:'OTHER_ADJUSTMENT'});
  if(input.direction!==(input.eventType==='CUSTOMER_ADVANCE_REFUNDED'?'out':input.eventType==='SUPPLIER_ADVANCE_REFUND_RECEIVED'?'in':'none'))fail('ADVANCE_DIRECTION_INVALID');
  if(!text(input.confirmedCommandId)||!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length)fail('ADVANCE_EVIDENCE_REQUIRED');
 }else createFinancialEvent(input);
 for(const key of ['effectiveAt','occurredAt','createdAt'])temporal(input[key]);
 if(input.confirmedAt!==undefined&&input.confirmedAt!==null)temporal(input.confirmedAt);
 if(input.status!=='confirmed')fail('ADVANCE_UNCONFIRMED');
 if(input.amountMinor!==undefined&&input.amountMinor!==input.amount)fail('ADVANCE_AMOUNT_ALIAS_CONFLICT');
 return immutableClone(input);
}
const customer=t=>t.startsWith('CUSTOMER_')||['CLIENT_PAYMENT_CONFIRMED','RECEIVABLE_CREATED'].includes(t);
const payment=t=>['CLIENT_PAYMENT_CONFIRMED','SUPPLIER_PAYMENT_CONFIRMED'].includes(t);
const normalized=e=>extension.has(e.eventType)?{...e,eventType:'OTHER_ADJUSTMENT',metadata:{...e.metadata,advanceCanonicalEventType:e.eventType}}:e;
function history(events){
 const originals=events.map(createAdvanceFinancialEvent),map=new Map(originals.map(e=>[e.eventId,e]));
 const graph=buildFinancialRelationshipGraph(originals.map(normalized));
 // Reuse the accepted graph's canonical effectiveAt/occurredAt/eventId order.
 const positions=new Map(graph.history.map((e,i)=>[e.eventId,i]));
 for(const e of originals)for(const ref of [e.reversalOf,e.correctionOf,e.paymentEventId,e.originatingPaymentEventId,e.targetCreationEventId]){
  if(ref&&(!positions.has(ref)||positions.get(ref)>=positions.get(e.eventId)))fail('ADVANCE_PREDECESSOR_NOT_VISIBLE');
 }
 // Reuse exact predecessor/uniqueness/cycle validation, preserving v2 type identity.
 for(const e of originals)if(e.correctionOf&&map.get(e.correctionOf)?.eventType!==e.eventType)fail('ADVANCE_CORRECTION_TYPE_MISMATCH');
 const effective=resolveEffectiveFinancialEvents(originals.map(normalized)).map(e=>map.get(e.eventId));
 const effectiveIds=new Set(effective.map(e=>e.eventId));
 for(const e of effective)for(const ref of [e.paymentEventId,e.originatingPaymentEventId,e.targetCreationEventId,e.allocationManifestEventId]){
  if(ref&&!effectiveIds.has(ref))fail('ADVANCE_DEPENDENCY_INCOMPLETE');
 }
 // Removing a predecessor with dependents requires an explicitly complete bundle.
 for(const e of originals.filter(e=>e.reversalOf)){
  const dependents=originals.filter(d=>[d.paymentEventId,d.originatingPaymentEventId,d.targetCreationEventId,d.allocationManifestEventId].includes(e.reversalOf));
  for(const d of dependents){
   const reversal=originals.find(r=>r.reversalOf===d.eventId);
   if(!reversal||!text(e.correctionBundleId)||reversal.correctionBundleId!==e.correctionBundleId)fail('ADVANCE_CORRECTION_BUNDLE_INCOMPLETE');
  }
 }
 return {originals,effective};
}
export function rebuildAdvanceProjections({companyId,currency,events,counterparties,asOf}){
 if(!text(companyId)||!/^[A-Z]{3}$/.test(currency)||!Array.isArray(counterparties)||!Array.isArray(events))fail('ADVANCE_INVALID_REQUEST');
 const validated=events.map(createAdvanceFinancialEvent);
 // Journal rejects conflicting business payloads. A replay is not a second
 // stored event: reject non-canonical replay histories explicitly, never silently dedup.
 const identities=new Map();
 for(const event of validated){
  const prior=identities.get(event.idempotencyKey);
  if(prior)fail(canonicalSemanticPayload(prior)===canonicalSemanticPayload(event)?'ADVANCE_NON_CANONICAL_REPLAY_HISTORY':'IDEMPOTENCY_CONFLICT');
  identities.set(event.idempotencyKey,event);
 }
 const cutoff=asOf===undefined?null:temporal(asOf,'ADVANCE_INVALID_AS_OF');
 const eligible=cutoff===null?validated:validated.filter(e=>temporal(e.effectiveAt)<=cutoff);
 // Filter BEFORE reversal/correction resolution, so future history cannot erase
 // an earlier fact. createdAt is audit metadata, never an applicability clock.
 const {originals,effective}=history(eligible);
 for(const e of originals)if(e.companyId!==companyId||e.currency!==currency)fail('ADVANCE_SCOPE_MISMATCH');
 const canonical=[...effective].sort(compareCanonicalEventTime);
 const obligations=new Map(),lots=new Map(),projects=new Map(),usedIds=new Set(),cashIdentities=new Set(),payments=new Map();
 let cash=0,revenue=0;
 const project=id=>{if(!text(id))fail('ADVANCE_PROJECT_REQUIRED');if(!projects.has(id))projects.set(id,{paidMinor:0,costMinor:0,recognizedRevenueMinor:0});return projects.get(id);};
 const add=(a,b)=>{const value=a+b;if(!money(value))fail('ADVANCE_BALANCE_INVARIANT');return value;};
 function party(e,type=customer(e.eventType)?'CUSTOMER':'SUPPLIER'){
  const id=e[type==='CUSTOMER'?'clientId':'supplierId'];
  if(!text(id)||e.counterpartyId!==undefined&&e.counterpartyId!==id||!counterparties.some(p=>p.companyId===companyId&&p.counterpartyId===id&&p.counterpartyType===type))fail('ADVANCE_COUNTERPARTY_INVALID');
  return {type,id};
 }
 function match(e,state,type){
  const p=party(e,type);
  if(p.id!==state.counterpartyId||(e.projectId??null)!==(state.projectId??null))fail('ADVANCE_ATTRIBUTION_MISMATCH');
 }
 function target(e,type){
  const o=obligations.get(e.targetObligationId);
  if(!o||o.type!==type||o.creationEventId!==e.targetCreationEventId)fail('ADVANCE_TARGET_INVALID');
  match(e,o,type);return o;
 }
 function unique(id){if(!text(id)||usedIds.has(id))fail('ADVANCE_DUPLICATE_IDENTITY');usedIds.add(id);}
 function createLot(e,p,residual){
  if(!residual)return;
  const id=advanceLotId(p.type,companyId,e.eventId);
  lots.set(id,{descriptor:{advanceLotId:id,advanceType:p.type,companyId,counterpartyId:p.id,currency,originatingPaymentEventId:e.eventId,originalAmountMinor:residual,initialProjectAttribution:e.projectId?{type:'PROJECT_ATTRIBUTED',projectId:e.projectId}:{type:'COMPANY_UNALLOCATED',projectId:null},occurredAt:e.occurredAt,effectiveAt:e.effectiveAt,createdAt:e.createdAt,evidenceRefs:e.evidenceRefs??[e.sourceEvidence],allocationManifestEventId:e.allocationManifestEventId??null},counterpartyId:p.id,projectId:e.projectId??null,remaining:residual,applied:0,refunded:0,attributed:!!e.projectId});
 }
 for(const e of canonical){
  const type=e.eventType,amt=e.amount;
  if(payment(type)||['CASH_IN','CASH_OUT','CUSTOMER_ADVANCE_REFUNDED','SUPPLIER_ADVANCE_REFUND_RECEIVED'].includes(type)){
   const identity=JSON.stringify([e.companyId,e.currency,e.sourceType,e.sourceId]);
   if(cashIdentities.has(identity))fail('ADVANCE_DUPLICATE_CASH_FACT');
   cashIdentities.add(identity);
  }
  if(type==='CASH_IN'||type==='CASH_OUT'){if(e.direction!==(type==='CASH_IN'?'in':'out'))fail('ADVANCE_DIRECTION_INVALID');cash=add(cash,type==='CASH_IN'?amt:-amt);continue;}
  if(type==='REVENUE_RECOGNIZED'){if(e.direction!=='none')fail('ADVANCE_DIRECTION_INVALID');revenue=add(revenue,amt);if(e.projectId)project(e.projectId).recognizedRevenueMinor=add(project(e.projectId).recognizedRevenueMinor,amt);continue;}
  if(type==='COST_INCURRED'){if(e.direction!=='none')fail('ADVANCE_DIRECTION_INVALID');project(e.projectId).costMinor=add(project(e.projectId).costMinor,amt);continue;}
  if(['RECEIVABLE_CREATED','PAYABLE_CREATED'].includes(type)){
   if(e.direction!=='none')fail('ADVANCE_DIRECTION_INVALID');
   const p=party(e),id=e[type==='RECEIVABLE_CREATED'?'receivableId':'payableId'];unique(id);
   obligations.set(id,{type:p.type,counterpartyId:p.id,projectId:e.projectId??null,creationEventId:e.eventId,remaining:amt});continue;
  }
  if(payment(type)){
   const p=party(e);if(e.direction!==(p.type==='CUSTOMER'?'in':'out'))fail('ADVANCE_DIRECTION_INVALID');
   if(!e.allocationManifestEventId&&e.allocationPolicy!=='NO_INITIAL_TARGET')fail('ADVANCE_ALLOCATION_POLICY_REQUIRED');
   payments.set(e.eventId,e);
   cash=add(cash,p.type==='CUSTOMER'?amt:-amt);
   if(p.type==='CUSTOMER'&&e.projectId)project(e.projectId).paidMinor=add(project(e.projectId).paidMinor,amt);
   if(!e.allocationManifestEventId)createLot(e,p,amt);
   continue;
  }
  if(type.endsWith('_PAYMENT_ALLOCATED')){
   const original=payments.get(e.paymentEventId),p=party(e);
   if(!original||original.allocationManifestEventId!==e.eventId||customer(original.eventType)!==(p.type==='CUSTOMER'))fail('ADVANCE_MANIFEST_INVALID');
   match(e,{counterpartyId:party(original).id,projectId:original.projectId??null},p.type);unique(e.manifestId);
   const o=target(e,p.type),available=original.amount,applied=Math.min(available,o.remaining);
   if(e.amount!==applied||e.expectedOutstandingMinor!==o.remaining||e.residualAmountMinor!==available-applied)fail('ADVANCE_ALLOCATION_INVALID');
   createLot(original,p,available-applied);
   o.remaining=add(o.remaining,-applied);continue;
  }
  if(extension.has(type)){
   const lot=lots.get(e.advanceLotId);if(!lot||e.originatingPaymentEventId!==lot.descriptor.originatingPaymentEventId)fail('ADVANCE_LOT_MISSING');
   const lotType=lot.descriptor.advanceType;
   if(type==='ADVANCE_PROJECT_ATTRIBUTED'){
    party(e,lotType);if((e[lotType==='CUSTOMER'?'clientId':'supplierId'])!==lot.counterpartyId||lot.attributed||lot.applied>0||lot.refunded>0||!text(e.projectId)||amt!==lot.remaining)fail('ADVANCE_ATTRIBUTION_INVALID');
    lot.projectId=e.projectId;lot.attributed=true;
    if(lotType==='CUSTOMER')project(e.projectId).paidMinor=add(project(e.projectId).paidMinor,amt);
    continue;
   }
   const expectedType=customer(type)?'CUSTOMER':'SUPPLIER';if(expectedType!==lotType)fail('ADVANCE_TYPE_MISMATCH');
   match(e,lot,lotType);if(amt<=0||amt>lot.remaining)fail('ADVANCE_OVER_CONSUMPTION');
   if(type.endsWith('_APPLIED')){
    unique(e.applicationId);const o=target(e,lotType);if(amt>o.remaining)fail('ADVANCE_OVER_APPLICATION');o.remaining=add(o.remaining,-amt);lot.applied=add(lot.applied,amt);
   }else{
    if(!text(e.sourceEvidence))fail('ADVANCE_REFUND_EVIDENCE_REQUIRED');
    unique(e.sourceType+':'+e.sourceId);
    lot.refunded=add(lot.refunded,amt);
    cash=add(cash,lotType==='CUSTOMER'?-amt:amt);
    if(lotType==='CUSTOMER'&&lot.projectId)project(lot.projectId).paidMinor=add(project(lot.projectId).paidMinor,-amt);
   }
   lot.remaining=add(lot.remaining,-amt);continue;
  }
  fail('ADVANCE_UNSUPPORTED_EVENT');
 }
 const watermark=buildProjectionWatermark(originals.map(normalized));
 const rebuiltAt=[...originals].map(e=>e.createdAt).sort((a,b)=>canonicalTimestampMillis(a)-canonicalTimestampMillis(b)||a.localeCompare(b)).at(-1)??'1970-01-01T00:00:00.000Z';
 const totals=id=>{
  const subset=x=>id===undefined||x.projectId===id;
  const sum=(xs,fn)=>xs.reduce((a,x)=>add(a,fn(x)),0);
  return {receivableMinor:sum([...obligations.values()].filter(o=>o.type==='CUSTOMER'&&subset(o)),o=>o.remaining),payableMinor:sum([...obligations.values()].filter(o=>o.type==='SUPPLIER'&&subset(o)),o=>o.remaining),customerAdvanceMinor:sum([...lots.values()].filter(l=>l.descriptor.advanceType==='CUSTOMER'&&subset(l)),l=>l.remaining),supplierAdvanceMinor:sum([...lots.values()].filter(l=>l.descriptor.advanceType==='SUPPLIER'&&subset(l)),l=>l.remaining)};
 };
 for(const x of [...obligations.values(),...lots.values()])if(x.projectId)project(x.projectId);
 const common={companyId,currency,status:'CURRENT',watermark,rebuiltAt};
 return immutableClone({company:{...common,scopeType:'COMPANY',cashMinor:cash,recognizedRevenueMinor:revenue,...totals()},projects:[...projects].map(([projectId,p])=>({...common,scopeType:'PROJECT',projectId,...p,...totals(projectId)})),lots:[...lots.values()].map(l=>({...l.descriptor,projectAttribution:l.projectId?{type:'PROJECT_ATTRIBUTED',projectId:l.projectId}:{type:'COMPANY_UNALLOCATED',projectId:null},remainingAmountMinor:l.remaining}))});
}
export * from './projection-v2.mjs';
export * from './reconciliation-v2.mjs';
