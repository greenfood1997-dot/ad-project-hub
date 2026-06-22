import assert from "node:assert/strict";
import { uploadProjectQuoteSheet, uploadProjectVerificationSheet } from "../server/services.mjs";

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
        }, {
          id: "QR-3",
          serviceName: "捷途汽车创意内容",
          description: "15-120s短视频 常规内容热点内容",
          quantity: 120,
          unit: "支",
          unitPrice: 4680,
          totalAmount: 561600
        }, {
          id: "QR-4",
          serviceName: "捷途汽车精品内容",
          description: "15-120s短视频 精品化内容制作",
          quantity: 24,
          unit: "支",
          unitPrice: 11700,
          totalAmount: 280800
        }, {
          id: "QR-5",
          serviceName: "捷途汽车TVC内容",
          description: "15-120s短视频 TVC水准内容",
          quantity: 4,
          unit: "次",
          unitPrice: 78000,
          totalAmount: 312000
        }, {
          id: "QR-6",
          serviceName: "事件营销内容",
          description: "15-120s短视频 事件营销策划",
          quantity: 12,
          unit: "个",
          unitPrice: 3900,
          totalAmount: 46800
        }, {
          id: "QR-7",
          serviceName: "二创内容",
          description: "素材剪辑发布",
          quantity: 60,
          unit: "支",
          unitPrice: 2340,
          totalAmount: 140400
        }]
      }
    }
  }],
  files: [],
  auditLogs: []
  };
}

const db = createDb();
const quoteDb = createDb();
quoteDb.projects[0].extractedFields.revenueRecognition.quoteRules = [];
const quoteUpload = await uploadProjectQuoteSheet(quoteDb, {
  id: "P-1",
  files: [{
    name: "报价表.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "quote-sheet",
    dataUrl: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAAA",
    tableRows: [
      { sheetName: "报价", cells: ["服务类别", "服务内容", "详细描述", "完成数量", "数量", "单位", "单价", "小计"] },
      { sheetName: "报价", cells: ["视频", "短视频发布", "官方账号短视频内容发布", "5支", "5", "条", "10000", "50000"] }
    ],
    text: "报价"
  }]
}, user);
assert.equal(quoteUpload.project.extractedFields.revenueRecognition.quoteFiles[0].dataUrl, "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAAA");

const result = await uploadProjectVerificationSheet(db, {
  id: "P-1",
  files: [{
    name: "工作簿2.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "verification-sheet",
    dataUrl: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,BBBB",
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
assert.equal(result.record.files[0].dataUrl, "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,BBBB");
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

const summaryDb = createDb();
const summaryResult = await uploadProjectVerificationSheet(summaryDb, {
  id: "P-1",
  files: [{
    name: "纵横三月核销.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "verification-sheet",
    tableRows: [
      { sheetName: "Sheet1", cells: ["服务类别", "服务内容", "详细描述", "完成数量", "数量", "单位", "单价（元）", "小计（元）", "备注", "", "3月核销"] },
      { sheetName: "Sheet1", cells: ["运营方案", "账号完整运营方案", "账号全年完整运营方案及全景策略规划", "根据品牌调性", "1", "次", "39000", "39000", "/", "", "39000"] },
      { sheetName: "Sheet1", cells: ["视频制作", "", "捷途汽车创意内容，15-120s短视频", "10支以上/月", "120", "支", "4680", "561600", "", "", "88920"] },
      { sheetName: "Sheet1", cells: ["", "", "捷途汽车精品内容，15-120s短视频", "2支以上/月", "24", "支", "11700", "280800", "", "", "93600"] },
      { sheetName: "Sheet1", cells: ["", "", "捷途汽车TVC内容，15-120s短视频", "1支以上/季度", "4", "次", "78000", "312000", "", "", "78000"] },
      { sheetName: "Sheet1", cells: ["", "", "事件营销内容，15-120s短视频", "每月不少于1个", "12", "个", "3900", "46800", "", "", "3900"] },
      { sheetName: "Sheet1", cells: ["", "", "二创内容", "服务期内不高于60支", "60", "支", "2340", "140400", "", "", "23400"] },
      { sheetName: "Sheet1", cells: ["合计（元）", "", "", "", "", "", "", "2005080", "", "视频", "326820"] },
      { sheetName: "Sheet1", cells: ["合计/月/（元）", "", "", "", "", "", "", "167090", "", "投流", "15399.7"] },
      { sheetName: "Sheet1", cells: ["项目最终优惠总价（元）", "", "", "", "", "", "", "2000000", "", "垫款", "8000"] },
      { sheetName: "Sheet1", cells: ["项目最终优惠总价（元）/月", "", "", "", "", "", "", "166666.67", "", "总数", "352325.673"] }
    ],
    text: "工作表：Sheet1\n服务类别\t服务内容\t详细描述\t完成数量\t数量\t单位\t单价（元）\t小计（元）\t备注\t\t3月核销"
  }]
}, user);

assert.equal(summaryResult.record.amount, 352325.673);
assert.equal(summaryResult.record.unpaidAmount, 352325.673);
assert.equal(summaryResult.record.summary.totalAmount, 352325.673);
assert.equal(summaryResult.record.summary.breakdown.length, 3);
assert.equal(summaryResult.record.items.reduce((sum, item) => sum + Number(item.amount || 0), 0), 326820);

console.log("verification parser regression passed");
