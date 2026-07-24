import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { splitPdfIntoSinglePageBase64 } from "../server/tencent-ocr.mjs";

const fixturePath = process.env.OCR_PDF_FIXTURE;
if (!fixturePath) {
  console.log("OCR PDF page splitting regression skipped (set OCR_PDF_FIXTURE for the real-file check)");
  process.exit(0);
}

const pdf = await readFile(fixturePath);
const pages = await splitPdfIntoSinglePageBase64(pdf.toString("base64"), 70);
const largestRequestBytes = Math.max(...pages.map((page) => Buffer.byteLength(JSON.stringify({ ImageBase64: page }))));

assert.equal(pages.length, 70, "the 70-page settlement PDF should be split into 70 OCR requests");
assert(largestRequestBytes < 10 * 1024 * 1024, `largest single-page OCR request is ${largestRequestBytes} bytes`);
assert(largestRequestBytes < pdf.toString("base64").length, "single-page OCR requests must not resend the whole PDF");

console.log(`OCR PDF page splitting regression passed; largest request ${largestRequestBytes} bytes`);
