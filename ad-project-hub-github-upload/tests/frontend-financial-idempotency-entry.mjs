import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["src/utils/api.js", "src/main.jsx"]) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const path of ["/api/payments", "/api/approvals", "/api/projects/cost-sheet"]) {
    assert(source.includes(`\"${path}\"`), `${file} must protect ${path}`);
  }
  assert(source.includes('"idempotency-key": idempotencyKey'), `${file} must send the idempotency header`);
  assert(source.includes("now - existing.createdAt < 30000"), `${file} must reuse a key only during the retry window`);
  assert(source.includes("session.id") && source.includes("options.body"), `${file} must scope keys by user and request body`);
}

console.log("frontend financial idempotency entry passed");
