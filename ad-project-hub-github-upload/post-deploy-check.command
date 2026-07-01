#!/bin/zsh
cd "$(dirname "$0")" || exit 1

REPO_RAW="https://raw.githubusercontent.com/greenfood1997-dot/ad-project-hub/oa-test-version/ad-project-hub-github-upload"
REPO_API="https://api.github.com/repos/greenfood1997-dot/ad-project-hub/contents/ad-project-hub-github-upload"
LIVE_HEALTH="https://ad-project-hub-oa-test.onrender.com/api/health"
VERSION="2026-06-27-upload-progress-prestart-health"
LATEST_WRAPPER_ZIP="/Users/greenfood/Documents/中台产品/ad-project-hub-github-upload-latest-replace.zip"
LATEST_CONTENTS_ZIP="/Users/greenfood/Documents/中台产品/ad-project-hub-clean-upload-no-dist.zip"

tmp_dir="$(mktemp -d)"
bad=0
github_bad=0
render_bad=0

download_text() {
  local url="$1"
  local target="$2"
  local label="$3"
  local missing_hint="$4"
  local http_code

  http_code="$(curl -L --connect-timeout 10 --max-time 45 -s -w "%{http_code}" "$url" -o "$target")"
  if [ "$http_code" != "200" ] || [ ! -s "$target" ]; then
    if [ -n "$missing_hint" ]; then
      echo "需要处理：读取 $label 失败，HTTP $http_code。$missing_hint"
    else
      echo "需要处理：读取 $label 失败，HTTP $http_code。请确认网络正常后再运行一次。"
    fi
    bad=1
    case "$label" in
      GitHub*) github_bad=1 ;;
      Render*) render_bad=1 ;;
    esac
    return 1
  fi
  return 0
}

check_contains() {
  local file="$1"
  local text="$2"
  local ok_msg="$3"
  local bad_msg="$4"

  if grep -q "$text" "$file" 2>/dev/null; then
    echo "通过：$ok_msg"
  else
    echo "需要处理：$bad_msg"
    bad=1
    case "$bad_msg" in
      GitHub*) github_bad=1 ;;
      Render*) render_bad=1 ;;
    esac
  fi
}

echo "正在检查 GitHub 和 Render 是否已经更新到最新版..."
echo ""

echo "1. 检查 GitHub 源码"
if download_text "$REPO_RAW/src/main.jsx" "$tmp_dir/main.jsx" "GitHub src/main.jsx"; then
  check_contains "$tmp_dir/main.jsx" "UploadProgressPanel" "GitHub 的 src/main.jsx 有识别进度面板" "GitHub 的 src/main.jsx 还没有识别进度代码，请重新上传完整文件"
  check_contains "$tmp_dir/main.jsx" "缩到后台" "GitHub 的 src/main.jsx 有缩到后台" "GitHub 的 src/main.jsx 缺少缩到后台，请重新上传完整文件"
fi
if download_text "$REPO_RAW/package.json" "$tmp_dir/package.json" "GitHub package.json"; then
  if grep -q '"prestart": "npm run build"' "$tmp_dir/package.json" 2>/dev/null; then
    echo "需要处理：GitHub 的 package.json 还有 prestart，Render 启动时会二次构建并可能一直检测不到端口"
    bad=1
    github_bad=1
  else
    echo "通过：GitHub 的 package.json 启动阶段只开服务端口"
  fi
fi
if download_text "$REPO_RAW/render.yaml" "$tmp_dir/render.yaml" "GitHub render.yaml"; then
  check_contains "$tmp_dir/render.yaml" "npm run build" "GitHub 的 render.yaml 会执行 npm run build" "GitHub 的 render.yaml 还是旧版，没有 npm run build"
fi
if download_text "$REPO_RAW/server/api.mjs" "$tmp_dir/api.mjs" "GitHub server/api.mjs"; then
  check_contains "$tmp_dir/api.mjs" "/api/health" "GitHub 的后端有 /api/health" "GitHub 的 server/api.mjs 还是旧版，没有 /api/health"
