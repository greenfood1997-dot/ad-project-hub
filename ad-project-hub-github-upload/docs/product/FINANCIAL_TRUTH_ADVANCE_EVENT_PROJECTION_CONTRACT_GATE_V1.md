# Advance Event / Projection / Lot Contract Design Gate v0.1

Design status: OWNER_ACCEPTED / DESIGN_COMPLETE / NON_AUTHORIZING. Owner separately authorized isolated implementation v0.1 in the current request. Design acceptance itself does not authorize production, schema activation or real DB.

Implementation progress: IMPLEMENTED_PENDING_INDEPENDENT_VALIDATION (isolated). Explicit canonical public version routing and deterministic shared-state CAS/lot/correction probes complete this remediation. ADV-IMP-001, ADV-IMP-002, ADV-DESIGN-001 and ATOMIC-IMP-005 CLOSED; Atomic 003/004 remain OPEN. This is self-validation, not independent validation or Owner acceptance of implementation.

## 1. Authority and compatibility

The Advance Accounting Model is OWNER_ACCEPTED / DESIGN_COMPLETE / IMPLEMENTATION_NOT_STARTED / NON_AUTHORIZING. Cash Receipt ≠ Revenue Recognition; Supplier Payment ≠ Cost Incurred. Negative receivable/payable cannot stand in for advance. Real cash facts remain facts even when current projection representation is insufficient. Events are future authoritative history; projections are derived/rebuildable; Legacy remains production authority.

Current source facts: event amount is a nonnegative safe integer, timestamps are occurredAt/effectiveAt/createdAt; clientId/supplierId exist as optional event dimensions. projectPaymentProjection currently sums only CLIENT_PAYMENT_CONFIRMED; current cash formulas lack proposed advance refunds. Existing exact reversal rules enforce predecessor identity, equal amount and uniqueness; they do not yet validate proposed lot dependencies. All extensions below are versioned design, not descriptions of current implementation.

## 2. Minimum counterparty and obligation dependency

Customer uses stable clientId; supplier uses stable supplierId, each validated as belonging to companyId. Counterparty identity is not inferred from name, amount, project or sourceContext. An event may expose counterpartyType CUSTOMER/SUPPLIER and counterpartyId as a typed reference, but they must match the corresponding clientId/supplierId, never create competing identity.

Receivable target requires receivableId; payable target requires payableId; each resolves to a confirmed immutable creation event, company/currency/counterparty, optional project and remaining obligation. No unvalidated invoice labels. Minimal registry/resolver contracts and immutable identity references are implementation-gate dependencies, not a CRM/vendor-master build.

## 3. Immutable lot and remaining balance

Every positive residual advance creates one immutable lot descriptor, reconstructible from originating payment and its initial allocation manifest. No separate cash-bearing advance creation event.

| Lot field | Required contract |
|---|---|
| advanceLotId | Stable, collision-free canonical identity tuple (advanceType, companyId, originatingPaymentEventId); canonical tuple encoding fixed before implementation |
| advanceType | CUSTOMER / SUPPLIER |
| companyId / currency | Required, one company and currency |
| counterpartyType / counterpartyId | Required stable customer/supplier identity |
| originatingPaymentEventId | Required confirmed cash event; exactly one lot per payment residual |
| originalAmountMinor | Positive safe integer residual, immutable; zero residual creates no lot |
| initialProjectAttribution | COMPANY_UNALLOCATED with projectId null, or PROJECT_ATTRIBUTED with confirmed projectId |
| occurredAt / effectiveAt / createdAt | Existing UTC event semantics; effectiveAt controls business effect; no independent ambiguous businessDate |
| evidenceRefs / allocationManifestEventId | Immutable references to payment evidence and initial manifest, if any |
| remainingAmountMinor | Derived only; never mutable source truth |

Remaining = original amount minus effective applications minus actual refunds, after explicit reversal/correction resolution. Every amount and accumulated sum must remain safe integer; consumption cannot exceed available balance. No UPDATE remaining amount. Lots are not deleted when exhausted.

## 4. Payment and initial allocation manifest

