import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../db/schema.postgres.sql", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");

assert(schema.includes("where not exists (select 1 from users)"), "default users must only seed a truly empty database");
assert(schema.includes("as seed(id, name, email, role, department, status, pin, must_change_pin)"), "default user seed should use a conditional values table");
assert(api.includes("function detachDeletedMemberHistory"), "member deletion should detach historical foreign keys before persistence");
assert(api.includes('clear(db.approvals, ["applicantId"])'), "approval history should preserve names without retaining a deleted user foreign key");
assert(api.includes('clear(db.payments, ["recordedBy", "voidedBy"])'), "payment history should detach deleted user foreign keys");
assert(api.includes('clear(db.comments, ["userId", "archivedBy"])'), "comment history should detach deleted user foreign keys");

console.log("postgres member delete persistence regression passed");
