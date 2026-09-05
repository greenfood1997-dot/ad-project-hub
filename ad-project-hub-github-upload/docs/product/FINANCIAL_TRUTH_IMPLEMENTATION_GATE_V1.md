# Financial Truth Implementation Gate V1

## 1. Purpose

定义 Phase 1B 第一批最小安全实施范围。本文仅做 implementation slicing、架构映射、依赖与测试设计；不授权业务代码、schema、API、迁移或生产行为变更。

## 2. Safety Principles

- Additive First；Shadow Before Authority。
- No Money Behavior Change：legacy `project.paid`、`receivable`、`costUsed`、`margin`、cash、供应商结算和审批行为保持不变。
- No Migration First；Legacy remains authoritative。
- Pure Logic Before Integration；Test Before Write Integration。
- JSON/PostgreSQL 共享 domain semantics；adapter 可不同。

## 3. Protected Existing Write Path Register

| File | Function / Path | Current Behavior | Why Protected | Allowed Change in Slice 1 |
|---|---|---|---|---|
| `server/payment-service.mjs` | `recordProjectPayment` | 写入 `payments[]`、`project.paid/receivable` 并刷新风险/通知 | 当前生产回款语义与金额路径 | NONE |
| `server/payment-service.mjs` | `voidProjectPayment` | 作废 payment，回滚项目累计值并重开通知 | 现有 reversal 行为尚非 Event 语义 | NONE |
| `server/approval-service.mjs` | `applyApprovedFinanceImpact` | 审批完成直接写项目成本/备用金/供应商状态 | Approved/Paid 边界风险 | NONE |
| `server/approval-service.mjs` | `updateSupplierSettlement` / supplier settlement | 标记付款并写项目成本 | supplier/payable/cash 尚未统一 | NONE |
| `server/project-parse-service.mjs` | `applyParsedFields` | 解析结果写合同、成本、回款、应收、利润 | 解析聚合不得改变 | NONE |
| `server/compensation-service.mjs` | compensation/labor writes | 写薪酬配置与人力分摊输入 | Payroll 边界尚未迁移 | NONE |
| `server/api.mjs` | payment/approval/supplier routes | 生产 API 写路径 | 防止隐式集成 | NONE |
| `src/utils/*` | financial derived calculations | 前端派生利润/回款/现金压力 | 不改变现有视图语义 | NONE |

## 4. Proposed New Modules

建议新增 `server/financial-truth/`（或等价隔离目录）：`financial-event.mjs`、`idempotency.mjs`、`authority.mjs`、`reversal.mjs`、`projections.mjs`、`reconciliation.mjs`、`journal-interface.mjs`。首批只允许纯 domain/pure functions 与测试；不导入生产写路径。

## 5. Slice Breakdown

### Slice 1A — Event Domain Contract

- Objective：closed event vocabulary、字段校验、`companyId`、amount/currency、sourceEvidence、authority metadata、immutable semantics。
- Allowed Files：新 `server/financial-truth/*`、对应 isolated tests。
- Forbidden Files：上述 Protected Register、`db/`、API、frontend、data。
- Tests：valid/invalid event、缺 companyId、金额、类型、幂等键、不可变确认事件。
- Acceptance：deterministic、无副作用、无网络/DB。
- Rollback Complexity：LOW；删除新增模块即可。
- Risk：LOW。
- Dependencies：Phase 1B design contract。

### Slice 1B — Idempotency + Correction/Reversal + Authority

- Objective：业务幂等键、重复检测、reversal/correction 规则、`canConfirmFinancialEvent`。
- Allowed Files：新 domain modules/tests。
- Forbidden Files：payment/approval/void/delete API、权限系统。
- Tests：Sales/PM/Finance authority、重复 key、double reversal、原事件保留、金额不可静默覆盖。
- Acceptance：规则纯函数化且不触发真实动作。
- Rollback Complexity：LOW。
- Risk：LOW。
- Dependencies：1A。

### Slice 1C — Pure Projections + Reconciliation

- Objective：`projectPaymentProjection`、`projectCostProjection`、`receivableProjection`、`payableProjection`、`cashProjection` 与 exact-unit reconciliation。
- Allowed Files：新纯函数/tests。
- Forbidden Files：现有金额写路径、UI、DB。
- Tests：Cash Receipt ≠ Revenue、Cost Incurred ≠ Payment、reversal/correction、MATCH/MISMATCH/UNKNOWN、重复回放。
- Acceptance：同一有序事件集每次输出相同结果，可重建，无副作用。
- Rollback Complexity：LOW。
- Risk：MEDIUM（规则定义需 Owner/Finance 复核）。
- Dependencies：1A、1B。

