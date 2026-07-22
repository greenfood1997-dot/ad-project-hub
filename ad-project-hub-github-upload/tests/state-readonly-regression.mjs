import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const routeStart = api.indexOf('url.pathname === "/api/state"');
const routeEnd = api.indexOf('url.pathname === "/api/notifications/action"', routeStart);
const route = api.slice(routeStart, routeEnd);

assert(route.includes("scopedSnapshot(snapshot"), "state should use the request snapshot");
assert(!route.includes("mutateDb("), "state polling must not acquire the global PostgreSQL mutation lock");
assert(!route.includes("scanSystemNotifications("), "notification scanning belongs to the scheduler, not state polling");

console.log("state read-only regression passed");
