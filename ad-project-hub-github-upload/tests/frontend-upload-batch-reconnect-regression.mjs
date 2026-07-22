import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const path of ["../src/UploadDialog.jsx", "../src/main.jsx"]) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  assert(source.includes("let temporaryFailures = 0"), `${path} should track temporary polling failures`);
  assert(source.includes("服务短暂恢复中，后台任务仍保留"), `${path} should explain automatic recovery`);
  assert(source.includes("temporaryFailures += 1") && source.includes("continue;"), `${path} should retry the same persistent batch`);
}

console.log("frontend upload batch reconnect regression passed");
