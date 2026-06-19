export function createProject(db, values, files, user) {
  if (!values?.["项目名称"]) throw new Error("请填写项目名称");
  const now = new Date().toISOString();
  const project = {
    id: `P-${Date.now()}`,
    name: values["项目名称"],
    client: values["客户 / 品牌"] || "",
    owner: values["负责人"] || user.name,
    contract: Number(values["合同金额"] || 0),
    status: "草稿",
    risk: "低",
    createdAt: now,
    createdBy: user.id,
    files
  };
  const parseJob = createParseJob(project, files);
  db.projects.unshift(project);
  db.parseJobs.unshift(parseJob);
  db.auditLogs.unshift({ type: "project", target: project.name, action: "create", user: user.name, at: now });
  return { project, parseJob };
}

export function createParseJob(project, files) {
  const now = new Date().toISOString();
  return {
    id: `J-${Date.now()}`,
    projectId: project.id,
    projectName: project.name,
    status: files.length ? "解析中" : "等待文件",
    progress: files.length ? 25 : 0,
    steps: [
      { name: "文件接收", status: files.length ? "完成" : "等待" },
      { name: "字段识别", status: files.length ? "进行中" : "等待" },
      { name: "人工确认", status: "等待" },
      { name: "写入项目", status: "等待" }
    ],
    files,
    createdAt: now,
    updatedAt: now
  };
}

export function advanceParseJob(db, idOrProjectId) {
  const job = db.parseJobs.find((item) => item.id === idOrProjectId || item.projectId === idOrProjectId);
  if (!job) throw new Error("解析任务不存在");
  job.progress = Math.min(100, job.progress + 25);
  job.status = job.progress >= 100 ? "已完成" : "解析中";
  job.steps = job.steps.map((step, index) => {
    const threshold = [25, 50, 75, 100][index];
    const current = Math.floor(job.progress / 25);
    return { ...step, status: job.progress >= threshold ? "完成" : index === current ? "进行中" : "等待" };
  });
  job.updatedAt = new Date().toISOString();
  return job;
}

export function validateAiSettings(values) {
  if (!values?.["API Key"]) throw new Error("请先填写 API Key");
  if (!values?.["Base URL"]) throw new Error("请先填写 Base URL");
  try {
    new URL(values["Base URL"]);
  } catch {
    throw new Error("Base URL 格式不正确");
  }
}

export async function testAiSettings(values) {
  validateAiSettings(values);
  const baseUrl = values["Base URL"].replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${values["API Key"]}` },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`AI 服务返回 ${res.status}`);
    }
    return {
      provider: values["服务商"] || "OpenAI 兼容接口",
      model: values["模型名称"] || "",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("AI 服务连接超时，请检查 Base URL 或网络");
    throw new Error(`AI 配置校验失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function saveSetting(db, type, values, user) {
  if (type === "aiService") validateAiSettings(values);
  const saved = { ...values, savedAt: new Date().toISOString(), savedBy: user.id };
  db.settings[type] = saved;
  db.auditLogs.unshift({ type: "settings", target: type, user: user.name, at: saved.savedAt });
  return saved;
}

export function recordFiles(db, body, user) {
  const now = new Date().toISOString();
  const files = Array.isArray(body.files) ? body.files : [];
  const upload = { files, projectName: body.projectName || "", user: user.name, at: now };
  db.files.unshift(upload);
  db.auditLogs.unshift({ type: "upload", target: upload.projectName || "未命名项目", count: files.length, user: user.name, at: now });
  return upload;
}

export function updateAlert(db, body, user) {
  const at = new Date().toISOString();
  const update = { ...body, user: user.name, at };
  db.alertUpdates.unshift(update);
  db.auditLogs.unshift({ type: "alert", target: body.project, action: body.action, user: user.name, at });
  return update;
}

export function addComment(db, body, user) {
  const at = new Date().toISOString();
  const comment = { ...body, user: user.name, at };
  db.comments.unshift(comment);
  db.auditLogs.unshift({ type: "comment", target: body.project, user: user.name, at });
  return comment;
}

export function supplierCsv(db) {
  const header = "供应商,归属项目,费用类型,应结金额,状态\n";
  const rows = db.suppliers.map((item) => [item.supplier, item.project, item.type, item.amount, item.status]
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  return header + rows.join("\n");
}
