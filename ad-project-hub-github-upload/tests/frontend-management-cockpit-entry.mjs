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
assert(source.includes("AI 商业顾问") && source.includes("经营建议") && source.includes("判断依据") && source.includes("优先关注项目"), "advisor page should show advice, evidence, and priority projects");
assert(source.includes("危险！你快倒闭啦！需要收缩现金流"), "advisor and scan copy should preserve the user-requested danger wording");
assert(styles.includes(".management-tab-row"), "management tabs should have dedicated styles");
assert(styles.includes(".cash-formula-card"), "cashflow formula should have dedicated styles");

console.log("frontend management cockpit entry passed");
