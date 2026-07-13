import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { actionItemKey, canArchiveComment, parseJobTone } from "../src/utils/projectDetailUi.js";

assert.equal(actionItemKey({ title: "补齐合同", text: "请上传合同" }), "补齐合同:请上传合同");
assert.equal(actionItemKey({}), "行动项:");

assert.equal(parseJobTone({ status: "解析失败" }), "failed");
assert.equal(parseJobTone({ status: "已完成" }), "done");
assert.equal(parseJobTone({ progress: 100 }), "done");
assert.equal(parseJobTone({ status: "解析中", progress: 20 }), "running");
assert.equal(parseJobTone({ progress: 1 }), "running");
assert.equal(parseJobTone({ status: "等待" }), "waiting");

assert.equal(canArchiveComment({ role: "pm" }, { userId: "u-1", user: "执行A" }), true);
assert.equal(canArchiveComment({ role: "member", id: "u-1", name: "执行A" }, { userId: "u-1", user: "别人" }), true);
assert.equal(canArchiveComment({ role: "member", id: "u-2", name: "执行A" }, { userId: "u-1", user: "执行A" }), true);
assert.equal(canArchiveComment({ role: "member", id: "u-2", name: "执行B" }, { userId: "u-1", user: "执行A" }), false);

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const dashboardContentSource = await readFile(new URL("../src/DashboardContent.jsx", import.meta.url), "utf8");
const projectDetailSource = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const moduleFallbackSource = await readFile(new URL("../src/ModuleFallback.jsx", import.meta.url), "utf8");
assert(dashboardContentSource.includes('const ProjectDetail = lazy(() => import("./ProjectDetail.jsx"))'), "dashboard content should lazy-load the project detail shell");
assert(projectDetailSource.includes('import { actionItemKey, canArchiveComment, parseJobTone } from "./utils/projectDetailUi.js";'), "project detail should import shared project detail UI helpers");
assert(projectDetailSource.includes("canHandleProjectAlertRole") && projectDetailSource.includes("canRecordPaymentRole"), "project detail should import shared project alert and payment permissions");
assert(projectDetailSource.includes('import { canWithdrawApproval, currentApprovalStepInfo } from "./utils/approvalFlow.js";'), "project detail should import shared approval flow helpers used by the lazy approval panel");
assert(projectDetailSource.includes('import ModuleFallback from "./ModuleFallback.jsx";') && projectDetailSource.includes('fallback={<ModuleFallback title="项目概览加载中" variant="detail" />}'), "project detail should use the shared detail fallback to avoid lazy-loaded runtime white screens");
assert(moduleFallbackSource.includes("export default function ModuleFallback") && moduleFallbackSource.includes('variant === "detail"') && moduleFallbackSource.includes("detail-section module-fallback"), "shared module fallback should support detail and feature variants");
assert(!mainSource.includes("ModuleFallback={ModuleFallback}"), "admin shell should import the shared fallback directly instead of receiving a prop from main");
assert(!mainSource.includes("function actionItemKey(") && !projectDetailSource.includes("function actionItemKey("), "frontend should not redefine actionItemKey");
assert(!mainSource.includes("function parseJobTone(") && !projectDetailSource.includes("function parseJobTone("), "frontend should not redefine parseJobTone");
assert(!mainSource.includes("function canArchiveComment(") && !projectDetailSource.includes("function canArchiveComment("), "frontend should not redefine canArchiveComment");

console.log("frontend project detail ui regression passed");
