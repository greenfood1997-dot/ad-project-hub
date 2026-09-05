# Financial Truth Foundation V1（Phase 1B Design Only）

本文件是设计与迁移映射，不代表实现、schema 变更或实施授权。核心原则：**One Financial Truth, Multiple Projections**。

### Owner Decision Integration (2026-09-05)

- `companyId` is **REQUIRED** on every FinancialEvent, using an explicit default company identity even in a single-company deployment. This does not implement multi-company capability.
- Business users may create only `CLIENT_PAYMENT_REPORTED`. Finance creates `CLIENT_PAYMENT_CONFIRMED` only after reliable evidence (bank statement, receipt, arrival voucher or equivalent) is reviewed. Bank API integration is not a Phase 1B dependency. Confirmed payment effects are Cash+, Receivable−, Project Collection+, Payment History+ and Cash Forecast refresh; it never automatically increases Revenue.
- `Contract Value`, `Recognized Revenue`, `Receivable` and `Cash Receipt` remain separate. Complex revenue-recognition policy is deferred; cash receipt is never revenue recognition.
- Payroll Ledger distinguishes Base Salary, Bonus/Commission, Allowance, Employer Contributions, Employee Deductions, Tax, Gross Payroll, Net Payroll Payable and Payroll Paid. Company labor cost is not employee net cash receipt; `PAYROLL_CONFIRMED` is not `PAYROLL_PAID`, and only `PAYROLL_PAID` creates Cash Out.
- JSON and PostgreSQL share the same Event Contract, Domain Service, idempotency, projection, authority and reversal semantics; only storage adapters differ. Event Journal plus required projections should share an atomic boundary. Event loss is forbidden; projection failure enters retry, reconciliation, alert and manual repair. No projection may change formal money without a corresponding event.
- Payable identity uses stable `supplierId`, never supplier name, and must support `companyId + projectId + supplierId + sourceType + sourceId` (with optional `lineItemId`/`settlementId`) for multiple payables.
- Monetary reconciliation is exact to the smallest currency unit; ¥300000.00 versus ¥299999.99 is MISMATCH. Historical mismatches require investigation and explicit backfill/correction/reversal decision, never auto-smoothing. Ratio rounding is a separate policy.
- Events cannot be deleted by ordinary business actions. Future archival must remain traceable, auditable and rebuildable; statutory retention is deferred to Governance/Finance Policy.

## 1. Current Financial Architecture

当前以 `projects` 聚合字段、嵌套 `costs[]/extractedFields`、`payments[]`、`approvals[]`、`suppliers[]` 和 compensation 设置组成 JSON/Postgres 快照。尚无统一 Financial Event Journal、Cash/Receivable/Payable/Payroll Ledger。金额写回分散在解析、回款、审批和供应商结算服务。

经济事实、批准、应收/应付、现金流动必须分层：Economic Incurred ≠ Approved ≠ Payable/Receivable ≠ Cash Movement。

## 2. Current Write Path Inventory