CLIENT_PAYMENT_CONFIRMED (in) and SUPPLIER_PAYMENT_CONFIRMED (out) each express cash exactly once. Direction is fixed by event type. Their complete confirmed source context includes counterparty, optional project attribution and immutable initial allocation manifest identity or explicit NO_INITIAL_TARGET.

Proposed CUSTOMER_PAYMENT_ALLOCATED / SUPPLIER_PAYMENT_ALLOCATED are non-cash (direction none) initial manifests, one per payment, with manifestId, paymentEventId, confirmedCommandId, target obligation IDs, target creation-event refs, amount per target, residualAmountMinor, expected target-state evidence, company/currency/counterparty/project identity and timestamps. Event amount is total applied amount; residual is separately recorded, never a second cash amount. Zero applied amount is permitted; no-manifest NO_INITIAL_TARGET means all payment is residual.

Minimum slice supports zero or one explicit target per payment. Multiple-target automatic selection is excluded. Payment plus referenced manifest must be relationship-complete; a missing referenced manifest is invalid history, not permission to reclassify. For an explicit eligible target, applied = min(payment amount, validated outstanding), residual = payment-applied. The manifest must exactly match that result and conserve the full payment. No target means no scanning; whole payment enters advance. Unallocated funds later use ADVANCE_APPLIED, not a late retroactive initial manifest.

Customer receivable 100/payment120 -> cash +120, receivable 0, customer lot original20. Receivable0/payment10 -> cash +10, receivable0, customer lot10. Supplier payable100/payment120 -> cash -120, payable0, supplier lot20. Available company cash is required for supplier disbursement; no overdraft.

## 5. Attribution and aggregation

Lot creation attribution is confirmed, never guessed. A COMPANY_UNALLOCATED lot can later be attributed through proposed ADVANCE_PROJECT_ATTRIBUTED (non-cash), referencing the lot, counterparty/company/currency, project, confirmation evidence and amount equal to the entire untouched lot.

Minimal v0.1 permits this once, only before any application/refund and only for the full remaining/original lot. Partial attribution, project-to-project transfer, attributed-to-unallocated transfer and cross-project allocation are excluded, requiring a later design. Event history preserves the initial attribution and subsequent confirmation.

Applications require a project-attributed lot to match the target project. Unallocated lots apply only to company-level obligations; project use requires prior confirmed attribution.

Company advance total = sum of distinct company-held remaining lots = unallocated total + sum of project-attributed subsets. Project total = sum of remaining lots currently attributed to that project. Never add Company total to Project totals.

Confirmed attribution of previously unassigned customer funds also transfers their receipt attribution into project paidMinor, without changing company cash. No application event changes paidMinor. The whole-untouched-lot restriction makes attribution amount unambiguous.

## 6. Application contract

Proposed CUSTOMER_ADVANCE_APPLIED and SUPPLIER_ADVANCE_APPLIED: one application -> one lot -> one target obligation. Additional lots/targets require separate confirmed events, not implicit borrowing.

Required: applicationId (stable and unique), eventId/idempotencyKey, advanceLotId, originating payment ref, target obligation ID/creation-event ref, amount (minor units, positive safe integer), companyId/currency/counterparty, attribution/projectId, confirmedCommandId, evidenceRefs, occurredAt/effectiveAt/createdAt and confirmation authority. No parallel amountMinor truth: event amount is canonical amount; field aliases must not disagree.

Customer application decreases lot remaining and target receivable by equal amounts; cash/revenue unchanged. Supplier application decreases lot remaining and payable equally; cash/cost unchanged. Amount <= both remaining and outstanding at the validated dependency frontier. Lot100 -> apply40 ->60 ->apply30 ->30; application31 then fails. No negative advance, implicit second lot, FX, cross-counterparty/company/project application.

Later receivable100 with existing advance20 leaves both untouched. Explicit application20 gives receivable80 / advance0. Same rule for payable. Mere obligation creation never applies an advance.

## 7. Refund versus reversal

Unique refund types: CUSTOMER_ADVANCE_REFUNDED (cash out) and SUPPLIER_ADVANCE_REFUND_RECEIVED (cash in). One refund references one lot, originating payment, amount, counterparty/company/currency/project attribution, bank evidence, confirmed command and timestamps. Amount <= unused lot remaining.

