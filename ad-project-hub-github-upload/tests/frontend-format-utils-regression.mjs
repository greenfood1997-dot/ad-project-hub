import assert from "node:assert/strict";
import { csvCell, daysFromNow, fileSize, money } from "../src/utils/format.js";

assert.equal(money(0), "¥0.00");
assert.equal(money(99999), "¥99,999.00");
assert.equal(money(100000), "¥100,000.00");
assert.equal(money(1870700), "¥1,870,700.00");
assert.equal(money(754553.29), "¥754,553.29");
assert.equal(money(-125000.5), "¥-125,000.50");
assert.equal(money("invalid"), "¥0.00");

assert.equal(fileSize(0), "0 B");
assert.equal(fileSize(512), "512 B");
assert.equal(fileSize(1536), "1.5 KB");
assert.equal(fileSize(2 * 1024 * 1024), "2 MB");

assert.equal(csvCell(null), '""');
assert.equal(csvCell("客户A"), '"客户A"');
assert.equal(csvCell('他说"确认"'), '"他说""确认"""');
assert.equal(csvCell("第一行\n第二行"), '"第一行\n第二行"');

const date = daysFromNow(0);
assert.match(date, /^\d{4}-\d{2}-\d{2}$/);

console.log("frontend format utils regression passed");
