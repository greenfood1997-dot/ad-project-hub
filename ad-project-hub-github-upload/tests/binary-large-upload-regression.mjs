import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const storage = await readFile(new URL("../server/upload-storage-service.mjs", import.meta.url), "utf8");

assert(api.includes("readRawBody") && api.includes("buffer: await readRawBody(req)"), "large uploads should enter the server as binary buffers");
assert(dialog.includes("const payloads = picked") && dialog.includes("uploadFileBinary(file"), "upload dialog should retain native files and upload them as binary");
assert(main.includes("async function uploadFileBinary") && main.includes('body: file'), "production entry should send the native file body");
assert(storage.includes("Buffer.isBuffer(file.buffer)"), "storage should persist binary upload buffers without base64 conversion");

console.log("binary large upload regression passed");
