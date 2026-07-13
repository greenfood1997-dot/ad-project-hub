import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSupplierSettlementPayable } from "../src/utils/supplierMetrics.js";

assert.equal(isSupplierSettlementPayable({ status: "待结算" }), true);
assert.equal(isSupplierSettlementPayable({ status: "审批中" }), true);
assert.equal(isSupplierSettlementPayable({ status: "已付" }), false);
assert.equal(isSupplierSettlementPayable({ status: "已结清" }), false);
assert.equal(isSupplierSettlementPayable({ status: "审批已驳回" }), false);
assert.equal(isSupplierSettlementPayable({ status: "审批已撤回" }), false);

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const supplierSource = await readFile(new URL("../src/SupplierLibrary.jsx", import.meta.url), "utf8");

assert(supplierSource.includes('import { isSupplierSettlementPayable } from "./utils/supplierMetrics.js";'), "supplier library should use shared supplier settlement helper");
assert(!mainSource.includes("function isSupplierSettlementPayable("), "main should not redefine supplier payable logic");
assert(!supplierSource.includes("function isSupplierSettlementPayable("), "supplier library should not redefine supplier payable logic");

console.log("frontend supplier metrics regression passed");
