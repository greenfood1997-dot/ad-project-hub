import { readFile } from "node:fs/promises";

const postDeploy = await readFile(new URL("../post-deploy-check.command", import.meta.url), "utf8");
const chineseDeploy = await readFile(new URL("../部署后检查.command", import.meta.url), "utf8");
const uploadGuide = await readFile(new URL("../请先看我-上传说明.txt", import.meta.url), "utf8");
const uploadContentsGuide = await readFile(new URL("../UPLOAD_THIS_FOLDER_CONTENTS.txt", import.meta.url), "utf8");

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
  "project-operation-permission-regression.mjs",
  "api-route-coverage.mjs"
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
assert(postDeploy.includes("frontend-upload-progress-entry.mjs") && postDeploy.includes("prestart") && postDeploy.includes("dist"), "post deploy failure guidance should mention missing tests, prestart, and dist");
assert(chineseDeploy.includes("frontend-upload-progress-entry.mjs") && chineseDeploy.includes("prestart") && chineseDeploy.includes("dist"), "Chinese deploy failure guidance should mention missing tests, prestart, and dist");

for (const guide of [uploadGuide, uploadContentsGuide]) {
  assert(guide.includes("ad-project-hub-github-upload-latest-replace.zip"), "upload guide should recommend the latest full replacement zip");
  assert(guide.includes("tests/frontend-upload-progress-entry.mjs"), "upload guide should require the upload progress test file");
  assert(guide.includes('"prestart": "npm run build"'), "upload guide should require the prestart marker");
  assert(guide.includes("UploadProgressPanel") && guide.includes("缩到后台") && guide.includes("appendPickedFiles") && guide.includes("dropFiles"), "upload guide should require current upload UI markers");
  assert(guide.includes("不能有 dist") || guide.includes("不要选择 dist"), "upload guide should warn that dist must not be uploaded");
}

console.log("post deploy check coverage passed");
