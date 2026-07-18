import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(service.includes("preview.requiresManualContract = true") && service.includes("preview.canConfirm = false"), "unreadable zero-amount contracts should not appear confirmable");
assert(source.includes("canConfirmPreview") && source.includes("manualContract > 0 && manualProjectName"), "manual project name and contract amount should unlock confirmation");
assert(source.includes("if (!preview?.requiresManualContract) setPreview(null)"), "editing fallback fields should retain the failed preview and its uploaded file");
assert(source.includes("识别失败时请手动填写"), "contract amount field should explain the manual fallback");

console.log("frontend contract manual fallback regression passed");
