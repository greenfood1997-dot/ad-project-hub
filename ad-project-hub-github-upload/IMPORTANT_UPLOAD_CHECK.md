# 上传前必看

这个文件夹才是当前最新版 OA 源码。上传 GitHub 时，请把本文件夹里的内容覆盖到仓库的 `ad-project-hub-github-upload/` 目录。

不要上传这些内容：

- `dist/`
- `node_modules/`
- `.git/`
- 任何 `.zip`
- `.DS_Store`

为什么：

- `dist/` 是旧的页面构建结果。如果 GitHub 里残留旧 `dist`，Render 可能继续显示旧页面，导致看不到“上传识别进度”“缩到后台”“多文件追加”等新功能。
- 当前最新版已经在 `package.json` 里加入 `"prestart": "npm run build"`，Render 启动前会自动重新构建页面。
- 当前最新版后端有 `/api/health`，前端左下角有版本状态，用来判断线上是否已经更新到最新版。

上传后请检查 GitHub：

- `ad-project-hub-github-upload/package.json` 里必须有 `"prestart": "npm run build"`。
- `ad-project-hub-github-upload/server/api.mjs` 里必须有 `/api/health`。
- `ad-project-hub-github-upload/server/static.mjs` 里必须有 `cache-control` 和 `no-store`。
- `ad-project-hub-github-upload/src/main.jsx` 里必须能搜到：
  - `缩到后台`
  - `等待 AI 预览识别`
  - `onDrop={dropFiles}`

Render 部署：

1. 上传并提交 GitHub 后，进入 Render。
2. 点 `Manual Deploy`。
3. 选择 `Clear build cache & deploy`。
4. 部署完成后打开 `/api/health`，能看到版本号才代表线上后端也更新了。

