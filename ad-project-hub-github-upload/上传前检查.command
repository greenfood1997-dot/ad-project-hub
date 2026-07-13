#!/bin/zsh
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
UPLOAD_DIR="$SOURCE_DIR"
STAGING_DIR="$(dirname "$SOURCE_DIR")/GitHub上传-最终只上传这里面的内容"

# In the development checkout, validate the clean staging folder instead of
# treating local dependencies as upload mistakes. In a released folder, use itself.
if [ -d "$SOURCE_DIR/node_modules" ] && [ -d "$STAGING_DIR" ]; then
  UPLOAD_DIR="$STAGING_DIR"
fi

cd "$SOURCE_DIR" || exit 1

echo "正在检查 GitHub 上传内容..."
echo "待上传目录：$UPLOAD_DIR"
echo ""

bad=0

for name in node_modules dist .git; do
  if [ -e "$UPLOAD_DIR/$name" ]; then
    echo "不能上传：发现 $name"
    bad=1
  fi
done

if find "$UPLOAD_DIR" -name "*.zip" | grep -q .; then
  echo "不能上传：发现 zip 压缩包"
  bad=1
fi

if ! grep -q "UploadProgressPanel" src/UploadDialog.jsx; then
  echo "缺少识别进度代码：src/UploadDialog.jsx 里没有 UploadProgressPanel"
  bad=1
fi

if ! grep -q "缩到后台" src/UploadDialog.jsx; then
  echo "缺少缩到后台代码：src/UploadDialog.jsx 里没有 缩到后台"
  bad=1
fi

if ! grep -q "npm run build" render.yaml; then
  echo "Render 配置错误：render.yaml 里没有 npm run build"
  bad=1
fi

if grep -q '"prestart": "npm run build"' package.json; then
  echo "Render 启动风险：package.json 里还有 prestart，会导致 npm start 时二次构建、延迟开端口"
  bad=1
fi

if ! grep -q "2026-07-13-production-readiness-pass" src/main.jsx; then
  echo "前端版本标记缺失：src/main.jsx 里没有最新版本号"
  bad=1
fi

if ! grep -q "/api/health" server/api.mjs; then
  echo "健康检查接口缺失：server/api.mjs 里没有 /api/health"
  bad=1
fi

if [ ! -f server/scheduler.mjs ]; then
  echo "后台巡检缺失：server/scheduler.mjs 不存在"
  bad=1
else
  if ! grep -q "scanSystemNotifications" server/scheduler.mjs || ! grep -q "SYSTEM_SCAN_INTERVAL_MS" server/scheduler.mjs; then
    echo "后台巡检不完整：scheduler 没有接入系统扫描或环境变量控制"
    bad=1
  fi
fi

if ! grep -q "startSystemScheduler" server.mjs; then
  echo "后台巡检启动缺失：server.mjs 没有启动 scheduler"
  bad=1
fi

if ! grep -q "scheduler: getSchedulerStatus()" server/api.mjs; then
  echo "健康检查缺少后台巡检状态：/api/health 没有返回 scheduler"
  bad=1
fi

if ! grep -q "sendSystemNotificationToWechat" server/services.mjs || ! grep -q "/api/notifications/wechat/send" server/api.mjs; then
  echo "企业微信待办发送缺失：后端没有完整发送链路"
  bad=1
fi

if ! grep -q "s3SignedHeaders" server/upload-storage-service.mjs || ! grep -q "uploadToS3CompatibleStorage" server/upload-storage-service.mjs; then
  echo "对象存储上传缺失：server/upload-storage-service.mjs 没有 S3 兼容上传能力"
  bad=1
fi

if ! grep -q "S3 Endpoint" src/IntegrationSettingsPanel.jsx || ! grep -q "后台定时巡检" src/AdminShell.jsx || ! grep -q "发送企业微信" src/NotificationDrawer.jsx; then
  echo "前端关键入口缺失：对象存储、后台巡检或企业微信发送入口没有显示"
  bad=1
fi

if [ ! -f tests/api-route-coverage.mjs ]; then
  echo "接口覆盖测试缺失：tests/api-route-coverage.mjs 不存在"
  bad=1
else
  if ! node tests/api-route-coverage.mjs >/tmp/ad-project-hub-api-route-check.log 2>&1; then
    echo "接口覆盖测试失败：前端可能调用了后端不存在的 API"
    cat /tmp/ad-project-hub-api-route-check.log
    bad=1
  fi
fi

if [ ! -f tests/post-deploy-check-coverage.mjs ]; then
  echo "部署后检查覆盖测试缺失：tests/post-deploy-check-coverage.mjs 不存在"
  bad=1
