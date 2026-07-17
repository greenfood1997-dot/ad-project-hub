import assert from "node:assert/strict";
import { deduplicateTencentOcr } from "../server/tencent-ocr.mjs";

let calls = 0;
let release;
const pending = new Promise((resolve) => { release = resolve; });
const recognize = async () => {
  calls += 1;
  await pending;
  return { text: "同一份识别结果", tableRows: [] };
};

const first = deduplicateTencentOcr("same-file", recognize);
const second = deduplicateTencentOcr("same-file", recognize);
await Promise.resolve();
assert.equal(calls, 1, "同一文件的并发请求只能调用一次 OCR");

release();
assert.deepEqual(await first, await second, "并发请求应共享同一识别结果");
assert.deepEqual(
  await deduplicateTencentOcr("same-file", recognize),
  { text: "同一份识别结果", tableRows: [] },
  "完成后的重复请求应复用短期缓存"
);
assert.equal(calls, 1, "缓存命中不得再次调用 OCR");

console.log("OCR deduplication regression passed");