fi
critical_tests=(
  "frontend-upload-progress-entry.mjs|frontend upload progress entry passed|上传进度与拖拽上传测试"
  "frontend-management-cockpit-entry.mjs|frontend management cockpit entry passed|经营舱三子页测试"
  "frontend-approval-workbench-entry.mjs|frontend approval workbench entry passed|审批工作台测试"
  "frontend-supplier-client-entry.mjs|frontend supplier client entry passed|供应商和客户档案测试"
  "frontend-collection-assistant-entry.mjs|frontend collection assistant entry passed|催收助手前端测试"
  "collection-assistant-regression.mjs|collection assistant regression passed|催收助手后端测试"
  "payment-ledger-regression.mjs|payment ledger regression passed|回款台账后端测试"
  "frontend-payment-ledger-entry.mjs|frontend payment ledger entry passed|回款台账前端测试"
  "approval-finance-impact-regression.mjs|approval finance impact regression passed|审批财务影响测试"
  "project-task-progress-regression.mjs|project task progress regression passed|项目任务进度测试"
  "frontend-task-progress-entry.mjs|frontend task progress entry passed|前端任务进度入口测试"
  "project-activity-audit-regression.mjs|project activity audit regression passed|项目动态审计测试"
  "frontend-project-activity-entry.mjs|frontend project activity entry passed|前端项目动态入口测试"
  "alert-notification-permission-regression.mjs|alert notification permission regression passed|预警待办权限测试"
  "frontend-closeout-review-entry.mjs|frontend closeout review entry passed|成本复盘测试"
  "assignment-suggestion-regression.mjs|assignment suggestion regression passed|AI 分派建议测试"
  "permission-boundary-regression.mjs|permission boundary regression passed|权限边界测试"
  "file-parse-permission-regression.mjs|file parse permission regression passed|文件和解析任务权限测试"
  "approval-action-permission-regression.mjs|approval action permission regression passed|审批处理权限测试"
  "supplier-client-permission-regression.mjs|supplier client permission regression passed|供应商客户权限测试"
  "feishu-pending-permission-regression.mjs|feishu pending permission regression passed|飞书待确认文件权限测试"
  "frontend-ai-confirmation-entry.mjs|frontend ai confirmation entry passed|AI提交前确认入口测试"
  "project-operation-permission-regression.mjs|project operation permission regression passed|项目操作权限测试"
  "api-route-coverage.mjs|api route coverage passed|前后端接口覆盖测试"
)

for item in "${critical_tests[@]}"; do
  file="${item%%|*}"
  rest="${item#*|}"
  marker="${rest%%|*}"
  label="${rest#*|}"
  target="$tmp_dir/$file"
  if download_text "$REPO_RAW/tests/$file" "$target" "GitHub $label" "如果是 HTTP 404，说明 tests 没有上传完整。"; then
    check_contains "$target" "$marker" "GitHub 有$label" "GitHub 的$label不是最新版或内容不完整"
  fi
done

echo ""
echo "2. 检查 GitHub 是否还残留旧 dist"
if download_text "$REPO_API?ref=oa-test-version" "$tmp_dir/tree.json" "GitHub 目录列表"; then
  if grep -q '"name": "dist"' "$tmp_dir/tree.json" 2>/dev/null; then
    echo "需要处理：GitHub 里还残留 ad-project-hub-github-upload/dist，请删除整个 dist 文件夹"
    bad=1
    github_bad=1
  else
    echo "通过：GitHub 里没有远端 dist 残留"
  fi
fi

echo ""
echo "3. 检查 Render 线上版本"
if download_text "$LIVE_HEALTH" "$tmp_dir/health.json" "Render /api/health" "如果是 HTTP 404，说明线上后端还是旧版，请重新部署。"; then
  if grep -q "$VERSION" "$tmp_dir/health.json" 2>/dev/null; then
    echo "通过：Render 线上已经是最新版"
  else
    echo "需要处理：Render 线上还不是最新版，或者还没有部署成功"
    echo "线上返回："
    cat "$tmp_dir/health.json"
    echo ""
    bad=1
    render_bad=1
  fi
fi

echo ""
if [ "$bad" -eq 0 ]; then
  echo "全部通过：GitHub 和 Render 都已经是最新版。"
  echo "现在上传弹窗应该能看到识别进度和缩到后台。"
else
  echo "检查未通过：请按上面的“需要处理”逐条修。"
  echo ""
  if [ "$github_bad" -eq 1 ]; then
    echo "判断：GitHub 远程还不是最新完整包。"
    echo "最稳修复："
    echo "1. 解压并使用这个完整替换包：$LATEST_WRAPPER_ZIP"
    echo "2. 在 GitHub 删除旧的 ad-project-hub-github-upload 文件夹，或至少删除里面的 dist。"
    echo "3. 上传解压后的新 ad-project-hub-github-upload 文件夹。"
    echo "4. 上传后确认 GitHub 能看到：ad-project-hub-github-upload/tests/frontend-upload-progress-entry.mjs"
    echo "5. 再确认 package.json 里没有 prestart，启动阶段只执行 node server.mjs"
    echo ""
    echo "如果 GitHub 网页不方便替换整个文件夹，也可以解压这个内容包，只上传里面的内容：$LATEST_CONTENTS_ZIP"
  fi
  if [ "$render_bad" -eq 1 ]; then
    echo ""
    echo "判断：Render 线上还没吃到最新版。"
    echo "修复：GitHub 确认最新后，在 Render 点 Manual Deploy -> Clear build cache & deploy。"
  fi
fi

rm -rf "$tmp_dir"

echo ""
echo "按回车关闭..."
read
