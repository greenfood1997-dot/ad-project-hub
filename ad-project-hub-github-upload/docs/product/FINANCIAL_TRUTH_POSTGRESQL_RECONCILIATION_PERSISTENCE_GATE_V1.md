# Financial Truth PostgreSQL Reconciliation Persistence Gate V1

## A. Design Executive Summary

本设计把已接受的 immutable reconciliation observation 规划为 PostgreSQL 中的永久、append-only、可审计 evidence。它不改变 Reconciliation 的非权威定位，不改变 TYPE A comparator，不授权生产接入、迁移或 Atomic Write Orchestrator。

## B. Persistence Objective

未来 repository 必须可靠保存 observation，支持按 company/project scope 读取，跨进程和重启保留 evidence，并为未来 caller-owned transaction 提供参与点。

## C. Authority Boundary

Financial Event Journal 是未来财务历史权威；Projection 是可重建派生状态；Reconciliation 仅是 evidence/consistency observation。持久化记录不得修改 Event、Projection 或 Legacy financial totals。

## D. Logical Record Model

逻辑记录以 immutable `reconciliationId` 作为业务身份。可存在内部 surrogate key，但不得替代 reconciliationId。记录包含 comparison type、scope identity、status/reason、versions、timestamps、snapshots、watermarks、differences 和 optional sourceContext。

## E. Typed Column Design

建议独立 typed columns：`reconciliation_id`、`comparison_type`、`scope_type`、`company_id`、`project_id`、`currency`、`comparison_status`、`reason_code`、`projection_contract_version`、`reconciliation_contract_version`、`checked_at`、`created_at`，以及可选 `persisted_at` storage metadata。typed identity/status/version/timestamps 用于约束、过滤和 fail-closed validation。

## F. Snapshot Persistence Design

`expected_snapshot` 与 `observed_snapshot` 使用 JSONB immutable evidence payload 保存。JSONB 保留 accepted snapshot 结构，不改变字段语义；row mapper 读取后必须重新验证 projection contract。

## G. Watermark Persistence Design

采用 hybrid：`expected_watermark` 与 `observed_watermark` 作为 JSONB immutable payload 保存，同时可在未来增加受控 typed extraction；首阶段不重复维护多套权威字段。payload 必须包含 `eventCount`、`latestCanonicalEventId`、`canonicalDigest`，读取时严格验证。

## H. Difference Evidence Design

`differences` 使用 JSONB array。每项保留 `category`、`field`、`expected`、`observed` 及必要 context。写入前保持 deterministic ordering，读取后 fail-closed 验证；不建立可变 resolution child table。

## I. SourceContext Design

`source_context` 使用 JSONB，保留 nested structure。它是 optional immutable audit evidence，不参与 financial equality，不成为 business authority，也不得被扁平化丢字段。

## J. Append-Only Semantics

未来 repository 只提供 INSERT、SELECT、LIST。禁止 UPDATE、DELETE、UPSERT overwrite、PATCH、replace。数据库约束与 adapter API 都必须保持 append-only。

## K. Duplicate-ID Semantics

同 reconciliationId + 相同 immutable content → `EXISTING_IDENTICAL`；同 ID + 不同 content → stable conflict/fail closed；不同 ID + 相同 evidence → 允许追加。

## L. Fingerprint Decision

首阶段不把 fingerprint 作为业务唯一依据。若未来增加 canonical fingerprint，仅用于 integrity/efficiency evidence。canonicalization 应覆盖业务 identity、status/reason、versions、timestamps、snapshots、watermarks、differences、sourceContext；metadata 是否纳入必须固定并版本化。最终 same-content 判定优先采用“读取 existing row → deterministic row mapping → canonical comparison”，fingerprint 仅作辅助。

## M. Company / Project Isolation

Company 查询必须同时满足 `scopeType = COMPANY`、companyId、currency。Project 查询必须同时满足 `scopeType = PROJECT`、companyId、projectId、currency，防止 REC-REM-001 再次发生。

## N. Ordering Contract

PostgreSQL list 必须显式 `ORDER BY created_at ASC, reconciliation_id ASC`。不得依赖无 ORDER BY 的自然顺序；该排序是未来 adapter contract。

## O. Timestamp Contract

`checked_at` 表示检查发生时间，`created_at` 表示 evidence 创建时间，均为 timezone-aware caller-provided timestamps。可选 `persisted_at` 仅为 storage metadata，不覆盖或参与 financial equality；数据库默认 NOW() 不得覆盖 caller evidence timestamp。