Customer refund decreases advance and cash, plus attributed project paidMinor; supplier refund decreases supplier advance and increases cash, never cost. No accompanying reversal of the original payment for the same real refund. Bank movement identity/idempotency must prevent booking one transfer through two cash events.

REFUND is a new actual transfer today. REVERSAL corrects erroneous historical facts and uses existing explicit equal-amount predecessor rules. Correction preserves originals and replacement links; no synthetic offset balancing events.

## 8. Unified dependency graph and ordering

Payment -> initial manifest -> residual lot; obligation creation -> settlement/application; lot -> attribution/application/refund; original event -> reversal/correction. Extend the existing relationship graph principles, not a second permissive validator.

Dependencies must resolve in same company/currency/counterparty and compatible project, with acyclic refs and unique event/application/manifest identities. Lot IDs are derived nodes anchored in events, not independent financial authority.

Use existing canonical effectiveAt/occurredAt/eventId ordering with mandatory predecessor visibility. A dependent event ordered before its required predecessor is invalid; backdated corrections must rebuild the complete affected history. Validate availability at each logical operation boundary; do not sum end balances to conceal interim over-consumption.

An explicit correction bundle carries stable bundle identity and complete members; apply its dependency-consistent effects as one logical validation unit, while preserving existing per-event exact reversal rules. The algorithm must validate final availability and all outside dependents. No automatic generation of dependent reversals.

Payment120 with settlement100/advance20 can be reversed only with its manifest and any downstream affected events resolved. If advance10 was applied, isolated payment reversal is rejected; explicit reversal of that application and relevant manifest/payment restores receivable/cash/lot together. Real refund evidence cannot be erased by a manufactured reversal; unresolved cash/obligation dependencies block the bundle.

## 9. Exact Projection v2 shape

Retain current common domain fields scopeType, companyId, currency, status, watermark, rebuiltAt; PROJECT additionally requires projectId; COMPANY snapshot/storage projectId null.

Company monetary fields: cashMinor, receivableMinor, payableMinor, recognizedRevenueMinor, customerAdvanceMinor, supplierAdvanceMinor.
Project monetary fields: paidMinor, receivableMinor, costMinor, payableMinor, recognizedRevenueMinor, customerAdvanceMinor, supplierAdvanceMinor.

Persisted objects retain projectionId, numeric projectionContractVersion, updatedAt and current inapplicable monetary null columns (Company paidMinor/costMinor; Project cashMinor). No company cost or project cash aggregate is silently added.

Both new advance fields are sums of effective remaining lots using section5. Receivable/payable now reduce only through validated initial allocation/application and supported reversal; raw payment alone no longer subtracts them. Obligation creation and revenue/cost recognition must not duplicate receivable/payable creation for the same fact: target obligation IDs and explicit event-effect rules are mandatory implementation tests.

paidMinor v2 = project-attributed customer receipts (including advances) minus attributable customer cash refunds, after historical correction resolution. Application never increases it. Current v1 only sums CLIENT_PAYMENT_CONFIRMED and lacks refund/attribution handling; ADV-DESIGN-001 records this known versioned implementation gap.

## 10. Final v2 sign policy

| Field | Company | Project |
|---|---|---|
| cashMinor | INVALID_IF_NEGATIVE | NOT_APPLICABLE / null |
| receivableMinor | INVALID_IF_NEGATIVE | INVALID_IF_NEGATIVE |
| payableMinor | INVALID_IF_NEGATIVE | INVALID_IF_NEGATIVE |
| customerAdvanceMinor | NON_NEGATIVE | NON_NEGATIVE |
| supplierAdvanceMinor | NON_NEGATIVE | NON_NEGATIVE |
| recognizedRevenueMinor | INVALID_IF_NEGATIVE | INVALID_IF_NEGATIVE |
| costMinor | NOT_APPLICABLE / null | INVALID_IF_NEGATIVE |
| paidMinor | NOT_APPLICABLE / null | INVALID_IF_NEGATIVE |

