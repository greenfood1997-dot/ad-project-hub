// Policy eligibility is distinct from record-shape validation.
export const INVALID_INPUT_PERSISTENCE_POLICY = 'TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY';
export function reconciliationPersistenceEligibility(result) {
 if(result?.comparisonStatus === 'INVALID_INPUT') return 'TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY';
 if(['MATCH','MISMATCH','INDETERMINATE'].includes(result?.comparisonStatus)) return 'EVIDENCE_SUBJECT_TO_RECORD_VALIDATION';
 return 'INVALID_RESULT';
}
export function assertReconciliationDiagnosticPolicy(result) {
 if(reconciliationPersistenceEligibility(result) === 'TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY') {
  const error = new Error('NON_PERSISTABLE_RECONCILIATION_DIAGNOSTIC');
  error.code = error.message;
  throw error;
 }
}
