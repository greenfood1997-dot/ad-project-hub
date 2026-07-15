import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { rootDir } from "./config.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

export async function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/"
    ? "/dist/index.html"
    : url.pathname.startsWith("/assets/")
      ? `/dist${url.pathname}`
      : url.pathname;
  if (url.pathname.startsWith("/uploads/")) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Local uploads are not publicly accessible");
    return;
  }
  const filePath = join(rootDir, decodeURIComponent(pathname).replace(/^\/+/, ""));
  try {
    const content = await readFile(filePath);
    const isEntry = url.pathname === "/" || url.pathname.endsWith(".html");
    res.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": isEntry ? "no-store" : "public, max-age=31536000, immutable"
    });
    res.end(content);
  } catch {
    if (url.pathname === "/") {
      const fallback = await readFile(join(rootDir, "standalone.html"));
      res.writeHead(200, { "content-type": mime[".html"], "cache-control": "no-store" });
      res.end(fallback);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}
