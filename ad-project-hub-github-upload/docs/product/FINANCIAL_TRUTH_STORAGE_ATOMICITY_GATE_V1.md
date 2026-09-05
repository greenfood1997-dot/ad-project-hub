# Phase 1B — Financial Truth Storage & Atomicity Gate Design V1

**Status: DESIGN ONLY — READY FOR OWNER REVIEW**  
**Scope:** storage architecture, atomicity, recovery, reconciliation persistence and implementation gates. No implementation or production activation is authorized.

## A. Storage Architecture Assessment

The current JSON store serializes `mutateDb()` in-process and writes through a temporary file followed by atomic rename. Corrupt-file recovery preserves the damaged file and restores a default database. This is useful for local/dev compatibility, but remains limited by process-local locking, crash windows, file growth and multi-instance coordination.

The PostgreSQL path supports transaction-oriented writes on one connection/session, row locking where applicable, and cross-instance coordination through `pg_advisory_lock`. Existing payment and approval idempotency constraints are not a Financial Event Journal. No production journal or unified event-plus-projection transaction exists today.

## B. PostgreSQL Recommendation

PostgreSQL is the production target. Candidate `financial_events` design: `event_id` primary key; unique `idempotency_key`; indexes on `company_id`, `project_id`, and `effective_at`; optional foreign keys for graph references while domain graph validation remains authoritative; `source_evidence` and `metadata` JSONB; all timestamps `timestamptz`; `amount_minor BIGINT` matching Slice 1 safe-integer minor-unit semantics, with application validation enforcing the safe range. NUMERIC is an alternative only if a future domain requires values outside that range.

The storage-neutral journal contract must expose `append`, `getById`, `findByIdempotencyKey`, and `list`. Events are append-only, immutable, uniquely identified, linked to relationship references, and carry status, effective/recorded timestamps, source evidence and metadata.

### PostgreSQL transaction boundary

The adapter must accept a transaction/client context; repository methods must not open mutually independent transactions. Future domain orchestration must complete Event Journal, required Projection and applicable Reconciliation state in one database transaction:

`BEGIN` → validate domain semantics → attempt event insert → enforce idempotency uniqueness and classify the conflict → update/rebuild required projection → persist reconciliation → `COMMIT`.

Any failure causes `ROLLBACK`. A projection must never commit when its event insert failed.

### BIGINT / JavaScript boundary

PostgreSQL `BIGINT` may be returned as a string by the Node driver. The adapter must parse and validate it before entering the Slice 1 domain. Direct unchecked `Number(dbBigInt)` conversion is forbidden. Values outside `Number.MAX_SAFE_INTEGER` / `Number.MIN_SAFE_INTEGER` fail closed. Writes serialize a validated domain safe integer deterministically to `BIGINT` without precision loss. This Gate does not change the domain to JavaScript `BigInt`.

## C. JSON Recommendation

Retain an independent immutable `financialEvents` collection in `db.json` for local/dev and deterministic test compatibility. The adapter must hold the mutation lock across read, duplicate check, append, projection/reconciliation update, write and rename. JSON is **SUPPORTED_WITH_LIMITATIONS** for local/test use and **NOT_RECOMMENDED_FOR_PRODUCTION** because process crashes, concurrent instances, recovery replay and unbounded history are weaker than PostgreSQL.

The complete sequence—read current state, validate, idempotency check and canonical payload comparison, append event, calculate/update projection, reconcile, atomic temporary write and rename—must be one `mutateDb` serialized critical section. JSON provides no genuine multi-instance distributed transaction capability. Production Financial Truth therefore requires PostgreSQL unless Owner separately authorizes JSON production use.

## D. Atomicity Model

The primary synchronous financial write uses the single atomic transaction defined above. Event success plus required-projection failure rolls back both; it is not a normal partially committed state. `PROJECTION_FAILED`, `RETRY_REQUIRED`, and `RECONCILIATION_REQUIRED` apply only to later asynchronous projection, recovery or rebuild paths; `PENDING_PROJECTION` applies only when an explicitly authorized asynchronous workflow owns the projection.

## E. Idempotency Race Strategy

PostgreSQL relies on `UNIQUE(idempotency_key)` and transactional insert/`ON CONFLICT`, not `SELECT` then `INSERT`. On conflict it loads the existing event and compares the canonical semantic payload: the same payload returns the existing event; a different payload returns `IDEMPOTENCY_CONFLICT`. A unique conflict is never automatically treated as duplicate success. JSON applies the same canonical comparison inside its one mutation lock and must never perform “find then append” outside it.

## F1. Payable Stable Identity

A payable obligation requires a stable `payableId`; `supplierId + projectId` is not unique because one supplier and project may have multiple simultaneous obligations. The minimum relationship includes `companyId`, `projectId`, `supplierId`, `sourceType`, and `sourceId`, with optional `lineItemId` and `settlementId`. Future `SUPPLIER_PAYMENT_CONFIRMED` events must point to one or more specific payable obligations rather than decrementing a supplier total. Allocation of one payment across multiple payables is `LATER_INTEGRATION_POLICY`, but storage design must preserve stable payable identity.

