# Business State Model

- Contract：Uploaded → Parsed → Needs Review → Confirmed → Active → Reversed/Corrected
- Expense：Detected → Allocated → Employee Confirmed → Approved → Paid → Reversed
- Delivery：Planned → In Progress → Delivered → Verified
- Payment：Expected → Reported → Finance Confirmed → Reversed
- Payroll：Prepared → Reviewed → Confirmed → Paid → Reversed

“确认”是事实提交点，不是单纯 UI 动作。执行人员确认执行事实、费用归属和材料；PM 确认项目成本、供应商交付和执行事实；销售确认合同信息和客户付款通知；财务确认到账、付款、工资、发票和结算；股东确认大额资金、分红及特殊安排。
