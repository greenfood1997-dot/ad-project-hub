import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { readJsonDb, writeJsonDb } from "../server/db-json.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await writeFile(dbFile, '{"projects": []}    ]');
  const recovered = await readJsonDb();
  assert(Array.isArray(recovered.projects), "readJsonDb should recover to a readable project list");
  assert(recovered.users?.length, "readJsonDb should restore default users after corrupt JSON");

  const filesAfterRecovery = await readdir("data");
  assert(filesAfterRecovery.some((name) => name.startsWith("db.json.corrupt-")), "corrupt JSON should be backed up before reset");

  await writeJsonDb({ ...recovered, projects: [{ id: "p-json-safe", name: "JSON 原子写入验证" }] });
  const saved = JSON.parse(await readFile(dbFile, "utf8"));
  assert(saved.projects?.[0]?.id === "p-json-safe", "writeJsonDb should save valid JSON through an atomic replacement");
  const filesAfterWrite = await readdir("data");
  assert(!filesAfterWrite.some((name) => name.startsWith("db.json.tmp-")), "writeJsonDb should not leave tmp files behind");

  console.log("json db resilience regression passed");
} finally {
  const names = await readdir("data").catch(() => []);
  await Promise.all(names.filter((name) => name.startsWith("db.json.corrupt-") || name.startsWith("db.json.tmp-")).map((name) => rm(`data/${name}`, { force: true })));
  await writeFile(dbFile, originalDb || "{}");
}
