# Render PostgreSQL 安全迁移清单

这份清单用于把 Render 上的广告项目 OA 从临时 JSON 数据切换到 PostgreSQL，避免服务重启或重新部署后数据丢失。

适用条件：后台管理 -> 产品设置 -> 上线健康检查里的“数据存储”显示 `json`，或线上 `/api/health` 的 `storageMode` 为 `json`。

## 迁移前：先备份现有 OA

1. 登录 OA 的管理员账号。
2. 打开“后台管理 -> 产品设置”。
3. 在“协同与生产配置”里点击“导出 OA 备份”。
4. 把下载的 `ad-project-hub-backup-日期.json` 留在本机，不要上传到 GitHub 或发到公开群。
5. 在同一页面的备份工具中，把备份文件内容粘贴进去，点击“校验备份 JSON”。确认项目、审批、回款等数量正确。

注意：备份会脱敏 API Key、飞书 Secret、企业微信 Webhook 和对象存储密钥。这些密钥需要继续保留在 Render 环境变量或后台设置中，不能依赖备份恢复。

## 在 Render 创建数据库

1. 打开 Render Dashboard，点击 `New +`。
2. 选择 `PostgreSQL`。
3. 名称可填写 `ad-project-hub-db`，区域选择和 OA Web Service 相同的区域。
4. 创建完成后打开数据库详情页，找到 `Internal Database URL`。
5. 复制这个内部连接地址。不要使用公开连接地址，OA 和数据库都在 Render 内时内部地址更稳定。

## 连接 OA

1. 回到 OA 对应的 Render Web Service。
2. 打开 `Environment`。
3. 新增环境变量：

```text
Key: DATABASE_URL
Value: 粘贴刚才复制的 Internal Database URL
```

4. 保存后点击 `Manual Deploy -> Deploy latest commit`。
5. 等部署完成，打开：

```text
https://你的-render-地址/api/health
```

确认返回中有：

```json
"storageMode": "postgres",
"databaseUrl": true
```

系统会在首次连接时自动建表和写入基础测试账号，因此不需要在 Render Shell 手动执行 SQL。

## 恢复 OA 数据

切换到 PostgreSQL 后，原来 JSON 里的业务数据不会自动搬过去，需要恢复刚才导出的备份。

1. 用默认管理员账号登录：`admin@company.local`，PIN：`123456`。
2. 打开“后台管理 -> 产品设置 -> 协同与生产配置”。
3. 粘贴迁移前导出的备份 JSON，先点击“校验备份 JSON”。
4. 确认数量预演无误后，在确认框输入：

```text
确认恢复OA备份
```

5. 点击“恢复 OA 备份”，等待完成后刷新页面。

恢复后请立即检查管理员和成员账号。备份出于安全考虑不包含 PIN；不在默认账号列表里的成员会重置为 PIN `123456`，应尽快在成员管理中改为新的 PIN。

## 最后验收

1. 后台健康检查的“数据存储”显示 `postgres`。
2. 项目数量、审批、回款、供应商和文件批次数量与备份校验结果一致。
3. 退出后重新登录一次，确认成员权限正常。
4. 上传一份测试合同，确认项目创建、AI 预览、确认入库和项目大盘均正常。
5. 到 Render 执行一次 `Manual Deploy` 或重启服务，再确认项目数据仍存在。

如果恢复过程中出错，不要继续上传新业务数据：保留备份文件，在后台重新校验后再恢复；旧 JSON 数据在切换前的备份中仍可找回。
