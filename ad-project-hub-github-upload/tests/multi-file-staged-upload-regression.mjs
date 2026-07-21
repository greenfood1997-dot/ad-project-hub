import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dialog = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(dialog.includes("stageFilesForPreview") && dialog.includes("/api/projects/upload-file"), "files should be staged independently before batch preview");
assert(dialog.includes("/api/upload-batches") && dialog.includes("waitForUploadBatch"), "staged files should be parsed by a persistent background batch");
assert(dialog.includes("for (let index = 0; index < files.length; index += 1)"), "multi-file uploads should be processed one file at a time");
assert(dialog.includes("if (stagedFiles[key])"), "successfully staged files should be reused when retrying");
assert(dialog.includes("files.map((file) => stagedFiles[uploadedFileKey(file)] || file)"), "confirmation should reuse staged references instead of resending base64 files");
assert(main.includes("stageFilesForPreview") && main.includes("/api/projects/upload-file"), "production entry should use staged multi-file uploads");
assert(api.includes('url.pathname === "/api/projects/upload-file"'), "backend should expose the staged-file endpoint");
assert(services.includes("export async function stageProjectUploadFile"), "backend should normalize each staged file independently");
assert(services.includes("const { base64, dataUrl, ...reference } = file"), "staged-file responses must not send large base64 content back to the browser");
assert(services.includes("storagePath: file.storagePath"), "lightweight file references should retain durable storage locations");

console.log("multi-file staged upload regression passed");
