import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(source.includes("async function sendFeishuChatMessage"), "Feishu intake should support replying to a group chat");
assert(source.includes("receive_id_type=chat_id"), "group replies should target the event chat_id");
assert(source.includes("event.chatId && shouldReply") && source.includes("await sendFeishuChatMessage(db.settings?.feishu || {}, event.chatId, reply)"), "only actionable events should send the generated OA reply back to Feishu");
assert(source.includes("record.replyDelivery = { ok: false"), "reply failures should be visible in the OA event record");
assert(source.includes("普通文字消息静默记录，避免群聊刷屏"), "ordinary project chat should be recorded silently");

console.log("Feishu group reply regression passed");
