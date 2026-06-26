import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeReq(method, path, userId, body = undefined) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return {
    method,
    url: path,
    headers: {
      "x-user-id": userId,
      "content-type": "application/json"
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    }
  };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    json() {
      const text = Buffer.concat(this.chunks).toString("utf8");
      return text ? JSON.parse(text) : {};
    }
  };
}

async function api(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  const payload = res.json();
  if (res.statusCode >= 400 || payload.ok === false) {
    throw new Error(`${method} ${path} failed: ${payload.error || res.statusCode}`);
  }
  return payload.data ?? payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteSheetFile(name = "Smoke报价表.xlsx") {
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "quote-sheet",
    tableRows: [
      { sheetName: "报价", cells: ["服务类别", "服务内容", "详细描述", "完成数量", "数量", "单位", "单价", "小计"] },
      { sheetName: "报价", cells: ["视频", "短视频发布", "官方账号短视频内容发布", "5支", "5", "条", "10000", "50000"] }
    ],
    text: "工作表：报价\n服务类别\t服务内容\t详细描述\t完成数量\t数量\t单位\t单价\t小计\n视频\t短视频发布\t官方账号短视频内容发布\t5支\t5\t条\t10000\t50000"
  };
}

function verificationSheetFile(name = "Smoke核销表.xlsx") {
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "verification-sheet",
    tableRows: [
      { sheetName: "6月核销", cells: ["月份", "项目", "确认收入", "本月核销条数", "备注"] },
      { sheetName: "6月核销", cells: ["2026年6月", "短视频发布", "50000", "5", "已完成发布"] }
    ],
    text: "工作表：6月核销\n月份\t项目\t确认收入\t本月核销条数\t备注\n2026年6月\t短视频发布\t50000\t5\t已完成发布"
  };
}

function costSheetFile(name = "Smoke执行成本表.csv") {
  return {
    name,
    type: "text/csv",
    category: "execution-cost",
    text: "项目,费用类型,金额\n捷途汽车测试项目,制作,1200\n捷途汽车测试项目,差旅,300"
  };
}

function browserCsvFile(name, text, category = "") {
  return {
    name,
    type: "text/csv",
    size: Buffer.byteLength(text, "utf8"),
    category,
    base64: Buffer.from(text, "utf8").toString("base64")
  };
}

