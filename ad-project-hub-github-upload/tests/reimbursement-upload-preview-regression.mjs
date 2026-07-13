import assert from "node:assert/strict";
import { previewProjectUpload } from "../server/services.mjs";

const db = {
  settings: {},
  projects: [{
    id: "p-jietu",
    name: "捷途项目",
    client: "捷途",
    owner: "中台管理员",
    contract: 1870700,
    paid: 0,
    receivable: 1870700,
    costs: [],
    extractedFields: {}
  }],
  files: [],
  parseJobs: [],
  auditLogs: [],
  suppliers: []
};

const user = { id: "u-admin", name: "中台管理员", role: "admin" };

const file = {
  name: "项目报销表20260303捷途（2月）.xlsx",
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size: 1024,
  text: `工作表：项目报表明细
项目报表明细
项目名称\t捷途（2026.2月份）
公司名称（客户）\t捷途
序号\t姓名\t参与部分\t时间\t周期/天\t具体事项\t金额\t备注
1\t邓志聪\t\t\t\t打车\t504.08\t捷途
2\t邓志聪\t\t\t\t加油费用\t625.83\t捷途
3\t邓志聪\t\t\t\t高速路费\t282\t捷途
4\t邓志聪\t\t\t\t餐费\t142.3\t捷途
14\t\t\t\t\t总计\t1554.21\t`
};

const preview = await previewProjectUpload(db, {
  type: "cost-sheet",
  id: "p-jietu",
  files: [file]
}, user);

const reimbursementSection = preview.sections.find((section) => section.title === "员工报销/项目报销明细");
assert(reimbursementSection, "项目报销表应显示为员工报销/项目报销明细");
assert.equal(reimbursementSection.total, 1554.21, "报销明细总额应保持正确");
assert(reimbursementSection.rows.some((row) => row.name.includes("打车") && row.status === "拍摄交通"), "打车应归类为拍摄交通");
assert(reimbursementSection.rows.some((row) => row.name.includes("餐费") && row.status === "餐饮"), "餐费应归类为餐饮");
assert(!preview.sections.some((section) => section.title === "供应商支出"), "内部报销表不应预览为供应商支出");
assert(preview.warnings.some((warning) => warning.includes("内部报销")), "预览应提示内部报销语义");

console.log("reimbursement upload preview regression passed");
