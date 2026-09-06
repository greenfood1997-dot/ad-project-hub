const cols=['reconciliation_id','comparison_type','scope_type','company_id','project_id','currency','comparison_status','reason_code','projection_contract_version','reconciliation_contract_version','checked_at','created_at','expected_snapshot','observed_snapshot','expected_watermark','observed_watermark','differences','source_context'];
const select=cols.join(', ');
export const POSTGRES_RECONCILIATION_SQL=Object.freeze({
 insert:`INSERT INTO financial_reconciliations (${select}) VALUES (${cols.map((_,i)=>`$${i+1}`).join(', ')}) RETURNING ${select}`,
 get:`SELECT ${select} FROM financial_reconciliations WHERE reconciliation_id = $1`,
 companyList:`SELECT ${select} FROM financial_reconciliations WHERE scope_type = 'COMPANY' AND company_id = $1 AND currency = $2 ORDER BY created_at ASC, reconciliation_id ASC`,
 projectList:`SELECT ${select} FROM financial_reconciliations WHERE scope_type = 'PROJECT' AND company_id = $1 AND project_id = $2 AND currency = $3 ORDER BY created_at ASC, reconciliation_id ASC`,
 columns:Object.freeze(cols)
});