const baseDb = {
  users: [
    { id: "u-shareholder", name: "公司股东", email: "owner@company.local", role: "shareholder", department: "管理层", status: "active", pin: "123456", feishuOpenId: "ou_owner" },
    { id: "u-admin", name: "中台管理员", email: "admin@company.local", role: "admin", department: "中台", status: "active", pin: "123456", feishuOpenId: "ou_admin" },
    { id: "u-director", name: "项目总监", email: "director@company.local", role: "director", department: "项目部", status: "active", pin: "123456", feishuOpenId: "ou_director" },
    { id: "u-pm", name: "项目经理", email: "pm@company.local", role: "pm", department: "项目部", status: "active", pin: "123456", feishuOpenId: "ou_pm" },
    { id: "u-sales", name: "销售成员", email: "sales@company.local", role: "sales", department: "销售部", status: "active", pin: "123456", feishuOpenId: "ou_sales" },
    { id: "u-finance", name: "财务成员", email: "finance@company.local", role: "finance", department: "财务部", status: "active", pin: "123456", feishuOpenId: "ou_finance" },
    { id: "u-member", name: "普通员工", email: "member@company.local", role: "member", department: "执行部", status: "active", pin: "123456", feishuOpenId: "ou_member" }
  ],
  settings: {
    aiService: null,
    feishu: { appId: "cli_mock_app", appSecret: "cli_mock_secret", verificationToken: "cli_mock_token", mockSend: "true" },
    interestRate: { source: "mock", annualRate: 3.45, spread: 0, fallbackRate: 3.45 },
    members: {
      items: [
        { userId: "u-member", email: "member@company.local", name: "普通员工", role: "member", department: "执行部", project: "捷途汽车测试项目" }
      ]
    }
  },
  projects: [
    {
      id: "p-smoke-1",
      name: "捷途汽车测试项目",
      client: "捷途汽车",
      owner: "项目总监",
      pm: "项目经理",
      sales: "销售成员",
      status: "执行中",
      risk: "中",
      progress: 45,
      contract: 120000,
      paid: 40000,
      receivable: 80000,
      executionBudget: 70000,
      costUsed: 30000,
      executionCost: 26000,
      advancePayment: 2000,
      advanceInterest: 100,
      internalLabor: 1000,
      overhead: 900,
      margin: 58,
      department: "项目部",
      paymentDue: "本月底前回款",
      costs: [["制作", 18000], ["差旅", 5000], ["场地", 7000]],
      extractedFields: {}
    }
  ],
  clientProfiles: [],
  suppliers: [
    { id: "s-smoke-1", project: "捷途汽车测试项目", supplier: "测试制作供应商", type: "制作", amount: 18000, status: "待结算" }
  ],
  supplierProfiles: [],
  approvals: [],
  payments: [],
  collectionScripts: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [
    {
      id: "feishu-pending-smoke-1",
      eventId: "event-smoke-1",
      chatId: "oc_smoke_chat",
      chatName: "捷途汽车测试群",
      senderId: "ou_sales",
      senderName: "销售成员",
      projectId: "p-smoke-1",
      projectName: "捷途汽车测试项目",
      uploadType: "file-reference",
      file: {
        name: "飞书测试资料.txt",
        type: "text/plain",
        size: 12,
        base64: Buffer.from("hello smoke", "utf8").toString("base64"),
        text: "hello smoke",
        source: "feishu-mock"
      },
      preview: {
        fileName: "飞书测试资料.txt",
        size: 12,
        type: "text/plain",
        uploadType: "file-reference",
        projectName: "捷途汽车测试项目",
        canConfirm: true,
        summary: "飞书测试资料"
      },
      status: "待确认",
      note: "",
      createdAt: "2026-06-26T00:00:00.000Z",
      handledAt: "",
      handledBy: ""
    },
    {
      id: "feishu-pending-smoke-2",
      eventId: "event-smoke-2",
      chatId: "oc_smoke_chat",
      chatName: "捷途汽车测试群",
      senderId: "ou_sales",
      senderName: "销售成员",
      projectId: "p-smoke-1",
      projectName: "捷途汽车测试项目",
      uploadType: "quote-sheet",
      file: quoteSheetFile("飞书报价表.xlsx"),
      preview: {
        fileName: "飞书报价表.xlsx",
        size: 128,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploadType: "quote-sheet",
        projectName: "捷途汽车测试项目",
        canConfirm: true,
        summary: "飞书报价表"
      },
      status: "待确认",
      note: "",
      createdAt: "2026-06-26T00:00:00.000Z",
      handledAt: "",
      handledBy: ""
    }
  ],
  systemNotifications: [
    {
      id: "notice-smoke-1",
      key: "notice-smoke-1",
      type: "feishu-pending-file",
      title: "飞书文件待确认",
      text: "测试待办",
      severity: "中",
      role: "pm",
      recipients: ["pm", "director"],
      projectId: "p-smoke-1",
      projectName: "捷途汽车测试项目",
      source: "feishu",
      sourceId: "feishu-pending-smoke-1",
      actionLabel: "处理文件",
      actionView: "project-files",
      status: "待处理",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z"
    }
  ],
  files: [],
  parseJobs: [],
  alertUpdates: [],
  comments: [],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(deepClone(baseDb), null, 2));

  const state = await api("GET", "/api/state", "u-admin");
  assert(state.projects.length === 1, "管理员应能读取测试项目");

  const employeeState = await api("GET", "/api/state", "u-member");
  assert(employeeState.users.length === 0, "普通员工不应读取成员敏感列表");
  assert(employeeState.settings.feishu?.configured === true, "普通员工只能看到飞书安全配置状态");

  const savedProduct = await api("POST", "/api/settings", "u-admin", {
    type: "product",
    values: {
      companyName: "Smoke 广告公司",
      operatingMode: "AI OA smoke"
    }
  });
  assert(savedProduct.companyName === "Smoke 广告公司", "产品设置应保存");

  const savedFeishu = await api("POST", "/api/settings", "u-admin", {
    type: "feishu",
    values: {
      appId: "cli_mock_app",
      appSecret: "cli_mock_secret",
      verificationToken: "cli_mock_token",
      mockSend: "true",
      mockContactsJson: JSON.stringify([{ name: "飞书同步成员", email: "sync@company.local", open_id: "ou_sync", department: "执行部" }])
    }
  });
  assert(savedFeishu.appId === "cli_mock_app", "飞书配置应保存");

  const savedWechat = await api("POST", "/api/settings", "u-admin", {
    type: "wechat",
    values: { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=smoke", corpId: "corp-smoke" }
  });
  assert(savedWechat.corpId === "corp-smoke", "企业微信配置应保存");

  const savedStorage = await api("POST", "/api/settings", "u-admin", {
    type: "storage",
    values: { provider: "oss", bucket: "ad-smoke", publicBaseUrl: "https://files.example.com" }
  });
  assert(savedStorage.bucket === "ad-smoke", "对象存储配置应保存");

  const savedApprovalRules = await api("POST", "/api/settings", "u-admin", {
    type: "approvalRules",
    values: { reimbursementDirectorThreshold: 1000, supplierDirectorThreshold: 3000 }
  });
  assert(Number(savedApprovalRules.reimbursementDirectorThreshold) === 1000, "审批规则应保存");

  const syncedContacts = await api("POST", "/api/integrations/feishu/contacts/sync", "u-admin", {});
  assert(syncedContacts.created === 1 && syncedContacts.members.some((item) => item.email === "sync@company.local"), "飞书通讯录应能同步成员");

  const newMember = await api("POST", "/api/members", "u-admin", {
    name: "Smoke 新成员",
    email: "smoke-member@company.local",
    role: "member",
    department: "执行部",
    pin: "123456",
    feishuOpenId: "ou_smoke_member"
  });
  assert(newMember.email === "smoke-member@company.local", "后台成员应能新增");

  const disabledMember = await api("POST", "/api/members/status", "u-admin", {
    id: newMember.id,
    status: "disabled"
  });
  assert(disabledMember.status === "disabled", "后台成员应能停用");

  const preview = await api("POST", "/api/projects/upload-preview", "u-sales", {
    type: "create-project",
    values: {
      "项目名称": "Smoke 新项目",
      "客户 / 品牌": "Smoke 客户",
      "负责人": "销售成员",
      "合同金额": "2000"
    },
    files: []
  });
  assert(preview.canConfirm === true && preview.fields["项目名称"] === "Smoke 新项目", "新项目上传预览应可确认");

  const createdProject = await api("POST", "/api/projects", "u-sales", {
    values: {
      "项目名称": "Smoke 新项目",
      "客户 / 品牌": "Smoke 客户",
      "负责人": "销售成员",
      "合同金额": "2000"
    },
    files: []
  });
  assert(createdProject.project?.name === "Smoke 新项目", "确认入库应创建新项目");

  let memberBlocked = false;
  try {
    await api("POST", "/api/projects/cost-sheet", "u-member", {
      id: createdProject.project.id,
      files: [costSheetFile("越权成本表.csv")]
    });
  } catch (error) {
    memberBlocked = /无权限/.test(error.message);
  }
  assert(memberBlocked, "员工不能向未分派项目上传成本表");

  const updatedProject = await api("POST", "/api/projects/update", "u-pm", {
    id: "p-smoke-1",
    values: {
      "项目名称": "捷途汽车测试项目",
      "客户 / 品牌": "捷途汽车",
      "负责人": "项目总监",
      "PM": "项目经理",
      "销售": "销售成员",
      "项目状态": "执行中",
      "合同金额": "120000",
      "已回款": "40000",
      "下一节点": "Smoke 下一节点",
      "回款节点": "Smoke 回款节点"
    }
  });
  assert(updatedProject.nextMilestone === "Smoke 下一节点" && updatedProject.paymentDue === "Smoke 回款节点", "项目详情编辑应保存");

  const quotePreview = await api("POST", "/api/projects/upload-preview", "u-pm", {
    type: "quote-sheet",
    id: "p-smoke-1",
    files: [quoteSheetFile()]
  });
  assert(quotePreview.canConfirm === true && quotePreview.sections[0]?.rows?.length === 1, "报价表上传预览应识别报价规则");

  const quoteUpload = await api("POST", "/api/projects/quote-sheet", "u-pm", {
    id: "p-smoke-1",
    files: [quoteSheetFile()]
  });
  assert(quoteUpload.rules.length === 1, "报价表确认入库应写入报价规则");

  const memberQuotePreview = await api("POST", "/api/projects/upload-preview", "u-member", {
    type: "quote-sheet",
    id: "p-smoke-1",
    files: [quoteSheetFile("成员上传报价表.xlsx")]
  });
  assert(memberQuotePreview.canConfirm === true, "已分派员工应能预览自己项目的报价表");

  const verificationPreview = await api("POST", "/api/projects/upload-preview", "u-pm", {
    type: "verification-sheet",
    id: "p-smoke-1",
    files: [verificationSheetFile()]
  });
  assert(verificationPreview.canConfirm === true && verificationPreview.sections[0]?.rows?.length === 1, "核销表上传预览应匹配报价规则");

  const verificationUpload = await api("POST", "/api/projects/verification-sheet", "u-pm", {
    id: "p-smoke-1",
    files: [verificationSheetFile()]
  });
  assert(verificationUpload.record?.amount === 50000, "核销表确认入库应生成核销收入记录");

  const costPreview = await api("POST", "/api/projects/upload-preview", "u-pm", {
    type: "cost-sheet",
    id: "p-smoke-1",
    files: [costSheetFile()]
  });
  assert(costPreview.canConfirm === true, "成本表上传预览应可确认");

  const costUpload = await api("POST", "/api/projects/cost-sheet", "u-pm", {
    id: "p-smoke-1",
    files: [costSheetFile()]
  });
  assert(costUpload.parseJob?.kind === "execution-cost", "成本表确认入库应生成执行成本解析任务");

  const memberCostUpload = await api("POST", "/api/projects/cost-sheet", "u-member", {
    id: "p-smoke-1",
    files: [costSheetFile("成员执行成本表.csv")]
  });
  assert(memberCostUpload.parseJob?.kind === "execution-cost", "已分派员工应能上传自己项目的执行成本表");

  const browserQuoteFile = browserCsvFile(
    "浏览器上传报价表.csv",
    "服务类别,服务内容,详细描述,完成数量,数量,单位,单价,小计\n视频,达人短视频,达人发布短视频,3条,3,条,8000,24000",
    "quote-sheet"
  );
  const browserQuotePreview = await api("POST", "/api/projects/upload-preview", "u-member", {
    type: "quote-sheet",
    id: "p-smoke-1",
    files: [browserQuoteFile]
  });
  assert(browserQuotePreview.canConfirm === true && browserQuotePreview.sections[0]?.rows?.length === 1, "浏览器式报价 CSV 预览应识别报价规则");
  const browserQuoteUpload = await api("POST", "/api/projects/quote-sheet", "u-member", {
    id: "p-smoke-1",
    files: [browserQuoteFile]
  });
  assert(browserQuoteUpload.rules.length === 1, "浏览器式报价 CSV 确认入库应写入报价规则");

  const browserVerificationFile = browserCsvFile(
    "浏览器上传核销表.csv",
    "月份,项目,确认收入,本月核销条数,备注\n2026年6月,达人短视频,24000,3,已完成发布",
    "verification-sheet"
  );
  const browserVerificationPreview = await api("POST", "/api/projects/upload-preview", "u-member", {
    type: "verification-sheet",
    id: "p-smoke-1",
    files: [browserVerificationFile]
  });
  assert(browserVerificationPreview.canConfirm === true, "浏览器式核销 CSV 预览应可确认");
  const browserVerificationUpload = await api("POST", "/api/projects/verification-sheet", "u-member", {
    id: "p-smoke-1",
    files: [browserVerificationFile]
  });
  assert(browserVerificationUpload.record?.amount === 24000, "浏览器式核销 CSV 确认入库应生成收入记录");

  const browserCostFile = browserCsvFile(
    "浏览器上传执行成本表.csv",
    "项目,费用类型,金额\n捷途汽车测试项目,制作,700\n捷途汽车测试项目,交通,200",
    "execution-cost"
  );
  const browserCostPreview = await api("POST", "/api/projects/upload-preview", "u-member", {
    type: "cost-sheet",
    id: "p-smoke-1",
    files: [browserCostFile]
  });
  assert(browserCostPreview.canConfirm === true, "浏览器式成本 CSV 预览应可确认");
  const browserCostUpload = await api("POST", "/api/projects/cost-sheet", "u-member", {
    id: "p-smoke-1",
    files: [browserCostFile]
  });
  assert(browserCostUpload.parseJob?.kind === "execution-cost", "浏览器式成本 CSV 确认入库应生成解析任务");

  const recordedFiles = await api("POST", "/api/files/record", "u-pm", {
    projectName: "捷途汽车测试项目",
    files: [{ name: "Smoke资料.txt", type: "text/plain", size: 5, text: "hello" }]
  });
  assert(recordedFiles.files.length === 1, "文件记录接口应保存上传记录");

  const progressedJob = await api("POST", "/api/parse-jobs/progress", "u-pm", {
    projectId: "p-smoke-1"
  });
  assert(progressedJob.projectId === "p-smoke-1", "解析任务进度接口应返回项目解析任务");

  const alertUpdate = await api("POST", "/api/alerts/update", "u-pm", {
    project: "捷途汽车测试项目",
    action: "resolve",
    note: "Smoke 已处理预警"
  });
  assert(alertUpdate.action === "resolve", "预警处理应保存记录");

  const comment = await api("POST", "/api/comments", "u-member", {
    project: "捷途汽车测试项目",
    body: "Smoke 项目进展记录"
  });
  assert(comment.body === "Smoke 项目进展记录", "项目评论应保存");

  const assignmentsBefore = await api("GET", "/api/project-assignments", "u-admin");
  assert(assignmentsBefore.some((item) => item.id === "p-smoke-1"), "项目分派列表应读取真实项目");

  const assignment = await api("POST", "/api/project-assignments", "u-admin", {
    projectId: "p-smoke-1",
    pmId: "u-pm",
    salesId: "u-sales",
    memberIds: ["u-member"],
    department: "项目部"
  });
  assert(assignment.project.pm === "项目经理" && assignment.members.some((item) => item.userId === "u-member"), "项目分派应保存 PM/销售/成员");

  const savedFinance = await api("POST", "/api/settings", "u-admin", {
    type: "companyFinance",
    values: {
      currentCash: "500000",
      monthlyLaborCost: "50000",
      monthlyRent: "10000",
      monthlyLoan: "5000",
      monthlyInterest: "1000",
      monthlyOtherCost: "4000"
    }
  });
  assert(savedFinance.monthlyRent === "10000", "公司现金流设置应保存");

  const binding = await api("POST", "/api/integrations/feishu/bindings", "u-admin", {
    projectId: "p-smoke-1",
    chatId: "oc_smoke_chat",
    chatName: "捷途汽车测试群"
  });
  assert(binding.projectId === "p-smoke-1", "飞书项目群绑定应保存");

  const event = await api("POST", "/api/integrations/feishu/events", "u-admin", {
    token: "cli_mock_token",
    event: {
      message: {
        chat_id: "oc_smoke_chat",
        chat_name: "捷途汽车测试群",
        message_type: "text",
        content: JSON.stringify({ text: "帮我登记到这个项目里" })
      },
      sender: {
        sender_name: "销售成员",
        sender_id: { open_id: "ou_sales" }
      }
    }
  });
  assert(event.event?.projectId === "p-smoke-1", "飞书事件应匹配项目群绑定");

  const task = await api("POST", "/api/project-tasks", "u-pm", {
    projectId: "p-smoke-1",
    title: "完成测试脚本",
    owner: "项目经理",
    progress: 60,
    status: "doing",
    note: "测试任务"
  });
  assert(task.task?.title === "完成测试脚本", "项目任务应能新增");

  const completedTask = await api("POST", "/api/project-tasks", "u-pm", {
    projectId: "p-smoke-1",
    taskId: task.task.id,
    action: "complete"
  });
  assert(completedTask.task?.progress === 100, "项目任务应能标记完成并更新进度");

  const feishuDelivery = await api("POST", "/api/notifications/feishu/send", "u-pm", {
    id: "notice-smoke-1"
  });
  assert(feishuDelivery.results?.some((item) => item.ok), "系统待办应能发送飞书私聊通知");

  const handledNotice = await api("POST", "/api/notifications/action", "u-pm", {
    id: "notice-smoke-1",
    action: "resolve",
    note: "测试已处理"
  });
  assert(handledNotice.status === "已处理", "系统待办应能标记处理");

  const rejectedPending = await api("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "feishu-pending-smoke-1",
    action: "reject",
    note: "测试驳回"
  });
  assert(rejectedPending.status === "已驳回", "飞书待确认文件应能驳回");

  const confirmedPending = await api("POST", "/api/integrations/feishu/pending-files/action", "u-pm", {
    id: "feishu-pending-smoke-2",
    action: "confirm",
    note: "测试确认报价表"
  });
  assert(confirmedPending.status === "已确认入库", "飞书待确认文件应能确认入库");

  const approval = await api("POST", "/api/approvals", "u-member", {
    projectId: "p-smoke-1",
    type: "reimbursement",
    amount: 120,
    reason: "测试交通报销",
    payee: "普通员工"
  });
  assert(approval.status === "待PM确认", "员工应能提交项目审批");

  const approvedByPm = await api("POST", "/api/approvals/action", "u-pm", {
    id: approval.id,
    action: "approve",
    note: "测试通过"
  });
  assert(approvedByPm.status !== "待PM确认", "PM 审批应推进流程");

  const payment = await api("POST", "/api/payments", "u-sales", {
    projectId: "p-smoke-1",
    amount: 1000,
    payer: "捷途汽车",
    method: "银行转账",
    note: "测试回款"
  });
  assert(payment.payment?.amount === 1000, "销售应能记录回款");

  const supplier = await api("POST", "/api/suppliers/rate", "u-pm", {
    supplier: "测试制作供应商",
    score: 5,
    market: "制作",
    comment: "测试评分"
  });
  assert(supplier.supplier === "测试制作供应商", "供应商评分应保存");

  const client = await api("POST", "/api/clients/profile", "u-pm", {
    client: "捷途汽车",
    likes: "真实场景\n执行路径清楚",
    pitfalls: "不要空概念",
    handoffNote: "测试交接"
  });
  assert(client.client === "捷途汽车" && client.pitfalls.length, "客户偏好应保存");

  const script = await api("POST", "/api/collections/suggest", "u-sales", {
    projectId: "p-smoke-1",
    style: "自然一点"
  });
  assert(script.projectId === "p-smoke-1" && script.script, "催收话术应生成");

  let memberCollectionBlocked = false;
  try {
    await api("POST", "/api/collections/suggest", "u-member", {
      projectId: "p-smoke-1",
      style: "普通员工不应生成催收"
    });
  } catch (error) {
    memberCollectionBlocked = /权限|Forbidden/.test(error.message);
  }
  assert(memberCollectionBlocked, "普通员工不应生成催收话术，前端也不应展示对应动作");

  const outcome = await api("POST", "/api/collections/outcome", "u-sales", {
    id: script.id,
    success: true,
    score: 5,
    outcome: "客户已回复"
  });
  assert(outcome.success === true, "催收结果应记录");

  const finalState = await api("GET", "/api/state", "u-admin");
  assert(finalState.payments.length === 1, "最终状态应包含回款记录");
  assert(finalState.collectionScripts.length === 1, "最终状态应包含催收记录");
  assert(finalState.feishuProjectBindings.length === 1, "最终状态应包含飞书群绑定");

  console.log("workflow smoke passed");
} finally {
  if (originalDb) await writeFile(dbFile, originalDb);
}
