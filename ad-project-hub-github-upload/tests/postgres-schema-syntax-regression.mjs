import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../db/schema.postgres.sql", import.meta.url), "utf8");
const adapter = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");

assert(!/^\s*values\s+jsonb/im.test(schema), "PostgreSQL schema must not use VALUES as an unquoted column name");
assert(schema.includes("config_values jsonb not null"), "settings must use a PostgreSQL-safe JSON column name");
assert(adapter.includes('config_values as "values"'), "adapter must preserve the in-memory settings row shape");
assert(adapter.includes("insert into settings (type, config_values, saved_by, saved_at)"), "settings writes must target the safe column name");

console.log("postgres schema syntax regression passed");
