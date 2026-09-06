import { immutable } from "./observation.mjs";
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
export class InMemoryReconciliationRepository {
 constructor(){this.records=new Map();}
 appendReconciliation(record){assertReconciliationDiagnosticPolicy(record);const r=immutable(record), old=this.records.get(r.reconciliationId); if(old){if(same(old,r))return {outcome:"EXISTING_IDENTICAL",record:old}; const e=new Error("reconciliation id conflict");e.code="CONFLICT";throw e;} this.records.set(r.reconciliationId,r); return {outcome:"APPENDED",record:r};}
 getReconciliation(id){return this.records.get(id)??null;}
 listReconciliationsForCompany({companyId,currency}){return [...this.records.values()].filter(r=>r.scopeType==='COMPANY'&&r.companyId===companyId&&r.currency===currency);}
 listReconciliationsForProject({companyId,projectId,currency}){return [...this.records.values()].filter(r=>r.scopeType==='PROJECT'&&r.companyId===companyId&&r.projectId===projectId&&r.currency===currency);}
}
import { assertReconciliationDiagnosticPolicy } from './persistence-policy.mjs';
