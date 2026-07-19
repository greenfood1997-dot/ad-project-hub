import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");
const parseService = await readFile(new URL("../server/project-parse-service.mjs", import.meta.url), "utf8");

assert(services.includes("sanitizeSupplierRows(parsed.suppliers)"));
assert(services.includes("供应商|服务商|收款方|结算单位|乙方"));
assert(services.includes("应结|实付|待结算|结算金额|付款金额|供应商费用|服务商费用"));
assert(services.includes("账号|账户|项目|客户|收入|利润|人力|税费|挂靠费|垫款|投流|日常支出|中标服务费"));
assert(parseService.includes("validSupplierRows(parsed.suppliers)"), "modular parse path must apply the same supplier guard");

console.log("supplier extraction guard regression passed");