### Slice 1D — Storage-Neutral Journal Interface + In-Memory Repository

- Objective：定义 `appendEvent/getEvent/findByIdempotencyKey/listEvents/listEventsForProject/listEventsForCompany`，先提供仅测试用 in-memory repository。
- Allowed Files：journal interface、in-memory test repository、tests。
- Forbidden Files：生产 JSON/Postgres adapter、生产写路径、schema/migration。
- Acceptance：同 domain contract、幂等与 immutable 规则；无生产行为影响。
- Rollback Complexity：LOW。
- Risk：LOW。
- Dependencies：1A–1C、atomicity decision。

## 6. Test Plan

所有测试 deterministic、isolated、无生产 DB、无网络、无外部 AI/OCR/飞书/微信。覆盖：事件校验、确认权限、幂等、Cash Receipt ≠ Revenue、Cost Incurred ≠ Payment、reversal、correction（300000→280000）、精确对账（0.01 为 MISMATCH）、可重建性、事件不可变。

## 7. Storage Decision

推荐 **Option A：先实现 in-memory test repository**。理由：复杂度与生产影响最低、最易验证 domain semantics；JSON/Postgres adapter 的事务与一致性尚未证明，暂不实现。Option D interface-only 可作为 1A，但 1D 应以 in-memory repository 验证接口。Option B/C 延后至 Storage Implementation Gate。

## 8. Atomicity Gate

当前结论：**ATOMICITY_BLOCKED** for real write integration；**ATOMICITY_PARTIAL** for design/test-only。

- PostgreSQL 理论上可在同一 transaction 写 Event Journal + projections，但当前尚无实现。
- JSON 现有临时文件 rename 提供快照写入原子性，但尚无 Event + projection 的事务语义与崩溃恢复证明。
- 因此在 atomic boundary、retry、reconciliation、manual repair 未被实现和验证前，禁止接入真实 payment/approval/supplier/payroll 写路径。

## 9. Open Question Classification

| Question | Classification |
|---|---|
| bank evidence format / finance SLA | BLOCKS_LATER_INTEGRATION |
| JSON/Postgres transaction implementation | BLOCKS_SLICE_1（若涉及真实 repository）；不阻塞纯 domain/in-memory |
| payable settlement / line item association | BLOCKS_LATER_INTEGRATION |
| historical mismatch ownership/SLA | BLOCKS_LATER_INTEGRATION |
| event audit/archive/rebuild operations | BLOCKS_LATER_INTEGRATION |

## 10. Implementation Authorization Matrix

| Capability | Design Accepted? | Slice 1 Implementable? | Real Write Integration Allowed? | Migration Allowed? | Source of Truth Switch Allowed? |
|---|---|---|---|---|---|
| Financial Event Contract | YES | YES (1A) | NO | NO | NO |
| Event Validation | YES | YES (1A) | NO | NO | NO |
| Idempotency | YES | YES (1B) | NO | NO | NO |
| Correction/Reversal Rules | YES | YES (1B) | NO | NO | NO |
| Confirmation Authority | YES | YES (1B) | NO permission-system changes | NO | NO |
| Projection Functions | YES | YES (1C) | NO | NO | NO |
| Reconciliation | YES | YES (1C) | NO legacy repair | NO | NO |
| JSON Event Repository | YES | In-memory only (1D) | NO | NO | NO |
| Postgres Event Repository | YES | NO | NO | NO | NO |
| Payment/Approval/Supplier/Payroll Integration | YES | NO | NO | NO | NO |
| Frontend Read Switch | YES | NO | NO | NO | NO |
| Legacy Deprecation | YES | NO | NO | NO | NO |

## 11. Acceptance Criteria

Slice 1 is acceptable only if all new logic is additive, pure or test-only, deterministic, covered by isolated tests, uses exact monetary comparison, preserves immutable events, and produces no production money behavior change. JSON/Postgres parity is a contract requirement even before adapters exist.

## 12. Stop Conditions

Stop immediately if implementation requires changing payment/approval semantics, project financial fields, migration, Source of Truth switch, widening permissions, automatic legacy correction, production DB/network/AI dependencies, unproven Event/Projection atomicity, or scope beyond Owner-accepted slices.

## 13. Owner Authorization Boundary

This document is a gate design, not authorization. Even “AUTHORIZE_SLICE_1” would require a subsequent explicit Owner authorization. No Financial Event code, Ledger, adapter, migration, API or frontend implementation is authorized by this document.
