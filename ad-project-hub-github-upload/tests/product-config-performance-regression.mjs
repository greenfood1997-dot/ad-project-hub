import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../server/upload-batch-worker.mjs", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");

assert(worker.includes("const snapshot = await readDb()"), "idle upload worker should perform a read-only work check");
assert(worker.indexOf("if (!hasWork) return false") < worker.indexOf("mutateDb((db) => claimUploadBatch"), "idle worker must not rewrite the database");
assert(worker.includes("5000"), "worker polling should not hammer PostgreSQL every two seconds");
assert(api.indexOf("checked = await testAiSettings(candidate)") < api.indexOf("mutateDb((db) => saveSetting"), "AI connection tests must finish before acquiring the database write lock");

console.log("product config performance regression passed");
