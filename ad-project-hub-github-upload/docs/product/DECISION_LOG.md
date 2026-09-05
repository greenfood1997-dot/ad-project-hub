# Decision Log

| Date | Decision | Reason | Status |
|---|---|---|---|
| 2026-09-05 | AI-first；Human by Exception；Minimum Human Touch | 减少重复录入，让人专注判断 | Accepted for Phase 0 |
| 2026-09-05 | Facts → Rules → AI；Single Input Multiple Effects | 防止推断污染事实并保持一致性 | Accepted for Phase 0 |
| 2026-09-05 | Money via Financial Events；confirmed facts 用 correction/reversal | 保证资金可追溯、可审计 | Accepted for Phase 0 |
| 2026-09-05 | Role + Scope + Responsibility；Exception First；Next Best Action | 同一真相适配不同职责并降低噪声 | Accepted for Phase 0 |
| 2026-09-05 | Universal Drop；Conversational Expense Capture；Monthly Expense Consolidation | 降低员工系统操作 | Accepted for Phase 0 |
| 2026-09-05 | Automatic Daily/Monthly Reporting；Client/Internal/Management boundary | 自动产出且避免信息越界 | Accepted for Phase 0 |
| 2026-09-05 | AI Brain uses Tools；Model Gateway；Business Memory categories | 可替换模型、可审计执行、长期业务记忆 | Accepted for Phase 0 |
| 2026-09-05 | Treasury Safety Layer | 经营建议不得越权成为资金动作 | Accepted for Phase 0 |
| 2026-09-05 | Quiet OS visual direction | 安静、直接、渐进披露的体验 | Accepted for Phase 0 |
| 2026-09-05 | Human Touch Rate as product KPI | 以真实自动化价值衡量产品 | Accepted for Phase 0 |
| 2026-09-05 | Execution Cost Universal Drop | AI 拆分归类执行成本，仅让人确认异常与正式金额 | ACCEPTED_AS_PHASE_0_DESIGN |
| 2026-09-05 | Annual Retainer Obligation Model | 年框合同持续追踪年度/月度计划、证据与履约风险 | ACCEPTED_AS_PHASE_0_DESIGN |
| 2026-09-05 | Company → Department → PM → Project Drill-down | 股东按 Scope 使用同一事实源下钻 | ACCEPTED_AS_PHASE_0_DESIGN |
| 2026-09-05 | AI Executive Advisor Scope | 以证据、影响、风险、下一步提供决策支持并限制越权 | ACCEPTED_AS_PHASE_0_DESIGN |
| 2026-09-05 | Event Delivery Reliability / No Silent Failure | 事件与通知分离、可重试、可审计，避免渠道失败丢失业务 | ACCEPTED_AS_PHASE_0_DESIGN |
| 2026-09-05 | Phase 0 Product Constitution & Architecture Baseline Owner Acceptance | Owner 接受文档化产品宪法与架构基线 | OWNER_ACCEPTED |

**Scope:** Documentation / Product Design / Architecture Baseline Only  
**Non-Authorizing Boundary:** 不授权 UI 或 Backend 重构、DB schema 变更、Financial Event/AI Brain/Business Memory/Notification 重构实现、自动投资/转账/招聘/裁员/扩张、生产部署或任何 Phase 1 实施；不代表上述能力已实现。

## Phase 1B Design Record

**Decision:** Financial Truth Foundation Design Started  
**Status:** DESIGN_IN_PROGRESS  
**Date:** 2026-09-05  
**Scope:** Financial Truth taxonomy, Financial Event and Ledger architecture, confirmation authority, effects, idempotency, migration and reconciliation mapping only.  
**Boundary:** DESIGN ONLY；IMPLEMENTATION NOT AUTHORIZED，不修改业务代码、数据库 schema、API、前端、测试或数据，不执行 migration，不部署，不改变任何金额事实。

## Owner Decisions Integrated — Phase 1B

