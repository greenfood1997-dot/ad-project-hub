import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/api.mjs", import.meta.url), "utf8");
const callback = source.indexOf('url.pathname === "/api/integrations/feishu/events"');
const authentication = source.indexOf("const user = getCurrentUser(req, snapshot)");

assert(callback >= 0, "Feishu callback route should exist");
assert(authentication >= 0, "OA authentication gate should exist");
assert(callback < authentication, "Feishu callback must be reachable before OA login authentication");
assert(source.includes("if (data.challenge) sendJson(res, 200, { challenge: data.challenge })"), "callback should return Feishu challenge directly");

console.log("Feishu public callback regression passed");
