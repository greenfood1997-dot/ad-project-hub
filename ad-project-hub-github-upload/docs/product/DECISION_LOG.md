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
