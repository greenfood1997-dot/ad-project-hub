import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");

assert(source.includes("let migrationPromise;"), "PostgreSQL migration should be cached per service instance");
assert(source.includes("if (!migrationPromise)"), "concurrent requests should share one migration promise");
assert(source.includes("migrationPromise = undefined;"), "failed migrations should remain retryable after database recovery");

console.log("postgres migration once regression passed");
