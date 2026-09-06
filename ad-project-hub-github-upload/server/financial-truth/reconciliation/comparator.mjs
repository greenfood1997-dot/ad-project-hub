import { projectionContract } from "../projection/projection-contract.mjs";
import { COMPARISON_TYPES, COMPARISON_STATUS, RECONCILIATION_CONTRACT_VERSION } from "./contract.mjs";
import { createObservation } from "./observation.mjs";
import {validateProjectionWatermark} from '../projection/storage/projection-watermark-contract.mjs';
const identity=["scopeType","companyId","projectId","currency"], watermark=["eventCount","latestCanonicalEventId","canonicalDigest"];
const validDate=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v))&&v.includes('T');
function invalid(base){return createObservation({...base,comparisonStatus:"INVALID_INPUT",reasonCode:null,differences:[]});}
function validateProjection(p, scope){
 if(!p||p.scopeType!==scope||!['COMPANY','PROJECT'].includes(scope)) return false;
 if(typeof p.companyId!=='string'||!p.companyId) return false;
 if(typeof p.currency!=='string'||!p.currency) return false;
 if(scope==='COMPANY' ? (p.projectId!==null) : (typeof p.projectId!=='string'||!p.projectId)) return false;
 for(const f of projectionContract(scope).map(x=>x.name)){
  if(!Object.hasOwn(p,f)) return false;
  const v=p[f];
  if(f.endsWith('Minor')) { if(!Number.isSafeInteger(v)) return false; }
  else if(f==='watermark') { try{validateProjectionWatermark(v);}catch{return false;} }
 }
 return typeof p.projectionContractVersion==='string'&&p.projectionContractVersion.length>0;
}
export function compareRebuiltVsPersistedProjectionV1({expected, observed, checkedAt, reconciliationId, sourceContext}){
 const base={reconciliationId,comparisonType:COMPARISON_TYPES.TYPE_A,checkedAt,createdAt:checkedAt,sourceContext};
 if(!reconciliationId||!validDate(checkedAt)||!expected||observed===undefined) return invalid(base);
 const scope=expected.scopeType; if(!validateProjection(expected,scope)) return invalid(base);
 if(observed===null) return createObservation({...base,scopeType:scope,companyId:expected.companyId,projectId:expected.projectId,currency:expected.currency,comparisonStatus:"INDETERMINATE",reasonCode:"OBSERVED_STATE_MISSING",expectedSnapshot:expected,observedSnapshot:null,expectedWatermark:expected.watermark,observedWatermark:null,projectionContractVersion:expected.projectionContractVersion});
 if(!validateProjection(observed,scope)) return invalid(base);
 if(identity.some(k=>expected[k]!==observed[k])) return invalid({...base,scopeType:scope,companyId:expected.companyId,projectId:expected.projectId,currency:expected.currency});
 const diffs=[]; for(const f of projectionContract(scope).map(x=>x.name)){ if(f==="watermark"||f==="rebuiltAt"||f==="status"||f==="projectionId") continue; if(expected[f]!==observed[f]) diffs.push({category:f.endsWith("Minor")?"FINANCIAL_VALUE_DIFFERENCE":"IDENTITY_DIFFERENCE",field:f,expected:expected[f],observed:observed[f]}); }
 for(const k of watermark) if(expected.watermark[k]!==observed.watermark[k]) diffs.push({category:"WATERMARK_DIFFERENCE",field:`watermark.${k}`,expected:expected.watermark[k],observed:observed.watermark[k]});
 if(expected.projectionContractVersion!==observed.projectionContractVersion) diffs.push({category:"VERSION_DIFFERENCE",field:"projectionContractVersion",expected:expected.projectionContractVersion,observed:observed.projectionContractVersion});
 return createObservation({...base,scopeType:scope,companyId:expected.companyId,projectId:expected.projectId??null,currency:expected.currency,comparisonStatus:diffs.length?"MISMATCH":"MATCH",reasonCode:null,expectedSnapshot:expected,observedSnapshot:observed,expectedWatermark:expected.watermark,observedWatermark:observed.watermark,differences:diffs,projectionContractVersion:expected.projectionContractVersion,reconciliationContractVersion:RECONCILIATION_CONTRACT_VERSION});
}
export function compareRebuiltVsPersistedProjection(args){
 const v=args?.expected?.projectionContractVersion,ov=args?.observed?.projectionContractVersion;
 if(v==='2')return compareAdvanceProjectionSnapshots(args);
 if(v!=='1'||args?.observed!==null&&ov!=='1')return invalid({reconciliationId:args?.reconciliationId,checkedAt:args?.checkedAt,createdAt:args?.checkedAt});
 return compareRebuiltVsPersistedProjectionV1(args);
}
import {compareAdvanceProjectionSnapshots} from '../advance/projection-v2.mjs';
