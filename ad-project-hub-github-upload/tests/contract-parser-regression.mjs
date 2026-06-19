import assert from "node:assert/strict";
import { createProject } from "../server/services.mjs";

const user = { id: "u-admin", name: "管理员", role: "admin" };

async function parseContract(text) {
  const db = { settings: {}, projects: [], parseJobs: [], auditLogs: [], suppliers: [] };
  const result = await createProject(
    db,
    { "负责人": "周敏" },
    [{ name: "合同.txt", type: "text/plain", size: text.length, text }],
    user
  );
  return result.project;
}

const cases = [
  {
    name: "2856万元 with years and tax number",
    text: `合同编号：HT2022-0601
甲方：上海青岚汽车有限公司
乙方：上海星河广告有限公司
签订日期：2022年6月1日
统一社会信用代码：913100002022000000
合同金额：人民币2856万元整
服务期限：自2022年7月1日至2023年6月30日`,
    contract: 28560000,
    partyA: "上海青岚汽车有限公司",
    partyB: "上海星河广告有限公司",
    period: "2022年7月1日 至 2023年6月30日"
  },
  {
    name: "comma yuan amount with bank account noise",
    text: `甲方名称：北京晨光品牌管理有限公司
乙方名称：广州蓝海互动传媒有限公司
开户账号：62220222060188889999
项目总价：28,560,000元
合同期限：2024-01-15 至 2024-12-31`,
    contract: 28560000,
    partyA: "北京晨光品牌管理有限公司",
    partyB: "广州蓝海互动传媒有限公司",
    period: "2024-01-15 至 2024-12-31"
  },
  {
    name: "uppercase chinese amount",
    text: `委托方：杭州鹿鸣科技有限公司
受托方：上海禾木广告有限公司
合同价款为人民币贰仟捌佰伍拾陆万元整。
合作期限从2025年3月1日到2025年9月30日。`,
    contract: 28560000,
    partyA: "杭州鹿鸣科技有限公司",
    partyB: "上海禾木广告有限公司",
    period: "2025年3月1日 至 2025年9月30日"
  },
  {
    name: "decimal wan amount and phone noise",
    text: `客户：深圳知夏食品有限公司
服务商：上海启明文化传播有限公司
联系电话：13820222022
服务费用总额：人民币2856.5万元
服务周期：2026年1月1日-2026年3月31日`,
    contract: 28565000,
    partyA: "深圳知夏食品有限公司",
    partyB: "上海启明文化传播有限公司",
    period: "2026年1月1日 至 2026年3月31日"
  },
  {
    name: "yi unit amount",
    text: `甲方：成都云杉集团有限公司
乙方：北京远山营销顾问有限公司
总金额：人民币1.2亿元
履行期限：自2026年04月01日起至2026年12月31日止`,
    contract: 120000000,
    partyA: "成都云杉集团有限公司",
    partyB: "北京远山营销顾问有限公司",
    period: "2026年04月01日 至 2026年12月31日"
  },
  {
    name: "plain wan amount with project code noise",
    text: `项目编号：AD-2022-2856
甲方：南京晴川电子商务有限公司
乙方：上海有光广告有限公司
合同金额 2856万
项目周期：2023年5月10日—2023年8月10日`,
    contract: 28560000,
    partyA: "南京晴川电子商务有限公司",
    partyB: "上海有光广告有限公司",
    period: "2023年5月10日 至 2023年8月10日"
  },
  {
    name: "comma wan amount",
    text: `甲方：苏州星野食品有限公司
乙方：杭州鲸跃传媒有限公司
合同总金额：人民币2,856万元
服务期间：2024年02月01日至2024年11月30日`,
    contract: 28560000,
    partyA: "苏州星野食品有限公司",
    partyB: "杭州鲸跃传媒有限公司",
    period: "2024年02月01日 至 2024年11月30日"
  },
  {
    name: "plain yuan decimal amount",
    text: `采购方：武汉明台汽车销售有限公司
承包方：上海清越文化传媒有限公司
合同价：28560000.00元
执行周期：2025-06-01~2025-10-31`,
    contract: 28560000,
    partyA: "武汉明台汽车销售有限公司",
    partyB: "上海清越文化传媒有限公司",
    period: "2025-06-01 至 2025-10-31"
  },
  {
    name: "large uppercase amount",
    text: `甲方：上海观澜科技集团有限公司
乙方：北京长河互动有限公司
人民币大写：贰亿零叁佰万元整
合同有效期：2026年1月1日至2026年12月31日`,
    contract: 203000000,
    partyA: "上海观澜科技集团有限公司",
    partyB: "北京长河互动有限公司",
    period: "2026年1月1日 至 2026年12月31日"
  }
];

const randomCases = buildRandomCases(100);
const fuzzCases = buildFuzzCases(100);

for (const item of cases) {
  const project = await parseContract(item.text);
  assert.equal(project.contract, item.contract, `${item.name}: contract`);
  assert.equal(project.client, item.partyA, `${item.name}: partyA/client`);
  assert.equal(project.extractedFields.partyB, item.partyB, `${item.name}: partyB`);
  assert.equal(project.extractedFields.servicePeriod, item.period, `${item.name}: period`);
}

for (const item of randomCases) {
  const project = await parseContract(item.text);
  assert.equal(project.contract, item.contract, `${item.name}: contract`);
  assert.equal(project.client, item.partyA, `${item.name}: partyA/client`);
  assert.equal(project.extractedFields.partyB, item.partyB, `${item.name}: partyB`);
  assert.equal(project.extractedFields.servicePeriod, item.period, `${item.name}: period`);
}

