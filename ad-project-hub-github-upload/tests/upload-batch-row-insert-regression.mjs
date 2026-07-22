import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
const start = api.indexOf('url.pathname === "/api/upload-batches"');
const end = api.indexOf('url.pathname.startsWith("/api/upload-batches/")', start);
const route = api.slice(start, end);

assert(route.includes("insertUploadBatch(job)"), "batch creation should use a dedicated insert");
assert(!route.includes("mutateDb("), "batch creation must not rewrite the database");
assert(postgres.includes("insertPostgresUploadBatch") && postgres.includes("insert into parse_jobs"), "PostgreSQL should insert only the batch row");

console.log("upload batch row insert regression passed");
