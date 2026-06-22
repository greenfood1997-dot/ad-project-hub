import assert from "node:assert/strict";
import { uploadProjectVerificationSheet } from "../server/services.mjs";

const user = { id: "u-pm", name: "项目PM", role: "pm" };

function createDb() {
  return {
  projects: [{
    id: "P-1",
    name: "2025年捷途营销高端产品序列新媒体账号运营项目",
    client: "芜湖捷途汽车销售有限公司",
    contract: 1000000,
    paid: 0,
    receivable: 1000000,
    files: [],
    extractedFields: {
      revenueRecognition: {
        quoteRules: [{
          id: "QR-1",
          serviceName: "短视频发布",
          description: "官方账号短视频内容发布",
          quantity: 30,
          unit: "条",
          unitPrice: 10000,
          totalAmount: 300000
        }, {
          id: "QR-2",
          serviceName: "创意内容短视频",
          description: "创意内容短视频制作发布",
          quantity: 20,
          unit: "支",
          unitPrice: 12000,
          totalAmount: 240000
        }]
      }
    }
  }],
  files: [],
  auditLogs: []
  };
}

const db = createDb();
const result = await uploadProjectVerificationSheet(db, {
  id: "P-1",
  files: [{
    name: "工作簿2.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "verification-sheet",
    tableRows: [
      { sheetName: "6月核销", cells: ["月份", "项目", "确认收入", "本月核销条数", "备注"] },
      { sheetName: "6月核销", cells: ["2026年6月", "短视频发布", "50000", "5", "已完成发布"] }
    ],
    text: "工作表：6月核销\n月份\t项目\t确认收入\t本月核销条数\t备注\n2026年6月\t短视频发布\t50000\t5\t已完成发布"
  }]
}, user);

assert.equal(result.record.items.length, 1);
assert.equal(result.record.amount, 50000);
assert.equal(result.record.paymentStatus, "未回款");
assert.equal(result.record.unpaidAmount, 50000);
assert.equal(result.record.items[0].quantity, 5);
assert.equal(result.record.items[0].matchedRuleId, "QR-1");
assert.equal(db.projects[0].extractedFields.revenueRecognition.verificationRecords.length, 1);

const quoteTailDb = createDb();
const quoteTailResult = await uploadProjectVerificationSheet(quoteTailDb, {
  id: "P-1",
  files: [{
    name: "三月核销.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "verification-sheet",
    tableRows: [
      { sheetName: "报价明细", cells: ["服务类别", "服务内容", "详细描述", "数量", "单位", "单价", "小计", "三月核销费用"] },
      { sheetName: "报价明细", cells: ["视频", "创意内容短视频", "创意内容短视频制作发布", "20", "支", "12000", "240000", "96000"] },
      { sheetName: "报价明细", cells: ["视频", "短视频发布", "官方账号短视频内容发布", "30", "条", "10000", "300000", ""] }
    ],
    text: "工作表：报价明细\n服务类别\t服务内容\t详细描述\t数量\t单位\t单价\t小计\t三月核销费用\n视频\t创意内容短视频\t创意内容短视频制作发布\t20\t支\t12000\t240000\t96000"
  }]
}, user);

assert.equal(quoteTailResult.record.items.length, 1);
assert.equal(quoteTailResult.record.amount, 96000);
assert.equal(quoteTailResult.record.items[0].quantity, 0);
assert.equal(quoteTailResult.record.items[0].matchedRuleId, "QR-2");
assert.equal(quoteTailResult.record.paymentStatus, "未回款");

const quoteOnlyDb = createDb();
await assert.rejects(
  uploadProjectVerificationSheet(quoteOnlyDb, {
    id: "P-1",
    files: [{
      name: "原始报价表.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      category: "verification-sheet",
      tableRows: [
        { sheetName: "报价明细", cells: ["服务类别", "服务内容", "详细描述", "数量", "单位", "单价（元）", "小计（元）", "备注"] },
        { sheetName: "报价明细", cells: ["视频", "创意内容短视频", "创意内容短视频制作发布", "20", "支", "12000", "240000", ""] },
        { sheetName: "报价明细", cells: ["视频", "短视频发布", "官方账号短视频内容发布", "30", "条", "10000", "300000", ""] }
      ],
      text: "工作表：报价明细\n服务类别\t服务内容\t详细描述\t数量\t单位\t单价（元）\t小计（元）\t备注"
    }]
  }, user),
  /未识别到核销条数或核销金额/
);

console.log("verification parser regression passed");
