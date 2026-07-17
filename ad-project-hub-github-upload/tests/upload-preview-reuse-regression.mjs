import assert from "node:assert/strict";
import { confirmProjectUpload, previewProjectUpload } from "../server/services.mjs";

const user = { id: "u-sales", name: "销售" };
const db = {
  projects: [],
  parseJobs: [],
  auditLogs: [],
  settings: { storage: {}, aiService: {}, interestRate: {} },
  uploadPreviews: []
};
const file = {
  name: "contract.txt",
  type: "text/plain",
  size: 22,
  base64: Buffer.from("项目名称：复用预览项目\n合同金额：1870000元").toString("base64")
};

const preview = await previewProjectUpload(db, {
  type: "create-project",
  values: { "项目名称": "复用预览项目", "合同金额": "1870000" },
  files: [file]
}, user);

assert(preview.previewId, "预览应返回一次性 previewId");
assert.equal(db.uploadPreviews.length, 1, "预览结果应暂存供确认复用");
const storedText = db.uploadPreviews[0].files[0].text;
db.uploadPreviews[0].files[0].base64 = "not-valid-base64";

const result = await confirmProjectUpload(db, {
  previewId: preview.previewId,
  values: { "合同金额": "1870000" }
}, user);

assert.equal(result.project.contract, 1870000, "确认应采用人工确认的合同金额");
assert.equal(result.project.files[0].text, storedText, "确认应复用预览已提取文本");
await assert.rejects(
  () => confirmProjectUpload(db, { previewId: preview.previewId }, user),
  /已入库/,
  "同一预览不得重复入库"
);

console.log("upload preview reuse regression passed");