| Financial Fact | Current Storage | Write Function / Trigger | Actor | Current Side Effects | Missing Side Effects | Idempotency | Reversal | Risk |
|---|---|---|---|---|---|---|---|---|
| Contract value | `project.contract`, extracted fields | `applyParsedFields` / parse completion | parser/authorized user | project name/client/budget/risk/margin refresh | evidence gate, event journal | job-level only | reparse/overwrite semantics | HIGH |
| Cost incurred from parse | `project.costUsed`, `costs[]` | `applyParsedFields` with cost sheet | parser | replaces/recomputes cost aggregate, margin | cost event, payable distinction | partial | no event reversal | CRITICAL |
| Client payment recorded | `payments[]`, `project.paid`, `project.receivable` | `recordProjectPayment` | finance/authorized role | payment row, paid++, receivable/risk/revenue sync, notifications | company cash, confirmed status, journal | payment idempotency exists in schema/API support but business key not universal | `voidProjectPayment` | CRITICAL |
| Client payment void | payment status + project totals | `voidProjectPayment` | authorized finance | paid--, receivable++, notices reopen | immutable reversal event | duplicate void guarded | partial void semantics | HIGH |
| Reimbursement approved/completed | approvals + project `costUsed`, costs, petty cash used | `applyApprovedFinanceImpact` | approval workflow/finance step | cost and petty cash fields updated when approval `已完成` | paid/cash distinction, payable, event | `appliedAt` guard | no generic reversal | CRITICAL |
| Petty cash approval | project extracted petty cash budget | `applyApprovedFinanceImpact` | approval workflow | budget increases on completed approval | cash issuance confirmation | `appliedAt` | absent | HIGH |
| Supplier payment | suppliers + project costs/costUsed | approval completion or `updateSupplierSettlement` | PM/finance by flow | supplier status paid, project cost applied, notifications | payable ledger, cash-out confirmation | settlement row/costAppliedAt partial | rollback cost row only | CRITICAL |
| Project margin | `project.margin`, frontend formulas | parse/approval/supplier updates; frontend derived | system | recalculated percentage | authoritative projection | none universal | recompute only | HIGH |
| Payroll/compensation | settings/member fields, labor allocation | compensation services/report calculations | admin/finance | workforce cost inputs | payroll ledger, paid cash event | unknown | absent | HIGH |
| Company cash | management/runway derived inputs | operating metrics/settings | system | dashboard/runway | bank/cash ledger and cash events | none | absent | CRITICAL |

## 3. Current Risks

- 汇总值与明细值双重事实：`paid/payments[]`、`costUsed/costs[]`、`receivable`、`margin`。
- 审批完成直接产生项目成本/备用金影响，未严格区分批准、应付和已付款。
- 回款更新项目累计值但没有统一公司 Cash Ledger。
- 解析状态“已完成”不等于字段证据、金额和义务已确认。
- 通知有局部失败记录，但无统一持久化事件、重试、dead-letter 与 acknowledgement。
- JSON 损坏恢复默认库可能造成业务数据风险；生产 mock/fallback 隔离需验证。

## 4. Financial Fact Taxonomy

设计候选并作为统一事件类型基线：

- Revenue/Receivable：`CONTRACT_VALUE_CONFIRMED`、`REVENUE_RECOGNIZED`、`RECEIVABLE_CREATED`、`CLIENT_PAYMENT_REPORTED`、`CLIENT_PAYMENT_CONFIRMED`、`RECEIVABLE_REVERSED`
- Cost/Payable：`COST_INCURRED`、`PAYABLE_CREATED`、`SUPPLIER_PAYMENT_APPROVED`、`SUPPLIER_PAYMENT_CONFIRMED`、`COST_REVERSED`
- Employee Expense：`EXPENSE_DETECTED`、`EXPENSE_ALLOCATED`、`EXPENSE_CONFIRMED`、`REIMBURSEMENT_APPROVED`、`REIMBURSEMENT_PAID`、`EXPENSE_REVERSED`
- Petty Cash/Advance：`PETTY_CASH_ISSUED`、`PETTY_CASH_USED`、`PETTY_CASH_RETURNED`、`PROJECT_ADVANCE_ISSUED`、`PROJECT_ADVANCE_SETTLED`
- Payroll：`PAYROLL_PREPARED`、`PAYROLL_APPROVED`、`PAYROLL_CONFIRMED`、`PAYROLL_PAID`、`PAYROLL_REVERSED`
- Treasury：`CASH_IN`、`CASH_OUT`、`DIVIDEND`、`TAX_PAYMENT`、`OTHER_ADJUSTMENT`

这些是统一设计类型，不声称当前代码已全部产生。

## 5. Financial Event Model

