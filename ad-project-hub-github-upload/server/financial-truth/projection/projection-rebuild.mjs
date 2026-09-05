import { createFinancialEvent, immutableClone } from "../financial-event.mjs";
import { buildCanonicalFinancialHistory, buildFinancialRelationshipGraph } from "../history.mjs";
import { buildProjectionWatermark } from "./projection-watermark.mjs";
import { buildCompanyMaterializedProjection, buildProjectMaterializedProjection } from "./projection-builder.mjs";
function scoped(events, companyId, currency, projectId){const all=events.map(createFinancialEvent);buildCanonicalFinancialHistory(all);buildFinancialRelationshipGraph(all);const out=all.filter(e=>e.companyId===companyId&&e.currency===currency&&(projectId===undefined||e.projectId===projectId));for(const e of out)for(const ref of [e.reversalOf,e.correctionOf])if(ref&&!out.some(x=>x.eventId===ref))throw new Error("INVALID_HISTORY");return buildCanonicalFinancialHistory(out);}
export function rebuildCompanyProjection(companyId,currency,events=[]){const h=scoped(events,companyId,currency);const watermark=buildProjectionWatermark(h);return buildCompanyMaterializedProjection(h,{companyId,currency,watermark});}
export function rebuildProjectProjection(companyId,projectId,currency,events=[]){const h=scoped(events,companyId,currency,projectId);const watermark=buildProjectionWatermark(h);return buildProjectMaterializedProjection(h,{companyId,projectId,currency,watermark});}
export function rebuildResultError(error){return immutableClone({status:"INVALID_HISTORY",error:error?.message||"INVALID_HISTORY"});}
