import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const feishu = await readFile(new URL("../server/approval-feishu-service.mjs", import.meta.url), "utf8");

assert(feishu.includes('msg_type: "interactive"') && feishu.includes('content: "通过"') && feishu.includes('content: "驳回"'), "approval notifications should use Feishu interactive cards");
assert(feishu.includes('action: "approval_action"') && feishu.includes("approvalId: approval.id"), "card buttons should carry only the approval action identity");
assert(feishu.includes("确认通过") && feishu.includes("确认驳回"), "both Feishu approval actions should require confirmation");
assert(feishu.includes("cardError") && feishu.includes("sendText"), "card delivery should fall back to text when interactive delivery fails");
assert(api.includes("approvalCardAction(body)") && api.includes("actOnApproval(db"), "public Feishu callback should reuse the OA approval engine");
assert(api.includes("未识别点击人的 OA 身份") && api.includes("feishuOpenId === cardAction.operatorOpenId"), "card clicks should map the Feishu operator to an active OA user");
assert(api.includes("card-${cardAction.action}") && api.includes("OA 已同步"), "card actions should audit and return synchronized feedback");

console.log("Feishu approval card regression passed");