for (const item of fuzzCases) {
  const project = await parseContract(item.text);
  assert.equal(project.contract, item.contract, `${item.name}: contract`);
  assert.equal(project.client, item.partyA, `${item.name}: partyA/client`);
  assert.equal(project.extractedFields.partyB, item.partyB, `${item.name}: partyB`);
  assert.equal(project.extractedFields.servicePeriod, item.period, `${item.name}: period`);
}

console.log(`Passed ${cases.length} fixed cases, ${randomCases.length} seeded random cases, and ${fuzzCases.length} numeric fuzz cases.`);

function buildRandomCases(count) {
  const rand = createSeededRandom(20260619);
  const partyAs = ["上海青岚汽车有限公司", "北京晨光品牌管理有限公司", "深圳知夏食品有限公司", "成都云杉集团有限公司", "南京晴川电子商务有限公司"];
  const partyBs = ["上海星河广告有限公司", "广州蓝海互动传媒有限公司", "上海启明文化传播有限公司", "北京远山营销顾问有限公司", "杭州鲸跃传媒有限公司"];
  const amountLabels = ["合同金额", "合同总金额", "合同价款", "项目总价", "服务费用总额", "总金额"];
  const partyALabels = ["甲方", "甲方名称", "委托方", "采购方", "客户"];
  const partyBLabels = ["乙方", "乙方名称", "受托方", "承包方", "服务商"];
  const periodLabels = ["服务期限", "合同期限", "合作期限", "项目周期", "履行期限"];
  const templates = [
    (amount) => `人民币${formatWan(amount)}万元整`,
    (amount) => `${formatWan(amount)}万`,
    (amount) => `￥${formatNumber(amount)}元`,
    (amount) => `${formatNumber(amount)}元`,
    (amount) => amount >= 100000000 && amount % 1000000 === 0 ? `人民币${trimDecimal(amount / 100000000)}亿元` : `人民币${formatWan(amount)}万元`
  ];

  return Array.from({ length: count }, (_, index) => {
    const partyA = pick(rand, partyAs);
    const partyB = pick(rand, partyBs.filter((name) => name !== partyA));
    const amountWan = randomInt(rand, 1, 9999) + (rand() > 0.8 ? 0.5 : 0);
    const amount = Math.round(amountWan * 10000);
    const year = randomInt(rand, 2020, 2028);
    const startMonth = randomInt(rand, 1, 9);
    const startDay = randomInt(rand, 1, 20);
    const endMonth = randomInt(rand, startMonth + 1, 12);
    const endDay = randomInt(rand, 21, 28);
    const start = `${year}年${startMonth}月${startDay}日`;
    const end = `${year}年${endMonth}月${endDay}日`;
    const amountText = pick(rand, templates)(amount);
    const projectCode = `AD-${year}-${randomDigits(rand, 4)}-${randomDigits(rand, 3)}`;
    const phone = `13${randomDigits(rand, 9)}`;
    const taxNo = `91310000${randomDigits(rand, 10)}`;

    return {
      name: `seeded random ${index + 1}`,
      text: `合同编号：${projectCode}
${pick(rand, partyALabels)}：${partyA}
${pick(rand, partyBLabels)}：${partyB}
签订日期：${year - 1}年${randomInt(rand, 1, 12)}月${randomInt(rand, 1, 28)}日
联系电话：${phone}
统一社会信用代码：${taxNo}
${pick(rand, amountLabels)}：${amountText}
${pick(rand, periodLabels)}：自${start}至${end}`,
      contract: amount,
      partyA,
      partyB,
      period: `${start} 至 ${end}`
    };
  });
}

function buildFuzzCases(count) {
  const rand = createSeededRandom(909090);
  return Array.from({ length: count }, (_, index) => {
    const amountWan = randomInt(rand, 1, 9999);
    const amount = amountWan * 10000;
    const year = randomInt(rand, 2020, 2028);
    const partyA = `甲方${randomDigits(rand, 3)}科技有限公司`;
    const partyB = `乙方${randomDigits(rand, 3)}传媒有限公司`;
    const start = `${year}年${randomInt(rand, 1, 6)}月${randomInt(rand, 1, 20)}日`;
    const end = `${year}年${randomInt(rand, 7, 12)}月${randomInt(rand, 21, 28)}日`;
    const numericNoise = Array.from({ length: 12 }, () => {
      const length = randomInt(rand, 1, 18);
      return pick(rand, [
        `随机编号：${randomDigits(rand, length)}`,
        `附件页码：${randomDigits(rand, length)}`,
        `内部流水：NO${randomDigits(rand, length)}`,
        `历史年份：${randomInt(rand, 1990, 2035)}年`,
        `账号：${randomDigits(rand, Math.max(8, length))}`
      ]);
    }).join("\n");

    return {
      name: `numeric fuzz ${index + 1}`,
      text: `${numericNoise}
甲方：${partyA}
乙方：${partyB}
合同金额：人民币${amountWan}万元
服务期限：自${start}至${end}
${numericNoise}`,
      contract: amount,
      partyA,
      partyB,
      period: `${start} 至 ${end}`
    };
  });
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(rand, items) {
  return items[Math.floor(rand() * items.length)];
}

function randomInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomDigits(rand, length) {
  return Array.from({ length }, () => randomInt(rand, 0, 9)).join("");
}

function formatWan(amount) {
  return trimDecimal(amount / 10000);
}

function formatNumber(amount) {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function trimDecimal(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}