| Date | Decision | Reason | Status |
|---|---|---|---|
| 2026-09-05 | companyId required with default company identity | 每个金融事实必须归属明确经营/法律主体 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Cash confirmation requires Finance and reliable evidence | 区分业务上报与真实到账，银行 API 非前置依赖 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Cash Receipt ≠ Revenue Recognition | 保持合同、收入、应收、现金边界 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Payroll boundary: gross/net/employer contributions and paid event | 区分公司人力成本、员工到手与现金流 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | JSON/PostgreSQL share financial semantics | 避免两套 Financial Truth，仅允许 adapter 差异 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Supplier payable identity uses stable supplierId | 支持同供应商同项目多笔应付事实 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Exact smallest-unit monetary reconciliation | 禁止宽松容差掩盖真实差异 | ACCEPTED_AS_PHASE_1B_DESIGN |
| 2026-09-05 | Financial Events are non-deletable and rebuildable | 支持审计、对账、重建与修正链 | ACCEPTED_AS_PHASE_1B_DESIGN |

**Design Acceptance Only:** these records do not mean IMPLEMENTED, MIGRATED, ACTIVATED or PRODUCTION READY.

## Phase 1B Owner Acceptance

**Decision:** Phase 1B Financial Truth Foundation Design Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Design Only  
**Non-Authorizing Boundary:** 不代表 Financial Event、Ledger、数据迁移、Source of Truth 切换、Legacy 字段废弃、Cash/Receivable/Payable/Payroll Ledger 或 Bank Integration 已实现或上线；不授权 DB schema、migration、API、frontend、production activation 或任何 implementation。Deferred Policy 与 implementation-detail 问题须在对应实施 Gate 前关闭。

## Implementation Gate Design Record

**Decision:** Phase 1B Implementation Gate Design  
**Status:** DESIGN_ONLY  
**Date:** 2026-09-05  
**Scope:** Additive domain foundation, isolated deterministic tests, in-memory test repository, projection/reconciliation design and protected write-path register only.  
**Boundary:** 不授权真实 payment/approval/supplier/payroll integration、JSON/PostgreSQL production adapters、migration、Source of Truth 切换、API/frontend 改造或任何生产金额行为变化。

## Phase 1B Slice 1 Implementation Authorization

**Decision:** Phase 1B Financial Truth Slice 1 Implementation Authorization  
**Status:** OWNER_AUTHORIZED  
**Date:** 2026-09-05  
**Scope:** Pure Domain Foundation Only（Financial Event contract/validation、business idempotency、correction/reversal、confirmation authority、pure projections/reconciliation、storage-neutral journal interface、in-memory test repository、isolated deterministic tests）。  
**Non-Authorizing Boundary:** 不授权修改现有 payment/approval/supplier/petty-cash/parse/compensation/frontend/API 写路径；不授权 DB schema、JSON/PostgreSQL production repository、真实 financial write integration、dual/shadow write、migration、Source of Truth switch、legacy deprecation、production deployment 或 push。Legacy financial fields remain authoritative。  
**Implementation State:** SLICE 1 IMPLEMENTATION NOT STARTED。

## Slice 1 Implementation Record

**Decision:** Phase 1B Financial Truth Slice 1 Implementation  
**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** Isolated Financial Truth domain modules, pure projections/reconciliation, storage-neutral journal interface, in-memory repository and deterministic tests only.  
**Boundary:** 未修改现有 payment/approval/supplier/payroll/project financial paths、API、frontend、DB、data 或 package；未接入生产写入、migration、dual write、shadow write 或 Source of Truth switch。

## Slice 1 Validation Remediation v0.1

**Status:** IMPLEMENTED_PENDING_REVALIDATION  
**Date:** 2026-09-05  
**Decision:** 强化 minor-unit precision、deep immutability、幂等冲突、时间戳、reversal/correction、canonical projection 与 reconciliation domain rules；明确 `COST_INCURRED` 与 `PAYABLE_CREATED` 各自承担单一财务效果。  
**Boundary:** 仅限 Slice 1 pure domain、in-memory journal 与 isolated deterministic test；不代表 VALIDATED、OWNER ACCEPTED、PRODUCTION READY、ACTIVATED 或 MIGRATED。