All applicable amounts are safe integers. No clamping, negative cash authorization, overdraft or financing model. Supplier payments require evidenced opening cash/history. Revenue/cost are created only by their accepted independent events; exact linked reversal reduces prior effects, not an over-reversal. Final history validation additionally rejects cumulative negatives; current predecessor equality alone is not claimed sufficient for all event combinations.

## 11. Version and TYPE A dependency

Proposed persisted Projection version: numeric 2; P1 v2 remains domain-only (no storage metadata), with explicit v2 source contract selected by the future public boundary. Snapshot mapping: Projection numeric2 / P1 v2 -> snapshot string '2'. Current version1 remains unchanged; no String(anyVersion).

TYPE A v2 includes customerAdvanceMinor/supplierAdvanceMinor in required financial fields, equality/differences, signed-policy validation and immutable evidence. Proposed reconciliation observation contract version string '2'; v1 and v2 explicit readers, no implicit upgrade. Metadata exclusions remain projectionId/updatedAt, with rebuiltAt/status excluded from financial equality.

V1 without advances must NOT be defaulted to advance0 or compared as v2-equivalent. Unsupported or mixed versions fail closed to a nonpersistable diagnostic until an explicit version-mapping/migration gate authorizes otherwise. Lot/application references and a versioned canonical history watermark must cover all financial and attribution dependencies; current watermark algorithm changes, if needed, require explicit reviewed v2 implementation evidence.

## 12. Schema, Atomic and Legacy boundary

Future schema design needs lot/counterparty/company/currency/project attribution, originating payment/manifests, application/refund refs, correction-bundle membership and both new aggregate fields with uniqueness and immutability. Derived remaining state may be cached/rebuilt, never independently authoritative. No SQL or migration here.

Atomic Write must not classify advances, choose targets/counterparties/projects or manufacture application evidence. It sequences validated histories only; current one-scope authorization does not permit dual company/project writes. Company cash checks plus project effects and snapshot-complete company/project views require a later explicit integration gate, not hidden scope expansion.

Legacy advancePayment/advanceInterest remain unrelated until separate mapping design. Legacy remains production authority. Prepayment is not monthly execution verification, settlement amount or revenue; future Fulfillment supplies validated obligations, not automatic recognition.

## 13. First isolated implementation package (proposal only)

One coordinated package: v2 event contracts/direction/effect matrix and validation; immutable lots and target identity resolvers over deterministic fixtures; unified dependencies and correction bundles; allocation/application/refund/attribution rebuild; P1 v2 exact fields/sign rules; isolated storage contract/row mapping v2; public snapshot version boundary; TYPE A v2; deterministic regressions and public chains.

Mandatory tests: 100/40,100/100,100/120,0/10 cash cases; all no-target cases; later obligations do not auto-apply;100->40->30 partial applications; over-consumption/cross-lot/currency/counterparty/project rejection; refund vs reversal; missing dependent bundle; company=sum subsets+unallocated; attribution/paidMinor non-double-count; unsafe/negative balances; v1/v2 no-default migration; storage/snapshot/reconciliation round-trip. No migration, real DB, production wiring or Atomic replay/concurrency continuation.

Implementation gate must enumerate precise event payload/SQL-mapping limits, canonical tuple serialization and concurrency protection before coding. These are bounded implementation specifications, not permission to infer new accounting decisions.

## 14. Findings and status

ADV-DESIGN-001 MEDIUM: current paidMinor lacks new refund/attribution events. RESOLVED_IN_DESIGN by section9 v2 formula; NOT_IMPLEMENTED. Current source compatibility is not claimed. No unresolved Critical/High design finding; all implementation gaps remain subject to gate authorization.

ADVANCE_EVENT_PROJECTION_CONTRACT_DESIGN_GATE: READY_FOR_OWNER_REVIEW.
ATOMIC-IMP-003: OPEN; ATOMIC-IMP-004: OPEN; ATOMIC-IMP-005: OPEN_PENDING_IMPLEMENTATION. Its closure requires future Event/P1/storage/snapshot/reconciliation implementation and validation, never this design.

DESIGN_ONLY: YES. No source, tests, codec, constants, schema, migration, real DB, production, Legacy execution, source switch, commit or push. No automatic allocation, revenue/cost recognition or Atomic Write resume authorization.

