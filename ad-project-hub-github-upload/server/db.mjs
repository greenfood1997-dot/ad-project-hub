import "./env.mjs";
import { readJsonDb, writeJsonDb } from "./db-json.mjs";

const usePostgres = Boolean(process.env.DATABASE_URL);

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
  const db = await readDb();
  const result = await mutator(db);
  await writeDb(db);
  return result;
}

export function dbMode() {
  return usePostgres ? "postgres" : "json";
}
