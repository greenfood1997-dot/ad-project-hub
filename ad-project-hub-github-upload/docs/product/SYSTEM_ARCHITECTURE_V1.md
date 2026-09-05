# System Architecture V1

## 七个核心 Engine

1. **Document Truth Engine**：合同、报价、成本、核销、发票、支付、工资及 Office/PDF/图片进入上传→解析/OCR→证据定位→交叉校验→规则校验→异常确认；字段目标为 `value/source/evidence/confidence/validationStatus`。OCR 成功不等于业务解析成功。
2. **Project Obligation Engine**：维护 planned、completed、remaining、this_month_due、overdue、risk，按角色范围展示履约风险。

   **Annual Retainer / 年框项目模型**：适用于年度合同，例如“捷途 2026 年度品牌运营”（2026-01-01 → 2026-12-31），义务包括短视频120条、KOL合作40位、活动6场、月报12份、季度复盘4次。每类 Obligation 预留 `obligationId`、`projectId`、`type`、`name`、`period`、`plannedQuantity`、`completedQuantity`、`remainingQuantity`、`thisMonthPlanned`、`thisMonthCompleted`、`overdueQuantity`、`status`、`evidenceRefs`、`lastUpdatedAt`，支持年度计划→月度计划→实际完成→累计完成→剩余量→延期→履约风险。合同解析形成草稿，报价/排期/执行表补充细节，执行证据更新事实；AI 不得仅凭自然语言直接改写 `completedQuantity`，必须有事实、证据和确认规则。

   **Event Delivery Reliability / No Silent Failure**：Business Event 与 Notification Delivery 分离，链路为 Event → Record → Recipient Resolution → Notification Task → Delivery Attempt → Delivered/Failed/Retry → Acknowledgement → Audit。预留 `PENDING`、`PROCESSING`、`DELIVERED`、`FAILED`、`RETRYING`、`DEAD_LETTER`、`ACKNOWLEDGED`；事件须持久化、幂等、记录失败原因，可重试错误进入 retry，多次失败进入 dead-letter/manual attention，系统内待办为最低保障，Critical 事件告警，scheduler 仅作补偿。收件人按 Role + Scope + Responsibility 解析；用户看不到 actionView 不得视为完成。重要事件包括 CONTRACT_CONFIRMED、PM_ASSIGNMENT_REQUIRED、PM_ASSIGNED、PROJECT_ACCEPTED、APPROVAL_REQUIRED、APPROVAL_COMPLETED、PAYMENT_CONFIRMED、PAYROLL_CONFIRMED、RECEIVABLE_OVERDUE、DELIVERY_OVERDUE、BUDGET_RISK、FINANCIAL_EVENT_FAILED。No Silent Failure 是 Phase 1 Reliability 约束，Phase 0 只记录设计、不实施。
3. **Financial Truth Engine**：统一合同、收入、应收、回款、成本、应付、报销、工资、税费、利润、现金流与分红；资金优先由 Ledger/Financial Event 推导，工资使用 Payroll Ledger。
4. **Workflow & Event Engine**：统一状态机、审批、待办、通知、飞书与 Next Best Action。预留 CONTRACT_CONFIRMED、PROJECT_CREATED、PM_ASSIGNMENT_REQUIRED、PM_ASSIGNED、PROJECT_ACCEPTED、EXPENSE_DETECTED、EXPENSE_CONFIRMED、APPROVAL_REQUIRED、APPROVAL_COMPLETED、PAYMENT_CONFIRMED、PAYROLL_CONFIRMED、DELIVERY_CONFIRMED。
5. **Resource Intelligence Engine**：以负载、项目复杂度、节点、逾期、人力成本分析 People；以质量、准时率、价格、返工、发票与付款风险分析 Supplier；不做鼠标/在线时长监控。
6. **Reporting Engine**：日报、周报、月报、客户月报、阶段汇报、复盘、结案与 PPT；数字只能来自 Facts/Rules，AI 负责组织表达。
7. **AI Operating Brain**：Observe、Understand、Reason、Plan、Act、Explain；下层包括 Model Gateway、Business Context、Business Memory、Tool Registry、Automation Policy、Audit；模型供应商可替换。
