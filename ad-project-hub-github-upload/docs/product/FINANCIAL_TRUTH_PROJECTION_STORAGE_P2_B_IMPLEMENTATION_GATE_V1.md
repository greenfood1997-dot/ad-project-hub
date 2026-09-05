# Financial Truth Projection Storage P2-B Implementation Gate V1

## Current State
P2-A is OWNER ACCEPTED, IMPLEMENTED, and VALIDATED. P2-B is DESIGN / AUTHORIZATION ONLY.

## Authority Boundary
Financial Event Journal is authoritative. Projection is derived, rebuildable, materialized state. The adapter may only persist validated P2-A projections.

## P2-A Binding Contract
The 18-field schema, identities, scope/nullability, BIGINT amounts, currency, statuses, persistability, watermark, version, row mapping, SAME_STATE, and projection_id stability contracts are binding.

## Repository Interface
Implement only getCompanyProjection, getProjectProjection, saveCompanyProjection, and saveProjectProjection with the accepted signatures.

## Read Contract
Use parameterized logical identity reads including scope, company, project (when applicable), and currency. Zero rows return null; duplicate rows fail closed; every row uses the P2-A mapper.

## Save Preconditions
Validate projection, persistability, and expectedCurrentWatermark before SQL. INVALID_HISTORY and malformed projections never enter SQL.

## Whole-State Replacement
Save is a complete materialized-state replacement; no delta or field-only mutation.

## Projection ID Stability
First insert uses the new ID. Replacement and SAME_STATE preserve the existing persisted ID.

## Atomic CAS
CAS compare and whole-state replacement must be one database-atomic conditional operation; no SELECT-then-unconditional-UPDATE TOCTOU pattern.

## Stale Write
Full watermark mismatch returns PROJECTION_STALE_WRITE without updating the row.

## First Insert
Expected null with no row inserts and returns SAVED. Unique conflicts enter explicit first-insert race resolution.

## Concurrent First Insert
Identity unique conflict is classified, winner is read, and resolved as SAME_STATE or PROJECTION_STALE_WRITE.

## SAME_STATE
Semantic no-op; no update, timestamp churn, or projection_id replacement.

## Timestamp Semantics
rebuilt_at comes from the new projection; updated_at is persistence metadata and is unchanged for SAME_STATE.

## SQL Parameterization
All values are SQL parameters. No interpolation of identity, currency, amounts, status, digest, or IDs.

## Canonical Row Shape and Replacement Fields
The canonical persisted row shape contains all 18 P2-A fields and is required for SELECT, INSERT, RETURNING, and mapper validation. Replacement UPDATE must preserve stable identity fields (`projection_id`, `scope_type`, `company_id`, `project_id`, `currency`) and replace the complete mutable derived-state set: status, all amount columns (including scope-inapplicable NULLs), watermark tuple, contract version, rebuilt_at, and updated_at.

## SQL Field Completeness
SELECT, INSERT, and RETURNING use the complete canonical 18-field row shape. UPDATE SET uses the complete mutable replacement field set only and never sets stable identity fields.

## Error Classification
Future constraint identifiers are fixed as `financial_projections_company_identity_uq`, `financial_projections_project_identity_uq`, and `financial_projections_pkey`. Using stable `code` and `constraint` metadata only: non-23505 is not a unique-conflict path; the two identity constraints classify as logical identity conflict; primary-key or other/unknown 23505 classify as `PROJECTION_STORAGE_CONFLICT`. Only logical identity conflicts may trigger winner resolution; PK conflicts never do.

## Transaction Boundary
Caller supplies tx/client. Adapter does not create pools, connect, or own BEGIN/COMMIT/ROLLBACK.

## Malformed Row
All rows pass through postgresRowToProjection and fail closed on malformed data.

## Mock Test Matrix
Cover reads, duplicates, malformed rows, first insert, replacement, stale writer, SAME_STATE, race resolution, full watermark comparison, ID stability, parameterization, identity/currency isolation, and transaction boundary.

## No Reconciliation / Rebuild Orchestration
No legacy comparison, reconciliation decisions, journal fetching, relationship graph, or rebuild orchestration.

## No Production Import
The adapter remains isolated and is not imported by production services or frontend.

## Migration Boundary
No table creation, schema edits, migration, source-of-truth switch, or production activation.

## Validation Gate
All repository safety, parameterization, atomic CAS intent, stale-write, first-insert, SAME_STATE, ID stability, field completeness, malformed-row, transaction-boundary, and non-authority checks must pass before Owner Acceptance.

## Owner Authorization Boundary
This document is a gate only. P2-B implementation requires separate explicit Owner authorization.