## Slice 1 Remediation v0.2

**Decision:** Financial History Integrity Rule；Canonical Projection Replay Rule  
**Status:** ACCEPTED_AS_SLICE_1_REMEDIATION_DESIGN  
**Date:** 2026-09-05  
**Scope:** History-aware reversal/correction validation, canonical event history, effective event resolution and final deep immutable journal API.  
**Boundary:** 仅为 Slice 1 domain remediation 设计与实现状态记录；不代表 VALIDATED、OWNER ACCEPTED、PRODUCTION READY、MIGRATED 或 ACTIVATED。

## Slice 1 Remediation v0.3

**Decision:** Financial Relationship Graph Integrity Rule；Effective Event Replacement Rule  
**Status:** ACCEPTED_AS_SLICE_1_REMEDIATION_DESIGN  
**Date:** 2026-09-05  
**Scope:** Unified relationship graph validation, history fail-closed semantics and corrected-event replacement in effective projections.  
**Boundary:** 不代表 VALIDATED、OWNER ACCEPTED、PRODUCTION READY、MIGRATED 或 ACTIVATED；不涉及 production integration、migration、API/frontend 或 Slice 2。

## Phase 1B Slice 1 Owner Acceptance

**Decision:** Phase 1B Financial Truth Slice 1 Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Pure Financial Truth Domain Foundation Only  
**Validation:** PASS  
**Critical Remaining:** 0  
**High Remaining:** 0  
**Classification:** NON-PRODUCTION / NON-MIGRATING / NON-ACTIVATING  
**Non-Authorizing Boundary:** 不授权 JSON production repository、PostgreSQL production repository、DB schema changes、migration、Event Journal production persistence、payment/approval/supplier/payroll production integration、dual write、shadow production write、frontend read switch、Source of Truth switch、legacy field deprecation、bank integration 或 production deployment。Legacy financial fields remain current authoritative production state。

## Phase 1B Storage & Atomicity Gate Design

**Decision:** Financial Truth Storage & Atomicity Gate Design V1  
**Status:** DESIGN ONLY / READY FOR OWNER REVIEW  
**Date:** 2026-09-05  
**Scope:** JSON/PostgreSQL storage assessment, Financial Event persistence contract, atomic event-plus-projection model, idempotency race handling, reconciliation persistence, crash recovery and semantic parity.  
**Non-Authorizing Boundary:** 不授权任何 storage adapter、DB schema 变更、migration、JSON/PostgreSQL production repository、真实 payment/approval/supplier/payroll 接入、dual/shadow production write、API/frontend 改造、Source of Truth switch、legacy deprecation、测试执行、部署或 push。Legacy financial fields remain authoritative。

## Phase 1B Storage & Atomicity Gate Owner Acceptance

**Decision:** Phase 1B Financial Truth Storage & Atomicity Gate Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Storage / Atomicity Architecture Design Only  
**Classification:** NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Design Decisions:** PostgreSQL Production Financial Truth Storage Target；JSON Local/Dev/Test Compatibility Only；Persistent Rebuildable Projection Rule；Historical Reconciliation Mismatch Requires Manual Review；BIGINT / Safe Integer Boundary；Stable Payable Identity Rule。  
**Storage Invariants:** Financial Event Journal is authoritative history; Projection is rebuildable materialized state and never the reverse authority; no projection without an event; synchronous Event + required Projection + applicable Reconciliation should share one transaction with rollback on failure; same idempotency key resolves by canonical payload comparison; PostgreSQL uses database uniqueness for races; JSON uses one serialized mutation critical section; BIGINT conversion must pass `Number.isSafeInteger`; payable requires stable `payableId`; MISMATCH/UNKNOWN are never auto-smoothed; rebuild is deterministic, canonical, relationship-validated, fail-closed and auditable; legacy financial fields remain authoritative until migration/reconciliation/source-switch gates pass.  
**Non-Authorizing Boundary:** 不授权创建或应用 `financial_events` schema/migration、实现 production adapters/repositories、Event Journal/Projection/Reconciliation production persistence、payment/approval/supplier/payroll/bank integration、dual/shadow write、frontend read switch、Source of Truth switch、legacy deprecation、production deployment 或进入 Storage Slice A。  
**Open Questions:** Storage design questions are resolved. Bank evidence, finance review SLA, multi-payable allocation, detailed mismatch SLA, operational rebuild tooling and archive operations block later integration only; Revenue Recognition, Payroll and statutory retention/archive remain deferred policy.

