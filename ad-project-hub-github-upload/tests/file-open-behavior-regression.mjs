import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileDate, fileOpenMode, filePreviewUrl } from "../src/utils/format.js";

assert.equal(fileOpenMode({ name: "合同.pdf" }), "preview");
assert.equal(fileOpenMode({ name: "照片.png" }), "preview");
assert.equal(fileOpenMode({ name: "结算单.docx" }), "office-preview");
assert.equal(fileOpenMode({ name: "成本表.xlsx" }), "office-preview");
assert.equal(fileOpenMode({ name: "汇报材料.pptx" }), "office-preview");
assert(filePreviewUrl({ name: "成本表.xlsx", storageUrl: "https://storage.example/成本表.xlsx" }).startsWith("https://view.officeapps.live.com/op/view.aspx?src="));
assert.equal(filePreviewUrl({ name: "合同.pdf", storageUrl: "https://storage.example/合同.pdf" }), "https://storage.example/合同.pdf");
assert.equal(fileDate("invalid"), "时间待记录");
assert.notEqual(fileDate("2026-07-19T01:00:00.000Z"), "时间待记录");

const panel = await readFile(new URL("../src/ProjectFilesPanel.jsx", import.meta.url), "utf8");
const detail = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const storage = await readFile(new URL("../server/upload-storage-service.mjs", import.meta.url), "utf8");

assert(panel.includes("预览文件") && panel.includes("下载文件") && panel.includes("历史文件仅保留记录"));
assert(detail.includes('fetch("/api/files/download"') && detail.includes("请使用 WPS、Word 或 Excel 打开"));
assert(api.includes('url.pathname === "/api/files/download"') && api.includes("无权限下载该项目文件"));
assert(storage.includes('".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"'));

console.log("file open behavior regression passed");
