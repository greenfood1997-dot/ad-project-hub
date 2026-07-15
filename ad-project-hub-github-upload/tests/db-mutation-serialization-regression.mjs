import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(join(tmpdir(), "oa-db-queue-"));
await cp(new URL("../server", import.meta.url), join(dir, "server"), { recursive: true });
await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }));
const moduleUrl = pathToFileURL(join(dir, "server/db.mjs"));
const { mutateDb, readDb } = await import(moduleUrl.href);

const first = mutateDb(async (db) => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  db.comments.push({ id: "first" });
});
const second = mutateDb(async (db) => {
  db.comments.push({ id: "second" });
});
await Promise.all([first, second]);

let db = await readDb();
assert.deepEqual(db.comments.map((item) => item.id), ["first", "second"], "concurrent mutations must not overwrite each other");

await assert.rejects(() => mutateDb(() => { throw new Error("expected failure"); }), /expected failure/);
await mutateDb((next) => { next.comments.push({ id: "after-failure" }); });
db = JSON.parse(await readFile(join(dir, "data/db.json"), "utf8"));
assert.equal(db.comments.at(-1).id, "after-failure", "a failed mutation must not poison the write queue");

console.log("db mutation serialization regression passed");
