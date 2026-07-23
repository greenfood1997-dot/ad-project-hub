import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(services.includes("项目没有分项报价规则，已按合同总额核销"), "preview should support projects without quote sheets");
assert(services.includes("按合同总额·待人工复核"), "contract-total verification must stay visibly reviewable");
assert(services.includes("累计核销") && services.includes("超过合同总额"), "preview and confirmation must enforce the contract cap");
assert(!services.includes('if (!quoteRules.length) throw new Error("当前项目还没有报价规则库'), "missing quote rules must not hard-block verification");

console.log("contract total verification regression passed");
