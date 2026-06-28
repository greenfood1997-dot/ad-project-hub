import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('label: "成本复盘"'), "navigation should expose closeout review");
assert(source.includes('["closeout", "结案复盘"]'), "closeout nav should include project closeout review");
assert(source.includes('["closeout", "支出排行"]'), "closeout nav should include spending ranking");
assert(source.includes("function CloseoutReview"), "frontend should render closeout review component");
assert(source.includes("costRows") && source.includes("topCost"), "closeout review should compute cost rows and top cost");
assert(source.includes("topCostShare"), "closeout review should compute top cost share");
assert(source.includes("costContractRate"), "closeout review should compute cost-to-contract rate");
assert(source.includes("suggestedReserve"), "closeout review should compute next-project budget reserve suggestion");
assert(source.includes("成本已接近合同金额") && source.includes("单项支出占比偏高"), "closeout review should generate risk-aware optimization copy");
assert(source.includes("最大支出占比"), "closeout review should show top spending ratio");
assert(source.includes("下次预算建议"), "closeout review should show next budget recommendation");
assert(source.includes("支出排行") && source.includes("占总成本"), "spending ranking should show cost share");
assert(source.includes("预算预留"), "spending optimization should include reserve advice");

console.log("frontend closeout review entry passed");