else
  if ! node tests/post-deploy-check-coverage.mjs >/tmp/ad-project-hub-post-deploy-coverage-check.log 2>&1; then
    echo "部署后检查覆盖测试失败：部署后检查脚本可能没有覆盖关键新版测试"
    cat /tmp/ad-project-hub-post-deploy-coverage-check.log
    bad=1
  fi
fi

if [ ! -f tests/json-db-resilience-regression.mjs ]; then
  echo "JSON 数据库韧性测试缺失：tests/json-db-resilience-regression.mjs 不存在"
  bad=1
else
  if ! node tests/json-db-resilience-regression.mjs >/tmp/ad-project-hub-json-db-resilience-check.log 2>&1; then
    echo "JSON 数据库韧性测试失败：本地 JSON 存储可能无法从坏文件恢复，或原子写入有问题"
    cat /tmp/ad-project-hub-json-db-resilience-check.log
    bad=1
  fi
fi

if [ ! -f tests/postgres-persistence-coverage.mjs ]; then
  echo "Postgres 持久化覆盖测试缺失：tests/postgres-persistence-coverage.mjs 不存在"
  bad=1
else
  if ! node tests/postgres-persistence-coverage.mjs >/tmp/ad-project-hub-postgres-persistence-check.log 2>&1; then
    echo "Postgres 持久化覆盖测试失败：线上数据库可能丢失项目评论、归档状态或审计日志"
    cat /tmp/ad-project-hub-postgres-persistence-check.log
    bad=1
  fi
fi

if [ ! -f tests/permission-boundary-regression.mjs ]; then
  echo "权限边界测试缺失：tests/permission-boundary-regression.mjs 不存在"
  bad=1
else
  if ! node tests/permission-boundary-regression.mjs >/tmp/ad-project-hub-permission-check.log 2>&1; then
    echo "权限边界测试失败：普通员工/财务/管理员的项目或密钥权限可能有问题"
    cat /tmp/ad-project-hub-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/file-parse-permission-regression.mjs ]; then
  echo "文件/解析权限测试缺失：tests/file-parse-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/file-parse-permission-regression.mjs >/tmp/ad-project-hub-file-parse-permission-check.log 2>&1; then
    echo "文件/解析权限测试失败：文件记录或识别进度可能没有按项目权限隔离"
    cat /tmp/ad-project-hub-file-parse-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/approval-action-permission-regression.mjs ]; then
  echo "审批处理权限测试缺失：tests/approval-action-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/approval-action-permission-regression.mjs >/tmp/ad-project-hub-approval-action-permission-check.log 2>&1; then
    echo "审批处理权限测试失败：PM/财务/管理层可能能处理不可见项目审批"
    cat /tmp/ad-project-hub-approval-action-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/supplier-client-permission-regression.mjs ]; then
  echo "供应商/客户权限测试缺失：tests/supplier-client-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/supplier-client-permission-regression.mjs >/tmp/ad-project-hub-supplier-client-permission-check.log 2>&1; then
    echo "供应商/客户权限测试失败：供应商导出或客户档案可能泄露不可见项目数据"
    cat /tmp/ad-project-hub-supplier-client-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/feishu-pending-permission-regression.mjs ]; then
  echo "飞书待确认文件权限测试缺失：tests/feishu-pending-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/feishu-pending-permission-regression.mjs >/tmp/ad-project-hub-feishu-pending-permission-check.log 2>&1; then
    echo "飞书待确认文件权限测试失败：飞书文件可能被不可见项目成员处理或看到"
    cat /tmp/ad-project-hub-feishu-pending-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-ai-confirmation-entry.mjs ]; then
  echo "AI确认入口测试缺失：tests/frontend-ai-confirmation-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-ai-confirmation-entry.mjs >/tmp/ad-project-hub-frontend-ai-confirmation-check.log 2>&1; then
    echo "AI确认入口测试失败：AI 助手可能会缺少提交前确认按钮"
    cat /tmp/ad-project-hub-frontend-ai-confirmation-check.log
    bad=1
  fi
fi

if [ ! -f tests/project-operation-permission-regression.mjs ]; then
  echo "项目操作权限测试缺失：tests/project-operation-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/project-operation-permission-regression.mjs >/tmp/ad-project-hub-project-operation-permission-check.log 2>&1; then
    echo "项目操作权限测试失败：项目更新、删除或重解析可能没有按项目权限隔离"
    cat /tmp/ad-project-hub-project-operation-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/ai-assistant-regression.mjs ]; then
  echo "AI 助手测试缺失：tests/ai-assistant-regression.mjs 不存在"
  bad=1
else
  if ! node tests/ai-assistant-regression.mjs >/tmp/ad-project-hub-ai-assistant-check.log 2>&1; then
    echo "AI 助手测试失败：对话、审批提交或现金流权限可能有问题"
    cat /tmp/ad-project-hub-ai-assistant-check.log
    bad=1
  fi
fi

