import assert from "node:assert/strict";
import { previewProjectUpload } from "../server/services.mjs";

const user = { id: "u-admin", name: "中台管理员", role: "admin" };

const db = {
  settings: {},
  projects: [],
  files: [],
  parseJobs: [],
  auditLogs: [],
  suppliers: []
};

const contractFile = {
  name: "捷途合同与报价表.pdf",
  type: "application/pdf",
  size: 2048,
  text: `甲方：芜湖捷途汽车销售有限公司
乙方：上海青品广告有限公司
合同附件报价表
运营期内千万播放量视频不低于1支
投标报价表
合计（元） 2005080
合计/万（元） 187.07
项目最终优惠总价（元） 1870700
服务周期：2025年3月1日至2026年2月28日
第15页 / 共18页
数量 130`
};

const preview = await previewProjectUpload(db, {
  type: "create-project",
  values: { "负责人": "中台管理员" },
  files: [contractFile]
}, user);

assert.equal(preview.fields["合同金额"], 1870700, "合同上传预览应优先识别项目最终优惠总价，不能被数量 130 覆盖");
assert.equal(preview.fields["待回款"], 1870700, "未实际回款时，待回款应与最终合同金额一致");
assert(preview.sections.some((section) => section.title === "AI 文件归类"), "上传预览应展示每个文件的 AI 归类结果");
assert.equal(preview.fields["客户 / 品牌"], "芜湖捷途汽车销售有限公司", "合同上传预览应识别甲方为客户");
assert(preview.warnings.some((warning) => warning.includes("已识别合同金额") && warning.includes("1,870,700")), "合同上传预览应提示用户核对已识别金额");
assert(!preview.warnings.some((warning) => warning.includes("合同金额未明确识别")), "明确金额不应触发未识别警告");

console.log("contract upload preview regression passed");

const splitFilePreview = await previewProjectUpload(db, {
  type: "create-project",
  values: { "负责人": "中台管理员" },
  files: [
    {
      name: "2025年捷途纵横合同.pdf",
      type: "application/pdf",
      size: 1024,
      text: "甲方：芜湖捷途汽车销售有限公司\n乙方：上海青品广告有限公司\n合同附件报价合计（元） 2005080"
    },
    {
      name: "2025捷途纵横报价表.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 512,
      text: "投标报价表\n合计（元） 2005080\n项目最终优惠总价（元） 1870700"
    }
  ]
}, user);

assert.equal(splitFilePreview.fields["合同金额"], 1870700, "合同与报价表分开上传时也应优先采用最终优惠总价");
assert.equal(splitFilePreview.fields["待回款"], 1870700, "双文件未回款项目的待回款应与最终优惠价一致");
assert.deepEqual(splitFilePreview.sections.find((section) => section.title === "AI 文件归类")?.rows.map((row) => row.status), ["项目合同", "合同报价表"], "双文件预览应显示逐文件归类");

console.log("split contract and quote preview regression passed");
