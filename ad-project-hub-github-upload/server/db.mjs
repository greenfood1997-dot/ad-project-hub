import "./env.mjs";
import { readJsonDb, writeJsonDb } from "./db-json.mjs";

const usePostgres = Boolean(process.env.DATABASE_URL);
let mutationQueue = Promise.resolve();

async function getPostgres() {
  return await import("./db-postgres.mjs");
}

export async function readDb() {
  if (!usePostgres) return await readJsonDb();
  const { readPostgresDb } = await getPostgres();
  return await readPostgresDb();
}

export async function writeDb(db) {
  if (!usePostgres) {
    await writeJsonDb(db);
    return;
  }
  const { writePostgresDbFromSnapshot } = await getPostgres();
  await writePostgresDbFromSnapshot(db);
}

export async function mutateDb(mutator) {
  const run = mutationQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
  mutationQueue = run.catch(() => undefined);
  return await run;
}

export function dbMode() {
  return usePostgres ? "postgres" : "json";
}
