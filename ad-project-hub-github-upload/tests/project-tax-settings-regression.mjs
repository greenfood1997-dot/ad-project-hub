import assert from "node:assert/strict";
import { createProject, extractContractTaxRate, inferContractTaxIncluded, projectTaxSnapshot, updateProject } from "../server/services.mjs";

assert.deepEqual(projectTaxSnapshot(10600, "6%", "含税"), { enteredAmount: 10600, contractTaxIncluded: true, taxRate: 6, netRevenue: 10000, estimatedTax: 600, contractTotal: 10600 });
assert.deepEqual(projectTaxSnapshot(10000, 6, "未税"), { enteredAmount: 10000, contractTaxIncluded: false, taxRate: 6, netRevenue: 10000, estimatedTax: 600, contractTotal: 10600 });
assert.equal(extractContractTaxRate("本项目最终优惠含税总价为人民币180万元，增值税税率：6%"), 6);
assert.equal(inferContractTaxIncluded("最终优惠含税总价人民币180万元"), true);
assert.equal(inferContractTaxIncluded("未税金额人民币180万元，税率6%"), false);

const db = { settings: { product: { "默认项目税率": "3%", "默认合同金额口径": "未税" } }, projects: [], parseJobs: [], auditLogs: [], suppliers: [], systemNotifications: [] };
const user = { id: "u-admin", name: "管理员", role: "admin" };
const { project } = await createProject(db, { "项目名称": "默认税率项目", "合同金额": "10000" }, [], user);
assert.equal(project.taxRate, 3);
assert.equal(project.contractTaxIncluded, false);
assert.equal(project.contract, 10300);
assert.equal(project.estimatedTax, 300);

const parsedResult = await createProject(db, { "项目名称": "AI 含税项目" }, [{ name: "合同.pdf", text: "最终优惠含税总价1800000元，增值税税率：6%" }], user, { parsed: { contract: 1800000, taxRate: 6, contractTaxIncluded: true, projectName: "AI 含税项目" } });
assert.equal(parsedResult.project.contract, 1800000);
assert.equal(parsedResult.project.estimatedTax, 101886.79);

updateProject(db, { id: project.id, values: { "合同金额": 10600, "项目税率": 6, "合同金额口径": "含税" } }, user);
assert.equal(project.netRevenue, 10000);
assert.equal(project.estimatedTax, 600);
assert.equal(project.contract, 10600);
console.log("project tax settings regression passed");
