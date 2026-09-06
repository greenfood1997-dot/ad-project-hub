# Customer / Supplier Advance Accounting Model Design Gate v0.1

Status: OWNER_ACCEPTED / DESIGN_COMPLETE / IMPLEMENTATION_NOT_STARTED / NON_AUTHORIZING.

Owner formally accepted COMPANY_OWNED_COUNTERPARTY_ADVANCE_WITH_PROJECT_ATTRIBUTION; customer advance is unapplied customer-funds liability; supplier advance is unapplied supplier-prepayment asset; negative receivable/payable is not formal v0.1 accounting; advance application requires explicit validated evidence. All sixteen Owner accounting invariants are binding. Initial READY_FOR_OWNER_REVIEW status below is historical, not current authorization.

## Authority and existing gap

Owner policy: PAYMENT_EVENT MAY_BE_VALID_BUSINESS_FACT; negative receivable/payable as formal accounting NOT_ACCEPTED; OVERPAYMENT_PROJECTION ACCOUNTING_MODEL_GAP. The current P1 formulas subtract payments without an advance bucket, while PostgreSQL rejects negative amounts. Foundation section 17 previously left overpayment OPEN_POLICY. This proposal resolves the design direction, not ATOMIC-IMP-005 implementation.

Cash Receipt ≠ Revenue Recognition; Supplier Payment ≠ Cost Incurred. Insufficient projection representation does not invalidate a real bank fact. A model-incomplete history cannot activate a trusted projection; preserve the evidence through a separately authorized ingestion workflow, never claim a partially completed atomic workflow succeeded.

## Candidate comparison and unique recommendation

| Candidate | Accounting / audit | Event fidelity | Simplicity | Migration / risk |
|---|---|---|---|---|
| Negative receivable/payable | Ambiguous netting; Owner rejects formal representation | Retains cash but obscures category | Simple arithmetic | Misclassification risk; NOT RECOMMENDED |
| Customer liability / supplier asset advance balances | Explicit parties, lots and application evidence | Preserves cash exactly once | More contracts, deterministic | New version/schema dependencies; RECOMMENDED |
| Reject all overpayment histories | Rejects potentially valid bank facts | Poor | Simple rejection | Lost facts/operational blockage; NOT RECOMMENDED |
| Generic suspense balance | Useful for unidentified receipts only | Preserves unknown facts | Requires separate investigation | Outside identified-counterparty v0.1 |

Unique recommendation: COMPANY_OWNED_COUNTERPARTY_ADVANCE_WITH_PROJECT_ATTRIBUTION.
customerAdvanceMinor is an unapplied customer-funds liability, NOT automatically earned revenue or statutory contract liability. Contract-liability classification depends on a later revenue/accounting policy.
supplierAdvanceMinor is an unapplied supplier prepayment asset, NOT cost. No implicit advance interest, financing, FX or deposit reclassification.

## Ownership and minimum scope

Canonical allocation key: companyId + currency + counterparty identity (clientId or supplierId) + advance lot/payment identity + purpose restriction + optional project attribution. Stable counterparty and source payment identities are required; display names are not identities.

Company owns all balances, including unassigned funds. Project projections show only confirmed project-attributed subsets. Company totals equal project-attributed balances plus unassigned balances; do not add company totals to project totals. A projectId is never fabricated. Moving attribution requires separately confirmed non-cash allocation evidence; cross-company/currency netting is prohibited.

v0.1 supports one company/currency, known counterparty, optionally one confirmed project, and explicitly identified unrestricted settlement targets. Cross-project automatic distribution, FX, invoice matching, unidentified receipts, refundable/security deposits and AI allocation are excluded. Restricted funds without a validated permitted use remain in their own advance lot; never consume unrelated receivables/payables.

## Cash fact versus allocation decision

Reuse CLIENT_PAYMENT_CONFIRMED and SUPPLIER_PAYMENT_CONFIRMED as the only cash movement for the original payment. Do not add a second cash-bearing ADVANCE_RECORDED event.

Payment confirmation alone proves cash, not settlement targets. A validated command supplies explicit target identities, amounts, scope, currency, restrictions and policy version. Its immutable allocation evidence references the payment. Proposed CUSTOMER_PAYMENT_ALLOCATED / SUPPLIER_PAYMENT_ALLOCATED events carry ZERO cash effect; applied amounts plus residual advance must equal the payment amount. Unallocated known-party payments remain advances. A payment cannot be allocated twice; allocation uniqueness and available-balance validation precede projection.

