import { POSTGRES_RECONCILIATION_SQL as SQL } from './postgres-reconciliation-sql.mjs';
import { observationToPostgresParams, postgresRowToObservation, sameImmutableContent } from './postgres-reconciliation-row-mapper.mjs';
import { classifyReconciliationStorageError, RECONCILIATION_DB_ERRORS } from './postgres-reconciliation-error-classifier.mjs';
function tx(x){if(!x||typeof x.query!=='function'){const e=new Error(RECONCILIATION_DB_ERRORS.MISSING_TRANSACTION_CONTEXT);e.code=e.message;throw e;}return x;}
const first=r=>r?.rows?.[0]??null;
class V1ReconciliationRepository {
 async appendReconciliation(context,observation){assertReconciliationDiagnosticPolicy(observation);tx(context);try{const out=await context.query(SQL.insert,observationToPostgresParams(observation));if(out?.rows?.length)return {outcome:'APPENDED',record:postgresRowToObservation(out.rows[0])};}catch(error){if(error?.code==='MALFORMED_PERSISTED_ROW')throw error;if(error?.code!=='23505'){const e=new Error(RECONCILIATION_DB_ERRORS.STORAGE_FAILURE);e.code=e.message;e.cause=error;throw e;}const existing=await this.getReconciliation(context,observation.reconciliationId);if(existing&&sameImmutableContent(existing,observation))return {outcome:'EXISTING_IDENTICAL',record:existing};const e=new Error(RECONCILIATION_DB_ERRORS.DUPLICATE_CONTENT_CONFLICT);e.code=e.message;throw e;}throw new Error(RECONCILIATION_DB_ERRORS.STORAGE_FAILURE);}
 async getReconciliation(context,id){tx(context);try{const row=first(await context.query(SQL.get,[id]));return row?postgresRowToObservation(row):null;}catch(error){if(error?.code==='MALFORMED_PERSISTED_ROW')throw error;const e=new Error(RECONCILIATION_DB_ERRORS.STORAGE_FAILURE);e.code=e.message;e.cause=error;throw e;}}
 async listReconciliationsForCompany(context,q){tx(context);try{return (await context.query(SQL.companyList,[q.companyId,q.currency])).rows.map(postgresRowToObservation);}catch(error){if(error?.code==='MALFORMED_PERSISTED_ROW')throw error;const e=new Error(RECONCILIATION_DB_ERRORS.STORAGE_FAILURE);e.code=e.message;e.cause=error;throw e;}}
 async listReconciliationsForProject(context,q){tx(context);try{return (await context.query(SQL.projectList,[q.companyId,q.projectId,q.currency])).rows.map(postgresRowToObservation);}catch(error){if(error?.code==='MALFORMED_PERSISTED_ROW')throw error;const e=new Error(RECONCILIATION_DB_ERRORS.STORAGE_FAILURE);e.code=e.message;e.cause=error;throw e;}}
}
import { assertReconciliationDiagnosticPolicy } from '../persistence-policy.mjs';
import {PostgresAdvanceReconciliationRepository} from '../../advance/reconciliation-v2.mjs';
export class PostgresReconciliationRepository {
 constructor({version='1'}={}){if(!['1','2'].includes(version))throw new Error('RECONCILIATION_VERSION_UNSUPPORTED');this.version=version;this.delegate=version==='1'?new V1ReconciliationRepository():new PostgresAdvanceReconciliationRepository();}
 async appendReconciliation(tx,r){assertReconciliationDiagnosticPolicy(r);if(r?.reconciliationContractVersion!==this.version)throw new Error('RECONCILIATION_VERSION_MISMATCH');return this.delegate.appendReconciliation(tx,r);}
 async getReconciliation(tx,id){const r=await this.delegate.getReconciliation(tx,id);if(r&&r.reconciliationContractVersion!==this.version)throw new Error('RECONCILIATION_VERSION_MISMATCH');return r;}
 async listReconciliationsForCompany(tx,q){if(this.version==='1')return this.delegate.listReconciliationsForCompany(tx,q);return this.list(tx,SQL.companyList,[q.companyId,q.currency]);}
 async listReconciliationsForProject(tx,q){if(this.version==='1')return this.delegate.listReconciliationsForProject(tx,q);return this.list(tx,SQL.projectList,[q.companyId,q.projectId,q.currency]);}
 async list(tx,sql,args){const out=await tx.query(sql,args);return Promise.all(out.rows.map(r=>this.getReconciliation({query:async()=>({rows:[r]})},r.reconciliation_id)));}
}