| Field | Decision | Reason |
|---|---|---|
| `eventId` | REQUIRED | 不可变事件标识 |
| `eventType` | REQUIRED | 区分经济、批准、应收/应付、现金事件 |
| `occurredAt` | REQUIRED | 业务实际发生时间 |
| `effectiveAt` | REQUIRED | 对账/投影生效时间 |
| `confirmedAt` | OPTIONAL | 未确认的 reported/incurred 事件可为空 |
| `companyId` | REQUIRED | 每个金融事实必须归属明确经营/法律主体；单公司也使用 default company identity |
| `departmentId` | OPTIONAL | 部门归属非所有事件必有 |
| `projectId` | OPTIONAL | 公司级税费/分红可无项目 |
| `clientId` | OPTIONAL | 非客户事件不需要 |
| `supplierId` | OPTIONAL | 非供应商事件不需要 |
| `employeeId` | OPTIONAL | 非员工事件不需要 |
| `approvalId` | OPTIONAL | 只有审批来源事件关联 |
| `paymentId` | OPTIONAL | 只有支付来源事件关联 |
| `amount` | REQUIRED | 金额事实核心字段 |
| `currency` | REQUIRED | 默认 CNY 也须显式化 |
| `direction` | REQUIRED | debit/credit 或 in/out 统一约定 |
| `economicCategory` | REQUIRED | 收入、成本、工资、税等经济分类 |
| `accountCategory` | OPTIONAL | 会计科目映射可后置 |
| `sourceType` | REQUIRED | API、上传、审批、银行、人工等来源 |
| `sourceId` | REQUIRED | 可追溯原始记录 |
| `sourceEvidence` | OPTIONAL | 文件/页码/凭证定位；Cash confirmation 等可靠资金确认场景 REQUIRED |
| `status` | REQUIRED | reported/confirmed/reversed/corrected 等 |
| `createdBy` | REQUIRED | 审计责任 |
| `confirmedBy` | OPTIONAL | 未确认事件为空 |
| `confirmationAuthority` | OPTIONAL | 记录所需角色权限 |
| `idempotencyKey` | REQUIRED | 防重复资金事实 |
| `reversalOf` | OPTIONAL | 冲销原事件引用 |
| `correctionOf` | OPTIONAL | 修正原事件引用 |
| `metadata` | OPTIONAL | 业务上下文与模型证据 |
| `createdAt` | REQUIRED | 事件写入时间 |

## 6. Ledger Architecture

| Ledger | Design decision | Rationale |
|---|---|---|
| Financial Event Journal | 独立权威 | 所有经济/确认事件的不可变来源 |
| Cash Ledger | 独立投影/必要时独立对账源 | 真实现金流动不能由项目字段推断 |
| Receivable Ledger | Event Projection | 由合同/收入/确认回款事件投影，可重建 |
| Payable Ledger | Event Projection | 成本发生、应付形成、供应商付款确认投影 |
| Project Cost Ledger | 独立可查询投影 | 成本明细、项目归属和预算分析需要 |
| Revenue Ledger | Event Projection | 收入确认与现金收款分离 |
| Employee Expense Ledger | Event Projection | 检测、分配、确认、报销支付分层 |
| Petty Cash / Advance Ledger | 独立投影 | 备用金发放、使用、归还需可追踪 |
| Payroll Ledger | 独立投影 | 工资准备、确认、支付和人力成本分离 |

不设计万能表；所有投影必须可由 Event Journal 重建，并保留投影版本/时间。

## 7. Source of Truth Matrix

| Current field | Future status | Design judgment |
|---|---|---|
| `project.contract` | PROJECTION / LEGACY | 由合同确认事件投影；过渡期保留并对账 |
| `project.paid` | PROJECTION / CACHE | 由 confirmed client payment 投影，可重建，不再独立写入 |
| `project.receivable` | PROJECTION | 由收入/应收/确认回款事件计算 |
| `project.costUsed` | PROJECTION / CACHE | 由 Project Cost Ledger 汇总，可重建 |
| `project.margin` | PROJECTION | 由收入与成本规则计算，前端不得权威计算 |
| `project.costs[]` | LEGACY → PROJECTION source | 迁移为 Cost Ledger 明细，暂不删除 |
| `payments[]` | LEGACY input + projection source | 迁移为 payment events，保留原始记录对账 |
| `approvals[]` | AUTHORITATIVE for workflow only | 审批状态不等于付款事实；产生批准事件 |
| supplier settlement | LEGACY input + Payable projection | 结算状态与付款确认分离；未来以稳定 `supplierId` 识别，名称仅展示 |
| `pettyCash*` | PROJECTION / LEGACY | 由 petty cash events 投影，字段暂存兼容 |
| `compensation` | AUTHORITATIVE input, Payroll projection | 薪酬配置不是已发工资事实；Payroll Ledger 分拆 gross/net、雇主承担与扣款 |

