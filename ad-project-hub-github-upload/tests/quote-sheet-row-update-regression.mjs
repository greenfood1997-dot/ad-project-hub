import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
const start = api.indexOf('url.pathname === "/api/projects/quote-sheet"');
const end = api.indexOf('url.pathname === "/api/projects/verification-sheet"', start);
const route = api.slice(start, end);

assert(route.includes("persistProjectQuoteResult"), "quote confirmation should use targeted persistence");
assert(!route.includes("mutateDb("), "quote confirmation must not rewrite the database");
const writerStart = postgres.indexOf("export async function persistPostgresProjectQuoteResult");
const writerEnd = postgres.indexOf("export async function", writerStart + 30);
const writer = postgres.slice(writerStart, writerEnd < 0 ? undefined : writerEnd);
assert(writer.includes("update projects") && writer.includes("insertProjectFile("), "quote confirmation should update only its project and files");
assert(!writer.includes("delete from projects") && !writer.includes("delete from users"), "quote confirmation must not delete business tables");

console.log("quote sheet row update regression passed");
