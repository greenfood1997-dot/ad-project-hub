import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
assert(source.includes('pool.on("error"') && source.includes("idle connection error"), "Postgres pool should handle idle connection errors without crashing Node");
assert(source.includes('db.on("error", onClientError)') && source.includes('db.off("error", onClientError)'), "transaction clients should safely handle connection errors");
console.log("postgres pool error regression passed");
