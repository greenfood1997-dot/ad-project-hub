# Financial Truth Reconciliation Persistence Capability Gate V0.1

## Projection–Reconciliation Snapshot Boundary v0.1

TYPE A accepts canonical ReconciliationProjectionSnapshot, not raw Projection. The sole public conversion is createReconciliationProjectionSnapshot(projection, {source: 'P1_REBUILD' | 'PERSISTED_PROJECTION'}).

P1 domain/output intentionally has no persistence version. Storage adds numeric SUPPORTED_PROJECTION_CONTRACT_VERSION (currently 1), including canonical persisted objects and database rows. Snapshot evidence uses the explicit current mapping 1 -> '1'. The exported snapshot version constant belongs to this boundary. P1 source mode attaches that mapped version; persisted source mode requires exactly the numeric supported version. No arbitrary coercion, guessed source mode or future-version conversion is allowed. Future versions need an explicit compatibility rule.

No accepted authority is overridden: these are distinct layer representations, not interchangeable objects. P1, comparator and Projection Repository semantics remain unchanged. Future Atomic Write must import this public converter, never hand-normalize version or import private row mappers.

Snapshot fields: scopeType/companyId/projectId/currency; COMPANY cashMinor/receivableMinor/payableMinor/recognizedRevenueMinor; PROJECT paidMinor/receivableMinor/costMinor/payableMinor/recognizedRevenueMinor; status, rebuiltAt, watermark and string projectionContractVersion. COMPANY projectId is canonical null. Inapplicable persisted amount columns must be null and are excluded from snapshot. All relevant monetary fields are safe integers. Currency, identity, timestamp and watermark are validated; invalid source is rejected, never repaired.

The full watermark tuple is preserved: eventCount, latestCanonicalEventId, canonicalDigest. Zero events requires null latest identity; nonempty history requires an identity. Observation top-level watermarks mirror snapshot watermarks. No digest or money is recalculated at the boundary.

projectionId/updatedAt/storage metadata are excluded. rebuiltAt and status remain snapshot metadata but do not participate in TYPE A financial equality under the existing comparator. Conversion deep-clones/freezes evidence and does not mutate input or consult a clock.

ATOMIC-IMP-002: CLOSED by public P1/self, PG/self, mixed-source and missing-observed persistence probes for COMPANY and PROJECT. REC-PROJ-CONTRACT-001 (HIGH): discovered and CLOSED in this remediation; reconciliation storage rejected canonical empty-history null latest identity, now accepts the explicit zero/nonzero watermark rule. No remaining blocker in this reviewed boundary.

## Evidence Presence Semantic Clarification v0.1 (2026-09-06)

This clarification preserves comparator evidence; it adds no business capability, authority, TYPE B/C/D execution or resolution workflow.

| Status / reason | expectedSnapshot | observedSnapshot | expectedWatermark | observedWatermark | differences | projectionContractVersion |
|---|---|---|---|---|---|---|
| MATCH | REQUIRED | REQUIRED | REQUIRED | REQUIRED | EMPTY | REQUIRED |
| MISMATCH | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED nonempty | REQUIRED |
| INDETERMINATE / STALE_REBUILD | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | EMPTY | MUST_BE_NULL |
| INDETERMINATE / INVALID_HISTORY | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | EMPTY | MUST_BE_NULL |
| INDETERMINATE / INSUFFICIENT_EVIDENCE | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | EMPTY | MUST_BE_NULL |
| INDETERMINATE / UNSUPPORTED_COMPARISON | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | EMPTY | MUST_BE_NULL |
| INDETERMINATE / OBSERVED_STATE_MISSING (TYPE A comparator) | REQUIRED | MUST_BE_NULL | REQUIRED | MUST_BE_NULL | EMPTY | REQUIRED |
| INDETERMINATE / OBSERVED_STATE_MISSING (generic evidence-free factory) | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | MUST_BE_NULL | EMPTY | MUST_BE_NULL |
| INVALID_INPUT (transient comparator diagnostic, NEVER persistable) | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | EMPTY | NOT_APPLICABLE |

Missing-observed TYPE A retains the validated rebuilt expected snapshot and its matching watermark. No fake observed zero state is created. The existing generic factory's evidence-free variant remains accepted; half-present expected evidence is invalid. Expected evidence is checked for scope/identity, safe-integer financial fields, version and matching watermark.

