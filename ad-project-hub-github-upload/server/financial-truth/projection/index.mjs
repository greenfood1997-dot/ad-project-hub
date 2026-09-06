export * from "./projection-contract.mjs";
export * from "./projection-watermark.mjs";
export {compareCanonicalEventTime,canonicalTimestampMillis} from '../canonical-event-time.mjs';
export * from "./projection-builder.mjs";
export * from "./projection-rebuild.mjs";
import {rebuildAdvanceProjections} from '../advance/index.mjs';
import {rebuildCompanyProjection,rebuildProjectProjection} from './projection-rebuild.mjs';
export function rebuildFinancialProjection({version,...request}){
 if(version===2)return rebuildAdvanceProjections(request);
 if(version===1)return request.scopeType==='PROJECT'?rebuildProjectProjection(request.companyId,request.projectId,request.currency,request.events):rebuildCompanyProjection(request.companyId,request.currency,request.events);
 throw Object.assign(new Error('PROJECTION_VERSION_UNSUPPORTED'),{code:'PROJECTION_VERSION_UNSUPPORTED'});
}
