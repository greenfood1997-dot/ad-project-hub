import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const postgres = await readFile(new URL("../server/db-postgres.mjs", import.meta.url), "utf8");
const db = await readFile(new URL("../server/db.mjs", import.meta.url), "utf8");

assert(postgres.includes("pg_advisory_lock($1)"), "Postgres mutations must acquire a database-level advisory lock");
assert(postgres.includes("pg_advisory_unlock($1)"), "Postgres mutations must always release the advisory lock");
assert(postgres.includes("const snapshot = await readPostgresDb(db)"), "the snapshot must be read after acquiring the shared database lock");
assert(postgres.includes("await writePostgresDbFromSnapshot(snapshot, db)"), "the locked snapshot must be written on the same Postgres session");
assert(postgres.indexOf("pg_advisory_lock($1)") < postgres.indexOf("const snapshot = await readPostgresDb(db)"), "the lock must precede the database read");
assert(postgres.indexOf("const snapshot = await readPostgresDb(db)") < postgres.indexOf("await mutator(snapshot)"), "business mutation must use the freshly locked snapshot");
assert(db.includes("return await mutatePostgresDb(mutator)"), "production Postgres writes must use the cross-instance locked mutation path");
assert(!db.includes("retryTransientDatabase(() => mutatePostgresDb(mutator))"), "business callbacks must not be replayed after external side effects");
assert(postgres.includes("db.release(connectionBroken)"), "broken mutation clients must be destroyed instead of returned to the pool");
assert(postgres.includes('db.query("rollback").catch'), "a failed rollback must not replace the original connection error");

console.log("postgres cross-instance mutation lock regression passed");
