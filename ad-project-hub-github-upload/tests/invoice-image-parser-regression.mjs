import assert from "node:assert/strict";
import { extractInvoiceItems } from "../server/services.mjs";

const items = extractInvoiceItems([
  {
    name: "纸质发票-001.jpg",
    text: "增值税电子普通发票\n发票号码：12345678901234567890\n开票日期：2026年07月17日\n销售方名称：上海某某酒店有限公司\n住宿服务\n价税合计（小写） ￥1,280.50"
  },
  {
    name: "纸质发票-002.jpg",
    text: "电子发票\n发票号码：87654321098765432109\n销售方：某某出租汽车有限公司\n运输服务\n小写 ￥86.00"
  }
]);

assert.equal(items.length, 2, "两张发票图片应生成两条发票明细");
assert.equal(items.reduce((sum, item) => sum + item.amount, 0), 1366.5, "应汇总每张发票的价税合计");
assert.equal(items[0].invoiceNo, "12345678901234567890", "应识别发票号码");
assert.equal(items[0].category, "住宿", "酒店发票应归类为住宿");
assert.equal(items[1].category, "拍摄交通", "出租车发票应归类为拍摄交通");

console.log("invoice image parser regression passed");