## Advance v2 Independent Validation Remediation v0.1 — 2026-09-06

This entry supersedes earlier implementation status summaries, not the historical Owner design decisions.
Scope: remediation + self-validation ONLY; independent revalidation has NOT been performed.

ADVANCE_ACCOUNTING_IMPLEMENTATION: IMPLEMENTED_PENDING_REVALIDATION.
READY_FOR_ADVANCE_REVALIDATION: YES.

- ADV-VAL-001 HIGH CLOSED (self-validation): reuse Journal canonicalSemanticPayload before monetary effects. Same key/different canonical business content throws IDEMPOTENCY_CONFLICT. Repeated canonical replay in a supplied history throws ADVANCE_NON_CANONICAL_REPLAY_HISTORY: Journal stores one accepted event, and rebuild accepts canonical stored history, not duplicate append attempts. No silent dedup and no second cash effect.
- ADV-VAL-002 HIGH CLOSED (self-validation): snapshot, TYPE A v1/v2, observation construction and PG mapping use the existing validateProjectionWatermark contract. Persistable evidence checks both snapshot and envelope watermark consistency before SQL; malformed self-comparison is INVALID_INPUT, never MATCH. Valid empty/nonempty and malformed tuple probes PASS. Old positive fixtures now use canonical 64-hex digests.
- ADV-VAL-003 HIGH CLOSED (self-validation): public v2 rebuild accepts optional asOf (inclusive effectiveAt cutoff); omitted means all supplied history, NOT an implicit current-clock cutoff. Cutoff precedes history relationship resolution and watermark construction. Eligible history uses effectiveAt/occurredAt/eventId ordering. Payment creates unapplied funds; allocation is processed at its own ordered event, never by future monetary lookahead. Missing manifests still fail closed unless explicitly present beyond the cutoff. createdAt remains audit metadata, not applicability. A manifest before its payment is invalid.
- ADV-VAL-004 HIGH discovered during broader audit and CLOSED (self-validation): unbounded reversal/correction resolution could remove earlier facts using future history. Filtering before resolution now preserves prior cash/advance; future reversal and correction public probes PASS. No separate history engine or Atomic changes.

FUTURE_RELATIONSHIP_EVIDENCE_MUST_NOT_AFFECT_PRIOR_PROJECTION_STATE.
A pending future manifest does not reduce current advances. Its identity may explain a deferred dependency, but its financial payload is not read at payment time. Lot originalAmountMinor records funds originally formed at the payment boundary; remainingAmountMinor reflects subsequent manifest/application/refund effects, not a retroactive descriptor rewrite.
Intermediate scenario: payment100 in 2026, refund20 mid-2026, allocation in 2027. At 2026 cutoff cash80/advance80/receivable100. A stale allocation100 fails ADVANCE_ALLOCATION_INVALID at 2027, not ADVANCE_LOT_MISSING at refund time. A valid allocation80 with residual0 leaves receivable20/advance0.
Future application, refund, attribution and reversal/correction do not change earlier state; same-time ordering is input-order independent.

Evidence: 15 non-Atomic Financial Truth regression/probe files PASS, including financial-truth-advance-remediation-public-probe.mjs, advance-accounting-public-probe and advance-shared-state-probe. Coverage includes normal customer/supplier payments, independent revenue/cost, public version routing, missing observed, transient INVALID_INPUT, storage/TYPE A/reconciliation, CAS one winner, apply60+60, apply80+refund50, double attribution and correction bundles.
ATOMIC-IMP-005: CLOSED; payment10/no receivable -> cash10/receivable0/customerAdvance10 -> public v2 storage/snapshot/TYPE A/reconciliation remains PASS.
All 15 requested remediation gates PASS. git diff --check PASS (existing LF/CRLF conversion warnings only).
Remaining Advance findings: Critical0 / High0 / Medium0 / Low0. This is NOT a whole-project zero-findings claim: ATOMIC-IMP-003 HIGH and ATOMIC-IMP-004 MEDIUM remain OPEN and their tests were intentionally excluded; Atomic remains blocked.

