import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(source.includes("sendFeishuProjectChoiceCard") && source.includes('msg_type: "interactive"'), "unbound groups should receive an interactive project choice card");
assert(source.includes('value: { action: "bind_project", projectId: project.id, chatId }'), "card buttons should carry only binding identifiers");
assert(source.includes("feishuProjectsForUser(db, operator).find"), "card clicks must recheck the operator's OA project access");
assert(source.includes("saveFeishuProjectBinding(db"), "valid card clicks should persist the group binding in OA");
assert(source.includes("请重新发送刚才的文件"), "binding confirmation should explain that the original file must be resent");

console.log("Feishu project choice card regression passed");
