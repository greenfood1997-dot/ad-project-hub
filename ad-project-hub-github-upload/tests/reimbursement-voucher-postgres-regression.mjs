import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../db/schema.postgres.sql", import.meta.url), "utf8");
const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
assert(schema.includes("approvals add column if not exists metadata jsonb"));
assert(postgres.includes('JSON.stringify({ voucher: item.voucher || null, invoiceGap: Number(item.invoiceGap || 0)'));
assert(postgres.includes('approvals.rows.map((item) => ({ ...item, ...(item.metadata || {}) }))'));
console.log("reimbursement voucher postgres regression passed");
