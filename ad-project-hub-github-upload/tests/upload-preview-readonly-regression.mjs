import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const routeStart = api.indexOf('url.pathname === "/api/projects/upload-preview"');
const routeEnd = api.indexOf('url.pathname === "/api/projects/upload-file"', routeStart);
const route = api.slice(routeStart, routeEnd);

assert(route.includes("await previewProjectUpload(snapshot, body, user)"), "upload previews should use the request snapshot");
assert(!route.includes("mutateDb("), "upload previews must not acquire the global PostgreSQL mutation lock");

console.log("upload preview read-only regression passed");