## Phase 1B Storage Slice A Implementation

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** PostgreSQL schema contract, adapter/transaction contracts, safe BIGINT codec, idempotency classification and isolated deterministic tests only.  
**Boundary:** Migration NOT APPLIED；Production Storage NOT ACTIVATED；Production Integration NOT AUTHORIZED；不得视为 VALIDATED、OWNER_ACCEPTED、MIGRATED 或 PRODUCTION_READY。

## Storage Slice A Remediation v0.1

**Status:** IMPLEMENTED_PENDING_REVALIDATION  
**Date:** 2026-09-05  
**Scope:** Schema/Test Contract Closure Only  
**Non-Authorizing:** YES；不授权 migration、DB connection、production adapter、projection/reconciliation tables、JSON adapter、integration、Source of Truth switch、Storage Slice B、commit 或 push。

## Phase 1B Financial Truth Storage Slice A Owner Acceptance

**Decision:** Phase 1B Financial Truth Storage Slice A Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** PostgreSQL Schema Contract / Adapter Contract / Isolated Tests Only  
**Validation:** PASS  
**Remaining Critical:** 0  
**Remaining High:** 0  
**Classification:** NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Invariants:** Financial Event remains authoritative future history; Schema Contract is not Applied Schema; schema draft is DRAFT / NOT APPLIED / NON-ACTIVATING; amount uses PostgreSQL BIGINT and domain safe-integer Number with fail-closed decode; idempotency is database-unique and classifies duplicate versus conflict; persistence is append-only and correction/reversal append new events; transaction ownership belongs to upper orchestration; structural constraints do not replace Slice 1 relationship-graph validation; current idempotency SQL is contract foundation only, not complete production row persistence.  
**Schema Version:** No `event_schema_version` in Slice A; replay compatibility remains governed by accepted FinancialEvent contract/version policy; SUFFICIENT_FOR_SLICE_A.  
**Non-Authorizing Boundary:** 不授权 db schema 修改、migration、真实 PostgreSQL table/adapter、complete production row mapper、Event Journal/Projection/Reconciliation persistence、JSON/payment/approval/supplier/payroll/bank integration、dual/shadow write、frontend read switch、Source of Truth switch、legacy deprecation、deployment 或 Storage Slice B。

## Phase 1B Storage Slice B Implementation

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** Isolated PostgreSQL Journal Adapter Only  
**Non-Authorizing:** YES；Migration NOT APPLIED；Production Storage NOT ACTIVATED；Production Integration NOT AUTHORIZED；不得进入 Storage Slice C。

## Storage Slice B Remediation v0.1

**Status:** IMPLEMENTED_PENDING_REVALIDATION  
**Date:** 2026-09-05  
**Scope:** PostgreSQL conflict classification、timestamp contract tests、malformed read / immutability tests  
**Boundary:** NON-PRODUCTION / NON-MIGRATING / NON-INTEGRATING；不授权 Storage Slice C。

## Phase 1B Financial Truth Storage Slice B Owner Acceptance

