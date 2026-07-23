import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { extractPptxContent } from "../server/pptx-extraction-service.mjs";
import { extractVerificationItems, previewProjectUpload } from "../server/services.mjs";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(services.includes("extractPptVerificationSummary(rows)"), "PPT settlement summaries need a dedicated parser");
assert(services.includes('/内容制作\\s*￥?\\s*([\\d,.]+)/'), "content-production totals should tolerate PPT line breaks");
assert(services.includes("months[0]} 至 ${months[months.length - 1]"), "multi-month settlements should display their covered range");
assert(services.includes("const range = normalized.match"), "explicit service ranges should win over cover and upload dates");

const fixture = "/Users/greenfood/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/ainihyt_8911/msg/file/2026-07/附件三：雇者-纵横结算材料.pptx";
await access(fixture);
const buffer = await readFile(fixture);
const file = await extractPptxContent({
  name: "附件三：雇者-纵横结算材料.pptx",
  type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  buffer
});
const summary = extractVerificationItems([file]).summary;
assert.equal(summary.totalAmount, 392776.12, "the real settlement total should be recognized");
assert.deepEqual(summary.breakdown.map(({ type, amount }) => ({ type, amount })), [
  { type: "内容制作", amount: 329160 },
  { type: "账户运营维护", amount: 35100 },
  { type: "投放充值", amount: 28516.12 }
]);

const preview = await previewProjectUpload({
  projects: [{
    id: "P-REAL-PPT",
    name: "纵横项目",
    contract: 1870700,
    extractedFields: { revenueRecognition: { quoteRules: [], recognizedRevenue: 0, verificationRecords: [] } }
  }]
}, { type: "verification-sheet", id: "P-REAL-PPT", files: [file] }, { id: "U-TEST", name: "测试用户" });
assert.equal(preview.fields["确认收入"], 392776.12);
assert.equal(preview.fields["核销月份"], "2025-06 至 2025-08");
assert.equal(preview.canConfirm, true);
assert(!preview.warnings.some((warning) => warning.includes("未识别到核销条数或核销金额")));

console.log("ppt settlement summary regression passed");
