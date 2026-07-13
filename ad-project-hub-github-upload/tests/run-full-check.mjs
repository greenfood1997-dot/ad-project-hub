import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { defaultDb } from "../server/default-db.mjs";
import { dbFile } from "../server/config.mjs";

const checks = [
  ["JSON 数据库韧性", "tests/json-db-resilience-regression.mjs"],
  ["Postgres 持久化覆盖", "tests/postgres-persistence-coverage.mjs"],
  ["权限边界", "tests/permission-boundary-regression.mjs"],
  ["文件解析权限", "tests/file-parse-permission-regression.mjs"],
  ["审批处理权限", "tests/approval-action-permission-regression.mjs"],
  ["审批财务影响", "tests/approval-finance-impact-regression.mjs"],
  ["供应商客户权限", "tests/supplier-client-permission-regression.mjs"],
  ["飞书待确认权限", "tests/feishu-pending-permission-regression.mjs"],
  ["项目操作权限", "tests/project-operation-permission-regression.mjs"],
  ["项目任务进度", "tests/project-task-progress-regression.mjs"],
  ["项目动态审计", "tests/project-activity-audit-regression.mjs"],
  ["预警待办权限", "tests/alert-notification-permission-regression.mjs"],
  ["回款台账", "tests/payment-ledger-regression.mjs"],
  ["催收助手", "tests/collection-assistant-regression.mjs"],
  ["系统巡检", "tests/system-scan-regression.mjs"],
  ["AI 助手", "tests/ai-assistant-regression.mjs"],
  ["AI 分派建议", "tests/assignment-suggestion-regression.mjs"],
  ["合同解析", "tests/contract-parser-regression.mjs"],
  ["报销表上传预览", "tests/reimbursement-upload-preview-regression.mjs"],
  ["核销解析", "tests/verification-parser-regression.mjs"],
  ["工作流冒烟", "tests/workflow-smoke.mjs"],
  ["前端性能入口", "tests/frontend-performance-entry.mjs"],
  ["前端后台路由入口", "tests/frontend-admin-routing-entry.mjs"],
  ["前端 AI 确认入口", "tests/frontend-ai-confirmation-entry.mjs"],
  ["前端员工操作入口", "tests/frontend-employee-dashboard-actions-entry.mjs"],
  ["前端项目筛选入口", "tests/frontend-project-filter-entry.mjs"],
  ["前端项目动态入口", "tests/frontend-project-activity-entry.mjs"],
  ["前端任务进度入口", "tests/frontend-task-progress-entry.mjs"],
  ["前端系统巡检入口", "tests/frontend-system-scan-entry.mjs"],
  ["前端分派建议入口", "tests/frontend-assignment-suggestion-entry.mjs"],
  ["快速检查", "tests/run-quick-check.mjs"]
];

async function run([label, file]) {
  process.stdout.write(`\n[full] ${label}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} failed with code ${code}`)));
    child.on("error", reject);
  });
}

try {
  for (const check of checks) {
    await run(check);
  }
  console.log("\nfull check passed");
} finally {
  await writeFile(dbFile, JSON.stringify(defaultDb, null, 2));
}