**Decision:** Phase 1B Financial Truth Storage Slice B Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Isolated PostgreSQL Journal Adapter Only  
**Validation:** PASS  
**Remaining Critical:** 0  
**Remaining High:** 0  
**Classification:** NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Invariants:** Adapter 仅负责 raw immutable Financial Event persistence/query；所有读写使用调用方 tx/client；完整 30-field mapping 与 append-only contract；BIGINT codec、timestamptz normalization、JSONB isolation、idempotency canonical comparison、23505 conflict classification、malformed-row fail-closed 与 deep immutability 均已验证。  
**Non-Authorizing Boundary:** 不授权 schema/migration、真实 financial_events table、production PostgreSQL activation、payment/approval/supplier/payroll/bank integration、projection/reconciliation persistence、JSON adapter、dual/shadow write、frontend read switch、Source of Truth switch、legacy deprecation、deployment 或 Storage Slice C。

## Phase 1B Projection Persistence & Rebuild Gate Design

**Decision:** Projection Persistence & Rebuild Gate Design V1  
**Status:** DESIGN ONLY / READY FOR OWNER REVIEW  
**Date:** 2026-09-05  
**Scope:** Projection authority, identity/currency boundary, materialized state, deterministic rebuild, watermark, invalid-history handling, reconciliation interface and future repository/transaction contracts.  
**Recommendation:** CONTINUE_WITH_PROJECTION_PERSISTENCE_GATE  
**Non-Authorizing Boundary:** 不授权 projection repository、table/schema、migration、reconciliation persistence、atomic write orchestration、JSON adapter、production integration 或 Source of Truth switch；本阶段不实施任何代码。

## Phase 1B Projection Persistence & Rebuild Gate Owner Acceptance

**Decision:** Phase 1B Projection Persistence & Rebuild Gate Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Projection Persistence / Rebuild Architecture Design Only  
**Classification:** NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Decisions:** Financial Event Journal authoritative；Projection rebuildable materialized state；PostgreSQL production target；JSON Adapter DEFERRED；PER_CURRENCY_PROJECTION；FULL_REBUILD_FIRST；no direct projection financial mutation；canonical deterministic watermark；company/project scoped projection identity。  
**Non-Authorizing Boundary:** 不授权 Projection Slice P1 implementation、PostgreSQL projection repository、`financial_projections` table、schema/migration、production PostgreSQL、reconciliation persistence、atomic write orchestrator、JSON/payment/approval/supplier/payroll/bank integration、shadow/dual write、frontend read switch、Source of Truth switch、legacy deprecation、deployment 或进入 Projection Slice P1。

## Projection Slice P1 Implementation

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** Pure Projection Contract / Materialized Builder / Deterministic Watermark / Company-Project Rebuild / Isolated Tests  
**Classification:** NON-STORAGE / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING

## Phase 1B Projection Slice P1 Owner Acceptance

**Decision:** Phase 1B Projection Slice P1 Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Pure Materialized Projection + Deterministic Rebuild + Relationship Integrity Boundary  
**Validation:** PASS  
**Remaining Critical:** 0  
**Remaining High:** 0  
**Classification:** NON-STORAGE-PERSISTING / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Invariants:** Financial Event Journal authoritative；Projection derived/rebuildable materialized state；relationship-complete input validation precedes scope extraction；company/project/currency isolation；canonical deterministic watermark；invalid history fail-closed；no direct projection financial mutation。  
**Non-Authorizing Boundary:** 不授权 Projection Slice P2、PostgreSQL Projection Repository、`financial_projections` table、SQL persistence、migration、reconciliation persistence、Atomic Write Orchestrator、JSON/payment/approval/supplier/payroll/bank integration、shadow/dual write、frontend read switch、Source of Truth switch 或 production deployment。

## Phase 1B Projection Slice P2 PostgreSQL Projection Repository Gate Design

**Decision:** PostgreSQL Projection Repository Gate Design V1  
**Status:** DESIGN ONLY / READY FOR OWNER REVIEW  
**Date:** 2026-09-05  
**Scope:** Future `financial_projections` identity/schema, scope constraints, BIGINT/currency boundary, watermark/version persistence, whole-state replacement, stale-write protection, status/error/read/transaction contracts.  
**Recommendation:** AUTHORIZE_P2_IMPLEMENTATION_GATE  
**Non-Authorizing Boundary:** 不授权 repository/adapter、table/schema、SQL、migration、production DB、reconciliation persistence、atomic orchestrator、JSON adapter、integration、Source of Truth switch 或 deployment。

