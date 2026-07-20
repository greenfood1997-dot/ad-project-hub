import assert from "node:assert/strict";
import { readApiPayload } from "../src/utils/api.js";

const response = (body, contentType, status = 200) => ({ status, headers: { get: () => contentType }, text: async () => body });
assert.deepEqual(await readApiPayload(response('{"ok":true,"data":1}', "application/json; charset=utf-8")), { ok: true, data: 1 });
await assert.rejects(() => readApiPayload(response("<!DOCTYPE html><title>Render error</title>", "text/html", 502)), /OA 服务正在重启/);
await assert.rejects(() => readApiPayload(response("not-json", "application/json")), /服务暂时不可用/);
console.log("api html response regression passed");
