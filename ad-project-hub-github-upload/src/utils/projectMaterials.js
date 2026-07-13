import { money } from "./format.js";

export function fileKindLabel(source = "") {
  const text = String(source || "").toLowerCase();
  if (/quote|报价/.test(text)) return "报价表";
  if (/verification|核销/.test(text)) return "核销表";
  if (/execution|cost|成本|费用/.test(text)) return "成本表";
  if (/contract|合同/.test(text)) return "合同";
  return "文件";
}

export function materialMatches(materialKey, text = "") {
  if (materialKey === "contract") return /合同|contract|协议|甲方|乙方/i.test(text);
  if (materialKey === "quote") return /报价|quote|刊例|报价单|报价表/i.test(text);
  if (materialKey === "cost") return /成本|费用|execution|cost|供应商结算|利润测算/i.test(text);
  if (materialKey === "verification") return /核销|verification|验收|月度/i.test(text);
  return false;
}

export function materialStatusLabel(item = {}) {
  if (item.status === "parsed") return "已解析";
  if (item.status === "review") return "需复核";
  if (item.status === "parsing") return "解析中";
  if (item.status === "uploaded") return "已上传";
  return "待补";
}

export function projectMaterialStatus(project = {}, files = [], jobs = []) {
  const allFiles = [
    ...(project.files || []),
    ...files,
    ...jobs.flatMap((job) => job.files || [])
  ];
  const extracted = project.extractedFields || {};
  const revenue = extracted.revenueRecognition || {};
  const specs = [
    {
      key: "contract",
      label: "合同",
      uploadType: "create-project",
      parsed: Boolean(project.contract),
      review: Boolean(project.contract) && (!project.client || !project.paymentDue || project.paymentDue === "待确认回款节点"),
      emptyTip: "请上传合同或补充合同金额"
    },
    {
      key: "quote",
      label: "报价表",
      uploadType: "quote-sheet",
      parsed: Boolean(revenue.quoteRules?.length || extracted.quoteRules?.length || extracted.revenueRules?.length),
      review: Boolean(revenue.quoteRules?.length) && !revenue.updatedAt,
      emptyTip: "建议上传报价表，方便后续核销匹配"
    },
    {
      key: "cost",
      label: "成本表",
      uploadType: "cost-sheet",
      parsed: Boolean(project.costUsed || (project.costs || []).some((row) => Number(Array.isArray(row) ? row[1] : row.amount) > 0)),
      review: Boolean(project.costBudget && project.costUsed > project.costBudget),
      emptyTip: "执行成本还不完整，建议补成本表或报销记录"
    },
    {
      key: "verification",
      label: "核销表",
      uploadType: "verification-sheet",
      parsed: Boolean(revenue.verificationRecords?.length || extracted.verifications?.length || extracted.verificationRecords?.length),
      review: Boolean((revenue.verificationRecords || []).some((record) => String(record.status || "").includes("复核"))),
      emptyTip: "月度核销表待补，影响回款判断"
    },
  ];
  const items = specs.map((spec) => {
    const matchedFiles = allFiles.filter((file) => materialMatches(spec.key, `${file.name || ""} ${file.category || ""} ${file.source || ""} ${file.type || ""}`));
    const matchedJobs = jobs.filter((job) => materialMatches(spec.key, `${job.projectName || ""} ${job.status || ""} ${(job.files || []).map((file) => file.name || file.category || "").join(" ")}`));
    const parsing = matchedJobs.some((job) => !/完成|失败/.test(String(job.status || "")) && Number(job.progress || 0) < 100);
    const failed = matchedJobs.some((job) => /失败|错误/.test(String(job.status || "")));
    const status = failed || spec.review
      ? "review"
      : spec.parsed
        ? "parsed"
        : parsing
          ? "parsing"
          : matchedFiles.length
            ? "uploaded"
            : "missing";
    return {
      ...spec,
      done: status === "parsed",
      status,
      statusLabel: materialStatusLabel({ status }),
      files: matchedFiles,
      jobs: matchedJobs,
      tip: status === "missing"
        ? spec.emptyTip
        : status === "uploaded"
          ? "文件已上传，等待 AI 解析或确认入库"
          : status === "parsing"
            ? "AI 正在解析，请稍后刷新查看结果"
            : status === "review"
              ? "已发现需复核信息，请查看解析结果或补充字段"
              : "材料已归档并进入项目数据"
    };
  });
  return {
    items,
    missing: items.filter((item) => item.status === "missing" || item.status === "review"),
    doneCount: items.filter((item) => item.done).length
  };
}