## 8. Confirmation Authority Matrix

| Actor | May confirm | Must not confirm |
|---|---|---|
| Execution Member | execution evidence, expense allocation, material submission | company cash, actual bank receipt, supplier payment |
| PM | project cost incurred, supplier delivery, execution fact | actual cash payment/receipt |
| Sales | client-reported payment → `CLIENT_PAYMENT_REPORTED`, contract business info | actual company receipt |
| Finance | reliable evidence reviewed bank receipt → `CLIENT_PAYMENT_CONFIRMED`; supplier payment, payroll paid, invoice/settlement | unsupported business delivery facts |
| Director | approval authority and high-risk business decisions | bypassing finance cash confirmation |
| Shareholder/Admin | large funds, dividend, exceptional arrangements; admin manages permissions | treating admin action as bank proof |

Business confirmation and cash confirmation are separate. PM supplier delivery creates `COST_INCURRED`/`PAYABLE_CREATED`; finance payment creates `SUPPLIER_PAYMENT_CONFIRMED` and Cash decrease.

## 9. Financial Effects Matrix

| Event | Effects | Explicit non-effect / double-count guard |
|---|---|---|
| `CONTRACT_VALUE_CONFIRMED` | contract value projection, obligation draft | 不增加现金或收入 |
| `REVENUE_RECOGNIZED` | Revenue +, Receivable + | 不增加现金 |
| `CLIENT_PAYMENT_REPORTED` | pending evidence/work item | 不减少应收、不增加现金 |
| `CLIENT_PAYMENT_CONFIRMED` | Cash +, Receivable -, Project paid +, collection rate/history/forecast refresh | Revenue 不因收款重复增加；必须有 `sourceEvidence` |
| `COST_INCURRED` | Project Cost +, expense recognition; potentially Payable + | 已有成本不得在付款时再次增加 |
| `PAYABLE_CREATED` | Payable + | 不减少现金 |
| `SUPPLIER_PAYMENT_CONFIRMED` | Cash -, Payable -, supplier paid status | 若成本已 incurred，不重复增加 Project Cost |
| `EXPENSE_CONFIRMED` | employee expense +, project allocation | 不等于 reimbursement paid |
| `REIMBURSEMENT_APPROVED` | approved payable/commitment + | 不减少现金、不等于 paid |
| `REIMBURSEMENT_PAID` | Cash -, payable -, project expense projection | 不重复计成本 |
| `PETTY_CASH_ISSUED` | Cash -, petty cash balance + | 不等于 expense incurred |
| `PAYROLL_CONFIRMED` | payroll liability/human cost confirmed | 不等于 cash out |
| `PAYROLL_PAID` | Cash -, payroll payable -, paid payroll + | 不重复确认工资成本 |
| `TAX_PAYMENT` | Cash -, tax payable - | 不改变项目收入 |
| `DIVIDEND` | Cash -, retained/distribution fact | 必须有股东权限与确认 |

## 10. Correction / Reversal Model

确认事件不可直接 edit/delete。错误到账 ¥300,000 应保留原事件，产生 Reversal Event（冲回 ¥300,000）及 Correct Event（确认 ¥280,000），或经批准的显式 Correction Event。必须填 `reversalOf`/`correctionOf`，保留原始证据、操作者、时间与原因；投影通过事件重放重建。现有 `void`、supplier rollback、approval withdraw/reject、delete 等语义未来分别映射为 reversal/correction/取消业务流程，不得物理抹除已确认金额。

## 11. Idempotency Model

统一使用业务幂等键，而非仅 HTTP request ID。示例：`client-payment:{bankReference|sourceEvidence|projectId|amount|effectiveDate}`、`approval-complete:{approvalId}:{stepVersion}`、`supplier-payment:{settlementId}`、`payroll-paid:{payrollRunId}`。重复页面提交、飞书回调、scheduler 重试必须命中同一 key；Event Journal 唯一约束先查后写并在数据库事务内执行。冲突 key 必须返回原事件，不生成第二笔资金事实。

