# Phase 1B — Projection Persistence & Rebuild Gate Design V1

**Status: DESIGN ONLY — READY FOR OWNER REVIEW**

## A. Current Capability and Authority

Slice 1 provides validated Financial Events, canonical history, relationship graph, effective-event resolution, and pure cash, paid, receivable, cost, payable and revenue projections. Slice A/B provide only PostgreSQL schema/journal contracts and isolated adapters. No projection or reconciliation persistence exists.

The Financial Event Journal is authoritative future financial history. Projection is a persisted, rebuildable materialized state; it never edits Events, replaces domain semantics, or becomes a reversal/correction authority. Legacy financial fields remain current production authority until later migration and Source of Truth gates pass.

## B. Projection Identity and Currency

Company identity is `(companyId, currency)`; project identity is `(companyId, projectId, currency)`. A deterministic `projectionId` may be derived from these components, but is not an additional business identity. Multiple currencies are separate projections. Without an accepted FX policy, cross-currency aggregation fails closed; no implicit conversion is permitted.

Company projections cover company-wide cash and payable, plus receivable and recognized revenue where defined. Project projections cover paid, receivable, cost, payable and project revenue. Company cash must never be copied into every project.

## C. Projection State Contract

Future machine contract (documentation only) should use typed columns for `companyId`, optional `projectId`, `currency`, `status`, `watermark`, `rebuiltAt`, and `updatedAt`. Core amounts remain exact minor-unit `BIGINT` columns: company `cashMinor`, `receivableMinor`, `payableMinor`, `recognizedRevenueMinor`; project `paidMinor`, `receivableMinor`, `costMinor`, `payableMinor`, `recognizedRevenueMinor`. An optional JSONB payload may hold non-authoritative display metadata, never opaque monetary truth.

Minimal statuses: `CURRENT`, `REBUILD_REQUIRED`, `RECONCILIATION_REQUIRED`, `INVALID_HISTORY`.

## D. Watermark / Version

Use a deterministic scope watermark composed of a canonical journal digest plus event count and the latest canonical event identity. Timestamp alone is insufficient because late correction, reversal and backfill events can change history. The watermark proves the exact input set used, detects staleness, and avoids introducing a distributed-log offset system.

## E. Rebuild Contracts

Pipeline:

`raw journal → buildCanonicalFinancialHistory → buildFinancialRelationshipGraph → resolveEffectiveFinancialEvents → pure projections → materialized projection → reconciliation → persist only when authorized`.

`rebuildCompanyProjection(companyId, currency)` reads all company events for that currency. `rebuildProjectProjection(companyId, projectId, currency)` reads only project-linked events; company-level cash events are excluded from project totals. Both are deterministic, repeatable, idempotent, scope-bounded, do not modify the Journal, and fail closed on any invalid event/history. Existing versus rebuilt exact mismatch yields `RECONCILIATION_REQUIRED`; no silent production overwrite.

The same raw event set in any retrieval order must produce identical canonical history, effective events, projection and watermark. Invalid duplicate IDs, broken relationships/cycles, unsafe amounts, malformed timestamps or invalid currency produce `INVALID_HISTORY` and no numeric projection update.

## F. Persistence Strategy

Recommend one `financial_projections` materialized-state table keyed by scope identity and currency, with typed identity/status/watermark/time and typed BIGINT amount columns. Avoid premature company/project specialized tables or many financial tables. The Journal remains the only financial authority; projection rows may be replaced or rebuilt, never reverse-replayed into Events.

## G. Repository and Transaction Boundary

Future contract only:

- `getCompanyProjection(txOrClient, companyId, currency)`
- `getProjectProjection(txOrClient, companyId, projectId, currency)`
- `saveCompanyProjection(tx, projection)`
- `saveProjectProjection(tx, projection)`

No `incrementCash`, `adjustProjection`, `setPaid` or patch-style business mutation API. Repository accepts shared tx/client context and owns no Pool or transaction lifecycle. Authorized synchronous orchestration is `BEGIN → append Event → rebuild/update required Projection → persist required Reconciliation → COMMIT`; this Gate implements none of it.

## H. Reconciliation Interface and Recovery

Rebuild results expose at least `projectedPaid`, `projectedCost` and `projectedReceivable`; company results may expose cash and payable. Reconciliation compares legacy versus projected exact minor-unit values and returns `MATCH`, `MISMATCH` or `UNKNOWN`. `MISMATCH`/`UNKNOWN` block Source of Truth switching.

Triggers are successful append, correction/reversal, recovery, manual rebuild and reconciliation mismatch. For current scale, recommend `FULL_REBUILD_FIRST`; adopt incremental updates only with measured volume evidence. Existing projection is not repaired directly: correct the Event or code, rebuild, then reconcile.

## I. Migration, JSON and Implementation Boundary

This Gate creates no table or migration. Migration requires a later readiness gate with reviewed schema, baseline reconciliation, rollback/recovery evidence, and Owner authorization. JSON Adapter remains `DEFERRED`; production projection target is PostgreSQL only. No dual projection repository is designed here.

Recommended isolated implementation slices:

1. P1: machine contract, pure materialized aggregate builder, deterministic rebuild tests.
2. P2: PostgreSQL projection repository contract/adapter with mock tx tests.
3. P3: reconciliation persistence and recovery tests.
4. P4: atomic write orchestration design/tests.

## J. Gate Criteria

`PROJECTION_IDENTITY_READY`  
`CURRENCY_BOUNDARY_READY`  
`PROJECTION_STATE_CONTRACT_READY`  
`REBUILD_CONTRACT_READY`  
`WATERMARK_READY`  
`INVALID_HISTORY_FAIL_CLOSED_READY`  
`TRANSACTION_BOUNDARY_READY`  
`RECONCILIATION_INTERFACE_READY`  
`JSON_DEFER_DECISION_READY`

All must be READY before recommending an implementation gate. Open questions that block later implementation/integration include final reconciliation retention, operational rebuild tooling, and measured volume/performance thresholds; no question currently authorizes production activation.

**Owner Authorization Boundary:** design acceptance would not authorize repository implementation, schema changes, migration, production integration, Source of Truth switch, or JSON adapter work.
