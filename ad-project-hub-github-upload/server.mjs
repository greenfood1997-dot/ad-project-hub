import { createServer } from "node:http";
import { host, port } from "./server/config.mjs";
import { handleApi } from "./server/api.mjs";
import { handleStatic } from "./server/static.mjs";
import { sendCorsPreflight, sendJson } from "./server/http-utils.mjs";

const server = createServer(async (req, res) => {
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
});

server.on("error", (error) => {
  console.error(`Failed to start Ad project hub on ${host}:${port}`);
  console.error(error);
  process.exit(1);
});

console.log(`Starting Ad project hub on ${host}:${port}`);
server.listen(port, host, () => {
  console.log(`Ad project hub running at http://${host}:${port}`);
});