if [ ! -f tests/system-scan-regression.mjs ]; then
  echo "系统巡检测试缺失：tests/system-scan-regression.mjs 不存在"
  bad=1
else
  if ! node tests/system-scan-regression.mjs >/tmp/ad-project-hub-system-scan-check.log 2>&1; then
    echo "系统巡检测试失败：项目滞后、回款、现金流或待分派提醒可能有问题"
    cat /tmp/ad-project-hub-system-scan-check.log
    bad=1
  fi
fi

if [ ! -f tests/collection-assistant-regression.mjs ]; then
  echo "催收助手后端测试缺失：tests/collection-assistant-regression.mjs 不存在"
  bad=1
else
  if ! node tests/collection-assistant-regression.mjs >/tmp/ad-project-hub-collection-assistant-check.log 2>&1; then
    echo "催收助手后端测试失败：话术生成、结果沉淀或权限可能有问题"
    cat /tmp/ad-project-hub-collection-assistant-check.log
    bad=1
  fi
fi

if [ ! -f tests/payment-ledger-regression.mjs ]; then
  echo "回款台账测试缺失：tests/payment-ledger-regression.mjs 不存在"
  bad=1
else
  if ! node tests/payment-ledger-regression.mjs >/tmp/ad-project-hub-payment-ledger-check.log 2>&1; then
    echo "回款台账测试失败：记录回款、待回款更新、核销回款同步或权限可能有问题"
    cat /tmp/ad-project-hub-payment-ledger-check.log
    bad=1
  fi
fi

if [ ! -f tests/approval-finance-impact-regression.mjs ]; then
  echo "审批财务影响测试缺失：tests/approval-finance-impact-regression.mjs 不存在"
  bad=1
else
  if ! node tests/approval-finance-impact-regression.mjs >/tmp/ad-project-hub-approval-finance-impact-check.log 2>&1; then
    echo "审批财务影响测试失败：备用金、报销、供应商付款或驳回后的财务影响可能有问题"
    cat /tmp/ad-project-hub-approval-finance-impact-check.log
    bad=1
  fi
fi

if [ ! -f tests/project-task-progress-regression.mjs ]; then
  echo "项目任务进度测试缺失：tests/project-task-progress-regression.mjs 不存在"
  bad=1
else
  if ! node tests/project-task-progress-regression.mjs >/tmp/ad-project-hub-task-progress-check.log 2>&1; then
    echo "项目任务进度测试失败：新增任务、完成任务、项目总进度或任务权限可能有问题"
    cat /tmp/ad-project-hub-task-progress-check.log
    bad=1
  fi
fi

if [ ! -f tests/project-activity-audit-regression.mjs ]; then
  echo "项目动态审计测试缺失：tests/project-activity-audit-regression.mjs 不存在"
  bad=1
else
  if ! node tests/project-activity-audit-regression.mjs >/tmp/ad-project-hub-project-activity-audit-check.log 2>&1; then
    echo "项目动态审计测试失败：项目评论、审计日志或权限范围可能有问题"
    cat /tmp/ad-project-hub-project-activity-audit-check.log
    bad=1
  fi
fi

if [ ! -f tests/alert-notification-permission-regression.mjs ]; then
  echo "预警待办权限测试缺失：tests/alert-notification-permission-regression.mjs 不存在"
  bad=1
