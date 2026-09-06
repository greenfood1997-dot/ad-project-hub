# Financial Truth Reconciliation Persistence Capability Gate V0.1

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
