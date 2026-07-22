import "./env.mjs";
import { readJsonDb, writeJsonDb } from "./db-json.mjs";
import { retryTransientDatabase } from "./database-errors.mjs";

const usePostgres = Boolean(process.env.DATABASE_URL);
let mutationQueue = Promise.resolve();

async function getPostgres() {
  return await import("./db-postgres.mjs");
}

export async function readDb() {
  if (!usePostgres) return await readJsonDb();
  const { readPostgresDb } = await getPostgres();
  return await retryTransientDatabase(() => readPostgresDb());
}

export async function writeDb(db) {
  if (!usePostgres) {
    await writeJsonDb(db);
    return;
  }
  const { writePostgresDbFromSnapshot } = await getPostgres();
  await retryTransientDatabase(() => writePostgresDbFromSnapshot(db));
}

export async function mutateDb(mutator) {
  const run = mutationQueue.then(async () => {
    if (usePostgres) {
      const { mutatePostgresDb } = await getPostgres();
      // Do not replay the business callback: it may already have called OCR, AI, or notifications.
      return await mutatePostgresDb(mutator);
    }
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
  mutationQueue = run.catch(() => undefined);
  return await run;
}

export async function mutateUploadBatch(selectJob, mutateJob) {
  if (usePostgres) {
    const { mutateUploadBatchJob } = await getPostgres();
    return await retryTransientDatabase(() => mutateUploadBatchJob(selectJob, mutateJob));
  }
  return await mutateDb((db) => {
    const job = (db.parseJobs || []).find(selectJob);
    return job ? mutateJob(job) : null;
  });
}

export async function insertUploadBatch(job) {
  if (usePostgres) {
    const { insertPostgresUploadBatch } = await getPostgres();
    return await retryTransientDatabase(() => insertPostgresUploadBatch(job));
  }
  return await mutateDb((db) => {
    db.parseJobs = db.parseJobs || [];
    db.parseJobs.unshift(job);
    return job;
  });
}

export async function persistProjectQuoteResult(result, parserSkills = []) {
  if (usePostgres) {
    const { persistPostgresProjectQuoteResult } = await getPostgres();
    return await retryTransientDatabase(() => persistPostgresProjectQuoteResult(result, parserSkills));
  }
  return await mutateDb((db) => {
    const index = (db.projects || []).findIndex((item) => item.id === result.project.id);
    if (index < 0) throw new Error("项目不存在");
    db.projects[index] = result.project;
    db.files.unshift({ files: result.files, projectId: result.project.id, projectName: result.project.name, type: "quote-sheet", user: result.userName, at: result.at });
    db.settings.parserSkills = parserSkills;
    db.auditLogs.unshift({ type: "upload", target: result.project.name, action: "quote-sheet", user: result.userName, meta: { count: result.files.length }, at: result.at });
    return result;
  });
}

export function dbMode() {
  return usePostgres ? "postgres" : "json";
}
