import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/tencent-ocr.mjs", import.meta.url), "utf8");
const catchStart = source.indexOf("errors.push(`第${page}页");
const catchEnd = source.indexOf("if (texts.length)", catchStart);
const catchBlock = source.slice(catchStart, catchEnd);

assert(catchStart >= 0 && catchBlock.includes("continue;"), "failed OCR pages should continue to later pages");
assert(!catchBlock.includes("break;"), "one failed OCR page must not stop the remaining document");
assert(!catchBlock.includes("if (page === 1) throw"), "a failed cover page must not hide later settlement summaries");
assert(source.includes("pageErrors: errors"), "partial OCR failures should remain observable");
assert(source.includes("splitPdfIntoSinglePageBase64"), "PDF OCR should split the document before sending page requests");
assert(source.includes("pdfPages[page - 1]"), "each OCR request should contain only its single PDF page");

console.log("OCR page continuation regression passed");
