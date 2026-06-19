# 广告项目经营中台

这是从静态原型升级出的可试用 Web 系统骨架，已经具备真实 API、本地持久化、权限校验、项目创建、文件记录、AI 解析任务进度、设置保存和协作记录。

## 启动

```bash
node server.mjs
```

打开：

```text
http://127.0.0.1:4173
```

## 已支持

- 工程化后端分层：`server/api.mjs`、`server/services.mjs`、`server/db.mjs`
- 保存 AI 服务配置、飞书、企业微信和高级设置
- 创建项目并生成 AI 解析任务
- 查看和推进 AI 解析进度
- 保存预警处理、@成员和备注
- 本地持久化数据到 `data/db.json`
- 高级设置接口带中台管理员权限校验
- 前端仍可通过 `standalone.html` 离线查看原型

## 数据位置

```text
data/db.json
```

默认使用本地 JSON。配置 `DATABASE_URL` 后会切换到 PostgreSQL。

## 切换到 PostgreSQL

1. 安装依赖：

```bash
npm install
```

2. 创建数据库：

```sql
create database ad_project_hub;
```

3. 配置 `.env`：

```env
DATABASE_URL=postgres://user:password@host:5432/ad_project_hub
```

4. 建表：

```bash
npm run db:schema
```

5. 启动：

```bash
npm run serve
```

打开 `/api/state`，返回里的 `dbMode` 为 `postgres` 即代表已经切换。

服务启动时会自动读取项目根目录下的 `.env`。如果服务器系统里已经设置了同名环境变量，会优先使用系统环境变量。

建表 SQL 在：

```text
db/schema.postgres.sql
```

## 下一步生产化

- 用户登录和角色权限
- 多人协作实时更新
- 文件上传和对象存储
- 合同 OCR 与 Excel 解析任务队列
- PostgreSQL 替换本地 JSON
- 飞书 / 企业微信真实推送

## 生产替换点

- `server/db.mjs`：替换为 PostgreSQL/MySQL
- `server/services.mjs`：接入真实 AI 解析、文件任务队列和通知推送
- `data/db.json`：仅用于本地试用，不建议生产使用
- `.env.example`：生产部署需要填写数据库、文件存储和 AI 网关配置
