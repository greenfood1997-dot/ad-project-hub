import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apiRequest, downloadFile, fileToPayload, uploadedFileKey } from "../src/utils/api.js";

const files = [
  "src/main.jsx",
  "src/AdminShell.jsx",
  "src/ProjectDetail.jsx",
  "src/UploadDialog.jsx",
  "src/AiWorkspace.jsx",
  "src/ApprovalFunds.jsx",
  "src/CollectionAssistant.jsx",
  "src/ManagementCockpit.jsx",
  "src/SupplierLibrary.jsx",
  "src/ClientLibrary.jsx",
  "src/CloseoutReview.jsx"
];

assert.equal(typeof apiRequest, "function");
assert.equal(typeof downloadFile, "function");
assert.equal(typeof fileToPayload, "function");
assert.equal(typeof uploadedFileKey, "function");
assert.equal(uploadedFileKey({ name: "合同.pdf", size: 1870700, type: "application/pdf" }), "合同.pdf:1870700:application/pdf");
assert.equal(uploadedFileKey({}), ":0:");

for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert(!source.includes("async function apiRequest("), `${file} should import shared apiRequest`);
  assert(!source.includes("async function downloadFile("), `${file} should import shared downloadFile`);
  assert(!source.includes("function fileToPayload("), `${file} should import shared fileToPayload`);
  assert(!source.includes("function uploadedFileKey("), `${file} should import shared uploadedFileKey`);
}

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const adminShellSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const projectDetailSource = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const uploadSource = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const aiSource = await readFile(new URL("../src/AiWorkspace.jsx", import.meta.url), "utf8");
const supplierSource = await readFile(new URL("../src/SupplierLibrary.jsx", import.meta.url), "utf8");

assert(mainSource.includes('import { apiRequest } from "./utils/api.js";'), "main should use shared API helper");
assert(adminShellSource.includes('import { downloadFile } from "./utils/api.js";'), "admin shell should use shared download helper");
assert(projectDetailSource.includes('import { apiRequest, uploadedFileKey } from "./utils/api.js";'), "project detail should use shared request/upload key helpers");
assert(uploadSource.includes('import { apiRequest, uploadFileBinary, uploadedFileKey } from "./utils/api.js";'), "upload dialog should use shared binary upload helpers");
assert(aiSource.includes('import { apiRequest, fileToPayload } from "./utils/api.js";'), "AI workspace should use shared request/file helpers");
assert(supplierSource.includes('import { apiRequest, downloadFile } from "./utils/api.js";'), "supplier library should use shared request/download helpers");
assert(!mainSource.includes("apiRequest={apiRequest}") && !mainSource.includes("downloadFile={downloadFile}"), "supplier library should not receive duplicated helper props");

console.log("frontend api utils regression passed");
