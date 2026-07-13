export function explainUploadError(error) {
  const raw = String(error?.message || error || "识别失败，请稍后重试。");
  const compact = raw.replace(/^Error:\s*/i, "").trim();
  if (/API Key|未检测到 AI Key|请先填写 API Key|401|unauthorized/i.test(compact)) {
    return {
      title: "AI 接入还没配好",
      detail: compact,
      next: "请让管理员到「后台管理 -> AI 接入」保存 API Key；如果线上覆盖后 Key 丢失，也可以在 Render 环境变量配置 AI_API_KEY、AI_BASE_URL、AI_MODEL。"
    };
  }
  if (/Base URL|模型名称|model|404|请求格式|AI 服务返回/i.test(compact)) {
    return {
      title: "AI 服务地址或模型不匹配",
      detail: compact,
      next: "请到「后台管理 -> AI 接入」点一次测试连接，确认 Base URL、模型名称和服务商是一组匹配的配置。"
    };
  }
  if (/超时|timeout|network|Failed to fetch|连接/i.test(compact)) {
    return {
      title: "AI/OCR 连接超时",
      detail: compact,
      next: "先不要重复上传。可以点「缩到后台」等一会儿，再到项目详情的「文件与 AI 解析」刷新或重试解析。"
    };
  }
  if (/过大|too large|Payload|413|body/i.test(compact)) {
    return {
      title: "文件太大，服务端没完整接收",
      detail: compact,
      next: "建议把合同 PDF 压缩到 40MB 以下，或先拆成合同正文/报价表两份再上传。"
    };
  }
  if (/OCR|扫描件|图片合同|未提取到可解析文本|腾讯云/i.test(compact)) {
    return {
      title: "扫描件需要 OCR",
      detail: compact,
      next: "如果是扫描版 PDF 或图片合同，请让管理员在 Render 配置 TENCENT_SECRET_ID、TENCENT_SECRET_KEY；普通可复制文字 PDF 可以继续本地解析。"
    };
  }
  if (/无权限|不能创建新项目|403/i.test(compact)) {
    return {
      title: "当前账号没有这个操作权限",
      detail: compact,
      next: "请切换到自己可见的项目上传，或让 PM/销售/管理员创建项目后再上传成本、报价、核销资料。"
    };
  }
  return {
    title: "这次识别没有完成",
    detail: compact,
    next: "可以先重新预览一次；如果仍失败，到项目详情的「文件与 AI 解析」查看任务状态，或让管理员检查上线健康里的 AI/OCR 配置。"
  };
}