Within one confirmed eligible target, allocation is deterministic: settled=min(payment, eligible outstanding), residual=payment-settled. This min is not silent clamping: every residual minor unit enters an explicit advance lot and is reconciled. No oldest-invoice/project guessing by Projection. Confirmation authority is Finance with payment evidence and validated business target/owner approval as applicable; AI cannot confirm.

| Customer eligible receivable | Payment | Cash delta | Receivable after | Advance increase |
|---|---|---|---|---|
| 100 | 40 | +40 | 60 | 0 |
| 100 | 100 | +100 | 0 | 0 |
| 100 | 120 | +120 | 0 | 20 |
| 0 | 10 | +10 | 0 | 10 |

These cases assume explicit validated application to the stated receivable. Without it, payment increases cash and advance while the receivable remains outstanding.

| Supplier eligible payable | Payment | Cash delta | Payable after | Advance increase |
|---|---|---|---|---|
| 100 | 40 | -40 | 60 | 0 |
| 100 | 100 | -100 | 0 | 0 |
| 100 | 120 | -120 | 0 | 20 |
| 0 | 10 | -10 | 0 | 10 |

Supplier scenarios require available company cash; this Gate authorizes no overdraft.

## Later liabilities / claims: no automatic application

Advance 20 followed by new receivable 100 leaves advance 20 AND receivable 100 until confirmed CUSTOMER_ADVANCE_APPLIED references the advance lot and receivable. Application 20 yields advance 0 / receivable 80 with cash and revenue unchanged.

Supplier advance 20 followed by payable 100 analogously leaves both unchanged until SUPPLIER_ADVANCE_APPLIED; application gives advance 0 / payable 80, cash/cost unchanged.

Application is bounded by remaining advance and target outstanding, same counterparty/company/currency and permitted project/purpose. No over-application, silent offset, automatic approval or financial fact edits.

## Refunds, reversal and correction

Real later refunds are new confirmed cash facts, not historical payment reversal: proposed CUSTOMER_ADVANCE_REFUNDED decreases cash and unused customer advance; SUPPLIER_ADVANCE_REFUND_RECEIVED increases cash and decreases unused supplier advance. Reference original lots/bank evidence; refund amount cannot exceed available advance. Neither changes revenue/cost. No direct balance mutation.

Project paidMinor is net confirmed customer cash receipts attributed to that project, including advance receipts and less attributable customer cash refunds. Company-level unassigned receipts do not enter any project paidMinor. Later advance application is not another receipt and must not increase paidMinor.

REVERSAL is correction of an erroneous historical fact, not an actual later refund. Existing exact-amount, predecessor identity, uniqueness and relationship validation remain mandatory. Reverse the payment plus its non-cash allocation effects as a validated correction bundle; cash, settled receivable/payable and remaining advance restore together. For a 120 receipt applied 100 plus advance 20, reversal restores cash -120, receivable +100 and advance -20 relative to that effect.

If downstream applications/refunds consumed the advance, reject an incomplete reversal bundle. Require explicit dependent reversals/replacements in dependency order; never silently generate them. Correction retains all original events and applies replacement facts through the same rule. Schema/history implementation must validate these new dependencies before accepting a slice; no new reversal execution is implemented here.

## Closed proposed monetary sign matrix

| Scope / field | Policy | Meaning |
|---|---|---|
| Company cashMinor | INVALID_IF_NEGATIVE | No overdraft/credit facility authority in v0.1 |
| Company / Project receivableMinor | INVALID_IF_NEGATIVE | Open confirmed receivable after explicit applications |
| Company / Project payableMinor | INVALID_IF_NEGATIVE | Open confirmed payable after explicit applications |
| Company / Project customerAdvanceMinor (vNext) | NON_NEGATIVE | Unused customer-funds liability |
| Company / Project supplierAdvanceMinor (vNext) | NON_NEGATIVE | Unused supplier prepayment asset |
| Company / Project recognizedRevenueMinor | INVALID_IF_NEGATIVE | Revenue-event-derived cumulative recognized balance |
| Project costMinor | INVALID_IF_NEGATIVE | Cost-event-derived cumulative cost balance |
| Project paidMinor | INVALID_IF_NEGATIVE | Net customer cash receipts attributed to project |
| Company paidMinor / costMinor; Project cashMinor | MUST_BE_NULL / NOT_APPLICABLE | Existing storage inapplicable columns, not balances |