## P2 Gate Documentation Closure v0.1

**Status:** DOCUMENTATION_CLOSURE_PENDING_OWNER_REVIEW  
**Date:** 2026-09-05  
**Findings Closed by Design:** P2-DOC-001 Company NULL uniqueness；P2-DOC-002 exact watermark CAS/stale-write semantics；P2-DOC-003 INVALID_HISTORY persistence policy。  
**Scope:** Documentation closure only  
**Non-Authorizing Boundary:** 不授权 implementation、SQL、table、migration、PostgreSQL connection、repository activation、reconciliation persistence、production integration、commit 或 push。

## P2 Gate Documentation Closure v0.2

**Status:** DOCUMENTATION_CLOSURE_V0_2_COMPLETE_PENDING_OWNER_ACCEPTANCE  
**Date:** 2026-09-05  
**Scope:** CAS-capable Repository Interface + Deterministic First-Insert Conflict Semantics + Stable Projection Technical Identity  
**Findings:** P2-DOC-001 CLOSED；P2-DOC-002 CLOSED；P2-DOC-003 CLOSED；P2-DOC-004 CLOSED；P2-DOC-005 CLOSED；P2-DOC-006 CLOSED。  
**Non-Authorizing Boundary:** 不授权 implementation、SQL、table、migration、真实 PostgreSQL、reconciliation persistence、production integration、P2-A、commit 或 push。

## Phase 1B Projection Slice P2 PostgreSQL Repository Gate Owner Acceptance

**Decision:** Phase 1B Projection Slice P2 PostgreSQL Repository Gate Owner Acceptance  
**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Projection Repository Architecture / Schema / CAS Contract Only  
**Accepted Findings:** P2-DOC-001 CLOSED；P2-DOC-002 CLOSED；P2-DOC-003 CLOSED；P2-DOC-004 CLOSED；P2-DOC-005 CLOSED；P2-DOC-006 CLOSED。  
**Classification:** NON-IMPLEMENTING / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING  
**Accepted Invariants:** Event Journal authoritative；Projection derived/rebuildable；partial unique identity constraints；stable `projection_id`；complete watermark CAS；whole-state replacement；`INVALID_HISTORY` not persistable；shared transaction boundary；JSON deferred。  
**Non-Authorizing Boundary:** 不授权 P2-A/P2-B implementation、repository、`financial_projections` table、SQL、migration、真实 PostgreSQL、reconciliation persistence、Atomic Write Orchestrator、JSON adapter、business integration、shadow/dual write、Source of Truth switch 或 deployment。

## Projection Storage Slice P2-A Implementation

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** Machine-readable Projection Storage Contract / Scope-Status-Identity Contract / Row Mapping / Watermark-CAS Contract / Repository Interface Contract / Deterministic Tests  
**Classification:** NON-SQL / NON-REPOSITORY / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING

## Projection Slice P1 Remediation v0.2

**Status:** IMPLEMENTED_PENDING_FINAL_REVALIDATION  
**Date:** 2026-09-05  
**Scope:** Cross-Company Relationship Integrity Closure + Relationship-Complete Input Contract  
**Classification:** NON-STORAGE / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING

## Projection Slice P1 Remediation v0.1

**Status:** IMPLEMENTED_PENDING_REVALIDATION  
**Date:** 2026-09-05  
**Scope:** Relationship Integrity Before Scope Projection + Cross-Scope Adversarial Test Closure  
**Classification:** NON-STORAGE / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING

## Storage Slice B Remediation v0.1.1

**Status:** IMPLEMENTED_PENDING_FINAL_REVALIDATION  
**Date:** 2026-09-05  
**Scope:** Malformed Read Fail-Closed + Return Immutability Test Closure  
**Boundary:** NON-PRODUCTION / NON-MIGRATING / NON-INTEGRATING；不授权 Storage Slice C。

