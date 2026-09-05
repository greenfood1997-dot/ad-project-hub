# Current Baseline（仓库事实）

状态定义：VERIFIED=代码/测试直接可见；PARTIAL=存在实现但范围有限；MOCK=模拟/本地数据；MISSING=未发现；UNKNOWN=无法仅凭静态检查确认。

| 能力 | 状态 | 事实 |
|---|---|---|
| 角色权限 | VERIFIED | admin/shareholder/director/pm/sales/finance/member 已存在，API 有 scope 过滤 |
| `/api/state` | VERIFIED | `server/api.mjs` 提供 GET，并按用户范围返回快照 |
| 合同解析 | PARTIAL | 文件解析、项目 parse/reparse 与合同校验存在 |
| OCR | PARTIAL | 腾讯云 OCR 集成及 PDF/图片路径存在，配置依赖环境 |
| 项目创建 | VERIFIED | 项目 API 与前端流程存在 |
| PM 分派 | VERIFIED | assignment API、候选建议与权限测试存在 |
| 项目执行 | PARTIAL | 项目活动/任务/材料模块存在，完整义务引擎未见 |
| 成本 | PARTIAL | 成本、报销、供应商结算写回存在，统一 Financial Event 未见 |
| 回款 | PARTIAL | payment/collection 服务存在，完整账本一致性需 Phase 1 |
| 审批 | VERIFIED | PM/总监/财务审批流与权限测试存在 |
| 供应商 | VERIFIED | 主档、评级、结算与导出存在 |
| 通知 | PARTIAL | 系统通知、飞书发送存在，统一事件驱动保证未见 |
| 飞书 | PARTIAL | 登录、联系人、机器人、审批卡片与文件事件存在，生产配置依赖环境 |
| 现金流 | PARTIAL | 管理现金/Runway 视图存在；Treasury Safety Layer 未见 |
| AI Advisor | PARTIAL | `/api/management/advisor` 与规则型 assistant 存在，非完整 Brain |
| Workload | PARTIAL | 分派建议使用负载评分；完整 Resource Intelligence 未见 |
| Reporting | PARTIAL | 月度成本/管理分析存在；自动全套报告/PPT 未见 |
| Payroll | PARTIAL | compensation 服务存在；Payroll Ledger/确认生命周期未见 |
| Financial Event | MISSING | 未发现统一 Financial Event 模型 |
| Business Event | PARTIAL | 审批/通知事件字段存在；统一事件总线未见 |
| AI Brain | MISSING | 未发现 Observe→Explain 的统一层 |
| Business Memory | MISSING | 未发现 Fact/Pattern/Hypothesis/Decision 分类存储 |

本表不把产品目标视为已实现；`data/db.json` 是本地 JSON 数据源，生产持久化路径需另行验证。
