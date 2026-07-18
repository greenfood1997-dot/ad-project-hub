import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(source.includes("mentionedBot") && source.includes("message.mentions"), "Feishu intake should distinguish explicit bot mentions from routine chat");
assert(source.includes("answerAiAssistant(db") && source.includes("selectedProjectId: project.id"), "mentioned questions should reuse the OA AI assistant with the bound project");
assert(source.includes("feishuScopedSnapshot(db, sender)"), "Feishu AI should use the sender's scoped OA data");
assert(source.includes("这项操作会修改 OA 数据，请到 OA 的 AI 助手中确认提交"), "write requests must not execute directly from Feishu in phase one");
assert(source.includes('action = "record-comment"'), "routine unmentioned chat should remain a silent project activity record");

console.log("Feishu AI brain regression passed");
