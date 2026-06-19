import { createServer } from "node:http";
import { host, port } from "./server/config.mjs";
import { handleApi } from "./server/api.mjs";
import { handleStatic } from "./server/static.mjs";
import { sendCorsPreflight, sendJson } from "./server/http-utils.mjs";

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendCorsPreflight(res);
      return;
    }
    if (req.url.startsWith("/api/")) await handleApi(req, res);
    else await handleStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Ad project hub running at http://${host}:${port}`);
});