No independent revalidation, implementation Owner acceptance, production-ready claim, Atomic resume, production wiring, Legacy mapping, source switch, schema/migration, real DB, commit or push. Existing dirty worktree changes are preserved. Next action is a separately requested Independent Revalidation.

## Advance Independent Revalidation Findings — Remediation v0.2

Date: 2026-09-06. Implementation remediation + SELF-VALIDATION only.
This entry supersedes v0.1 deferred-manifest exemptions and whole-payment lot semantics.
ADVANCE_ACCOUNTING_IMPLEMENTATION: IMPLEMENTED_PENDING_REVALIDATION_V2.
READY_FOR_ADVANCE_REVALIDATION_V2: YES.
Independent revalidation has not been performed this turn; prior FAIL is not relabeled PASS.

ADV-REVAL-001 HIGH CLOSED (self-validation): asOf effectiveAt slice now precedes identity, relationship and completeness checks. No deferredManifestIds or future-history dependency exemption remains.
FUTURE_EVIDENCE_CANNOT_SATISFY_PRIOR_DEPENDENCY.
A payment requiring a manifest outside the slice is incomplete, whether or not that future manifest exists in full input. At the manifest boundary it can participate normally. This explicitly replaces the earlier 2026 success through a 2027 manifest. A legitimate NO_INITIAL_TARGET payment still forms advance immediately and permits an intermediate refund; a required-but-not-yet-effective initial manifest does not authorize such a lot.
Future application/refund/attribution/reversal/correction cannot complete earlier dependencies; future conflicting identity records do not alter earlier slice validation.

ADV-REVAL-002 MEDIUM CLOSED (self-validation): initial settlement creates only its residual lot, at manifest processing. Payment120/settlement100 produces immutable originalAmountMinor20; settlement100 is not advance consumption. Zero residual produces no lot. NO_INITIAL_TARGET creates the entire payment as its lot.
Derived state tracks original amount, applied amount, refunded amount and remaining amount; remaining = original - applied - refunded. Fully consumed means remaining0; partially consumed means positive remaining with applied/refunded >0; unconsumed means applied/refunded0. There is no generic consumed flag set by initial settlement.
Unconsumed/unattributed residual20 permits one attribution20. Apply5 or Refund5 leaves15 and blocks attribution under the whole-untouched-lot policy; second attribution is rejected.
Attribution adds no cash or company advance. Customer residual attribution assigns20 to project paidMinor once under the accepted view semantics, not another receipt or another company cash effect; supplier attribution adds no paidMinor. Already project-attributed receipts cannot be attributed again.

ADV-REVAL-003 HIGH CLOSED (self-validation): predecessor visibility uses positions from the existing Financial Relationship Graph canonical effectiveAt/occurredAt/eventId order, before reversal/correction resolution. Reversal/correction/payment-origin/target-creation references must precede their dependent. A manifest's payment back-reference is temporal; a payment's manifest ID is a completeness link, not an inverted temporal predecessor edge. Lot operations also require the lot to have been formed during ordered replay, so they cannot consume a residual before its manifest.
Earlier-effective or same-time earlier-ordered reversal/application/refund/attribution/correction fails closed. Legitimate later reversal and complete bundles retain behavior.

Evidence: 16 non-Atomic Financial Truth regression/probe files PASS, including new financial-truth-advance-remediation-v2-public-probe.mjs. Existing v0.1 temporal test expectations explicitly updated for strict missing-manifest completeness; no weakened financial assertions. Customer/supplier residual attribution, zero residual, partial apply/refund, duplicate attribution, future dependency isolation, reversal ordering, public chain, watermark, idempotency, version isolation, missing observed and INVALID_INPUT all PASS.
All 15 requested v0.2 remediation gates PASS. Shared CAS one winner, apply60+60, apply80+refund50, double attribution and correction bundles PASS. These are isolated in-memory/query-contract tests, not real DB concurrency certification.
ATOMIC-IMP-005 CLOSED: Payment10/no receivable public v2 storage/snapshot/TYPE A/reconciliation chain remains PASS.
Broader temporal audit: no additional finding identified beyond the three addressed findings.
Remaining Advance findings: Critical0 / High0 / Medium0 / Low0. ATOMIC-IMP-003 HIGH / ATOMIC-IMP-004 MEDIUM remain OPEN, unchanged and excluded from this count and regression scope.
git diff --check PASS; existing LF/CRLF warnings only. No commit/push/schema/migration/real DB/production/Legacy/source switch or Atomic resume. Existing dirty worktree retained.
Stop after self-validation; separately requested Independent Revalidation V2 is the next step.