## 12. Migration Strategy

1. **Stage 1 — Introduce Event Journal**：只读/旁路建立事件表与类型契约，不改变旧读取。
2. **Stage 2 — Dual Write / Shadow Projection**：现有写路径同时记录事件与新投影，保留 legacy 字段。
3. **Stage 3 — Reconciliation**：逐项目、逐事件对账，输出 MATCH/MISMATCH/UNKNOWN。
4. **Stage 4 — Read from Projection**：仅在门槛通过的视图切换读取。
5. **Stage 5 — Legacy Deprecation**：停止新增直接写旧聚合字段，保留兼容读取。
6. **Stage 6 — Remove Direct Writes**：Owner 批准且所有对账、回放、回滚验证通过后移除。

一致性证明至少包括：`legacy project.paid = payment projection`、`legacy project.costUsed = cost projection`、`legacy receivable = receivable projection`；差异未归零前不得切换 Source of Truth。

## 13. Reconciliation Gate

建议 `financial_reconciliation` 记录：`companyId`、`projectId`、`legacyPaid`、`projectedPaid`、`difference`、`legacyCost`、`projectedCost`、`difference`、`legacyReceivable`、`projectedReceivable`、`difference`、`status`（MATCH/MISMATCH/UNKNOWN）、`checkedAt`、`evidence`。货币金额按最小单位精确比较，不设宽松容差；比例另行定义 rounding policy。任何 MISMATCH 或 UNKNOWN 禁止自动切换新 Ledger 为权威，必须进入 Investigation → Explicit Backfill/Correction/Reversal Decision → Audit。

## 14. Failure / Atomicity Model

- Event 与关键投影必须在同一数据库事务 Atomic Boundary 内提交；失败整体 rollback。
- Event 成功、Projection 失败：保留事件为 pending projection，重试并告警，不宣称完成。
- Projection 成功、Event 失败：事务回滚；若跨系统不可回滚，标记 mismatch 并进入人工修复。
- Cash 与 Project Ledger 不一致：fail-closed，冻结自动切换/进一步派生，进入 reconciliation。
- 重复 webhook：按 business idempotency key 返回既有结果。
- 可重试错误进入有限退避 retry；多次失败进入 dead-letter/manual repair。
- 所有失败、重试、人工修复和告警写入审计。

## 15. Frontend Financial Boundary

前端只展示后端 Financial Truth Projection。`contract - paid`、`contract - cost` 等只能作为明确标注的 derived visualization，不能成为 authoritative receivable/profit。页面应显示数据来源、投影时间、待对账或 fallback 状态；不得用 mock/default 数字掩盖缺失事实。

## 16. Implementation Gates

本设计不授权实施。未来每一步必须满足：事件类型与权限评审、schema/API 评审、幂等设计、回放/对账证明、失败路径测试、生产 mock/fallback 隔离、Owner 明确批准。Phase 1B 设计完成不等于 migration 或 Financial Event 已实现。

## 17. Open Questions

### RESOLVED_BY_OWNER

- `companyId` required with default company identity.
- Cash confirmation requires Finance plus reliable evidence; bank API is not a Phase 1B dependency.
- Cash Receipt ≠ Revenue Recognition; complex recognition policy is deferred.
- Payroll boundary and exact monetary reconciliation are defined; supplier identity uses stable `supplierId`.
- JSON/PostgreSQL share domain semantics, idempotency, projection, authority and reversal contracts.

### DEFERRED_POLICY

- Full Revenue Recognition policy and statutory/accounting treatment.
- Payroll cycle details, statutory contributions, tax and bonus policy.
- Event statutory retention period and archival governance.

### STILL_OPEN

- Exact bank evidence formats and Finance review SLA.
- Event Journal storage/transaction implementation across JSON and PostgreSQL adapters.
- Payable line-item and settlement linkage details.
- Historical dirty-data investigation ownership, reconciliation workflow and operational SLA.
- Event audit access controls, archive mechanics and projection rebuild operations.