### Storage Gate Design Decisions

| Date | Decision | Status |
|---|---|---|
| 2026-09-05 | PostgreSQL is the target production Financial Truth storage; JSON remains Local/Dev/Test compatibility with limitations | ACCEPTED_AS_STORAGE_GATE_DESIGN |
| 2026-09-05 | Financial Event Journal is authoritative; Projection is persistent rebuildable cache/materialized state | ACCEPTED_AS_STORAGE_GATE_DESIGN |
| 2026-09-05 | Historical reconciliation `MISMATCH` / `UNKNOWN` requires recorded manual review and must not be auto-smoothed | ACCEPTED_AS_STORAGE_GATE_DESIGN |

**Design-only boundary:** 上述决定不代表 schema 已创建、migration 已应用、adapter/repository 已实现或 production 已激活。

## Phase 1B Projection Storage Slice P2-A Owner Acceptance

**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Machine-Readable Projection Storage Contract + Row Mapping + CAS Semantic Contract + Repository Interface Contract  
**Validation:** PASS  
**Remaining Critical:** 0  
**Remaining High:** 0  
**Boundary:** NON-SQL / NON-REPOSITORY / NON-MIGRATING / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Implementation Authorization Gate

**Status:** DESIGN / AUTHORIZATION ONLY  
**Date:** 2026-09-05  
**P2-A:** OWNER ACCEPTED  
**P2-B Implementation:** NOT AUTHORIZED  
**Migration:** NOT AUTHORIZED  
**Production Integration:** NOT AUTHORIZED  
**Scope:** Isolated PostgreSQL Projection Repository Adapter design gate only

## Phase 1B Projection Storage Slice P2-B Implementation Gate Owner Acceptance

**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-05  
**Scope:** Isolated PostgreSQL Projection Repository Adapter Implementation Authorization  
**Accepted Closure:** P2B-DOC-001 CLOSED; P2B-DOC-002 CLOSED  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Implementation Completion v0.1

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-06  
**Evidence:** Mock Transaction Repository Regression PASS; Existing Financial Truth Regressions PASS  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Owner Acceptance

**Status:** OWNER_ACCEPTED  
**Date:** 2026-09-06  
**Scope:** Isolated PostgreSQL Projection Repository Adapter + Parameterized SQL + Atomic CAS + Whole-State Replacement + First-Insert Race Resolution + SAME_STATE + Error Classification + Mock Transaction Validation  
**Validation:** PASS; P2B-VAL-001 CLOSED  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Validation Coverage Closure v0.1

**Status:** PASS_WITH_NON_BLOCKING_FINDING_CLOSED  
**Date:** 2026-09-06  
**Finding:** P2B-VAL-001 CLOSED  
**Evidence:** Project race, winner-missing, empty-watermark, and existing regression coverage PASS  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Implementation Completion v0.1

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Evidence:** Mock Transaction Repository Regression PASS; Existing Financial Truth Regressions PASS  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## Phase 1B Projection Storage Slice P2-B Implementation

**Status:** IMPLEMENTED_PENDING_VALIDATION  
**Date:** 2026-09-05  
**Scope:** Isolated PostgreSQL Projection Repository Adapter + Parameterized SQL + Atomic CAS + First Insert Race Resolution + SAME_STATE + Error Classification + Mock Transaction Tests  
**Boundary:** NON-MIGRATING / NON-REAL-DB / NON-PRODUCTION / NON-INTEGRATING / NON-ACTIVATING

## P2-B Gate Documentation Closure v0.1

**Findings:** P2B-DOC-001 Canonical Row Shape vs Mutable Replacement Field Set; P2B-DOC-002 Deterministic Logical Identity Unique Conflict Classification  
**Status:** DOCUMENTATION_CLOSURE_V0_1_COMPLETE_PENDING_OWNER_REVIEW  
**Scope:** Documentation only; no implementation, SQL source, tests, DB, migration, or production integration.
