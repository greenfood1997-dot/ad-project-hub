import assert from "node:assert/strict";
import { handleStatic } from "../server/static.mjs";

async function request(pathname) {
  const chunks = [];
  const response = {
    status: 0,
    headers: {},
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); }
  };
  await handleStatic({ url: pathname }, response);
  return { ...response, body: Buffer.concat(chunks) };
}

for (const pathname of ["/brand/company-logo-square.png", "/favicon.png"]) {
  const response = await request(pathname);
  assert.equal(response.status, 200, `${pathname} should be publicly served`);
  assert.equal(response.headers["content-type"], "image/png");
  assert(response.body.length > 1000, `${pathname} should return the image body`);
}

console.log("static brand assets regression passed");
