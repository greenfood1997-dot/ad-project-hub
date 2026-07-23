import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(services.includes("looksLikeVerificationEvidence(files)"), "quote preview should detect settlement evidence");
assert(services.includes('type: "verification-sheet"') && services.includes("autoCorrectedFrom"), "settlement evidence should reroute to verification preview");
for (const source of [dialog, main]) {
  assert(source.includes("if (data.type && data.type !== type) setType(data.type)"), "frontend should follow the corrected upload type before confirmation");
}

console.log("settlement material auto routing regression passed");
