import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { rootDir } from "./config.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export async function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/standalone.html" : url.pathname;
  const filePath = join(rootDir, pathname.replace(/^\/+/, ""));
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
