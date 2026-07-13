import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  approvalTypeOptionsFor,
  canBeAssignmentMember,
  canBeAssignmentPm,
  canBeAssignmentSales,
  canCreateProjectRole,
  canManageAssignmentsRole,
  canHandleFeishuPendingRole,
  canHandleProjectAlertRole,
  canRecordPaymentRole,
  canSeeManagement,
  canSubmitSupplierPaymentRole,
  canUseAdminRole,
  canUseCollectionRole,
  canWriteProjectRole,
  roleLabel,
  roleOptions
} from "../src/utils/permissions.js";

assert.equal(roleLabel("admin"), "管理员");
assert.equal(roleLabel("member"), "普通成员");
assert.equal(roleLabel("unknown"), "unknown");
assert.equal(roleOptions.some(([role]) => role === "finance"), true);

assert.equal(canSeeManagement({ role: "finance" }), true);
assert.equal(canSeeManagement({ role: "member" }), false);
assert.equal(canUseAdminRole({ role: "admin" }), true);
assert.equal(canUseAdminRole({ role: "director" }), false);
assert.equal(canManageAssignmentsRole({ role: "director" }), true);
assert.equal(canManageAssignmentsRole({ role: "pm" }), false);
assert.equal(canBeAssignmentPm({ role: "pm" }), true);
assert.equal(canBeAssignmentPm({ role: "sales" }), false);
assert.equal(canBeAssignmentSales({ role: "sales" }), true);
assert.equal(canBeAssignmentSales({ role: "finance" }), false);
assert.equal(canBeAssignmentMember({ role: "member" }), true);
assert.equal(canBeAssignmentMember({ role: "viewer" }), false);
assert.equal(canCreateProjectRole({ role: "sales" }), true);
assert.equal(canCreateProjectRole({ role: "member" }), false);
assert.equal(canWriteProjectRole({ role: "pm" }), true);
assert.equal(canWriteProjectRole({ role: "finance" }), false);
assert.equal(canUseCollectionRole({ role: "finance" }), true);
assert.equal(canUseCollectionRole({ role: "viewer" }), false);
assert.equal(canHandleFeishuPendingRole({ role: "director" }), true);
assert.equal(canSubmitSupplierPaymentRole({ role: "finance" }), true);
assert.equal(canSubmitSupplierPaymentRole({ role: "member" }), false);
assert.equal(canRecordPaymentRole({ role: "sales" }), true);
assert.equal(canRecordPaymentRole({ role: "viewer" }), false);
assert.equal(canHandleProjectAlertRole({ role: "pm" }), true);
assert.equal(canHandleProjectAlertRole({ role: "member" }), false);
assert.deepEqual(approvalTypeOptionsFor({ role: "member" }).map(([value]) => value), ["reimbursement", "petty_cash"]);
assert.deepEqual(approvalTypeOptionsFor({ role: "finance" }).map(([value]) => value), ["reimbursement", "petty_cash", "supplier_payment"]);

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const aiSource = await readFile(new URL("../src/AiWorkspace.jsx", import.meta.url), "utf8");
const uploadSource = await readFile(new URL("../src/UploadDialog.jsx", import.meta.url), "utf8");
const collectionSource = await readFile(new URL("../src/CollectionAssistant.jsx", import.meta.url), "utf8");
const approvalSource = await readFile(new URL("../src/ApprovalFunds.jsx", import.meta.url), "utf8");
const projectDetailSource = await readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8");
const adminShellSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const assignmentSource = await readFile(new URL("../src/ProjectAssignmentPanel.jsx", import.meta.url), "utf8");

assert(mainSource.includes('from "./utils/permissions.js"'), "main should import shared permission helpers");
assert(mainSource.includes("canUseAdminRole") && mainSource.includes("canManageAssignmentsRole"), "main should use shared admin and assignment permissions");
assert(adminShellSource.includes("canUseAdminRole") && adminShellSource.includes("canManageAssignmentsRole"), "admin shell should use shared admin and assignment permissions");
assert(assignmentSource.includes("canBeAssignmentPm") && assignmentSource.includes("canBeAssignmentSales") && assignmentSource.includes("canBeAssignmentMember"), "assignment panel should use shared candidate role helpers");
assert(aiSource.includes('from "./utils/permissions.js"'), "AI workspace should import shared permission helpers");
assert(uploadSource.includes('import { canCreateProjectRole } from "./utils/permissions.js";'), "upload dialog should import shared create-project permission");
assert(collectionSource.includes('import { canUseCollectionRole } from "./utils/permissions.js";'), "collection assistant should import shared collection permission");
assert(approvalSource.includes('from "./utils/permissions.js"') && approvalSource.includes("approvalTypeOptionsFor") && approvalSource.includes("canSubmitSupplierPaymentRole"), "approval funds should import shared approval type options and supplier payment permission");
assert(projectDetailSource.includes("canRecordPaymentRole") && projectDetailSource.includes("canHandleProjectAlertRole"), "project detail should import shared payment and alert permissions");

for (const [name, source] of [["main", mainSource], ["admin shell", adminShellSource], ["assignment", assignmentSource], ["ai", aiSource], ["upload", uploadSource], ["collection", collectionSource], ["approval", approvalSource], ["project detail", projectDetailSource]]) {
  assert(!source.includes("const managementRoles"), `${name} should not redefine management roles`);
  assert(!source.includes("const adminRoles"), `${name} should not redefine admin roles`);
  assert(!source.includes("const assignmentManageRoles"), `${name} should not redefine assignment roles`);
  assert(!source.includes("const assignmentPmCandidateRoles"), `${name} should not redefine assignment PM candidate roles`);
  assert(!source.includes("const assignmentSalesCandidateRoles"), `${name} should not redefine assignment sales candidate roles`);
  assert(!source.includes("const assignmentMemberExcludedRoles"), `${name} should not redefine assignment member excluded roles`);
  assert(!source.includes("const projectCreateRoles"), `${name} should not redefine project create roles`);
  assert(!source.includes("const collectionRoles"), `${name} should not redefine collection roles`);
  assert(!source.includes("const paymentRecordRoles"), `${name} should not redefine payment roles`);
  assert(!source.includes("const projectAlertHandleRoles"), `${name} should not redefine project alert roles`);
  assert(!source.includes("function canSeeManagement("), `${name} should not redefine canSeeManagement`);
  assert(!source.includes("function canUseAdminRole("), `${name} should not redefine canUseAdminRole`);
  assert(!source.includes("function canManageAssignmentsRole("), `${name} should not redefine canManageAssignmentsRole`);
  assert(!source.includes("function canBeAssignmentPm("), `${name} should not redefine canBeAssignmentPm`);
  assert(!source.includes("function canBeAssignmentSales("), `${name} should not redefine canBeAssignmentSales`);
  assert(!source.includes("function canBeAssignmentMember("), `${name} should not redefine canBeAssignmentMember`);
  assert(!source.includes("function canCreateProjectRole("), `${name} should not redefine canCreateProjectRole`);
  assert(!source.includes("function canUseCollectionRole("), `${name} should not redefine canUseCollectionRole`);
  assert(!source.includes("function approvalTypeOptionsFor("), `${name} should not redefine approvalTypeOptionsFor`);
}

console.log("frontend permission utils regression passed");
