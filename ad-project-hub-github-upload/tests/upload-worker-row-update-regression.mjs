import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../server/upload-batch-worker.mjs", import.meta.url), "utf8");
const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");

assert(worker.includes("mutateUploadBatch") && !worker.includes("mutateDb("), "upload worker should update only its batch row");
assert(postgres.includes("for update skip locked"), "workers should claim parse jobs with row locks");
assert(postgres.includes("update parse_jobs set status=$2") && !postgres.slice(postgres.indexOf("export async function mutateUploadBatchJob")).includes("delete from projects"), "batch updates must not rewrite business tables");

console.log("upload worker row update regression passed");
