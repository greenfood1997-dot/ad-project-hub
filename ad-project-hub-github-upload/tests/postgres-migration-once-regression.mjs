import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");

assert(source.includes("let migrationPromise;"), "PostgreSQL migration should be cached per service instance");
assert(source.includes("if (!migrationPromise)"), "concurrent requests should share one migration promise");
assert(source.includes("migrationPromise = undefined;"), "failed migrations should remain retryable after database recovery");
assert(source.includes("update projects set receivable") && source.includes("recognizedRevenue"), "startup migration should backfill receivables from recognized revenue");
assert(source.includes("latest_cost_snapshot") && source.includes("costSnapshotRepairVersion"), "startup migration should repair previously duplicated annual cost snapshots");
assert(source.includes("p.cost_used > s.snapshot_total"), "cost repair must only reduce projects whose persisted total exceeds the parsed snapshot");
assert(source.includes("const normalizedProjects") && source.includes("calculatedReceivable"), "reads should calculate receivable from existing verification data");

console.log("postgres migration once regression passed");
