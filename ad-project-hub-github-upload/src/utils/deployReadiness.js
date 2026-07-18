export function deployReadinessActions(health = {}, items = [], buildVersion = "") {
  const actions = [];
  if (health.version && buildVersion && health.version !== buildVersion) {
    actions.push({
      tone: "danger",
      title: "先重新部署最新代码",
      text: `页面版本 ${buildVersion}，服务端版本 ${health.version}。这通常说明 GitHub 没覆盖成功、Render 没重新部署，或线上还在用旧构建。`
    });
  }
  if (!health.renderBuildCommand || !health.noPrestartBuild || !health.startOpensPortOnly) {
    actions.push({
      tone: "danger",
      title: "检查 Render 构建/启动命令",
      text: "Build Command 应为 npm install && npm run build，Start Command 应为 npm start，启动阶段不要二次构建。"
    });
  }
  if (Number(health.insecureDefaultAccountCount || 0) > 0) {
    actions.push({
      tone: "danger",
      title: "先移除默认 123456 账号",
      text: `当前仍有 ${health.insecureDefaultAccountCount} 个启用账号使用默认 PIN。请在 Render 临时配置 OA_BOOTSTRAP_ADMIN_PIN，部署后用管理员完成首次改密，再删除该环境变量。`
    });
  }
  if (!health.aiEnv?.apiKey && !health.aiEnv?.databaseConfigured) {
    actions.push({
      tone: "warn",
      title: "补 AI 环境变量或后台 Key",
      text: "合同/报价/成本智能解析依赖 AI Key。建议 Render 配置 AI_API_KEY、AI_BASE_URL、AI_MODEL，避免覆盖 data/db.json 后丢失。"
    });
  }
  if (!health.ocrEnv?.secretId || !health.ocrEnv?.secretKey) {
    actions.push({
      tone: "warn",
      title: "扫描件上传前先配 OCR",
      text: "未配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 时，扫描版 PDF 和图片合同可能只能得到有限结果。"
    });
  }
  if (!health.databaseUrl && (health.storageMode === "json" || health.nodeEnv === "production")) {
    actions.push({
      tone: "warn",
      title: "生产环境建议接 PostgreSQL",
      text: "JSON 存储适合测试，正式长期使用建议在 Render 接 DATABASE_URL，降低数据被覆盖或丢失的风险。"
    });
  }
  if (health.nodeEnv === "production" && health.productionPersistenceReady === false) {
    actions.push({
      tone: "danger",
      title: "生产数据尚未持久化",
      text: "当前服务仍使用本地 JSON。请配置 Render PostgreSQL 的 DATABASE_URL，并完成备份恢复后再承载正式业务。"
    });
  }
  if (health.nodeEnv === "production" && health.filePersistenceReady === false) {
    actions.push({
      tone: "danger",
      title: "原始文件尚未持久化",
      text: "合同、发票和票据当前没有真实对象存储。请配置 S3/R2/MinIO Bucket，避免 Render 重建后文件丢失。"
    });
  }
  if (health.scheduler && !health.scheduler.enabled) {
    actions.push({
      tone: "info",
      title: "需要主动提醒就开启后台巡检",
      text: "自动扫描项目分派、进度、审批、现金流和文件待办依赖后台定时巡检。"
    });
  }
  if (!actions.length && items.length && items.every((item) => item.ok)) {
    actions.push({
      tone: "ok",
      title: "可以进行真实上传测试",
      text: "版本、构建、启动和关键环境都已就绪。建议用一份合同和一份成本表做完整上传、预览、确认入库测试。"
    });
  }
  return actions.slice(0, 4);
}
