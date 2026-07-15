import { spawn } from "node:child_process";

const checks = [
  ["多人写入串行化", "tests/db-mutation-serialization-regression.mjs"],
  ["备份恢复安全", "tests/backup-safety-regression.mjs"],
  ["备份安全前端提示", "tests/frontend-backup-safety-entry.mjs"],
  ["前端共享 API Token", "tests/frontend-shared-api-auth-regression.mjs"],
  ["API 覆盖", "tests/api-route-coverage.mjs"],
  ["部署检查覆盖", "tests/post-deploy-check-coverage.mjs"],
  ["Postgres 持久化覆盖", "tests/postgres-persistence-coverage.mjs"],
  ["对象存储环境兜底", "tests/storage-env-fallback-regression.mjs"],
  ["上线健康", "tests/deploy-health-regression.mjs"],
  ["生产风险入口", "tests/frontend-production-risk-entry.mjs"],
  ["前端性能入口", "tests/frontend-performance-entry.mjs"],
  ["上传进度入口", "tests/frontend-upload-progress-entry.mjs"],
  ["报销表上传预览", "tests/reimbursement-upload-preview-regression.mjs"],
  ["审批工作台入口", "tests/frontend-approval-workbench-entry.mjs"],
  ["回款台账入口", "tests/frontend-payment-ledger-entry.mjs"],
  ["成本复盘入口", "tests/frontend-closeout-review-entry.mjs"],
  ["供应商客户入口", "tests/frontend-supplier-client-entry.mjs"],
  ["经营舱入口", "tests/frontend-management-cockpit-entry.mjs"],
  ["催收助手入口", "tests/frontend-collection-assistant-entry.mjs"]
];

async function run([label, file]) {
  process.stdout.write(`\n[quick] ${label}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} failed with code ${code}`)));
    child.on("error", reject);
  });
}

for (const check of checks) {
  await run(check);
}

console.log("\nquick check passed");
