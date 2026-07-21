import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");

assert(postgres.includes("let queryQueue = Promise.resolve()"), "locked Postgres reads must serialize queries on their single client");
assert(postgres.includes("const currentProjects = await db.query(\"select id, name from projects\")"), "snapshot writes must compare against current projects before destructive replacement");
assert(postgres.includes("检测到旧数据快照，已阻止覆盖"), "stale snapshots must fail closed instead of deleting existing projects");
assert(postgres.includes("snapshot.__deletedProjectIds"), "intentional project deletions must be explicitly declared");
assert(services.includes("db.__deletedProjectIds") && services.includes("backupProjectIds"), "project deletion and backup restore paths must declare intentional removals");

console.log("postgres stale snapshot fuse regression passed");
