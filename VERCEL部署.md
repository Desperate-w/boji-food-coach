# 薄肌 Vercel 试用部署

本次按个人试用部署在 Vercel Hobby，账号和饮食使用 Neon PostgreSQL，照片使用私有 Vercel Blob。朋友使用同一网址自行注册，没有固定人数限制。免费额度不包含 DeepSeek API 调用费用。

## 存储与访问

- 设置 `DATABASE_URL` 时启用 PostgreSQL；不设置时，本地开发继续使用 SQLite。Vercel 入口缺少云配置直接报错，避免误写函数临时磁盘。
- 账号、会话、餐食、计划版本、交流、习惯和去重结果均写入数据库；每次查询都限定账号。
- 照片保存到私有 Blob，浏览器只获得 `/api/media/<id>`，登录后按所属账号读取。删除立即使照片不可访问；物理删除失败会重试。
- 同账号写入、全站 AI 并发、调用额度和认证限流保存在 PostgreSQL，在多个函数实例间共享。请求租约 330 秒，函数最长 300 秒，旧请求失去租约后不能写入。
- 每天 03:00 UTC 维护过期会话、租约和待清理照片，维护接口验证 `CRON_SECRET`。写入请求完成后也尝试清理。
- `.vercelignore` 排除密钥、`.env*`、本机数据库、照片、备份和测试。前端构建仅发布四个 JS/CSS 文件；页面和 API 由认证入口提供。

## 重新部署

已授权的 Vercel CLI 在项目目录运行：

```sh
vercel link --project boji-food-coach
vercel env pull .env.vercel.local --environment production
chmod 600 .env.vercel.local
npm ci
npm test
npm run test:cloud
npm run db:migrate
vercel deploy --prod --yes
```

`test:cloud` 自动启动并销毁临时 PostgreSQL，不使用生产数据；当前支持依赖包提供的 macOS/Linux 二进制平台。部署构建只安装生产依赖。不要提交、发送或公开 `.env.vercel.local`，其中包含数据库和服务端凭据。

在 Vercel 项目 Settings → Environment Variables 管理密钥；改变变量后重新部署。数据库和 Blob 仅关联 Production。预览环境需要独立资源和密钥，避免测试修改真实数据。保持 Deployment Protection 对生产域名开放，朋友才无需 Vercel 登录。

### 环境变量

| 名称 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon 提供的 PostgreSQL 连接地址，推荐连接池地址与 TLS。 |
| `BLOB_READ_WRITE_TOKEN` | 私有 Blob 关联项目时自动注入的服务端令牌。也支持服务商的 `BLOB_STORE_ID` + OIDC。 |
| `DEEPSEEK_API_KEY` | 服务端 DeepSeek 密钥。主模型默认 `deepseek-v4-pro`；照片识别默认 `deepseek-flash`。 |
| `CRON_SECRET` | 随机维护密钥，禁止放入浏览器。 |
| `REGISTRATION_MODE` | 默认 `open`，可改 `invite` 或 `closed`。 |
| `DAILY_MODEL_LIMIT` | 默认每账号每天 30 次 AI 请求。 |
| `GLOBAL_DAILY_MODEL_LIMIT` | 默认全站每天 1000 次，UTC 午夜重置；这是请求次数限制，不是金额上限。 |
| `MODEL_CONCURRENCY` | 默认最多同时 10 个 AI 请求，跨实例共享。 |
| `DB_POOL_MAX` | 默认每实例最多 5 条连接，并使用 Vercel 连接池生命周期管理。 |
| `PUBLIC_ORIGIN` | 通常留空，允许生产别名；配置时填写实际 HTTPS 域名且不含路径。 |

模板见 `deploy/vercel.env.example`。邀请注册需要站长时可执行 `node --env-file=.env.vercel.local admin.js owner`，随后在 `/login#invite` 使用一次性邀请码。普通公开注册无需此操作。

## 本机记录与备份

此次创建独立的空云数据库，本机 SQLite 和照片保留。需要迁入时，在原本机应用「我的计划」导出，在云应用登录自己的账号后导入。账号密码和会话不会随个人记录备份导入，需重新注册。

云端备份导出包含照片，使用流式响应；Vercel 导入请求限制为 4 MB（包括 JSON 包装），超过时需分批迁移。个人导出可用于恢复餐食、交流、资料和习惯；它不是完整站点备份，也不重建账号凭据、所有历史计划版本或修订审计。

站点恢复应分别备份 PostgreSQL 和私有 Blob，并在独立数据库/存储验证恢复。代码 Git 回滚不会回滚数据库；迁移有版本检查，不能将旧代码直接用于更高版本数据库。`npm run db:cleanup` 可手动执行清理。完整站点灾备演练仍待补充。

## 试用边界

- Vercel、Neon、Blob 的免费资源有额度和使用条款，流量扩大后要看各自用量。Hobby 面向个人非商业使用，商业运营前重新评估方案。[Vercel Hobby](https://vercel.com/docs/plans/hobby)
- DeepSeek 使用你自己的余额，部署免费不代表 AI 免费；在 DeepSeek 控制台查看账单并按预算调整调用次数。
- 中国大陆到 Vercel 默认域名的访问质量不保证，自定义域名可能改善，但仍需朋友在各自网络实测。[Vercel 中国大陆访问说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)
- 文字和照片可用；语音依赖浏览器 Web Speech 支持与网络，HTTPS 并不保证所有手机浏览器都能识别。
- 当前尚无自助找回密码、邮箱验证和完整账号注销，PRD 全部真实场景、容量压测及正式发布指标继续按开发计划推进。
