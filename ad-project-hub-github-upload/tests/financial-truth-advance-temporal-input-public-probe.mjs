import assert from 'node:assert/strict';
import {scenario,parties} from './financial-truth-advance-accounting-public-probe.mjs';
import {rebuildFinancialProjection} from '../server/financial-truth/projection/index.mjs';
import {PostgresProjectionRepository} from '../server/financial-truth/projection/storage/index.mjs';
const payment=scenario('CUSTOMER',0,100)[0],cutoff='2026-06-01T00:00:00.000Z';
const B=(events,asOf)=>rebuildFinancialProjection({version:2,companyId:'A',currency:'CNY',counterparties:parties,events,asOf});
let cases=0,writes=0,outputs=0;
const repo=new PostgresProjectionRepository({version:2}),tx={async query(){writes++;throw Error('must not reach SQL');}};
for(const field of ['effectiveAt','occurredAt','createdAt','confirmedAt']){
 const invalid=[null,'not-a-date','','2026-02-30T00:00:00.000Z','2026-01-01T24:00:00.000Z','2026-01-01',42,{},'2026-01-01T00:00:00+00:00'];
 if(field!=='confirmedAt')invalid.push(undefined);
 for(const value of invalid){
  if(field==='confirmedAt'&&value===null)continue;
  const event={...payment,[field]:value};
  for(const asOf of [undefined,cutoff]){
   await assert.rejects(async()=>{const raw=B([event],asOf).company;outputs++;await repo.saveCompanyProjection(tx,raw,null);});cases++;
  }
 }
}
for(const asOf of [null,'','bad',123,'2026-02-30T00:00:00.000Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00+08:00'])assert.throws(()=>B([],asOf),/ADVANCE_INVALID_AS_OF/);
assert.equal(outputs,0);assert.equal(writes,0);
const empty=B([],cutoff);assert.equal(empty.company.watermark.eventCount,0);assert.equal(empty.company.watermark.latestCanonicalEventId,null);
assert.equal(B([payment],cutoff).company.cashMinor,100);
const future={...payment,effectiveAt:'2027-01-01T00:00:00.000Z',occurredAt:'2027-01-01T00:00:00.000Z'};
assert.deepEqual(B([future],cutoff),empty);
assert.throws(()=>B([{...future,occurredAt:'bad'}],cutoff));
// Both accepted UTC representations and real leap days remain legal.
for(const timestamp of ['2024-02-29T00:00:00Z','2024-02-29T00:00:00.000Z'])assert.equal(B([{...payment,effectiveAt:timestamp,occurredAt:timestamp,createdAt:timestamp}],cutoff).company.cashMinor,100);
console.log(`TEMPORAL_INPUT_PUBLIC: PASS (${cases} malformed-history cases; projection outputs=${outputs}; SQL calls=${writes})`);
