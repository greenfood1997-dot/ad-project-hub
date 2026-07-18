import { readFile, writeFile } from "node:fs/promises";
import { dbFile } from "../server/config.mjs";
import { handleApi } from "../server/api.mjs";
import { handleStatic } from "../server/static.mjs";

const originalDb = await readFile(dbFile, "utf8").catch(() => "");

function clone(value) {
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

async function call(method, path, userId, body) {
  const res = makeRes();
  await handleApi(makeReq(method, path, userId, body), res);
  const payload = res.json();
  return { status: res.statusCode, payload };
}

async function staticCall(path) {
  const res = makeRes();
  await handleStatic({ method: "GET", url: path }, res);
  return { status: res.statusCode, body: Buffer.concat(res.chunks).toString("utf8") };
}

async function ok(method, path, userId, body) {
  const result = await call(method, path, userId, body);
  if (result.status >= 400 || result.payload.ok === false) {
    throw new Error(`${method} ${path} as ${userId} failed: ${result.payload.error || result.status}`);
  }
  return result.payload.data ?? result.payload;
}

async function denied(method, path, userId, body, message) {
  let result;
  try {
    result = await call(method, path, userId, body);
  } catch (error) {
    return { status: 500, payload: { ok: false, error: error.message } };
  }
  if (result.status < 400 && result.payload.ok !== false) {
    throw new Error(message);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const baseDb = {
  users: [
    { id: "u-admin", name: "管理员", role: "admin", department: "中台", status: "active", pin: "123456" },
    { id: "u-pm", name: "项目经理", role: "pm", department: "项目部", status: "active", pin: "123456" },
    { id: "u-member", name: "执行小伙伴", role: "member", department: "执行部", status: "active", pin: "123456" },
    { id: "u-outsider", name: "无关成员", role: "member", department: "执行部", status: "active", pin: "123456" }
  ],
  settings: {
    storage: {
      provider: "s3-compatible",
      bucket: "oa-files",
      publicBaseUrl: "https://files.example.com",
      endpoint: "https://s3.example.com",
      region: "auto",
      pathPrefix: "oa-test",
      accessKeyId: "mock-key",
      secretAccessKey: "mock-secret",
      mockUpload: "true",
      pathStyle: "true"
    },
    members: {
      items: [
        { userId: "u-member", name: "执行小伙伴", role: "member", project: "可见拍摄项目" },
        { userId: "u-outsider", name: "无关成员", role: "member", project: "隐藏拍摄项目" }
      ]
    }
  },
  projects: [
    { id: "p-visible", name: "可见拍摄项目", client: "A客户", owner: "项目经理", pm: "项目经理", sales: "销售", department: "项目部", status: "执行中", contract: 100000, paid: 20000, receivable: 80000 },
    { id: "p-hidden", name: "隐藏拍摄项目", client: "B客户", owner: "其他PM", pm: "其他PM", sales: "其他销售", department: "其他部门", status: "执行中", contract: 200000, paid: 0, receivable: 200000 }
  ],
  files: [],
  parseJobs: [
    {
      id: "job-visible",
      projectId: "p-visible",
      projectName: "可见拍摄项目",
      status: "解析中",
      progress: 25,
      files: [{ name: "可见合同.pdf", size: 100 }],
      steps: [
        { name: "读取文件", status: "完成" },
        { name: "识别内容", status: "进行中" },
        { name: "提取字段", status: "等待" },
        { name: "同步项目", status: "等待" }
      ],
      extractedFields: {}
    },
    {
      id: "job-failed",
      projectId: "p-visible",
      projectName: "可见拍摄项目",
      status: "解析失败",
      progress: 75,
      error: "AI 服务连接超时，请检查 Base URL 或网络",
      files: [{ name: "失败合同.pdf", size: 100 }],
      steps: [
        { name: "文件接收", status: "完成" },
        { name: "字段识别", status: "失败" },
        { name: "人工确认", status: "等待" },
        { name: "写入项目", status: "等待" }
      ],
      extractedFields: {}
    },
    {
      id: "job-hidden",
      projectId: "p-hidden",
      projectName: "隐藏拍摄项目",
      status: "解析中",
      progress: 25,
      files: [{ name: "隐藏合同.pdf", size: 100 }],
      steps: [
        { name: "读取文件", status: "完成" },
        { name: "识别内容", status: "进行中" },
        { name: "提取字段", status: "等待" },
        { name: "同步项目", status: "等待" }
      ],
      extractedFields: {}
    }
  ],
  suppliers: [],
  approvals: [],
  payments: [],
  collectionScripts: [],
  clientProfiles: [],
  supplierProfiles: [],
  feishuEvents: [],
  feishuProjectBindings: [],
  feishuPendingFiles: [],
  systemNotifications: [],
  comments: [],
  alertUpdates: [],
  auditLogs: []
};

try {
  await writeFile(dbFile, JSON.stringify(clone(baseDb), null, 2));

  const storageTest = await ok("POST", "/api/settings/storage/test", "u-admin", {
    values: baseDb.settings.storage
  });
  assert(storageTest.ok === false && storageTest.storageStatus === "已上传对象存储", "模拟对象存储不得冒充真实生产就绪");
  assert(storageTest.storageUrl?.startsWith("https://files.example.com/oa-test/"), "对象存储自测应返回远程访问地址");
  assert(storageTest.localStorageUrl?.startsWith("/uploads/"), "对象存储自测应保留本地备份地址");
  assert(storageTest.warning, "模拟对象存储自测应明确提示尚未完成真实远程上传");
  await denied("POST", "/api/settings/storage/test", "u-member", {
    values: baseDb.settings.storage
  }, "普通成员不应测试后台对象存储配置");

  const recorded = await ok("POST", "/api/files/record", "u-pm", {
    projectName: "可见拍摄项目",
    files: [{
      name: "拍摄排期.txt",
      type: "text/plain",
      size: Buffer.byteLength("拍摄排期测试"),
      base64: Buffer.from("拍摄排期测试", "utf8").toString("base64")
    }]
  });
  assert(recorded.projectId === "p-visible", "文件记录应补齐归属项目 ID");
  assert(recorded.projectName === "可见拍摄项目", "文件记录应使用可见项目名称");
  assert(recorded.files.length === 1, "文件记录应保存文件列表");
  assert(recorded.id && recorded.files[0].id, "文件记录和文件本身应有稳定 ID 方便后续归档纠错");
  assert(recorded.files[0].storageUrl?.startsWith("https://files.example.com/oa-test/") && recorded.files[0].storageStatus === "已上传对象存储", "配置 S3 兼容存储后应生成对象存储访问地址");
  assert(recorded.files[0].localStorageUrl?.startsWith("/uploads/"), "对象存储上传时仍应保留本地备份访问地址");
  assert(recorded.files[0].localStoragePath, "对象存储上传时应记录本地备份路径供故障排查");

  const archived = await ok("POST", "/api/files/archive", "u-pm", {
    projectId: "p-visible",
    fileId: recorded.files[0].id,
    reason: "传错版本，先归档"
  });
  assert(archived.file?.archivedAt, "项目文件归档应保留归档时间");
  assert(archived.file?.archivedBy === "u-pm", "项目文件归档应保留归档人");

  await denied("POST", "/api/files/record", "u-pm", {
    projectName: "隐藏拍摄项目",
    files: [{ name: "隐藏资料.xlsx", size: 128 }]
  }, "PM 不应登记不可见项目文件");
  await denied("POST", "/api/files/archive", "u-pm", {
    projectName: "隐藏拍摄项目",
    fileName: "隐藏资料.xlsx"
  }, "PM 不应归档不可见项目文件");
  await denied("POST", "/api/files/record", "u-member", {
    projectName: "可见拍摄项目",
    files: [{ name: "成员资料.xlsx", size: 128 }]
  }, "普通成员不应直接调用文件记录写接口");
  await denied("POST", "/api/files/archive", "u-member", {
    projectId: "p-visible",
    fileId: recorded.files[0].id
  }, "普通成员不应直接归档项目文件记录");

  const progressed = await ok("POST", "/api/parse-jobs/progress", "u-member", { id: "job-visible" });
  assert(progressed.projectId === "p-visible" && progressed.progress === 50, "成员应能推进自己项目的解析进度");

  const retrying = await ok("POST", "/api/parse-jobs/progress", "u-member", { id: "job-failed" });
  assert(!/失败/.test(retrying.status) && !retrying.error, "失败解析任务再次刷新时应进入重试状态并清空旧错误");
  assert(retrying.steps.some((step) => step.name === "字段识别" && step.status !== "失败"), "解析任务重试后失败步骤应恢复为进行中或完成");

  await denied("POST", "/api/parse-jobs/progress", "u-member", { id: "job-hidden" }, "成员不应推进不可见项目解析任务");
  await denied("POST", "/api/parse-jobs/progress", "u-outsider", { projectId: "p-visible" }, "无关成员不应推进未绑定项目解析任务");

  const memberState = await ok("GET", "/api/state", "u-member");
  assert(memberState.files.every((item) => item.projectId === "p-visible"), "成员状态只应返回自己项目文件");
  assert(memberState.files.some((item) => item.files?.some((file) => file.archivedAt)), "已归档文件应保留在后台状态中用于审计");
  assert(memberState.parseJobs.every((item) => item.projectId === "p-visible"), "成员状态只应返回自己项目解析任务");
  const adminState = await ok("GET", "/api/state", "u-admin");
  assert(adminState.auditLogs.some((item) => item.type === "upload" && item.action === "archive-file" && item.target === "可见拍摄项目"), "文件归档应写入审计日志");

  console.log("file parse permission regression passed");
} finally {
  await writeFile(dbFile, originalDb || "{}");
}
