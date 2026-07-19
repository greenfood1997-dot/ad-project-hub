import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function req(path, userId, body) {
  const payload = JSON.stringify(body);
  return { method: "POST", url: path, headers: { "x-user-id": userId, "content-type": "application/json" }, async *[Symbol.asyncIterator]() { yield Buffer.from(payload); } };
}

function res() {
  return { statusCode: 0, chunks: [], writeHead(status) { this.statusCode = status; }, end(chunk = "") { if (chunk) this.chunks.push(Buffer.from(String(chunk))); }, json() { return JSON.parse(Buffer.concat(this.chunks).toString("utf8") || "{}"); } };
}

async function call(userId, id) {
  const response = res();
  try {
    await handleApi(req("/api/members/delete", userId, { id }), response);
    return { status: response.statusCode, payload: response.json() };
  } catch (error) {
    return { status: 400, payload: { ok: false, error: error.message } };
  }
}

try {
  const db = {
    users: [
      { id: "admin", name: "管理员", email: "admin@test.local", role: "admin", status: "active", pin: "654321" },
      { id: "unused", name: "误建人员", email: "unused@test.local", role: "member", status: "disabled", pin: "654321" },
      { id: "linked", name: "当前人员", email: "linked@test.local", role: "member", status: "disabled", pin: "654321" },
      { id: "historical", name: "历史人员", email: "historical@test.local", role: "member", status: "disabled", pin: "654321" }
    ],
    projects: [{ id: "p1", name: "当前项目", owner: "当前人员" }],
    approvals: [{ id: "a1", applicantId: "historical", applicantName: "历史人员" }],
    payments: [{ id: "pay1", recordedBy: "historical", recordedByName: "历史人员" }],
    comments: [{ id: "c1", userId: "historical", user: "历史人员" }],
    settings: {}, auditLogs: [], systemNotifications: []
  };
  await writeFile(dbFile, JSON.stringify(db, null, 2));

  const deleted = await call("admin", "unused");
  assert.equal(deleted.status, 200);
  assert.equal(deleted.payload.data.id, "unused");

  const linked = await call("admin", "linked");
  assert.equal(linked.status, 400);
  assert.match(linked.payload.error, /当前项目.*负责人/);

  const historical = await call("admin", "historical");
  assert.equal(historical.status, 200);
  assert.equal(historical.payload.data.id, "historical");

  const self = await call("admin", "admin");
  assert.equal(self.status, 400);
  assert.match(self.payload.error, /当前登录账号/);

  const saved = JSON.parse(await readFile(dbFile, "utf8"));
  assert.equal(saved.users.some((item) => item.id === "unused"), false);
  assert.equal(saved.users.some((item) => item.id === "linked"), true);
  assert.equal(saved.users.some((item) => item.id === "historical"), false);
  assert.equal(saved.approvals[0].applicantName, "历史人员");
  assert.equal(saved.auditLogs[0].action, "delete");
  console.log("member delete regression passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
