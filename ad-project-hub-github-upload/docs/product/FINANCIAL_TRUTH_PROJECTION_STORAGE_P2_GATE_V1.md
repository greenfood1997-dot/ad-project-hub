# Phase 1B — Projection Slice P2 PostgreSQL Projection Repository Gate Design V1

**Status: DESIGN ONLY — READY FOR OWNER REVIEW**

## A. Current State and Authority

P1 provides pure materialized projections and deterministic rebuild. Storage Slice A/B provides PostgreSQL event storage contracts. No projection table or repository exists. Financial Event Journal remains `AUTHORITATIVE`; Projection is `DERIVED / REBUILDABLE / MATERIALIZED STATE` and remains shadow/non-authoritative before a future Source of Truth gate.

## B. P1 Dependency and Input Provider

P2 consumes P1's accepted `(companyId, currency)` and `(companyId, projectId, currency)` identities, statuses, per-currency semantics and relationship-complete rebuild results. The future rebuild orchestration service, not the repository, supplies the relationship-complete relevant raw Event set. Repository methods never fetch or assemble business history and never recalculate projections.

## C. Projection Storage Identity and Future Schema

Recommend one future `financial_projections` table. Use a surrogate `projection_id` UUID primary key for auditability and future references. Ordinary NULL-bearing composite UNIQUE is insufficient for Company rows, so use two partial unique indexes: `UNIQUE(company_id, currency) WHERE scope_type='COMPANY'` and `UNIQUE(company_id, project_id, currency) WHERE scope_type='PROJECT'`. CHECK constraints require COMPANY ⇒ `project_id IS NULL` and PROJECT ⇒ `project_id IS NOT NULL`. The UUID is technical only; logical identity remains scope + company/project + currency.

Company-only amounts (`cash_minor`) are nullable on PROJECT rows. Project amounts (`paid_minor`, `cost_minor`) are nullable on COMPANY rows. Shared dimensions (`receivable_minor`, `payable_minor`, `recognized_revenue_minor`) follow P1 scope semantics and are nullable only where unsupported. `NULL` means not applicable; zero remains a meaningful exact amount.

All amounts are PostgreSQL `BIGINT` minor units and must use validated safe-integer codecs at the adapter boundary. Currency is required and projections are per currency; no FX or cross-currency aggregation is permitted.

## D. Watermark and Versioning

Persist P1's exact `watermark_event_count`, `watermark_latest_event_id` and `watermark_digest`. The repository stores these values and never recomputes or hashes rows. Add a separate `projection_contract_version` to distinguish materialized projection semantics from Journal watermark identity. `updated_at` is persistence metadata and does not enter P1 semantic identity.

## E. Repository Interface and Save Semantics

Future interface only (CAS-capable):

- `getCompanyProjection(txOrClient, companyId, currency)`
- `getProjectProjection(txOrClient, companyId, projectId, currency)`
- `saveCompanyProjection(tx, projection, expectedCurrentWatermark)`
- `saveProjectProjection(tx, projection, expectedCurrentWatermark)`

`expectedCurrentWatermark = null` means the caller expects no existing row; otherwise it is the complete tuple `(eventCount, latestCanonicalEventId, canonicalDigest)`. The repository validates P1 projection contracts but never computes business semantics.

No `incrementCash`, `adjustProjection`, `setPaid`, or patch API. Save is whole-state replacement of a validated derived projection. `INSERT ... ON CONFLICT DO UPDATE` may be used for projection rows (unlike immutable Event Journal), but only to replace the complete row in one statement/transaction; no partial amount updates are allowed.

## F. Stale Write Protection and Concurrency