## Temporal Input Validation Before asOf — Remediation v0.3

Date: 2026-09-06. Implementation remediation + self-validation ONLY.
ADV-REVAL-V2-001 HIGH: CLOSED (self-validation).
ADVANCE_ACCOUNTING_IMPLEMENTATION: IMPLEMENTED_PENDING_REVALIDATION_V3.
READY_FOR_ADVANCE_REVALIDATION_V3: YES.
No Independent Revalidation V3 performed; previous independent FAIL is not relabeled PASS.

INVALID_EVENT_MUST_NOT_BECOME_ABSENT_EVENT.
All raw events now pass createAdvanceFinancialEvent before slicing. Required effectiveAt/occurredAt/createdAt and optional non-null confirmedAt use the accepted UTC representation (seconds or three millisecond digits, Z) with explicit finite epoch and ISO round-trip calendar validation. Invalid dates that JavaScript normalizes (February30, hour24) are rejected. No timestamp is silently rewritten. asOf uses the same strict temporal rule.
Canonical business identity is checked over validated full input before asOf, as explicitly required by this v0.3 instruction. This supersedes v0.2's test that ignored a future conflicting identity. A valid future event is excluded; an invalid event or conflicting input history is rejected. Relationship/dependency resolution still occurs only inside the slice: future evidence cannot complete prior dependencies.
True empty history remains valid. A valid slice containing no events also legitimately has the empty watermark; malformed history never produces that output.

Public evidence: financial-truth-advance-temporal-input-public-probe.mjs covers 76 malformed-history cases with and without asOf, invalid asOf, nonstrings, missing fields, impossible dates, legitimate past/future events, true empty history, UTC seconds/milliseconds and leap day. Malformed cases produced zero Projection outputs and zero mock SQL calls, preventing downstream snapshot/TYPE A/reconciliation continuation.
All 17 non-Atomic Financial Truth regression/probe files PASS. Previous idempotency/watermark/relationship-slice/residual-lot/temporal-predecessor cases, normal customer/supplier/paidMinor/revenue/cost/version/public chain, shared CAS/lot races and correction bundles PASS.
ATOMIC-IMP-005 CLOSED; Payment10/no receivable full public v2 storage/snapshot/TYPE A/reconciliation remains PASS.
All 12 requested temporal remediation gates PASS. Broader Advance filter/sort audit: temporal parsing at slice and canonical ordering now receives validated events; no additional Advance finding identified. The stricter calendar check is scoped to Advance v2; shared v1 event/storage implementations were not changed.
Remaining Advance findings: Critical0 / High0 / Medium0 / Low0. ATOMIC-IMP-003 HIGH and ATOMIC-IMP-004 MEDIUM remain OPEN, unchanged, excluded from these counts/tests.
git diff --check PASS, existing LF/CRLF warnings only. No commit/push/migration/real DB/production/Legacy/source switch/Atomic resume. Existing dirty worktree preserved. Stop; independent revalidation requires the next request.

## Canonical Temporal Ordering Remediation v0.4

Date: 2026-09-06. Implementation remediation + self-validation only.
ADV-REVAL-V3-001 HIGH: CLOSED (self-validation).
ADVANCE_ACCOUNTING_IMPLEMENTATION: IMPLEMENTED_PENDING_REVALIDATION_V4.
READY_FOR_ADVANCE_REVALIDATION_V4: YES.
No Independent Revalidation V4 performed; earlier independent FAIL is not relabeled PASS.

