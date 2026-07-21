import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractPptxContent, pptxInternals } from "../server/pptx-extraction-service.mjs";

assert.equal(pptxInternals.slideText("<a:t>结算&amp;核销</a:t><a:t>金额 1200 元</a:t>"), "结算&核销\n金额 1200 元");

const zip = new JSZip();
zip.file("ppt/slides/slide1.xml", '<p:sld><a:t>12月结算材料</a:t><a:t>申报金额 220209.52 元</a:t></p:sld>');
const base64 = await zip.generateAsync({ type: "base64" });
const result = await extractPptxContent({ name: "结算材料.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", base64 });

assert.equal(result.pageCount, 1);
assert.match(result.text, /12月结算材料/);
assert.match(result.text, /220209\.52/);
assert.equal(result.tableRows[0].sheetName, "PPT第1页");

console.log("pptx extraction regression passed");