## F. Reconciliation Persistence Design

Persist company/project identifiers, legacy and projected paid/cost/receivable totals, exact minor-unit differences, status (`MATCH`, `MISMATCH`, `UNKNOWN`), timestamps and investigation metadata. Comparisons are exact in smallest currency units. `MISMATCH` and `UNKNOWN` block any Source of Truth switch and require auditable investigation; they must never be auto-smoothed.

Minimum governance: the system detects and records the mismatch; Finance investigates source evidence; the relevant Business Owner/PM/Sales supplies missing business facts where needed; only authorized Finance/Admin performs an approved backfill, correction or reversal; audit records reason, evidence, operator and time. Every `MISMATCH` enters a manual-review queue. Ownership is `RESOLVED`; detailed SLA remains `DEFERRED_POLICY`.

## G. Crash Recovery Matrix

| Failure point | Required outcome |
|---|---|
| Before append | No event; safe retry |
| Event written before projection | Transaction rollback, or durable pending state for retry |
| Partial projection | Mark failed/retry; rebuild from journal |
| Commit acknowledgment dropped | Retry by idempotency key; return existing committed event |
| Process restart | Replay pending/failed projections and reconcile |
| JSON temp-file crash | Preserve prior committed file; recover temp/corrupt artifact explicitly |
| PostgreSQL failure before commit | Rollback; no visible event/projection |

## H. Storage Semantic Parity

JSON and PostgreSQL adapters share Slice 1 validation, relationship graph, authority, idempotency, correction/reversal, projection and reconciliation semantics. Only persistence mechanics differ. Legacy financial fields remain authoritative until every migration gate passes.

## H1. Projection Persistence and Rebuild Contract

The Financial Event Journal is authoritative. Projection is a persistent, rebuildable cache/materialized state, chosen to avoid replaying the complete journal for every read while preserving auditability. Projection may be deleted and rebuilt; Events may never be reconstructed from or replaced by Projection. A future frontend reads backend-authoritative projection and does not calculate official Financial Truth itself.

The implementation must provide `rebuildCompanyProjection(companyId)` and `rebuildProjectProjection(projectId)`, or equivalent operations. Rebuild uses Slice 1 canonical history and relationship graph validation, fails closed on invalid history, never modifies the Event Journal, emits reconciliation results, and is deterministic and repeatable. If persisted and rebuilt projections differ, status becomes `RECONCILIATION_REQUIRED`; production projection is not silently overwritten without an authorized repair workflow.

## I. Recommended Storage Implementation Slices

1. **Storage Slice A:** storage contract and schema design tests. A schema artifact or migration draft requires future Owner authorization and must not be applied.
2. **Storage Slice B:** isolated PostgreSQL Journal Adapter tests; no production import.
3. **Storage Slice C:** JSON Adapter compatibility tests for local/dev/test only.
4. **Storage Slice D:** isolated projection persistence and rebuild tests.
5. **Storage Slice E:** reconciliation persistence and recovery tests.

Real financial write integration is deferred to a separate Shadow Integration Gate.

## J. Shadow Integration Boundary

When separately authorized, legacy paths remain authoritative while Financial Events, projections and reconciliation run in shadow. No official user-visible monetary number, payment behavior or Source of Truth changes during shadow operation.

## K. Open Questions Reclassification

**RESOLVED_FOR_STORAGE_DESIGN:** PostgreSQL transaction boundary; JSON atomic mutation boundary; BIGINT/JavaScript safe-integer boundary; concurrent idempotency insert strategy; minimum payable stable identity; historical mismatch responsibility; minimum projection rebuild contract; persistent rebuildable projection strategy.

**BLOCKS_LATER_INTEGRATION:** bank evidence format; finance review SLA; multi-payable allocation policy; detailed historical mismatch SLA; operational rebuild tooling; archive operations.

**DEFERRED_POLICY:** complete Revenue Recognition Policy; Payroll Policy; statutory retention/archive policy.

No unresolved design question currently blocks Storage Slice A or B. Later-integration and deferred-policy items must close before their applicable integration or production gate.

## Gate Criteria and Boundary

Design readiness is: `STORAGE_DESIGN_READY`, `ATOMICITY_DESIGN_READY`, `IDEMPOTENCY_DESIGN_READY`, `RECONCILIATION_DESIGN_READY`, `RECOVERY_DESIGN_READY`, and `JSON_POSTGRES_SEMANTIC_PARITY_DESIGN_READY`. All are subject to Owner authorization before implementation. This document authorizes no code, schema, migration, dual/shadow write, API/frontend change, production integration, deployment or Source of Truth switch.