else
  if ! node tests/alert-notification-permission-regression.mjs >/tmp/ad-project-hub-alert-notification-permission-check.log 2>&1; then
    echo "预警待办权限测试失败：待办处理、项目预警或公司级预警权限可能有问题"
    cat /tmp/ad-project-hub-alert-notification-permission-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-system-scan-entry.mjs ]; then
  echo "前端巡检入口测试缺失：tests/frontend-system-scan-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-system-scan-entry.mjs >/tmp/ad-project-hub-frontend-scan-check.log 2>&1; then
    echo "前端巡检入口测试失败：通知抽屉可能没有接入立即巡检"
    cat /tmp/ad-project-hub-frontend-scan-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-collection-assistant-entry.mjs ]; then
  echo "催收助手前端测试缺失：tests/frontend-collection-assistant-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-collection-assistant-entry.mjs >/tmp/ad-project-hub-frontend-collection-assistant-check.log 2>&1; then
    echo "催收助手前端测试失败：个人风格、成功率、有效话术或结果记录可能没有接入"
    cat /tmp/ad-project-hub-frontend-collection-assistant-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-payment-ledger-entry.mjs ]; then
  echo "前端回款入口测试缺失：tests/frontend-payment-ledger-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-payment-ledger-entry.mjs >/tmp/ad-project-hub-frontend-payment-ledger-check.log 2>&1; then
    echo "前端回款入口测试失败：项目详情可能没有真实记录回款表单或台账展示"
    cat /tmp/ad-project-hub-frontend-payment-ledger-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-task-progress-entry.mjs ]; then
  echo "前端任务进度入口测试缺失：tests/frontend-task-progress-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-task-progress-entry.mjs >/tmp/ad-project-hub-frontend-task-progress-check.log 2>&1; then
    echo "前端任务进度入口测试失败：项目详情可能没有真实新增/完成任务入口"
    cat /tmp/ad-project-hub-frontend-task-progress-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-project-activity-entry.mjs ]; then
  echo "前端项目动态入口测试缺失：tests/frontend-project-activity-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-project-activity-entry.mjs >/tmp/ad-project-hub-frontend-project-activity-check.log 2>&1; then
    echo "前端项目动态入口测试失败：项目详情可能没有真实评论/活动流展示"
    cat /tmp/ad-project-hub-frontend-project-activity-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-upload-progress-entry.mjs ]; then
  echo "上传进度入口测试缺失：tests/frontend-upload-progress-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-upload-progress-entry.mjs >/tmp/ad-project-hub-frontend-upload-progress-check.log 2>&1; then
    echo "上传进度入口测试失败：多文件追加、移除、识别进度或缩到后台可能没有接入"
    cat /tmp/ad-project-hub-frontend-upload-progress-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-admin-routing-entry.mjs ]; then
  echo "后台入口测试缺失：tests/frontend-admin-routing-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-admin-routing-entry.mjs >/tmp/ad-project-hub-frontend-admin-routing-check.log 2>&1; then
    echo "后台入口测试失败：飞书/企业微信/项目分派入口可能没有直达真实后台页面"
    cat /tmp/ad-project-hub-frontend-admin-routing-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-management-cockpit-entry.mjs ]; then
  echo "经营舱入口测试缺失：tests/frontend-management-cockpit-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-management-cockpit-entry.mjs >/tmp/ad-project-hub-frontend-management-cockpit-check.log 2>&1; then
    echo "经营舱入口测试失败：公司大盘、现金流压力、AI 商业顾问可能又变成同一类页面"
    cat /tmp/ad-project-hub-frontend-management-cockpit-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-approval-workbench-entry.mjs ]; then
  echo "审批工作台测试缺失：tests/frontend-approval-workbench-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-approval-workbench-entry.mjs >/tmp/ad-project-hub-frontend-approval-workbench-check.log 2>&1; then
    echo "审批工作台测试失败：待我审批、备用金、报销、供应商付款或流程进度可能没有真实分流"
    cat /tmp/ad-project-hub-frontend-approval-workbench-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-supplier-client-entry.mjs ]; then
  echo "供应商/客户入口测试缺失：tests/frontend-supplier-client-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-supplier-client-entry.mjs >/tmp/ad-project-hub-frontend-supplier-client-check.log 2>&1; then
    echo "供应商/客户入口测试失败：供应商评分导出或客户交接清单可能没有真实接入"
    cat /tmp/ad-project-hub-frontend-supplier-client-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-closeout-review-entry.mjs ]; then
  echo "成本复盘入口测试缺失：tests/frontend-closeout-review-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-closeout-review-entry.mjs >/tmp/ad-project-hub-frontend-closeout-review-check.log 2>&1; then
    echo "成本复盘入口测试失败：结案复盘、支出排行或预算优化建议可能没有真实接入"
    cat /tmp/ad-project-hub-frontend-closeout-review-check.log
    bad=1
  fi
fi

if [ ! -f tests/assignment-suggestion-regression.mjs ]; then
  echo "分派建议测试缺失：tests/assignment-suggestion-regression.mjs 不存在"
  bad=1
else
  if ! node tests/assignment-suggestion-regression.mjs >/tmp/ad-project-hub-assignment-suggestion-check.log 2>&1; then
    echo "分派建议测试失败：PM/销售/执行推荐或权限可能有问题"
    cat /tmp/ad-project-hub-assignment-suggestion-check.log
    bad=1
  fi
fi

if [ ! -f tests/frontend-assignment-suggestion-entry.mjs ]; then
  echo "前端分派建议入口测试缺失：tests/frontend-assignment-suggestion-entry.mjs 不存在"
  bad=1
else
  if ! node tests/frontend-assignment-suggestion-entry.mjs >/tmp/ad-project-hub-frontend-assignment-suggestion-check.log 2>&1; then
    echo "前端分派建议入口测试失败：项目分派页可能没有展示 AI 推荐"
    cat /tmp/ad-project-hub-frontend-assignment-suggestion-check.log
    bad=1
  fi
fi

echo ""
if [ "$bad" -eq 0 ]; then
  echo "检查通过：可以上传这个文件夹里面的内容。"
  echo "上传后记得去 Render 点 Clear build cache & deploy。"
else
  echo "检查失败：请不要上传，先让 Codex 修复。"
fi

echo ""
if [ -t 0 ]; then
  echo "按回车关闭..."
  read
fi
