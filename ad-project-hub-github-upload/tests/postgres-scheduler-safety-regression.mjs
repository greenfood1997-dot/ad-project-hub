import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile(new URL("../server/scheduler.mjs", import.meta.url), "utf8");
const start = scheduler.indexOf("export async function startSystemScheduler");
const end = scheduler.indexOf("export async function reloadSystemScheduler", start);
const startup = scheduler.slice(start, end);

assert(startup.includes('dbMode() === "postgres"'), "PostgreSQL must use the scheduler safety gate");
assert(startup.indexOf('dbMode() === "postgres"') < startup.indexOf("setInterval(runScheduledScan"), "safety gate must run before any timer starts");
assert(startup.includes("status.enabled = false"), "unsafe PostgreSQL scheduler must stay disabled");

console.log("postgres scheduler safety regression passed");
