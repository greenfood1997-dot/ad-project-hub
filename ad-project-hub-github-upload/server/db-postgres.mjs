import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "./env.mjs";
import { defaultDb } from "./default-db.mjs";

let pool;

async function getPool() {
  if (pool) return pool;
  const pg = await import("pg");
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function migratePostgres() {
  const sqlPath = fileURLToPath(new URL("../db/schema.postgres.sql", import.meta.url));
  const sql = await readFile(sqlPath, "utf8");
  const db = await getPool();
  await db.query(sql);
}

export async function readPostgresDb() {
  await migratePostgres();
  const db = await getPool();
  const [
    users,
    settingsRows,
    projects,
    files,
    parseJobs,
    suppliers,
    alertUpdates,
    comments,
    auditLogs
  ] = await Promise.all([
    db.query("select id, name, role, department from users order by created_at asc"),
    db.query("select type, values from settings"),
    db.query(`select id, name, client, owner, contract::float,
      cost_budget::float as "costBudget", cost_used::float as "costUsed",
      paid::float, receivable::float, status, risk, ai_summary as "aiSummary",
      next_milestone as "nextMilestone", payment_due as "paymentDue",
      margin::float, tasks, costs, extracted_fields as "extractedFields",
      created_by as "createdBy", created_at as "createdAt"
      from projects order by created_at desc`),
    db.query("select project_id as \"projectId\", project_name as \"projectName\", name, size, mime_type as type, storage_url as \"storageUrl\", uploaded_at as \"uploadedAt\" from project_files order by uploaded_at desc"),
    db.query("select id, project_id as \"projectId\", project_name as \"projectName\", status, progress, steps, files, created_at as \"createdAt\", updated_at as \"updatedAt\" from parse_jobs order by created_at desc"),
    db.query("select supplier, project, type, amount::float, status from suppliers order by created_at desc"),
    db.query("select action, project, type, mentions, note, user_name as \"user\", created_at as at from alert_updates order by created_at desc"),
    db.query("select project, body, mentions, user_name as \"user\", created_at as at from comments order by created_at desc"),
    db.query("select type, target, action, user_name as \"user\", meta, created_at as at from audit_logs order by created_at desc")
  ]);

  const settings = { ...defaultDb.settings };
  settingsRows.rows.forEach((row) => {
    settings[row.type] = row.values;
  });

  return {
    users: users.rows,
    settings,
    projects: projects.rows.map((project) => ({
      ...project,
      files: files.rows.filter((file) => file.projectId === project.id)
    })),
    suppliers: suppliers.rows,
    files: files.rows,
    parseJobs: parseJobs.rows,
    alertUpdates: alertUpdates.rows,
    comments: comments.rows,
    auditLogs: auditLogs.rows
  };
}

export async function writePostgresDbFromSnapshot(snapshot) {
  await migratePostgres();
  const db = await getPool();
  await db.query("begin");
  try {
    await db.query("delete from audit_logs");
    await db.query("delete from comments");
    await db.query("delete from alert_updates");
    await db.query("delete from suppliers");
    await db.query("delete from parse_jobs");
    await db.query("delete from project_files");
    await db.query("delete from projects");
    await db.query("delete from settings");

    for (const [type, values] of Object.entries(snapshot.settings || {})) {
      if (values) {
        await db.query(
          "insert into settings (type, values, saved_by, saved_at) values ($1, $2, $3, $4)",
          [type, values, values.savedBy || null, values.savedAt || new Date().toISOString()]
        );
      }
    }

    for (const project of snapshot.projects || []) {
      await db.query(
        `insert into projects (
          id, name, client, owner, contract, cost_budget, cost_used, paid,
          receivable, status, risk, ai_summary, next_milestone, payment_due,
          margin, tasks, costs, extracted_fields, created_by, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          project.id,
          project.name,
          project.client,
          project.owner,
          project.contract || 0,
          project.costBudget || 0,
          project.costUsed || 0,
          project.paid || 0,
          project.receivable || 0,
          project.status,
          project.risk,
          project.aiSummary || "",
          project.nextMilestone || "",
          project.paymentDue || "",
          project.margin || 0,
          JSON.stringify(project.tasks || []),
          JSON.stringify(project.costs || []),
          JSON.stringify(project.extractedFields || {}),
          project.createdBy || null,
          project.createdAt || new Date().toISOString()
        ]
      );
      for (const file of project.files || []) {
        await db.query(
          "insert into project_files (project_id, project_name, name, size, mime_type, storage_url, uploaded_by, uploaded_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
          [project.id, project.name, file.name, file.size || 0, file.type || null, file.storageUrl || null, project.createdBy || null, file.uploadedAt || new Date().toISOString()]
        );
      }
    }

    for (const job of snapshot.parseJobs || []) {
      await db.query(
        "insert into parse_jobs (id, project_id, project_name, status, progress, steps, files, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [job.id, job.projectId, job.projectName, job.status, job.progress, JSON.stringify(job.steps || []), JSON.stringify(job.files || []), job.createdAt || new Date().toISOString(), job.updatedAt || new Date().toISOString()]
      );
    }

    for (const item of snapshot.suppliers || []) {
      await db.query(
        "insert into suppliers (supplier, project, type, amount, status) values ($1,$2,$3,$4,$5)",
        [item.supplier, item.project, item.type, item.amount || 0, item.status]
      );
    }

    for (const item of snapshot.alertUpdates || []) {
      await db.query(
        "insert into alert_updates (action, project, type, mentions, note, user_name, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [item.action, item.project, item.type, item.mentions, item.note, item.user, item.at || new Date().toISOString()]
      );
    }

    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
