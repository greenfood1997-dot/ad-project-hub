import { readFile } from "node:fs/promises";

const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.postgres.sql", import.meta.url), "utf8");
const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(schema.includes("comment_id text"), "Postgres comments table should keep stable frontend comment ids");
assert(schema.includes("pin_hash text") && schema.includes("must_change_pin boolean"), "Postgres users should persist hashed PIN and first-login state");
assert(schema.includes("alter column pin drop not null") && schema.includes("alter column pin drop default"), "Postgres migration should remove the insecure default PIN constraint");
assert(!schema.includes("default '123456'") && !schema.includes("'active', '123456'"), "Postgres schema must not create default active PIN accounts");
assert(schema.includes("archived_at timestamptz") && schema.includes("archive_reason text"), "Postgres comments table should keep archive fields");
assert(schema.includes("archived_by_name text"), "Postgres comments table should keep archive actor names");
assert(schema.includes("file_id text"), "Postgres project_files table should keep stable frontend file ids");
assert(schema.includes("local_storage_url text") && schema.includes("storage_remote_error text"), "Postgres project_files table should keep local backup and remote storage failure details");
assert(schema.includes("uploaded_by_name text") && schema.includes("archive_reason text"), "Postgres project_files table should keep uploader and archive metadata");
assert(schema.includes("voided_at timestamptz") && schema.includes("void_reason text"), "Postgres payments table should keep voided payment state");
assert(schema.includes("payments_idempotency_key_unique") && schema.includes("approvals_idempotency_key_unique"), "financial writes should keep unique idempotency keys in Postgres");
assert(schema.includes("supplier_id text") && schema.includes("payment_note text"), "Postgres suppliers table should keep supplier settlement state");
assert(schema.includes("approval_id text") && schema.includes("paid_at timestamptz"), "Postgres suppliers table should keep supplier payment approval and paid time");
assert(schema.includes("cost_applied_at timestamptz") && schema.includes("cost_rolled_back_at timestamptz"), "Postgres suppliers table should keep supplier settlement cost sync state");
assert(schema.includes("approval_stopped_at timestamptz") && schema.includes("approval_stopped_action text"), "Postgres suppliers table should keep stopped supplier-payment approval state");
assert(schema.includes("pm text") && schema.includes("sales text") && schema.includes("department text"), "Postgres projects table should keep assignment fields");
assert(schema.includes("progress numeric") && schema.includes("petty_cash_budget numeric") && schema.includes("petty_cash_used numeric"), "Postgres projects table should keep progress and petty cash fields");
assert(schema.includes("service_period text") && schema.includes("start_date text") && schema.includes("end_date text"), "Postgres projects table should keep timeline fields");
assert(postgres.includes("select id, name, client, owner, pm, sales, department") && postgres.includes('petty_cash_budget::float as "pettyCashBudget"'), "Postgres read should restore project assignment and petty cash fields");
assert(postgres.includes("insert into projects (") && postgres.includes("pm, sales, department, progress") && postgres.includes("petty_cash_budget, petty_cash_used"), "Postgres write should persist project assignment and progress fields");
assert(postgres.includes("const db = client || await activePool.connect()") && postgres.includes("db.release()"), "Postgres snapshot writes must stay on one transaction connection and release owned clients");
assert(postgres.includes("pg_advisory_lock($1)") && postgres.includes("pg_advisory_unlock($1)"), "Postgres read-modify-write cycles must be serialized across instances");
assert(postgres.includes('pin_hash as "pinHash"') && postgres.includes('must_change_pin as "mustChangePin"'), "Postgres read should restore secure authentication fields");
assert(postgres.includes("pin, pin_hash, must_change_pin") && postgres.includes("user.pinHash || null") && postgres.includes("Boolean(user.mustChangePin)"), "Postgres write should persist secure authentication fields");
assert(!postgres.includes('user.pin || "123456"'), "Postgres write must not regenerate the default PIN");
assert(postgres.includes("project.pm || project.extractedFields?.pm") && postgres.includes("project.pettyCashBudget ?? project.extractedFields?.pettyCashBudget"), "Postgres write should fallback to extracted project assignment and petty cash fields");
assert(postgres.includes('file_id as id') && postgres.includes('local_storage_url as "localStorageUrl"'), "Postgres read should restore file ids and local backup urls");
assert(postgres.includes('storage_remote_error as "storageRemoteError"') && postgres.includes('archived_at as "archivedAt"'), "Postgres read should restore file remote errors and archive state");
assert(postgres.includes("insert into project_files (") && postgres.includes("local_storage_url") && postgres.includes("archive_reason"), "Postgres write should persist full project file metadata");
assert(postgres.includes("groupProjectFileUploads(files.rows)") && postgres.includes("files: fileUploads"), "Postgres read should restore global upload batches, not only flat file rows");
assert(postgres.includes("collectProjectFilesForPostgres(snapshot)") && postgres.includes("for (const upload of snapshot.files || [])"), "Postgres write should persist global upload ledger files as project files");
assert(postgres.includes("fileIdentity(merged, project.id, project.name)") && postgres.includes("if (seen.has(key)) return"), "Postgres file persistence should dedupe project files and upload ledger files");
assert(postgres.includes('row.type === "__uploadPreviews"') && postgres.includes('"__uploadPreviews", { items: snapshot.uploadPreviews }'), "Postgres should persist upload previews under an internal settings key and keep them out of public settings");
assert(services.includes("db.uploadPreviews") && services.includes("body.previewId"), "project confirmation should reuse the persisted preview record");
assert(postgres.includes('voided_at as "voidedAt"') && postgres.includes('void_reason as "voidReason"'), "Postgres read should restore voided payment metadata");
assert(postgres.includes("insert into payments (") && postgres.includes("voided_by_name") && postgres.includes("void_reason"), "Postgres write should persist voided payment metadata");
assert(postgres.includes('idempotency_key as "idempotencyKey"') && postgres.includes("item.idempotencyKey || null"), "Postgres should round-trip financial idempotency keys");
assert(postgres.includes('approval_id as "approvalId"') && postgres.includes('payment_note as "paymentNote"'), "Postgres read should restore supplier settlement metadata");
assert(postgres.includes("insert into suppliers (") && postgres.includes("approval_id") && postgres.includes("payment_note"), "Postgres write should persist supplier settlement metadata");
assert(postgres.includes('cost_applied_at as "costAppliedAt"') && postgres.includes('cost_rolled_back_at as "costRolledBackAt"'), "Postgres read should restore supplier settlement cost sync metadata");
assert(postgres.includes("cost_applied_at, cost_applied_by, cost_applied_by_name") && postgres.includes("item.costAppliedAt || null"), "Postgres write should persist supplier settlement cost sync metadata");
assert(postgres.includes('approval_stopped_at as "approvalStoppedAt"') && postgres.includes('approval_stopped_action as "approvalStoppedAction"'), "Postgres read should restore stopped supplier-payment approval metadata");
assert(postgres.includes("approval_stopped_at, approval_stopped_by, approval_stopped_action") && postgres.includes("item.approvalStoppedAction || \"\""), "Postgres write should persist stopped supplier-payment approval metadata");
assert(postgres.includes('comment_id as id') && postgres.includes('archived_at as "archivedAt"'), "Postgres read should restore comment ids and archive state");
assert(postgres.includes("for (const item of snapshot.comments || [])"), "Postgres write should persist project comments");
assert(postgres.includes("insert into comments (") && postgres.includes("archive_reason"), "Postgres write should persist archived comment metadata");
assert(postgres.includes("for (const item of snapshot.auditLogs || [])"), "Postgres write should persist audit logs");
assert(postgres.includes("insert into audit_logs") && postgres.includes("JSON.stringify(item.meta || {})"), "Postgres audit log write should preserve meta JSON");

console.log("postgres persistence coverage passed");