CANONICAL_TEMPORAL_ORDER_MUST_COMPARE_ACTUAL_INSTANTS.
Shared pure canonical-event-time.mjs validates accepted UTC seconds/milliseconds against finite epoch and round-trip calendar validity. compareCanonicalEventTime compares effectiveAt epoch, then occurredAt epoch, then the unchanged String(eventId).localeCompare identity tie-break. It checks both temporal dimensions even when effective instants differ. Stored event timestamps and canonicalSemanticPayload are not rewritten.
Shared history construction/resolution and Advance replay use this comparator; relationship predecessor positions derive from that same history. asOf still uses validated numeric instants, after full event/identity validation and before relationship resolution.
Seconds Z and milliseconds .000Z at the same instant compare equal in the temporal dimensions. Original lawful +1ms reversal now succeeds; original unlawful -1ms reversal rejects. Application/refund/attribution/correction mixed-precision cases pass in both directions.
Advance rebuiltAt maximum selection also uses actual createdAt instants, with a representation-only tie-break when instants are equal. No additional economic ordering is derived from raw timestamp strings.

Watermark inherits shared canonical history order. Same event set in multiple input permutations has identical canonical history/projection/digest. Correcting previously misordered mixed-precision histories may change their digest/latest event; no persisted records were updated, no migration or source switch authorized. Same-instant timestamp text is still immutable evidence, not normalized away.
Broader source search: no remaining raw effectiveAt/occurredAt string sorting in Financial Truth event-order paths. Remaining localeCompare is event identity or equal-instant metadata representation; stable object-key sorting is not temporal. Existing reconciliation date validation and Atomic checkedAt numeric equality were inspected, not changed. No extra finding identified.

Evidence: 18 non-Atomic Financial Truth regression/probe files PASS, including mixed-precision public history/projection/dependency/digest probe, temporal malformed-input, previous findings, customer/supplier normal cases, shared CAS/lot races/correction bundles, version/storage/snapshot/TYPE A/missing-observed/INVALID_INPUT/reconciliation. All 15 requested v0.4 gates PASS.
ATOMIC-IMP-005 CLOSED: Payment10/no receivable full public chain remains PASS.
Remaining Advance findings: Critical0 / High0 / Medium0 / Low0. ATOMIC-IMP-003 HIGH and ATOMIC-IMP-004 MEDIUM remain OPEN and excluded; no Atomic source or test changes.
git diff --check PASS (existing LF/CRLF warnings). Existing dirty worktree preserved. No commit, push, migration, real DB, production wiring, Legacy mapping, source switch or Atomic resume. Stop for separately requested Independent Revalidation V4.

## Owner Acceptance — Advance Accounting v2

Date: 2026-09-06.

ADVANCE_ACCOUNTING_V2: OWNER_ACCEPTED.
ADVANCE_ACCOUNTING_IMPLEMENTATION: OWNER_ACCEPTED.
ADVANCE_ACCOUNTING_VALIDATION: PASS.
ADVANCE_ACCOUNTING_REVALIDATION_V4: PASS.
ADVANCE_VALIDATION_FINDINGS: 0.

The accepted scope comprises this Advance Event / Projection / Lot Contract, the accepted Advance Accounting Model, isolated Advance v2 implementation, public v1/v2 routing, Projection v2, Reconciliation v2, lot/application/refund/attribution semantics, canonical point-in-time behavior and canonical temporal ordering, plus the Financial Truth supporting contracts required by the validated public chain.

Independent Revalidation V4 evidence: 18/18 non-Atomic Financial Truth regression/probe files PASS; 76 malformed temporal cases PASS; mixed-precision canonical ordering PASS; public v2 chain PASS; shared-state contract probes PASS; ATOMIC-IMP-005 closure chain PASS; Critical0 / High0 / Medium0 / Low0 Advance findings.

ATOMIC-IMP-005: CLOSED.
ATOMIC-IMP-003: OPEN.
ATOMIC-IMP-004: OPEN.

Acceptance is OWNER_ACCEPTED / IMPLEMENTED / INDEPENDENTLY_VALIDATED / ISOLATED / NON-PRODUCTION only. It does not authorize Atomic Write completion or validation, migration, real DB validation, production activation, Legacy mapping, Source of Truth switch, or capital/money movement automation. It is not PRODUCTION_READY, REAL_DB_VALIDATED, MIGRATION_READY, SOURCE_OF_TRUTH, or ATOMIC_COMPLETE.
