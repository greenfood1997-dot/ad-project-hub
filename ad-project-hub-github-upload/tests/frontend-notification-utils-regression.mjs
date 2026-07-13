import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { notificationPriorityQueue, parseNoticeAmount } from "../src/utils/notifications.js";

assert.equal(parseNoticeAmount("待回款 107.07万"), 1070700);
assert.equal(parseNoticeAmount("供应商待付 130,000元"), 130000);
assert.equal(parseNoticeAmount("无金额"), 0);

const now = new Date("2026-07-10T08:00:00.000Z").getTime();
const items = [
  {
    id: "low-1",
    type: "collection-follow-up",
    severity: "中",
    title: "客户跟进",
    text: "今天确认回款资料",
    createdAt: "2026-07-10T07:00:00.000Z"
  },
  {
    id: "cash-1",
    type: "company-cash-runway",
    severity: "高",
    title: "现金流危险",
    text: "公司现金流低于 3 个月",
    createdAt: "2026-07-10T07:00:00.000Z"
  },
  {
    id: "money-1",
    type: "project-receivable-risk",
    severity: "中",
    title: "捷途项目待回款",
    text: "待回款 107.07万，需要销售跟进",
    createdAt: "2026-07-09T08:00:00.000Z"
  },
  {
    id: "old-1",
    type: "feishu-pending-file",
    severity: "低",
    title: "飞书文件待确认",
    text: "项目群文件未确认",
    createdAt: "2026-07-07T08:00:00.000Z"
  }
];

const queue = notificationPriorityQueue(items, now);
assert.equal(queue.length, 3);
assert.equal(queue[0].item.id, "money-1");
assert.equal(queue[0].amount, 1070700);
assert.equal(queue[0].reason, "金额压力 107.07万");
assert.equal(queue[1].item.id, "cash-1");
assert.equal(queue[1].reason, "高优先级");
assert.equal(queue[2].item.id, "old-1");
assert.equal(queue[2].ageHours, 72);
assert.equal(queue[2].reason, "已等待 72 小时");

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
assert(mainSource.includes('import { notificationPriorityQueue } from "./utils/notifications.js";'), "main should import shared notification queue helper");
assert(!mainSource.includes("function parseNoticeAmount("), "main should not redefine parseNoticeAmount");
assert(!mainSource.includes("function notificationPriorityQueue("), "main should not redefine notificationPriorityQueue");

console.log("frontend notification utils regression passed");
