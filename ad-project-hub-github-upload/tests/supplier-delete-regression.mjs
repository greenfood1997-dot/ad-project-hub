import assert from "node:assert/strict";
import { deleteMistakenSupplier } from "../server/services.mjs";
import { readFile } from "node:fs/promises";

const actor = { id: "admin", name: "管理员", role: "admin" };
const db = { users: [], projects: [{ id: "p1", name: "项目一", contract: 10000, costUsed: 3000, costs: [{ source: "supplier-settlement", settlementId: "s1", amount: 1000 }] }], suppliers: [{ id: "s1", supplier: "误建科目", projectId: "p1", project: "项目一", amount: 1000, status: "待结算", costAppliedAt: "2026-07-20" }], supplierProfiles: [{ supplier: "误建科目", ratings: [] }], approvals: [], auditLogs: [] };
const result = deleteMistakenSupplier(db, { supplier: "误建科目" }, actor);
assert.equal(result.deletedRows, 1);
assert.equal(result.rolledBack, 1000);
assert.equal(db.suppliers.length, 0);
assert.equal(db.supplierProfiles.length, 0);
assert.equal(db.projects[0].costUsed, 2000);

const paidDb = { suppliers: [{ supplier: "真实供应商", status: "已付款", amount: 100 }], supplierProfiles: [], approvals: [], projects: [], auditLogs: [] };
assert.throws(() => deleteMistakenSupplier(paidDb, { supplier: "真实供应商" }, actor), /强制清理/);
const forced = deleteMistakenSupplier(paidDb, { supplier: "真实供应商", forceMistake: true, confirmSupplierName: "真实供应商" }, actor);
assert.equal(forced.forced, true);
assert.equal(paidDb.suppliers.length, 0);
assert.equal(paidDb.auditLogs[0].action, "force-delete-mistaken-supplier");

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/SupplierLibrary.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
assert(api.includes('url.pathname === "/api/suppliers/delete"') && api.includes('["shareholder", "admin"]'), "supplier delete API must be admin scoped");
assert(panel.includes("删除误建供应商") && panel.includes("/api/suppliers/delete"), "split supplier library should expose safe delete");
assert(main.includes("删除误建供应商") && main.includes("deletingSupplier"), "production supplier library should expose safe delete");
assert(panel.includes("confirmSupplierName") && panel.includes("window.prompt"), "forced cleanup should require typing the full supplier name");

console.log("supplier delete regression passed");