ATOMIC-IMP-001: CLOSED by missing-observed public append/read round-trip, cross-repository replay and negative probes.

REC-CONTRACT-001: HIGH / CLOSED by INVALID_INPUT Persistence Policy Clarification v0.1 below.

## INVALID_INPUT Persistence Policy Clarification v0.1

Unique policy: TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY. All INVALID_INPUT results are transient, including those carrying apparently valid scope. There is no scoped/unscoped persistence split. A failed comparison attempt is diagnostically useful, but does not establish reliably attributable reconciliation evidence. Scoped repositories are not generic error logs; no scope is inferred or supplemented. Future diagnostic logging requires a separate decision and is not implemented here.

The comparator and immutable factory may produce the existing diagnostic shape. Immutability is not persistence eligibility. The public pure helper reconciliationPersistenceEligibility explicitly returns TRANSIENT_COMPARATOR_DIAGNOSTIC_ONLY for INVALID_INPUT, EVIDENCE_SUBJECT_TO_RECORD_VALIDATION for MATCH/MISMATCH/INDETERMINATE, and INVALID_RESULT otherwise. This helper is a policy classification, not a complete evidence validator.

| INVALID_INPUT diagnostic field | Presence policy |
|---|---|
| scopeType / companyId / projectId / currency | OPTIONAL diagnostic context; never inferred, never persistence authority |
| expectedSnapshot / observedSnapshot | NOT_APPLICABLE |
| expectedWatermark / observedWatermark | NOT_APPLICABLE |
| differences | REQUIRED empty array |
| projectionContractVersion | NOT_APPLICABLE |
| sourceContext | OPTIONAL immutable diagnostic context |
| reasonCode | MUST_BE_NULL; no new reason vocabulary |

NOT_APPLICABLE means no validated evidence is asserted and comparator may omit the field; it is not an optional persistence slot. Repository rejection applies regardless of extra diagnostic fields.

Both append APIs reject INVALID_INPUT before any mutation/query with NON_PERSISTABLE_RECONCILIATION_DIAGNOSTIC. Persisted-row corruption remains MALFORMED_PERSISTED_ROW; the mapper is not weakened to admit diagnostics. Existing evidence duplicate semantics are unchanged.

Future Atomic Write must not append a transient diagnostic as required evidence; it must return an orchestration diagnostic/failure, with actual mapping deferred to its separately authorized implementation. No ALLOW/DENY/approval or truth mutation is introduced.

Validation: all requested regressions and post-regression public policy probes PASS; ATOMIC-IMP-001 remains CLOSED; no new findings in this remediation. Atomic Write remains not implemented and is not resumed in this turn.

## Purpose and Authority
Reconciliation persists immutable expected-vs-observed consistency evidence. It is not Financial Truth authority, does not mutate Events, Projections, Legacy values, or Source of Truth, and never auto-corrects or auto-smooths.

## Comparison Types
Use closed types: `REBUILT_VS_PERSISTED_PROJECTION`, `JOURNAL_WATERMARK_VS_PROJECTION_WATERMARK`, `FINANCIAL_TRUTH_VS_LEGACY`, `MIGRATION_BASELINE_RECONCILIATION`. Type C requires a separately accepted legacy mapping; Type D is not authorized for execution.

## Expected / Observed Semantics
Expected and observed sides are explicit. TYPE A expected is fresh deterministic P1 projection; observed is persisted projection. Records include complete watermarks and exact relevant minor-unit state snapshots.

## Scope / Currency
Reuse COMPANY `(companyId,currency)` and PROJECT `(companyId,projectId,currency)` identity. Currency is per-currency; no FX or cross-currency comparison.

## Status and Difference Evidence
Closed comparison statuses: `MATCH`, `MISMATCH`, `INDETERMINATE`, `INVALID_INPUT`. MISMATCH must include field-level expected/observed differences. INDETERMINATE means evidence is insufficient and is never treated as MATCH.

## Projection and Watermark Semantics
Persistence SAME_STATE continues to use P2-A `sameMaterializedProjectionState`. Reconciliation TYPE A uses a separate financial-state comparator: identity, exact amounts/nullability, contract version, and full watermark tuple. projectionId and updatedAt do not alone create financial mismatch; rebuiltAt is recorded as metadata and does not alone create TYPE A mismatch. Watermarks are eventCount/latestCanonicalEventId/canonicalDigest, not timestamps.

