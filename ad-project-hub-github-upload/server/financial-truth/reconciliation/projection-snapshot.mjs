import { projectionContract } from '../projection/projection-contract.mjs';
import { SUPPORTED_PROJECTION_CONTRACT_VERSION, SCOPE_AMOUNT_MATRIX } from '../projection/storage/projection-storage-contract.mjs';
import { validateProjectionWatermark } from '../projection/storage/projection-watermark-contract.mjs';
import { immutable } from './observation.mjs';

// Explicit current compatibility mapping; future versions require a new rule.
export const RECONCILIATION_PROJECTION_VERSION = '1';
const fail=()=>{throw new Error('INVALID_RECONCILIATION_PROJECTION_SOURCE');};
export function createReconciliationProjectionSnapshotV1(projection, {source} = {}) {
 const p=projection;
 if(!p || !['P1_REBUILD','PERSISTED_PROJECTION'].includes(source))fail();
 if(source==='P1_REBUILD') {
  if(Object.hasOwn(p,'projectionContractVersion')||Object.hasOwn(p,'projectionId')||Object.hasOwn(p,'updatedAt'))fail();
 } else if(p.projectionContractVersion!==SUPPORTED_PROJECTION_CONTRACT_VERSION)fail();
 if(SUPPORTED_PROJECTION_CONTRACT_VERSION!==1)fail();
 if(!['COMPANY','PROJECT'].includes(p.scopeType)||typeof p.companyId!=='string'||!p.companyId.trim()||typeof p.currency!=='string'||! /^[A-Z]{3}$/.test(p.currency))fail();
 if(p.scopeType==='PROJECT'?(typeof p.projectId!=='string'||!p.projectId.trim()):(source==='PERSISTED_PROJECTION'?p.projectId!==null:p.projectId!=null))fail();
 if(!['CURRENT','REBUILD_REQUIRED','RECONCILIATION_REQUIRED'].includes(p.status)||source==='P1_REBUILD'&&p.status!=='CURRENT')fail();
 if(typeof p.rebuiltAt!=='string'||!p.rebuiltAt.includes('T')||Number.isNaN(Date.parse(p.rebuiltAt)))fail();
 const matrix=SCOPE_AMOUNT_MATRIX[p.scopeType];
 for(const {name} of matrix.required)if(!Number.isSafeInteger(p[name]))fail();
 for(const name of matrix.mustBeNull)if(source==='PERSISTED_PROJECTION'?p[name]!==null:Object.hasOwn(p,name)&&p[name]!==null)fail();
 try{validateProjectionWatermark(p.watermark);}catch{fail();}
 const result=Object.fromEntries(projectionContract(p.scopeType).map(({name})=>[name,p[name]]));
 result.projectId=p.scopeType==='COMPANY'?null:p.projectId;
 result.projectionContractVersion=RECONCILIATION_PROJECTION_VERSION;
 result.watermark={eventCount:p.watermark.eventCount,latestCanonicalEventId:p.watermark.latestCanonicalEventId,canonicalDigest:p.watermark.canonicalDigest};
 return immutable(result);
}
export function createReconciliationProjectionSnapshot(projection, options={}) {
 if(['P1_REBUILD_V2','PERSISTED_PROJECTION_V2'].includes(options.source))return createAdvanceProjectionSnapshot(projection,options);
 if(projection&&['customerAdvanceMinor','supplierAdvanceMinor'].some(k=>Object.hasOwn(projection,k)))fail();
 return createReconciliationProjectionSnapshotV1(projection,options);
}
import {createAdvanceProjectionSnapshot} from '../advance/projection-v2.mjs';