## P. Malformed Row Policy

row mapper 必须验证 identity、scope、currency、status、reason、versions、watermarks、snapshots、differences、sourceContext 和 timestamps。任何 malformed trusted row 都必须 fail closed，不得静默 normalize。

## Q. Transaction Boundary

未来 API 采用 caller-owned transaction：`appendReconciliation(tx, observation)`、`getReconciliation(txOrClient, id)`、`list...`。repository 不得 new Pool、connect、BEGIN、COMMIT 或 ROLLBACK。写入强制 tx 以便未来参与统一事务；读取可接受 caller-owned tx/client。

## R. Future Atomic Write Compatibility

设计允许未来同一 caller-owned tx 执行 Event append、Projection save、Reconciliation append，但本 Gate 不实现 orchestrator，也不代表 atomicity 已存在。

## S. Error Classification

未来 adapter 至少提供稳定 machine-readable 分类：duplicate identity、same-content replay、different-content conflict、malformed persisted row、missing transaction context、storage failure。不得把 raw PostgreSQL message 作为外部 contract。

## T. Logical Index Design

逻辑建议：reconciliation_id unique；company scope lookup；project scope lookup；必要的 currency 与 created_at/reconciliation_id ordering 支持。避免为 JSONB 内部字段建立过度索引。

## U. JSONB Boundary

JSONB 仅承载 immutable evidence：expected_snapshot、observed_snapshot、expected_watermark、observed_watermark、differences、source_context。typed columns 仍负责 identity/status/version/timestamp validation；JSONB 不能绕过 typed validation。

## V. Repository Interface

未来接口：`appendReconciliation(tx, observation)`、`getReconciliation(txOrClient, reconciliationId)`、`listReconciliationsForCompany(txOrClient, query)`、`listReconciliationsForProject(txOrClient, query)`。不得加入 update/delete/patch/replace。

## W. Future Test Matrix

未来实现必须覆盖 append、read、company/project isolation、explicit ordering、same ID same content、same ID conflict、different IDs same evidence、sourceContext/snapshot/difference/watermark persistence、timestamp round-trip、malformed row、missing tx、no transaction ownership、no update/delete、no production import。

## X. Existing Pattern Reuse

复用 Journal PostgreSQL Adapter 与 Projection PostgreSQL Repository 的 caller-owned transaction、row mapper、timestamp codec、error classifier、mock transaction 和 malformed-row test pattern。不复制 Projection 的 mutable CAS/SAME_STATE 语义。

## Y. First Implementation Slice Recommendation

未来最小实现切片：PostgreSQL Reconciliation Repository、isolated SQL contract、row mapper/timestamp validation、mock transaction repository 和 deterministic regression tests。该切片仍需单独 Owner Implementation Gate。

## Z. Explicit Non-Authorization

本设计是 DESIGN ONLY / NOT IMPLEMENTED / NOT ACTIVATED。未授权真实 PostgreSQL、table、SQL、migration、real DB、production integration、Atomic Write、Legacy reconciliation、TYPE B/C/D execution、shadow/dual write、frontend switch 或 Source of Truth switch。

## AA. Status

`POSTGRESQL_RECONCILIATION_PERSISTENCE_DESIGN_GATE: READY_FOR_OWNER_REVIEW`

## Owner Design Acceptance and Implementation Gate Preparation

**Design Status:** OWNER_ACCEPTED / DESIGN_COMPLETE / IMPLEMENTATION_NOT_STARTED / NON_AUTHORIZING  
**Accepted Date:** 2026-09-06  
**Implementation Gate:** READY_FOR_OWNER_AUTHORIZATION

### Prepared Implementation Work Package

The next separately authorized isolated package may include:

- PostgreSQL reconciliation repository
- SQL contract module containing query strings only
- deterministic row mapper
- timestamp codec and validation reuse
- JSONB evidence round-trip
- duplicate-ID classification
- caller-owned transaction enforcement
- company/project query isolation
- deterministic ordering
- malformed-row fail-closed handling
- no update/delete API
- static production-isolation checks
- comprehensive repository regression

Proposed isolated locations:

- `server/financial-truth/reconciliation/storage/`
- `tests/financial-truth-postgres-reconciliation-repository-regression.mjs`

This preparation does not authorize implementation, SQL migration, real DB connection, production integration, Atomic Write, Legacy reconciliation, TYPE B/C/D execution, or Source of Truth switch.
