# Role Experience Model

| 角色 | 核心问题 | 主要体验 |
|---|---|---|
| 执行人员 | 今天要做什么？ | Today/Projects/AI；Universal Drop、对话式费用、执行材料捕获、AI 报告、异常复核 |
| PM | 项目是否失控？ | 进度、履约、成本、预算、回款、供应商、团队、风险与下一步；接收项目/提出问题 |
| 销售 | 客户、合同、回款状态？ | 合同+报价上传解析，异常确认，形成项目并提醒分派 PM，跟进回款续约 |
| 财务 | 今天哪些钱要处理？ | 待付款、到账、供应商结算、报销、备用金、工资、发票与现金风险 |
| 总监 | 部门经营如何？ | 合同额、收入、成本、利润、毛利率、回款率、应收、垫款、负载与风险 |
| 股东 | 公司安全吗、该做什么？ | 现金、应收、工资税费、利润、部门与项目下钻；建议必须经过 Treasury Safety Layer |

执行侧默认“丢材料+说一句话”，月底自动形成报销草稿并只需确认总额；不同角色共享同一事实源。

## Execution Cost Universal Drop

执行人员可将执行成本表拖入 AI / Universal Drop。AI 自动识别项目、月份、费用明细、供应商、金额、费用类型与日期，检查重复和异常，仅将无法确定的项目/供应商/金额交给执行人员选择；确认后形成待确认/已确认成本事实，进入审批、供应商、预算、利润等后续链路。一次上传可含多笔费用、多个供应商、多个分类及不同项目/子项目，AI 先拆分归类再处理异常。不得要求重新填写，能确定的字段不重复询问；上传成功不等于 Financial Fact Confirmed，正式金额须经 Financial Event / Financial Truth 确认，冲突或不完整时进入 Needs Review。

## 股东 Scope 下钻

股东不进入另一套独立 Dashboard，而是通过同一事实系统按 Scope 下钻：**Company → Department → PM → Project → Execution / Financial / Supplier / Client / Obligation Facts**。例如公司 → 汽车事业部 → PM 张三 → 捷途年度运营项目，可查看执行进度、年度履约、项目成本、预算、回款、应收、供应商、团队负载、风险、文件证据及审批/财务事实。层级越高越强调聚合、趋势、风险和异常，越向下钻越具体；首页不得堆积全部明细。

## AI Executive Advisor（Decision Support）

范围包括 Cash Survival、Expansion、Expansion Direction、Contraction、Hiring、Flexible Capacity、Collection Priority、Margin Improvement、Client Quality、Department Capacity、PM / Workforce Pressure、Treasury Safety、Potential Idle Cash、Scenario Simulation。统一输出 **Recommendation / Evidence / Expected Impact / Risk / Next Action**，必须指向具体对象、原因和下一步。AI Executive Advisor 仅是 Decision Support，不拥有自动扩张、招聘、裁员、投资或转账权。
