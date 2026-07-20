import assert from "node:assert/strict";
import { isTransientDatabaseError, publicServerError, retryTransientDatabase } from "../server/database-errors.mjs";

assert.equal(isTransientDatabaseError({ code: "57P03", message: "the database system is in recovery mode" }), true);
assert.equal(isTransientDatabaseError(new Error("ordinary validation error")), false);
assert.equal(publicServerError(new Error("the database system is in recovery mode")), "数据库正在恢复，请稍后重试。本次操作未完成。");

let attempts = 0;
const result = await retryTransientDatabase(async () => {
  attempts += 1;
  if (attempts < 3) throw Object.assign(new Error("the database system is in recovery mode"), { code: "57P03" });
  return "ready";
}, { attempts: 3, baseDelayMs: 1 });
assert.equal(result, "ready");
assert.equal(attempts, 3);

console.log("database recovery regression passed");
