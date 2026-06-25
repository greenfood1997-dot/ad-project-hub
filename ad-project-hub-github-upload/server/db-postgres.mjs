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
    clientProfiles,
    files,
    parseJobs,
    suppliers,
    supplierProfiles,
    approvals,
    payments,
    collectionScripts,
    feishuProjectBindings,
    feishuEvents,
    feishuPendingFiles,
    systemNotifications,
    alertUpdates,
    comments,
    auditLogs
  ] = await Promise.all([
    db.query(`select id, name, email, role, department, status, pin,
      feishu_open_id as "feishuOpenId", feishu_user_id as "feishuUserId",
      feishu_name as "feishuName", created_at as "createdAt"
      from users order by created_at asc`),
    db.query("select type, values from settings"),
    db.query(`select id, name, client, owner, contract::float,
      cost_budget::float as "costBudget", cost_used::float as "costUsed",
      paid::float, receivable::float, status, risk, ai_summary as "aiSummary",
      next_milestone as "nextMilestone", payment_due as "paymentDue",
      margin::float, tasks, costs, alerts, extracted_fields as "extractedFields",
      created_by as "createdBy", created_at as "createdAt"
      from projects order by created_at desc`),
    db.query("select client, likes, dislikes, pitfalls, handoff_note as \"handoffNote\", contact_style as \"contactStyle\", updated_at as \"updatedAt\" from client_profiles order by updated_at desc"),
    db.query("select project_id as \"projectId\", project_name as \"projectName\", name, size, mime_type as type, storage_url as \"storageUrl\", data_url as \"dataUrl\", category, uploaded_at as \"uploadedAt\" from project_files order by uploaded_at desc"),
    db.query(`select id, project_id as "projectId", project_name as "projectName",
      status, progress, steps, files, source_values as "sourceValues",
      extracted_fields as "extractedFields", created_at as "createdAt",
      updated_at as "updatedAt" from parse_jobs order by created_at desc`),
    db.query("select supplier, project, type, amount::float, status from suppliers order by created_at desc"),
    db.query("select supplier, market, contact, note, ratings, updated_at as \"updatedAt\" from supplier_profiles order by updated_at desc"),
    db.query(`select id, type, type_label as "typeLabel", project_id as "projectId",
      project_name as "projectName", amount::float, reason, payee, category,
      status, current_role as "currentRole", applicant_id as "applicantId",
      applicant_name as "applicantName", applicant_role as "applicantRole",
      steps, logs, applied_at as "appliedAt", completed_at as "completedAt",
      completed_by as "completedBy", created_at as "createdAt", updated_at as "updatedAt"
      from approvals order by created_at desc`),
    db.query(`select id, project_id as "projectId", project_name as "projectName",
      client, amount::float, payer, method, note, received_at as "receivedAt",
      recorded_by as "recordedBy", recorded_by_name as "recordedByName",
      created_at as "createdAt" from payments order by received_at desc, created_at desc`),
    db.query(`select id, project_id as "projectId", project_name as "projectName",
      client, sales_id as "salesId", sales_name as "salesName", style, tone,
      amount::float, payment_due as "paymentDue", script, reason, outcome,
      success, score::float, created_at as "createdAt", updated_at as "updatedAt"
      from collection_scripts order by created_at desc`),
    db.query(`select chat_id as "chatId", chat_name as "chatName",
      project_id as "projectId", project_name as "projectName",
      bound_by as "boundBy", bound_at as "boundAt", updated_at as "updatedAt"
      from feishu_project_bindings order by updated_at desc`),
    db.query(`select id, event_id as "eventId", chat_id as "chatId",
      chat_name as "chatName", sender_id as "senderId", sender_name as "senderName",
      message_type as "messageType", text, file_name as "fileName", file_key as "fileKey",
      project_id as "projectId", project_name as "projectName", action, status, reply,
      created_at as "createdAt" from feishu_events order by created_at desc`),
    db.query(`select id, event_id as "eventId", chat_id as "chatId",
      chat_name as "chatName", sender_id as "senderId", sender_name as "senderName",
      project_id as "projectId", project_name as "projectName", upload_type as "uploadType",
      file, preview, status, note, created_at as "createdAt",
      handled_at as "handledAt", handled_by as "handledBy"
      from feishu_pending_files order by created_at desc`),
    db.query(`select id, notice_key as key, type, title, body as text,
      severity, role, recipients, project_id as "projectId",
      project_name as "projectName", source, source_id as "sourceId",
      action_label as "actionLabel", action_view as "actionView",
      status, note, feishu_delivery as "feishuDelivery",
      created_at as "createdAt", updated_at as "updatedAt",
      handled_at as "handledAt", handled_by as "handledBy",
      handled_by_name as "handledByName"
      from system_notifications order by created_at desc`),
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
    clientProfiles: clientProfiles.rows,
    suppliers: suppliers.rows,
    supplierProfiles: supplierProfiles.rows,
    approvals: approvals.rows,
    payments: payments.rows,
    collectionScripts: collectionScripts.rows,
    feishuProjectBindings: feishuProjectBindings.rows,
    feishuEvents: feishuEvents.rows,
    feishuPendingFiles: feishuPendingFiles.rows,
    systemNotifications: systemNotifications.rows,
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
      await db.query("delete from system_notifications");
      await db.query("delete from feishu_pending_files");
    await db.query("delete from feishu_events");
    await db.query("delete from feishu_project_bindings");
    await db.query("delete from collection_scripts");
    await db.query("delete from payments");
    await db.query("delete from approvals");
    await db.query("delete from comments");
    await db.query("delete from alert_updates");
    await db.query("delete from supplier_profiles");
    await db.query("delete from suppliers");
    await db.query("delete from parse_jobs");
    await db.query("delete from project_files");
    await db.query("delete from client_profiles");
    await db.query("delete from projects");
    await db.query("delete from settings");
    await db.query("delete from users");

    for (const user of snapshot.users || defaultDb.users) {
      await db.query(
        `insert into users (
          id, name, email, role, department, status, pin,
          feishu_open_id, feishu_user_id, feishu_name, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          user.id,
          user.name,
          user.email || `${user.id}@company.local`,
          user.role,
          user.department || "",
          user.status || "active",
          user.pin || "123456",
          user.feishuOpenId || "",
          user.feishuUserId || "",
          user.feishuName || user.name || "",
          user.createdAt || new Date().toISOString()
        ]
      );
    }

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
          margin, tasks, costs, alerts, extracted_fields, created_by, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
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
          JSON.stringify(project.alerts || []),
          JSON.stringify(project.extractedFields || {}),
          project.createdBy || null,
          project.createdAt || new Date().toISOString()
        ]
      );
      for (const file of project.files || []) {
        await db.query(
          "insert into project_files (project_id, project_name, name, size, mime_type, storage_url, data_url, category, uploaded_by, uploaded_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [project.id, project.name, file.name, file.size || 0, file.type || null, file.storageUrl || null, file.dataUrl || null, file.category || null, file.uploadedBy || project.createdBy || null, file.uploadedAt || new Date().toISOString()]
        );
      }
    }

    for (const item of snapshot.clientProfiles || []) {
      await db.query(
        "insert into client_profiles (client, likes, dislikes, pitfalls, handoff_note, contact_style, updated_at) values ($1,$2,$3,$4,$5,$6,$7)",
        [
          item.client,
          JSON.stringify(item.likes || []),
          JSON.stringify(item.dislikes || []),
          JSON.stringify(item.pitfalls || []),
          item.handoffNote || "",
          item.contactStyle || "",
          item.updatedAt || new Date().toISOString()
        ]
      );
    }

    for (const job of snapshot.parseJobs || []) {
      await db.query(
        "insert into parse_jobs (id, project_id, project_name, status, progress, steps, files, source_values, extracted_fields, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          job.id,
          job.projectId,
          job.projectName,
          job.status,
          job.progress,
          JSON.stringify(job.steps || []),
          JSON.stringify(job.files || []),
          JSON.stringify(job.sourceValues || {}),
          JSON.stringify(job.extractedFields || {}),
          job.createdAt || new Date().toISOString(),
          job.updatedAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.suppliers || []) {
      await db.query(
        "insert into suppliers (supplier, project, type, amount, status) values ($1,$2,$3,$4,$5)",
        [item.supplier, item.project, item.type, item.amount || 0, item.status]
      );
    }

    for (const item of snapshot.supplierProfiles || []) {
      await db.query(
        "insert into supplier_profiles (supplier, market, contact, note, ratings, updated_at) values ($1,$2,$3,$4,$5,$6)",
        [item.supplier, item.market || "", item.contact || "", item.note || "", JSON.stringify(item.ratings || []), item.updatedAt || new Date().toISOString()]
      );
    }

    for (const item of snapshot.approvals || []) {
      await db.query(
        `insert into approvals (
          id, type, type_label, project_id, project_name, amount, reason, payee,
          category, status, current_role, applicant_id, applicant_name, applicant_role,
          steps, logs, applied_at, completed_at, completed_by, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          item.id,
          item.type,
          item.typeLabel,
          item.projectId,
          item.projectName,
          item.amount || 0,
          item.reason || "",
          item.payee || "",
          item.category || "",
          item.status,
          item.currentRole || "",
          item.applicantId || null,
          item.applicantName || "",
          item.applicantRole || "",
          JSON.stringify(item.steps || []),
          JSON.stringify(item.logs || []),
          item.appliedAt || null,
          item.completedAt || null,
          item.completedBy || null,
          item.createdAt || new Date().toISOString(),
          item.updatedAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.payments || []) {
      await db.query(
        `insert into payments (
          id, project_id, project_name, client, amount, payer, method, note,
          received_at, recorded_by, recorded_by_name, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          item.id,
          item.projectId,
          item.projectName,
          item.client || "",
          item.amount || 0,
          item.payer || "",
          item.method || "",
          item.note || "",
          item.receivedAt || new Date().toISOString(),
          item.recordedBy || null,
          item.recordedByName || "",
          item.createdAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.collectionScripts || []) {
      await db.query(
        `insert into collection_scripts (
          id, project_id, project_name, client, sales_id, sales_name, style, tone,
          amount, payment_due, script, reason, outcome, success, score, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          item.id,
          item.projectId,
          item.projectName || "",
          item.client || "",
          item.salesId || null,
          item.salesName || "",
          item.style || "",
          item.tone || "",
          item.amount || 0,
          item.paymentDue || "",
          item.script || "",
          item.reason || "",
          item.outcome || "",
          typeof item.success === "boolean" ? item.success : null,
          item.score || null,
          item.createdAt || new Date().toISOString(),
          item.updatedAt || item.createdAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.feishuProjectBindings || []) {
      await db.query(
        `insert into feishu_project_bindings (
          chat_id, chat_name, project_id, project_name, bound_by, bound_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          item.chatId,
          item.chatName || "",
          item.projectId,
          item.projectName || "",
          item.boundBy || null,
          item.boundAt || new Date().toISOString(),
          item.updatedAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.feishuEvents || []) {
      await db.query(
        `insert into feishu_events (
          id, event_id, chat_id, chat_name, sender_id, sender_name, message_type,
          text, file_name, file_key, project_id, project_name, action, status, reply, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          item.id,
          item.eventId || "",
          item.chatId || "",
          item.chatName || "",
          item.senderId || "",
          item.senderName || "",
          item.messageType || "",
          item.text || "",
          item.fileName || "",
          item.fileKey || "",
          item.projectId || null,
          item.projectName || "",
          item.action || "",
          item.status || "",
          item.reply || "",
          item.createdAt || new Date().toISOString()
        ]
      );
    }

    for (const item of snapshot.feishuPendingFiles || []) {
      await db.query(
        `insert into feishu_pending_files (
          id, event_id, chat_id, chat_name, sender_id, sender_name, project_id,
          project_name, upload_type, file, preview, status, note, created_at,
          handled_at, handled_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          item.id,
          item.eventId || "",
          item.chatId || "",
          item.chatName || "",
          item.senderId || "",
          item.senderName || "",
          item.projectId || null,
          item.projectName || "",
          item.uploadType || "",
          JSON.stringify(item.file || {}),
          JSON.stringify(item.preview || {}),
          item.status || "待确认",
          item.note || "",
          item.createdAt || new Date().toISOString(),
          item.handledAt || null,
          item.handledBy || null
        ]
      );
    }

    for (const item of snapshot.systemNotifications || []) {
      await db.query(
        `insert into system_notifications (
          id, notice_key, type, title, body, severity, role, recipients,
          project_id, project_name, source, source_id, action_label, action_view,
          status, note, feishu_delivery, created_at, updated_at, handled_at,
          handled_by, handled_by_name
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          item.id,
          item.key || item.id,
          item.type || "",
          item.title || "",
          item.text || "",
          item.severity || "中",
          item.role || "",
          JSON.stringify(item.recipients || []),
          item.projectId || null,
          item.projectName || "",
          item.source || "",
          item.sourceId || "",
          item.actionLabel || "",
          item.actionView || "",
          item.status || "待处理",
          item.note || "",
          JSON.stringify(item.feishuDelivery || {}),
          item.createdAt || new Date().toISOString(),
          item.updatedAt || item.createdAt || new Date().toISOString(),
          item.handledAt || null,
          item.handledBy || null,
          item.handledByName || ""
        ]
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