export function projectActionItems({ project, files, jobs, approvals, health, isManagement, feishuPending = [] }) {
  const materials = projectMaterialStatus(project, files, jobs);
  const pendingApprovals = approvals.filter((item) => String(item.status || "").includes("待"));
  const receivable = Number(project.receivable || 0);
  const costRate = project.costBudget ? Math.round((Number(project.costUsed || 0) / Number(project.costBudget || 1)) * 100) : 0;
  const actions = [];
  const pendingFeishuCount = feishuPending.filter((item) => item.status === "待确认").length;
  if (pendingFeishuCount) {
    actions.push({
      tone: "warn",
      title: "确认飞书文件",
      text: `${pendingFeishuCount} 个飞书文件等待确认，确认前不会写入项目成本/报价/核销。`
    });
  }
  if (materials.missing.length) {
    actions.push({
      tone: "warn",
      title: `补齐${materials.missing.map((item) => item.label).join("、")}`,
      text: materials.missing[0].tip
    });
  } else {
    actions.push({ tone: "good", title: "关键材料完整", text: "合同、报价、成本和核销材料都有记录，可以进入更细的复盘和回款跟进。" });
  }
  if (health.label === "滞后") actions.push({ tone: "danger", title: "进度需要追赶", text: health.text });
  if (receivable > 0) actions.push({ tone: "warn", title: "跟进项目回款", text: `当前待回款 ${money(receivable)}，回款节点：${project.paymentDue || "待确认"}。` });
  if (pendingApprovals.length) actions.push({ tone: "warn", title: "处理待审批", text: `${pendingApprovals.length} 条审批仍在流程中，可能影响备用金、报销或供应商付款。` });
  if (isManagement && costRate >= 85) actions.push({ tone: "danger", title: "成本接近预算", text: `已使用预算 ${costRate}%，建议冻结非必要新增支出。` });
  return actions.slice(0, 5);
}

export function projectAiAdvice({ project, materialStatus, approvals, health, isManagement, feishuPending = [] }) {
  const advice = [];
  const pendingFeishuCount = feishuPending.filter((item) => item.status === "待确认").length;
  if (pendingFeishuCount) {
    advice.push(`先处理 ${pendingFeishuCount} 个飞书待确认文件，避免项目材料已经到群里但还没入库。`);
  }
  if (materialStatus.missing.length) {
    advice.push(`优先补齐${materialStatus.missing.map((item) => item.label).join("、")}，否则后续成本归集、核销和回款判断会不完整。`);
  }
  if (health.label === "滞后") advice.push("当前完成度落后于时间进度，建议 PM 明确本周交付物，并把客户确认材料先归档。");
  if (Number(project.receivable || 0) > 0) advice.push(`待回款 ${money(project.receivable)}，建议销售结合节点「${project.paymentDue || "待确认"}」跟进客户确认。`);
  if (approvals.some((item) => String(item.status || "").includes("待"))) advice.push("项目内仍有待处理审批，可能影响执行备用金、报销或供应商付款。");
  if (isManagement && Number(project.margin || 0) < 25) advice.push("该项目毛利率偏低，管理层应复盘报价、供应商支出和临时追加成本。");
  if (!advice.length) advice.push("项目关键材料和节奏较稳定，可以提前准备下月核销、客户确认和结案复盘材料。");
  return advice.slice(0, 4);
}
