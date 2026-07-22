import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const routeStart = api.indexOf('url.pathname === "/api/projects/upload-file"');
const routeEnd = api.indexOf('url.pathname === "/api/upload-batches"', routeStart);
const route = api.slice(routeStart, routeEnd);

assert(route.includes("await stageProjectUploadFile(snapshot, body, user)"), "large file staging should use the read snapshot only");
assert(!route.includes("mutateDb((db) => stageProjectUploadFile"), "large file and object-storage I/O must not hold the PostgreSQL write lock");

console.log("upload staging outside DB lock regression passed");