## No Auto-Correction
`RECONCILIATION_NEVER_MUTATES_TRUTH`: no Event, Projection, Legacy mutation, balancing entry, or automatic repair. Exact minor-unit comparison only; no tolerance or silent smoothing.

## Immutable Record and Resolution Lifecycle
Recommended persistence is an immutable comparison snapshot plus lifecycle metadata. Comparison result is immutable; resolution statuses may be `UNREVIEWED`, `UNDER_REVIEW`, `ACCEPTED_EXCEPTION`, `RESOLVED`, `SUPERSEDED`. Resolution never implies numeric correction. Corrections use a new superseding record; normal delete/update is forbidden.

## Record Identity, Versioning, and Append Semantics
Use stable `reconciliationId` (UUID recommendation) as append identity, with optional comparison fingerprint for audit detection only. Do not collapse repeated observations. Add `reconciliationContractVersion`.

## Persistence Shape Recommendation
Choose one `financial_reconciliations` model with typed identity/status/version fields and versioned expected/observed snapshots plus difference evidence. Store sufficient immutable snapshots, not references only.

## Typed vs JSONB Recommendation
Use a hybrid model: typed identity/status/watermark/version/timestamps for constraints and queries; JSONB (or equivalent versioned structured payload) for exact expected/observed snapshots and difference evidence. Amounts remain exact minor-unit values within the structured payload.

## Repository and Transaction Boundary
Future `ReconciliationRepository` only appends/reads evidence using caller-provided tx/client. It must not compare, mutate Projection/Event, own transactions, or create Pool/connect/BEGIN/COMMIT/ROLLBACK.

## Rebuild / SAME_STATE / STALE / Invalid History
Rebuild Orchestrator remains responsible only for history→P1→Projection coordination. SAME_STATE may still produce MATCH evidence when a caller explicitly performs a check. A triggered check ending in STALE creates an INDETERMINATE observation with reason `STALE_REBUILD`, without field-level mismatch claims. A triggered check ending in invalid history creates INDETERMINATE with reason `INVALID_HISTORY`; invalid request input remains INVALID_INPUT.

## Legacy and Migration Boundaries
Legacy comparison waits for an accepted legacy financial mapping gate. Migration baseline reconciliation, real DB, shadow integration, Source of Truth switch, and production activation are not authorized.

## Existing Pure Reconciliation Assessment
Existing `server/financial-truth/reconciliation.mjs` provides limited scalar legacy-vs-projection helpers (EXISTS / PARTIAL). It does not yet implement the four-type, watermark-aware, immutable evidence model.

## Reason Vocabulary and Observation/Resolution Separation
Closed indeterminate reasons: `STALE_REBUILD`, `INVALID_HISTORY`, `INSUFFICIENT_EVIDENCE`, `OBSERVED_STATE_MISSING`, `UNSUPPORTED_COMPARISON`. Observation records are immutable and append-only. Resolution lifecycle is separate append-only evidence; derived lifecycle views never mutate the observation.

## Future Implementation Slice
First slice: pure reconciliation record contract + projection-vs-projection comparison + append-only repository contract + in-memory/mock repository. No real PostgreSQL adapter or schema creation in the first slice.

## Future Test and Validation Gates
Tests must cover MATCH/MISMATCH/INDETERMINATE, exact amounts, nulls, watermarks, scope/currency, malformed sides, stale/invalid-history safeguards, immutable append-only records, supersession, no auto-correction, no mutation, no legacy reads, transaction boundary, and production isolation. Gates include non-authority, explicit sides, exactness, watermark safety, difference completeness, immutability, append-only, stale/invalid-history safeguards, legacy/tx boundaries, and isolation.

## Owner Acceptance and First Slice Authorization
**Gate:** OWNER ACCEPTED  
**Documentation Closure:** COMPLETE  
**REC-DOC-001:** CLOSED  
**REC-DOC-002:** CLOSED  
**REC-DOC-003:** CLOSED  
**REC-DOC-004:** CLOSED  
**Implementation:** AUTHORIZED_NOT_STARTED

The first implementation slice is limited to immutable observation contract, TYPE A pure comparator, difference/status/reason contracts, append-only repository interface, in-memory/mock repository, and deterministic isolated tests. PostgreSQL, SQL, migration, legacy execution, resolution workflow, and Atomic Write Orchestrator remain unauthorized.
