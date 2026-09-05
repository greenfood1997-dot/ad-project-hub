# Frontend Information Architecture

视觉方向：Quiet OS（Apple System × Financial OS）：安静、智能、直接；强调留白、层级、渐进披露、少按钮/表格/弹窗。普通用户一级导航为 Today、Projects、AI；有权限用户增加经营、管理。搜索/AI Search、Quick Action、头像位于右上；AI 优先 floating assistant/popover，继承当前上下文。首页遵循 One Screen, One Question，异常突出。

禁止为每个角色复制独立 Dashboard；采用 Widget Composition + Role Context + Scope Context，复用 MyActions、MyProjects、ProjectHealth、DepartmentHealth、CompanyHealth、CashHealth、Workload、AIAdvice。

## Phase 0 工程约束

当前 `src/main.jsx` 为巨型入口，未来建议拆分为 `app/`、`pages/`、`features/`、`components/ui/`、`components/business/`、`services/api/`、`state/`、`design/`；本阶段不改代码。