Every save must carry a distinct `expectedCurrentWatermark` and `newProjection.watermark`. CAS compares the complete tuple `(eventCount, latestCanonicalEventId, canonicalDigest)`, with digest primary and the other fields cross-checked. First insert with expected `NULL` succeeds only when no row exists; if a concurrent writer wins, the loser rereads the winner: identical complete state/watermark returns `SAME_STATE`, otherwise `PROJECTION_STALE_WRITE`. Existing W1 + expected W1 + new W2 permits whole-state replacement. Existing W2 + expected W1 returns `PROJECTION_STALE_WRITE`. Partial tuple mismatch is never same-state. CAS and replacement are one database-atomic operation, never SELECT-compare-unconditional UPDATE.

`projection_id` is generated only on first insert and is retained across every whole-state replacement. It is technical row identity, not business identity, version identity or watermark.

Deterministic errors: `PROJECTION_IDENTITY_CONFLICT`, `PROJECTION_STALE_WRITE`, `PROJECTION_STORAGE_CONFLICT`, `PROJECTION_ROW_INVALID`; unknown database errors fail closed.

## G. Status and Invalid Rows

Allowed statuses remain `CURRENT`, `REBUILD_REQUIRED`, `RECONCILIATION_REQUIRED`, `INVALID_HISTORY`. Repository persistence accepts CURRENT, REBUILD_REQUIRED and RECONCILIATION_REQUIRED only. CURRENT requires complete applicable numeric fields; REBUILD_REQUIRED means the last trusted materialized state requires future rebuild and is `NOT_PRODUCED_BY_P1 / FUTURE_ORCHESTRATION_STATUS`; RECONCILIATION_REQUIRED means a complete derived state exists but authority switch is blocked by future reconciliation/orchestration, not repository calculation. INVALID_HISTORY is rejected with `PROJECTION_INVALID_HISTORY_NOT_PERSISTABLE` and never replaces a trusted row. `SAVED` may update `updated_at`; `SAME_STATE` is a true no-op and does not update it. `rebuilt_at` comes from P1. Invalid scope/nullability, currency, watermark, timestamp, contract version or unsafe BIGINT fail closed.

## H. Transaction, Recovery and Read Authority

Repository accepts caller tx/client context and owns no Pool, connection or transaction lifecycle. Future orchestration is `BEGIN → append Event → save whole Projection → save Reconciliation → COMMIT`; this Gate does not implement it. Save failure must not produce success outside that transaction. Retry/recovery workers are later responsibilities.

Reads return validated deep-immutable Projection domain objects, never mutable DB rows. Projection Repository never modifies Events, resolves relationships, filters reversals, computes projections or persists reconciliation.

## I. Migration, JSON and Implementation Slices

No table, SQL or migration is created in this Gate. JSON remains `DEFERRED`; PostgreSQL is the sole production target. Recommended future slices:

1. P2-A: machine-readable schema/scope/status/amount contract, row mapping and interface tests.
2. P2-B: isolated PostgreSQL repository adapter with mock tx, stale-write and malformed-row tests.

Migration requires a later Migration Readiness Gate with reviewed schema, baseline reconciliation, rollback evidence and explicit Owner authorization. Documentation closure status: `DOCUMENTATION_CLOSURE_PENDING_OWNER_REVIEW`.

## J. Gate Criteria

`PROJECTION_STORAGE_SCHEMA_READY` · `PROJECTION_SCOPE_CONSTRAINT_READY` · `PROJECTION_AMOUNT_CONTRACT_READY` · `PROJECTION_WATERMARK_STORAGE_READY` · `PROJECTION_VERSIONING_READY` · `PROJECTION_REPOSITORY_INTERFACE_READY` · `PROJECTION_SAVE_SEMANTICS_READY` · `PROJECTION_STALE_WRITE_PROTECTION_READY` · `PROJECTION_STATUS_PERSISTENCE_READY` · `PROJECTION_TRANSACTION_BOUNDARY_READY` · `PROJECTION_MALFORMED_ROW_FAIL_CLOSED_READY` · `PROJECTION_NON_AUTHORITY_BOUNDARY_READY`.

All must be READY before isolated implementation authorization. Open questions: final projection retention, exact SQL locking/index strategy and operational repair tooling. These do not authorize implementation or production activation.
