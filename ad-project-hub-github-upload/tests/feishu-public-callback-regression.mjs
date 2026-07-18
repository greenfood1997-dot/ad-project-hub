import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/api.mjs", import.meta.url), "utf8");
const callback = source.indexOf('url.pathname === "/api/integrations/feishu/events"');
const authentication = source.indexOf("const user = getCurrentUser(req, snapshot)");
const databaseRead = source.indexOf("const snapshot = await readDb()");

assert(callback >= 0, "Feishu callback route should exist");
assert(authentication >= 0, "OA authentication gate should exist");
assert(callback < authentication, "Feishu callback must be reachable before OA login authentication");
assert(callback < databaseRead, "Feishu URL verification must be handled before database reads to meet the 3-second deadline");
assert(source.includes("if (body?.challenge)") && source.includes("sendJson(res, 200, { challenge: body.challenge })"), "callback should return Feishu challenge directly");

console.log("Feishu public callback regression passed");
