import assert from 'node:assert/strict';
import {e,scenario,rebuild,persisted} from './financial-truth-advance-accounting-public-probe.mjs';
import {advanceLotId,ADVANCE_PROJECTION_SQL as SQL,ADVANCE_PROJECTION_COLUMNS as cols,advanceProjectionToRow} from '../server/financial-truth/advance/index.mjs';
import {PostgresProjectionRepository} from '../server/financial-truth/projection/storage/index.mjs';
function barrier(){let n=0,release;const done=new Promise(r=>release=r);return async()=>{if(++n===2)release();await done;};}
// Shared row CAS, not a scripted winner/STALE response.
let state=advanceProjectionToRow(persisted),gate=barrier();const trace=[];
const client=name=>({async query(sql,params){
 if(sql===SQL.get){const snapshot=structuredClone(state);trace.push(name+' read '+snapshot.watermark_digest);await gate();return {rows:[snapshot]};}
 assert.equal(sql,SQL.update);
 const compatible=String(state.watermark_event_count)===params[20]&&state.watermark_latest_event_id===params[21]&&state.watermark_digest===params[22];
 trace.push(name+(compatible?' CAS winner':' CAS stale'));
 if(!compatible)return {rows:[]};
 state=Object.fromEntries(cols.map((c,i)=>[c,params[i]]));return {rows:[structuredClone(state)]};
}});
const repo=new PostgresProjectionRepository({version:2});
const target=(amount,digest)=>({...persisted,customerAdvanceMinor:amount,watermark:{...persisted.watermark,eventCount:2,latestCanonicalEventId:'next',canonicalDigest:digest.repeat(64)}});
const results=await Promise.allSettled([repo.saveCompanyProjection(client('W1'),target(20,'a'),persisted.watermark),repo.saveCompanyProjection(client('W2'),target(30,'b'),persisted.watermark)]);
assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
assert.equal(results.find(r=>r.status==='rejected').reason.message,'PROJECTION_STALE_WRITE');
assert.equal(trace.filter(t=>t.includes('read')).length,2);
assert.equal(state.customer_advance_minor,'20');
console.log(trace.join('\n'));
const lot=advanceLotId('CUSTOMER','A','02');
const obligation=e('04','RECEIVABLE_CREATED',100,{receivableId:'o'});
const application=(id,amount)=>e(id,'CUSTOMER_ADVANCE_APPLIED',amount,{applicationId:id,advanceLotId:lot,originatingPaymentEventId:'02',targetObligationId:'o',targetCreationEventId:'04'});
const refund=(id,amount)=>e(id,'CUSTOMER_ADVANCE_REFUNDED',amount,{direction:'out',advanceLotId:lot,originatingPaymentEventId:'02'});
async function race(base,a,b){
 let committed=structuredClone(base);const rendezvous=barrier();
 async function append(event){
  const observed=rebuild(committed);assert.equal(observed.lots[0].remainingAmountMinor,100);
  await rendezvous();
  // Synchronous compare/validate + publish models the required atomic history guard.
  const candidate=[...committed,event];rebuild(candidate);committed=candidate;return true;
 }
 const r=await Promise.allSettled([append(a),append(b)]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert(rebuild(committed).lots[0].remainingAmountMinor>=0);
 return committed;
}
const base=[...scenario('CUSTOMER',0,100),obligation];
await race(base,application('05',60),application('06',60));
await race(base,application('05',80),refund('06',50));
const attribution=(id,p)=>e(id,'ADVANCE_PROJECT_ATTRIBUTED',100,{projectId:p,advanceLotId:lot,originatingPaymentEventId:'02'});
const assigned=await race(scenario('CUSTOMER',0,100),attribution('05','P1'),attribution('06','P2'));
assert.equal(rebuild(assigned).projects.length,1);
assert.equal(rebuild(assigned).company.cashMinor,100);
assert.equal(rebuild(assigned).projects[0].paidMinor,100);
for(const dependent of [application('05',30),refund('05',40),attribution('05','P1')]){
 const history=[...base,dependent];
 assert.throws(()=>rebuild([...history,e('10','REVERSAL',100,{projectId:null,reversalOf:'02'})]));
 const complete=[...history,e('10','REVERSAL',dependent.amount,{projectId:dependent.projectId,reversalOf:'05',correctionBundleId:'bundle'}),e('11','REVERSAL',100,{projectId:null,reversalOf:'02',correctionBundleId:'bundle'})];
 const rebuilt=rebuild(complete);assert.equal(rebuilt.company.cashMinor,0);assert.equal(rebuilt.company.customerAdvanceMinor,0);
}
console.log('ADVANCE_SHARED_STATE_CAS_AND_LOT_PROBES: PASS');
console.log('ADVANCE_CORRECTION_BUNDLE_PROBES: PASS');
// Cross-version state is rejected before any write, even with equal watermark.
for(const [version,rowVersion] of [[2,1],[1,2]]){
 let writes=0;
 const tx={async query(sql){if(sql.startsWith('SELECT'))return {rows:[{...state,projection_contract_version:rowVersion}]};writes++;throw new Error('must not write');}};
 const routed=new PostgresProjectionRepository({version});
 await assert.rejects(()=>routed.saveCompanyProjection(tx,{...persisted,projectionContractVersion:version},persisted.watermark));
 assert.equal(writes,0);
}
assert.throws(()=>new PostgresProjectionRepository({version:3}),/PROJECTION_VERSION_UNSUPPORTED/);
