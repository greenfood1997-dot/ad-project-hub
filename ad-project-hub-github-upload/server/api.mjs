import { readDb, mutateDb, dbMode } from "./db.mjs";
import { getCurrentUser, readBody, requireRole, sendJson } from "./http-utils.mjs";
import {
  addComment,
  advanceParseJob,
  createProject,
  deleteProject,
  recordFiles,
  reparseProject,
  refreshInterestRate,
  saveSetting,
  supplierCsv,
  testAiSettings,
  updateAlert,
  updateProject
} from "./services.mjs";

export async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const snapshot = await readDb();
  const user = getCurrentUser(req, snapshot);

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, { ok: true, data: snapshot, currentUser: user, dbMode: dbMode() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    if (!requireRole(user, ["admin"], res)) return;
    const body = await readBody(req);
    const data = await mutateDb((db) => saveSetting(db, body.type, body.values, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/ai/test") {
    if (!requireRole(user, ["admin"], res)) return;
    const body = await readBody(req);
    const data = await testAiSettings(body.values);
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/interest-rate/refresh") {
    if (!requireRole(user, ["admin"], res)) return;
    const data = await mutateDb((db) => refreshInterestRate(db, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await readBody(req);
    const data = await mutateDb((db) => createProject(db, body.values, body.files || [], user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/update") {
    const body = await readBody(req);
    const data = await mutateDb((db) => updateProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/delete") {
    const body = await readBody(req);
    const data = await mutateDb((db) => deleteProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/projects/reparse") {
    const body = await readBody(req);
    const data = await mutateDb((db) => reparseProject(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/files/record") {
    const body = await readBody(req);
    const data = await mutateDb((db) => recordFiles(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/parse-jobs/progress") {
    const body = await readBody(req);
    const data = await mutateDb((db) => advanceParseJob(db, body.id || body.projectId));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/alerts/update") {
    const body = await readBody(req);
    const data = await mutateDb((db) => updateAlert(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/comments") {
    const body = await readBody(req);
    const data = await mutateDb((db) => addComment(db, body, user));
    sendJson(res, 200, { ok: true, data });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suppliers/export") {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=supplier-settlements.csv"
    });
    res.end(supplierCsv(snapshot));
    return;
  }

  sendJson(res, 404, { ok: false, error: "API not found" });
}
