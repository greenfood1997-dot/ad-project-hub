import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPresignedUpload } from "../server/upload-storage-service.mjs";

const settings = {
  provider: "s3",
  bucket: "oa-files-1234567890",
  endpoint: "https://cos.ap-guangzhou.myqcloud.com",
  region: "ap-guangzhou",
  accessKeyId: "test-id",
  secretAccessKey: "test-secret",
  pathPrefix: "ad-project-hub"
};
const signed = createPresignedUpload({ id: "F-1", name: "核销材料.pptx" }, "verification-sheet", settings);
assert.match(signed.uploadUrl, /^https:\/\/oa-files-1234567890\.cos\.ap-guangzhou\.myqcloud\.com\//);
assert.match(signed.uploadUrl, /X-Amz-Signature=/);
assert.match(signed.objectKey, /^ad-project-hub\//);

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const batch = await readFile(new URL("../server/upload-batch-service.mjs", import.meta.url), "utf8");
assert(api.includes('url.pathname === "/api/uploads/presign"'), "API should expose authorized presigning");
assert(dialog.includes("uploadFileDirect(file") && main.includes("uploadFileDirect(file"), "both upload entries should prefer direct COS upload");
assert(batch.includes("downloadStoredObject(file, settings)"), "private COS files should be downloaded with server credentials");

console.log("COS direct upload regression passed");
