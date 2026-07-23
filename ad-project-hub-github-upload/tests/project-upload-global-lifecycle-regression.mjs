import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const detail = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(detail.includes("onOpenUpload"), "project detail should delegate uploads to the dashboard lifecycle");
assert(!detail.includes('import("./UploadDialog.jsx")'), "project detail must not own an upload dialog that disappears on unmount");
assert(!detail.includes("quickUploadMinimized") && !detail.includes("quickUploadType"), "project detail must not keep disposable background-task state");
assert(main.includes("onOpenUpload={openUpload}"), "dashboard should own project upload tasks across view changes");

console.log("project upload global lifecycle regression passed");
