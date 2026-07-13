import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { explainUploadError } from "../src/utils/uploadErrors.js";

assert.equal(explainUploadError("未检测到 AI Key").title, "AI 接入还没配好");
assert.equal(explainUploadError("model 404").title, "AI 服务地址或模型不匹配");
assert.equal(explainUploadError("timeout").title, "AI/OCR 连接超时");
assert.equal(explainUploadError("Payload too large 413").title, "文件太大，服务端没完整接收");
assert.equal(explainUploadError("扫描件未提取到可解析文本").title, "扫描件需要 OCR");
assert.equal(explainUploadError("403 无权限").title, "当前账号没有这个操作权限");
assert.equal(explainUploadError(new Error("未知错误")).title, "这次识别没有完成");
assert(explainUploadError("Payload too large 413").next.includes("40MB 以下"));
assert(explainUploadError("扫描件").next.includes("TENCENT_SECRET_ID"));

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const uploadSource = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");

assert(uploadSource.includes('import { explainUploadError } from "./utils/uploadErrors.js";'), "upload dialog should import shared upload error guidance");
assert(!mainSource.includes("function explainUploadError("), "main should not redefine upload error guidance");
assert(!uploadSource.includes("function explainUploadError("), "upload dialog should not redefine upload error guidance");

console.log("frontend upload errors regression passed");
