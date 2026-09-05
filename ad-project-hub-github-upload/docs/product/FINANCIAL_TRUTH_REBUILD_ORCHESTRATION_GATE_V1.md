# Financial Truth Rebuild Orchestration Capability Gate V0.1

## Gate Executive Summary
This is a design and authorization gate only. It closes ownership between the Financial Event Journal, relationship-complete history input, P1 deterministic rebuild, and the isolated P2-B Projection Repository.

## Authority Boundary
The Financial Event Journal is authoritative future history. Projection is derived, rebuildable materialized state. Legacy financial fields remain current production authority. The orchestrator is non-authoritative and cannot alter events, arithmetic, reconciliation, or source authority.

## Missing Ownership Gap
The missing layer owns history retrieval, relationship completeness evidence, scope safety, P1 invocation, P2-B coordination, and deterministic outcome mapping.

## Rebuild Input Provider Contract
Choose an independent provider interface injected into the orchestrator. It returns a validated bundle, not a raw event array, and must be relationship-complete, relevant, scope-safe, and canonical-input-ready.

## Relationship-Complete Input Contract
Related target/reversal/correction/dependency events must be included before scope extraction. A bundle must carry companyId, requested scope, currency, rawEvents, relationshipCompletenessStatus, retrieval context, and observed/generated timestamp.

Provider completeness status is not proof. Distinguish RawRebuildInputBundle from ValidatedRelationshipCompleteFinancialEventBundle. Before P1, a deterministic validator must verify identity, currency, event IDs, relationship closure, cross-company/project/currency prohibitions, and metadata consistency. COMPLETE alone is insufficient.

## Scope / Currency Contract
Requests are COMPANY(companyId,currency) or PROJECT(companyId,projectId,currency). Currency is mandatory; no implicit company, FX, or cross-currency aggregation.

## Rebuild Request Contract
`rebuildCompanyProjection({ context, companyId, currency })` and `rebuildProjectProjection({ context, companyId, projectId, currency })` are future injected interfaces. No as-of semantics are introduced; temporal point-in-time behavior is deferred to a separate gate.

## Rebuild Flow
Validate request → request relationship-complete history → validate bundle → call pure P1 rebuild → validate projection/watermark → read current projection as needed → call accepted P2-B save → return deterministic result.

## Current Projection / Expected Watermark Strategy
Use ordering A: validate request, read current projection, capture an immutable expected watermark exactly once, then fetch/validate history, rebuild, and save using that frozen token. This prevents old history from acquiring CAS permission from a newer persisted projection. P2-B conditional CAS remains final stale-write authority.

## Initial / Existing Projection Semantics
Absent projection uses expected null and P2-B first-insert semantics. Existing projection uses its current watermark; P2-B determines SAME_STATE, SAVED, or STALE.

## SAME_STATE / STALE Semantics
SAME_STATE is successful no-op. STALE is returned without automatic overwrite or retry; caller may explicitly restart from fresh history under a future policy.

## Provider / Invalid History Failure Semantics
Provider failure, incomplete/malformed bundle, scope/currency mismatch, relationship failure, or P1 invalid history fail closed. No partial or best-effort projection is persisted.

## Empty History Semantics
Valid relationship-complete empty history may produce a valid empty projection and empty watermark. It is distinct from provider failure.

## Result Vocabulary
Closed results: `REBUILD_SAVED`, `REBUILD_SAME_STATE`, `REBUILD_STALE`, `REBUILD_INPUT_INVALID`, `REBUILD_HISTORY_INVALID`, `REBUILD_STORAGE_FAILURE`.

## Transaction Boundary
No transaction ownership in this capability. Caller supplies journal and projection contexts. BEGIN/COMMIT/ROLLBACK belong to a future Atomic Write Orchestrator.

## Rebuild vs Atomic Orchestrator Boundary
Rebuild Orchestrator coordinates history → P1 → projection persistence. Atomic Orchestrator later owns Event append + rebuild + projection + reconciliation transactionality.

## Reconciliation Boundary
No reconciliation persistence or decision is performed. Results may expose projection and watermark metadata for a future reconciliation layer.

## Legacy Boundary
Legacy totals and financial fields are not read or used to supplement projections.

## Concurrency / Snapshot Consistency Boundary
This capability is best-effort history retrieval plus CAS-protected persistence, not an atomic history/projection snapshot. Concurrent journal appends may make the result stale.

EXPECTED_WATERMARK_CAPTURE_ONCE is mandatory. Initial null remains null if another writer inserts meanwhile. REBUILD_STALE ends the invocation; no token refresh or automatic retry.

## Future Interface / Implementation Slice
Future isolated files may live under `server/financial-truth/projection/orchestration/` with an injected input provider, orchestrator, contract, index, and deterministic regression tests. No files are created by this gate.

## Future Test Matrix / Validation Gates
Tests must cover complete bundles, scope/currency safety, provider and P1 failures, empty history, initial/existing rebuild, SAME_STATE, STALE, storage failure, deterministic repeatability, no legacy reads, no transaction ownership, and production isolation. Required gates include input completeness, scope/currency safety, P1 purity, repository reuse, stale/SAME_STATE safety, invalid-history fail-closed, provider failure, transaction boundary, non-authority, and production isolation.

## Migration / Production Boundaries
No table, migration, real DB, shadow integration, production import, source switch, reconciliation persistence, or atomic write orchestration is authorized.

## Gate Assessment
All design boundaries are READY for a future implementation gate; implementation itself is not performed here. After successful implementation, validation, and Owner Acceptance, the next candidate is Reconciliation Persistence Gate.
