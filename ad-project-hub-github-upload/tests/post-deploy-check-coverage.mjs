import { readFile } from "node:fs/promises";

const postDeploy = await readFile(new URL("../post-deploy-check.command", import.meta.url), "utf8");
const chineseDeploy = await readFile(new URL("../部署后检查.command", import.meta.url), "utf8");
const uploadGuide = await readFile(new URL("../请先看我-上传说明.txt", import.meta.url), "utf8");
const uploadContentsGuide = await readFile(new URL("../UPLOAD_THIS_FOLDER_CONTENTS.txt", import.meta.url), "utf8");
const preUploadCheck = await readFile(new URL("../上传前检查.command", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const fullCheck = await readFile(new URL("./run-full-check.mjs", import.meta.url), "utf8");

const required = [
  "frontend-upload-progress-entry.mjs",
  "frontend-management-cockpit-entry.mjs",
  "frontend-approval-workbench-entry.mjs",
  "frontend-supplier-client-entry.mjs",
  "frontend-collection-assistant-entry.mjs",
  "collection-assistant-regression.mjs",
  "payment-ledger-regression.mjs",
  "frontend-payment-ledger-entry.mjs",
  "approval-finance-impact-regression.mjs",
  "project-task-progress-regression.mjs",
  "frontend-task-progress-entry.mjs",
  "project-activity-audit-regression.mjs",
  "frontend-project-activity-entry.mjs",
  "alert-notification-permission-regression.mjs",
  "frontend-closeout-review-entry.mjs",
  "assignment-suggestion-regression.mjs",
  "permission-boundary-regression.mjs",
  "file-parse-permission-regression.mjs",
  "approval-action-permission-regression.mjs",
  "supplier-client-permission-regression.mjs",
  "feishu-pending-permission-regression.mjs",
  "frontend-ai-confirmation-entry.mjs",
  "frontend-admin-routing-entry.mjs",
  "frontend-employee-dashboard-actions-entry.mjs",
  "frontend-project-filter-entry.mjs",
  "frontend-system-scan-entry.mjs",
  "frontend-assignment-suggestion-entry.mjs",
  "project-operation-permission-regression.mjs",
  "api-route-coverage.mjs",
  "deploy-health-regression.mjs",
  "json-db-resilience-regression.mjs",
  "postgres-persistence-coverage.mjs"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of required) {
  assert(postDeploy.includes(file), `post-deploy-check.command should verify ${file}`);
  assert(chineseDeploy.includes(file), `部署后检查.command should verify ${file}`);
}

assert(postDeploy.includes("critical_tests=("), "post deploy check should use a critical test list");
assert(chineseDeploy.includes("critical_tests=("), "Chinese deploy check should use a critical test list");
assert(postDeploy.includes("GitHub 的$label不是最新版或内容不完整"), "post deploy check should report incomplete remote tests");
assert(chineseDeploy.includes("GitHub 的$label不是最新版或内容不完整"), "Chinese deploy check should report incomplete remote tests");
assert(postDeploy.includes("LATEST_WRAPPER_ZIP"), "post deploy check should point to latest wrapper zip");
assert(chineseDeploy.includes("LATEST_WRAPPER_ZIP"), "Chinese deploy check should point to latest wrapper zip");
assert(postDeploy.includes("frontend-upload-progress-entry.mjs") && postDeploy.includes("二次构建") && postDeploy.includes("dist"), "post deploy failure guidance should mention missing tests, duplicate build, and dist");
assert(chineseDeploy.includes("frontend-upload-progress-entry.mjs") && chineseDeploy.includes("二次构建") && chineseDeploy.includes("dist"), "Chinese deploy failure guidance should mention missing tests, duplicate build, and dist");
for (const marker of ["server/scheduler.mjs", "startSystemScheduler", "scheduler: getSchedulerStatus()", "S3 Endpoint", "s3SignedHeaders", "/api/notifications/wechat/send", "后台定时巡检"]) {
  assert(postDeploy.includes(marker), `post deploy check should verify ${marker}`);
  assert(chineseDeploy.includes(marker), `Chinese deploy check should verify ${marker}`);
}
for (const marker of ["server/scheduler.mjs", "startSystemScheduler", "scheduler: getSchedulerStatus()", "S3 Endpoint", "s3SignedHeaders", "sendSystemNotificationToWechat", "发送企业微信"]) {
  assert(preUploadCheck.includes(marker), `pre-upload check should verify ${marker}`);
}
assert(preUploadCheck.includes("json-db-resilience-regression.mjs"), "pre-upload check should verify JSON database resilience before uploading");
assert(preUploadCheck.includes("api-route-coverage.mjs") && preUploadCheck.includes("post-deploy-check-coverage.mjs"), "pre-upload check should verify API and deploy-check coverage");
assert(packageJson.scripts.check === "node tests/run-quick-check.mjs", "package.json should expose npm run check");
assert(packageJson.scripts["check:full"] === "node tests/run-full-check.mjs", "package.json should expose npm run check:full");
assert(!packageJson.scripts.prestart, "package.json should not reintroduce prestart");
assert(fullCheck.includes("json-db-resilience-regression.mjs") && fullCheck.includes("workflow-smoke.mjs") && fullCheck.includes("run-quick-check.mjs"), "full check should include JSON resilience, smoke, and quick checks");
for (const file of required.filter((item) => item.startsWith("frontend-"))) {
  assert(fullCheck.includes(file) || fullCheck.includes("run-quick-check.mjs"), `full check should include ${file} directly or through quick check`);
}
assert(fullCheck.includes("postgres-persistence-coverage.mjs") || (await readFile(new URL("./run-quick-check.mjs", import.meta.url), "utf8")).includes("postgres-persistence-coverage.mjs"), "full or quick check should include Postgres persistence coverage");

for (const guide of [uploadGuide, uploadContentsGuide]) {
  assert(guide.includes("ad-project-hub-github-upload-latest-replace.zip"), "upload guide should recommend the latest full replacement zip");
  assert(guide.includes("tests/frontend-upload-progress-entry.mjs"), "upload guide should require the upload progress test file");
  assert(guide.includes("不能有") && guide.includes("prestart"), "upload guide should warn that prestart must not be used on Render");
  assert(guide.includes("UploadProgressPanel") && guide.includes("缩到后台") && guide.includes("appendPickedFiles") && guide.includes("dropFiles"), "upload guide should require current upload UI markers");
  assert(guide.includes("不能有 dist") || guide.includes("不要选择 dist"), "upload guide should warn that dist must not be uploaded");
  assert(guide.includes("json-db-resilience-regression.mjs") && guide.includes("写库测试") && guide.includes("顺序"), "upload guide should mention JSON resilience and sequential write-heavy tests");
  assert(guide.includes("npm run check") && guide.includes("npm run check:full"), "upload guide should mention standard npm check commands");
}

console.log("post deploy check coverage passed");
