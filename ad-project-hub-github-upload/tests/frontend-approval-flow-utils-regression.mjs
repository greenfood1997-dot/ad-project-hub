import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  approvalAdminHandleRoles,
  approvalPmStepHandleRoles,
  approvalPriorityQueue,
  approvalRuntimeInfo,
  approvalWithdrawManageRoles,
  canHandleApproval,
  canWithdrawApproval,
  currentApprovalStepInfo
} from "../src/utils/approvalFlow.js";

const pendingPmApproval = {
  id: "a-1",
  status: "待审批",
  amount: 3000,
  waitHours: 4,
  applicantId: "u-member",
  steps: [{ role: "pm", label: "PM审批", status: "current" }],
  logs: []
};
const pendingFinanceApproval = {
  id: "a-2",
  status: "待审批",
  amount: 500,
  waitHours: 20,
  applicantId: "u-pm",
  slaStatus: "即将超时",
  steps: [{ role: "finance", label: "财务复核", status: "current" }],
  logs: []
};

assert.equal(currentApprovalStepInfo(pendingPmApproval).role, "pm");
assert.deepEqual(approvalAdminHandleRoles, ["shareholder", "admin"]);
assert.deepEqual(approvalPmStepHandleRoles, ["pm", "director"]);
assert.deepEqual(approvalWithdrawManageRoles, ["shareholder", "admin", "director"]);
assert.equal(canHandleApproval({ role: "pm" }, pendingPmApproval), true);
assert.equal(canHandleApproval({ role: "director" }, pendingPmApproval), true);
assert.equal(canHandleApproval({ role: "member" }, pendingPmApproval), false);
assert.equal(canHandleApproval({ role: "finance" }, pendingFinanceApproval), true);
assert.equal(canWithdrawApproval({ id: "u-member", role: "member" }, pendingPmApproval), true);
assert.equal(canWithdrawApproval({ id: "u-other", role: "member" }, pendingPmApproval), false);
assert.equal(canWithdrawApproval({ id: "u-admin", role: "admin" }, pendingPmApproval), true);

const runtime = approvalRuntimeInfo(pendingFinanceApproval);
assert.equal(runtime.handler, "财务");
assert.equal(runtime.waitText, "已等待 20 小时");
assert.equal(runtime.tone, "warn");

const queue = approvalPriorityQueue([pendingFinanceApproval, pendingPmApproval], { role: "finance" });
assert.equal(queue[0].approval.id, "a-2");
assert.equal(queue[0].actionable, true);

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const approvalFlowSource = await readFile(new URL("../src/utils/approvalFlow.js", import.meta.url), "utf8");
const approvalSource = await readFile(new URL("../src/ApprovalFunds.jsx", import.meta.url), "utf8");
const projectApprovalSource = await readFile(new URL("../src/ProjectApprovalPanel.jsx", import.meta.url), "utf8");

assert(approvalSource.includes('from "./utils/approvalFlow.js"'), "approval workbench should import shared approval flow helpers");
assert(projectApprovalSource.includes("currentApprovalStepInfo,") && projectApprovalSource.includes("canWithdrawApproval,"), "project approval panel should receive shared approval flow helpers through props");
assert(approvalFlowSource.includes("approvalAdminHandleRoles") && approvalFlowSource.includes("approvalPmStepHandleRoles") && approvalFlowSource.includes("approvalWithdrawManageRoles"), "approval flow should name role groups instead of hiding role arrays inside conditionals");

for (const [name, source] of [["main", mainSource], ["approval", approvalSource], ["project approval", projectApprovalSource]]) {
  assert(!source.includes("function currentApprovalStepInfo("), `${name} should not redefine currentApprovalStepInfo`);
  assert(!source.includes("function canHandleApproval("), `${name} should not redefine canHandleApproval`);
  assert(!source.includes("function canWithdrawApproval("), `${name} should not redefine canWithdrawApproval`);
  assert(!source.includes("function approvalRuntimeInfo("), `${name} should not redefine approvalRuntimeInfo`);
  assert(!source.includes("function approvalPriorityQueue("), `${name} should not redefine approvalPriorityQueue`);
}

console.log("frontend approval flow utils regression passed");
