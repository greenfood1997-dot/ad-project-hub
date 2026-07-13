import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('["management", "公司大盘"]'), "management nav should include company dashboard");
assert(source.includes('["management", "现金流压力"]'), "management nav should include cashflow pressure");
assert(source.includes('["management", "AI 商业顾问"]'), "management nav should include AI business advisor");
assert(source.includes('const showCash = subView === "现金流压力"'), "management cockpit should branch cashflow page");
assert(source.includes('const showAdvisor = subView === "AI 商业顾问"'), "management cockpit should branch advisor page");
assert(source.includes('const showDashboard = !showCash && !showAdvisor'), "management cockpit should branch company dashboard page");
assert(source.includes("公司经营大盘") && source.includes("合同总额") && source.includes("项目结构"), "company dashboard should show operating totals and project structure");
assert(source.includes("6个月现金底线公式"), "cashflow page should explain the 6 month safety formula");
assert(source.includes("月固定支出 = 人力 + 租金 + 贷款 + 利息 + 每月其他支出"), "cashflow page should show the fixed-cost formula");
assert(source.includes("可存活月数 = 当前公司现金 ÷ 月固定支出"), "cashflow page should show runway calculation");
assert(source.includes("现金压力来源"), "cashflow page should show pressure sources");
assert(source.includes("function calculateRunway"), "cashflow settings should reuse a concrete runway calculation helper");
assert(source.includes("const financePreview = calculateRunway(financeForm)"), "cashflow settings form should preview runway before saving");
assert(source.includes('apiRequest("/api/company-finance"') && source.includes("body: JSON.stringify({ values: financeForm })"), "cashflow settings should save through the dedicated company finance API");
assert(source.includes("公司现金流设置已保存，经营舱已刷新：月固定支出") && source.includes("现金可撑") && source.includes("6个月缺口"), "cashflow settings save should report refreshed runway numbers");
assert(source.includes("cash-settings-preview") && source.includes("按当前填写，现金还能撑"), "cashflow settings should show an inline runway preview");
assert(source.includes("const financeTemplates = [") && source.includes("轻团队") && source.includes("拍摄执行期") && source.includes("收缩现金流"), "cashflow settings should provide practical fixed-cost templates");
assert(source.includes("function applyFinanceTemplate(template)") && source.includes("已套用「${template.label}」现金流模板"), "cashflow templates should be clickable and explain the next save step");
assert(source.includes("AI 商业顾问") && source.includes("经营建议") && source.includes("判断依据") && source.includes("优先关注项目"), "advisor page should show advice, evidence, and priority projects");
assert(source.includes("function managementLedgerRows(metrics = {}, stats = {}, projects = [])") && source.includes("6个月安全线") && source.includes("现金压力总暴露") && source.includes("AI建议 ${index + 1}") && source.includes("优先项目 ${index + 1}"), "management cockpit should build a CSV operating summary with cash safety line, advisor actions, and priority projects");
assert(source.includes("const [exportingManagement") && source.includes("async function exportManagementLedger()") && source.includes("downloadCsv(\"公司经营舱摘要.csv\", managementLedgerRows(metrics, stats, projects))"), "management cockpit should export the current operating summary as CSV");
assert(source.includes("导出经营摘要") && source.includes("公司经营舱摘要 CSV 已导出，包含经营建议、现金安全线和优先项目。"), "management export should show an action and success notice");
assert(source.includes("actionTarget") && source.includes("actionLabel") && source.includes("actionReason"), "management risk projects should carry an action target, label, and reason");
assert(source.includes("function ManagementCockpit({ projects, approvals = [], settings = {}, session, stats, subView, setSubView, onOpenApprovals, onOpenCollections, onOpenProjectSection"), "management cockpit should receive real navigation actions");
assert(source.includes("function handleAdvisorAction(action = \"\", index = 0)") && source.includes("onOpenCollections?.(metrics.highRiskProjects[0]") && source.includes("onOpenApprovals?.()"), "advisor actions should route to collection and approval workflows");
assert(source.includes("function handleRiskProject(project)") && source.includes("onOpenProjectSection?.(project, project.actionTarget === \"costs\" ? \"costs\" : \"progress\"") && source.includes("处理经营舱建议：${project.actionReason}"), "management risk projects should route to project cost/progress sections when collection is not the right action");
assert(source.includes("已切到现金流压力页，可以先补现金设置") && source.includes("看现金流"), "advisor cash action should route to cashflow page");
assert(source.includes("advisor-action-card") && source.includes("去催收") && source.includes("去审批") && source.includes("看大盘"), "advisor advice should render as clickable action cards");
assert(source.includes("management-risk-action") && source.includes("project.actionLabel") && source.includes("project.actionReason"), "priority risk projects should show the exact next action and reason");
assert(source.includes("onOpenProjectSection={(project = null, focus = \"progress\", message = \"\") =>") && source.includes("setProjectFocus(focus)") && source.includes("成本与审批区"), "management page should route project actions back into the project detail focus area");
assert(source.includes("危险！你快倒闭啦！需要收缩现金流"), "advisor and scan copy should preserve the user-requested danger wording");
assert(styles.includes(".management-tab-row"), "management tabs should have dedicated styles");
assert(styles.includes(".advisor-action-card") && styles.includes(".compact-action-row") && styles.includes(".management-risk-action"), "advisor action cards should have dedicated styles");
assert(styles.includes(".cash-formula-card"), "cashflow formula should have dedicated styles");
assert(styles.includes(".cash-settings-preview") && styles.includes(".cash-settings-preview.danger") && styles.includes(".cash-settings-preview.warn"), "cashflow preview should have status styles");
assert(styles.includes(".finance-template-row") && styles.includes(".finance-template-row .tiny"), "cashflow template buttons should have compact responsive styles");
assert(styles.includes(".founder-card .mini strong") && styles.includes("color: #111827") && styles.includes(".feature-panel .review-summary .mini span"), "management cockpit metric mini cards should keep readable contrast");

console.log("frontend management cockpit entry passed");
