import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeManagementAdvisor } from "../server/services.mjs";

const db = {
  settings: { companyFinance: { currentCash: 500000, monthlyLaborCost: 204000, monthlyRent: 35000, monthlyOtherCost: 15000 } },
  projects: [{ id: "p-1", name: "高集中项目", client: "客户A", status: "执行中", contract: 2000000, paid: 0, receivable: 2000000, costUsed: 300000, paymentDue: "未填写" }],
  approvals: [{ id: "a-1", type: "supplier_payment", status: "待审批", amount: 100000 }]
};

const fallback = await analyzeManagementAdvisor(db, {}, { name: "管理层", role: "shareholder" });
assert.equal(fallback.mode, "calculated-fallback");
assert.equal(fallback.decisionMode, "生存优先");
assert(fallback.executiveConclusion.includes("1.97") || fallback.executiveConclusion.includes("2"), "must calculate cash runway");
assert(fallback.actions.some((item) => item.priority === "P0" && item.stopLoss), "must return P0 action with stop-loss");
assert.equal(fallback.scenarios.length, 5, "must compare collection scenarios");
assert(fallback.unknowns.some((item) => item.includes("实时") && item.includes("市场")), "must disclose missing live market data");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200, headers: { "content-type": "application/json" } });
const malformed = await analyzeManagementAdvisor({ ...db, settings: { ...db.settings, aiService: { "API Key": "secret", "Base URL": "https://ai.invalid/v1", "模型名称": "test" } } }, {}, { name: "管理层", role: "admin" });
globalThis.fetch = originalFetch;
assert.equal(malformed.mode, "calculated-fallback", "malformed AI output must safely fall back");
assert(malformed.unknowns.some((item) => item.includes("AI 深度分析未成功")));

const apiSource = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
assert(apiSource.includes('url.pathname === "/api/management/advisor"'));
assert(apiSource.includes('if (!requireRole(user, COCKPIT_ROLES, res)) return;\n    const body = await readBody(req);\n    const data = await analyzeManagementAdvisor'), "advisor endpoint must be cockpit-role protected");

const uiSource = await readFile(new URL("../src/ManagementAdvisor.jsx", import.meta.url), "utf8");
for (const field of ["优先决策与止损线", "内部事实", "市场依据边界", "现金情景推演", "当前缺失信息与结论边界"]) assert(uiSource.includes(field));

console.log("management advisor regression passed");
