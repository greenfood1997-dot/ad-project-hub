import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const path of ["../src/UploadDialog.jsx", "../src/main.jsx"]) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  assert(source.includes("async function requestParsedPreview(parsedFiles)"), `${path} should isolate retryable preview generation`);
  assert(source.includes("数据库正在恢复") && source.includes("temporaryFailures >= 5"), `${path} should retry transient database recovery with a limit`);
  assert(source.includes("文件解析结果已保留，数据库短暂恢复中"), `${path} should tell users parsed files are preserved`);
  assert(source.includes("const data = await requestParsedPreview(parsedFiles)"), `${path} should reuse parsed files instead of creating another batch`);
}

console.log("frontend upload preview retry regression passed");