This is a proposed vNext sign policy, not a retroactive assertion about all existing formulas. Out-of-period reversal requiring an opening balance needs explicit evidenced opening history; never invent cash or clamp totals. Reversals can reduce legitimate balances but cannot create unauthorized cumulative negatives. Negative cash is NOT_AUTHORIZED_IN_V0_1; future funding/overdraft policy is separate.

## Contract, reconciliation and schema dependencies

Projection Contract vNext adds two advance fields, canonical lot/counterparty/application state and explicit allocation semantics. Aggregate columns alone are insufficient to enforce ownership or application limits. Reuse immutable cash facts; add reviewed non-cash allocation/application and cash refund event semantics through a later Event Implementation Gate. Current revenue/cost formulas require impact review for separation before implementation; no formula is changed here.

TYPE A vNext must include advances in financial snapshots/equality, safe-integer and nonnegative validation, watermark and explicit version mapping. Current comparator is unchanged. P1/company/project consistency, exact payment conservation, opening balances, dependent correction bundles, replay and application idempotency become mandatory tests.

Unified PostgreSQL Schema Design must cover versioned advance aggregates, lot/counterparty/project/purpose attribution and application/refund references with uniqueness/immutability; no table, column or migration SQL is authorized here. Legacy mapping and real DB validation are subsequent independent gates.

Atomic Write only sequences validated commands/history, never decides whether a receipt is an advance. Its current one-scope slice must not secretly become a company+project dual writer; any required multi-projection consistency is a separately authorized implementation gate. ATOMIC-IMP-005 remains open until design acceptance, implementation and cross-participant validation complete.

## Legacy architecture note

Read-only search found advancePayment / advanceInterest in server/api.mjs and server/services.mjs used as project 垫款/垫资利息 cost/profit inputs (for example services cost aggregation). These are not proven customer/supplier advance subledgers. No canonical advance-lot/application model was identified by this scoped source search; no database contents were audited. Do not map based on similar names. Legacy remains production authority.

## Fulfillment and invariants

Customer prepayment 500000 does not imply monthly settlement 500000, delivery 500000 or revenue 500000. Customer final monthly confirmation, contractual receivable, cash receipt and revenue recognition remain separate evidenced facts.

Cash receipt is not revenue; supplier payment is not cost; advance application needs explicit evidence; no negative receivable/payable as default accounting; no silent clamping; no double-count; Event remains authoritative future history; Projection remains derived; Legacy remains current production authority. Advances never auto-recognize revenue/cost or authorize expenditure.

## Readiness and non-authorization

Design findings: NONE unresolved HIGH within the bounded proposal. Deposit classification, FX, statutory presentation, financing and multi-project automatic allocation are explicitly excluded future gates. Detailed schemas, event contracts, opening-balance provenance, dependent reversal rules and multi-projection persistence tests must be closed before their implementation slices, not assumed implemented.

ADVANCE_ACCOUNTING_MODEL_DESIGN_GATE: OWNER_ACCEPTED.
ATOMIC-IMP-003: OPEN. ATOMIC-IMP-004: OPEN.
ATOMIC-IMP-005: OPEN_PENDING_IMPLEMENTATION (not closed).
DESIGN_ONLY: YES.

No new event/field/codec/Journal/Reconciliation/Atomic Write implementation, DB/schema/migration, production, Legacy execution, automatic allocation/revenue/cost recognition, source switch, commit or push is authorized by this document.

## Advance Accounting v2 Consolidated Owner Acceptance

Date: 2026-09-06.

The Owner now accepts this model as part of the implemented and independently validated Advance Accounting v2 boundary. ADVANCE_ACCOUNTING_V2: OWNER_ACCEPTED; ADVANCE_ACCOUNTING_IMPLEMENTATION: OWNER_ACCEPTED; ADVANCE_ACCOUNTING_VALIDATION: PASS; ADVANCE_ACCOUNTING_REVALIDATION_V4: PASS; ADVANCE_VALIDATION_FINDINGS: 0; ATOMIC-IMP-005: CLOSED.

ATOMIC-IMP-003 and ATOMIC-IMP-004 remain OPEN. The accepted status is ISOLATED / NON-PRODUCTION and does not authorize Atomic Write completion, migration, real DB validation, production activation, Legacy mapping, Source of Truth switch, or capital/money movement automation.
