# 薄肌 Vercel 试用部署

访问地址：[薄肌饮食教练](https://boji-food-coach.vercel.app)。

本次按个人试用部署在 Vercel Hobby，账号和饮食使用 Neon PostgreSQL，照片使用私有 Vercel Blob。朋友使用同一网址自行注册，没有固定人数限制。免费额度不包含 DeepSeek API 调用费用。

## 存储与访问

- 设置 `DATABASE_URL` 时启用 PostgreSQL；不设置时，本地开发继续使用 SQLite。Vercel 入口缺少云配置直接报错，避免误写函数临时磁盘。
- 账号、会话、餐食、计划版本、交流、习惯和去重结果均写入数据库；每次查询都限定账号。
- 照片保存到私有 Blob，浏览器只获得 `/api/media/<id>`，登录后按所属账号读取。删除立即使照片不可访问；物理删除失败会重试。
- 同账号写入、全站 AI 并发、调用额度和认证限流保存在 PostgreSQL，在多个函数实例间共享。请求租约 330 秒，函数最长 300 秒，旧请求失去租约后不能写入。
- 每天 03:00 UTC 维护过期会话、租约和待清理照片，维护接口验证 `CRON_SECRET`。写入请求完成后也尝试清理。
- `.vercelignore` 排除密钥、`.env*`、本机数据库、照片、备份和测试。前端构建仅发布五个 JS/CSS 文件；页面和 API 由认证入口提供。

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

## 2026-10-08 上线验收记录

- Vercel 生产构建成功，Neon 免费数据库已迁移，Blob 已核验为私有存储。
- 41 项既有测试 + 9 项真实临时 PostgreSQL 测试通过。
- 浏览器真实注册、四步建档、DeepSeek V4 Pro 记餐成功，两颗水煮鸡蛋记录为约 150 kcal / 蛋白质 12g，刷新后保留。
- 未登录私人 API 返回 401；密钥、本机环境文件、数据库结构和服务端源码路径返回 404。
- 真实 Blob 测试图片上传、鉴权读取、未登录拒绝和带照片备份导出成功。
- 第二个公网账号不能读取原账号照片或删除其餐食；在第二个账号成功恢复个人备份，照片获得独立的私有路径。真实手动修改将两颗鸡蛋改为一颗，摄入更新为约 72 kcal / 蛋白质 7g，并保存一条修订。
- 实际照片链路调用 `deepseek-flash` + `deepseek-v4-pro`，正确描述测试棋盘图并未误记饮食。390px 手机尺寸下，今天、饮食历史、我的计划均无横向溢出；尚未替代实体手机与麦克风测试。
- 公网页面单餐确认删除、整日删除和照片不可访问已验证；退出后私人 API 返回 401。生产代码再次部署后，原账号仍可登录并读取之前的记录。
- 最终生产部署：`dpl_AizV6CZJaaJ4JHfqrZM3Qj6Dy7Wo`，函数区域 `sin1`，公开别名保持不变。云存储改造提交 `662ecaf`，上线验收及维护时限修复另行提交。
- 本机命令行默认 DNS 将站点域名解析至异常地址，直连超时；浏览器可正常打开。不能据此保证中国大陆所有网络可访问，朋友需实测，必要时绑定自定义域名或迁移托管。

## 2026-10-09 多图升级

每条消息最多 6 张照片，浏览器将单张压缩至 450 KB 内，整条聊天 JSON 限制 4 MB，低于 [Vercel Functions 的 4.5 MB 限制](https://vercel.com/docs/functions/limitations)。通过原有私有 Blob 和 PostgreSQL 保存，无需新增服务或迁移数据库结构。主模型仍为 V4 Pro，照片联合识别为 Flash；新增 `photos.js` 已加入静态构建和函数文件清单。

本地 48 项回归与 11 项 PostgreSQL/私有 Blob 测试通过，覆盖 6 图、单图兼容、失败重试、整批回滚、跨账号隔离、删除与备份恢复。生产部署 `dpl_J6qPeeZnqszbmBkH3kFmr3d3xM7F` 状态 Ready，继续使用 https://boji-food-coach.vercel.app；代码提交 `934018d`。

相同服务代码通过本机 HTTP 入口连接真实 Neon、私有 Blob 和 DeepSeek：一次六图 `deepseek-flash` 联合识别，再由 `deepseek-v4-pro` 回复，逐一描述六种颜色棋盘图，未误计饮食；六张完整保存/读取/备份、去重、单张删除与整日清理通过。临时测试账号、凭据和照片已清理，真实用户数据和全站模型计费记录保留。

浏览器隔离预览实际选择两张再追加四张，文字说明保留；六图缩略图横向滚动，实际 278px 窄屏页面宽度与滚动宽度相同，无横向溢出。生产网址最终登录后浏览器复测因本机网络/浏览器导航超时未完成，保留 B9-06；不将本机真实云存储验收等同于公网浏览器验收。

## 2026-10-09 多行输入与思考排版更新

- 代码提交 `6ff6b0b`。文字输入 16px，Enter / Shift + Enter 换行，Ctrl / ⌘ + Enter 发送；中文输入法候选词确认不会误发送。输入区按内容增高/收缩，桌面最高 240px，窄屏最高 180px，超出时在文字区滚动。
- 思考和最近反馈卡片与输入框共用内容宽度；调整标题、耗时、展开/收起与停止按钮的层级。展开长思考时独立滚动并自动露出卡片；流式更新保留阅读位置，页面随输入及照片预览高度预留底部空间。
- 49 项回归及静态构建通过。独立模拟页面在实际 1280×720 和 390×844 视口验证字号、原生换行、增高/清空收缩、长文上限、卡片边缘对齐、无横向溢出；检查控制台无错误。模拟流追加验证阅读位置未跳动，截图明确标注模拟；未调用真实模型或修改生产用户记录。
- Vercel 生产部署 `dpl_EomBEd6tUE8JARnJoUvCmEwfLVPi` 返回 `READY`，生产别名保持 [薄肌饮食教练](https://boji-food-coach.vercel.app)。本机浏览器打开公网登录页超时，未完成本轮生产页面复测；本次界面证据来自独立本地验收页面。


## 2026-10-11 代码审查修复发布

- 修复提交 `90d3e64`、日期切换补充提交 `3a00037`；详见 `代码审查-2026-10-11.md`，开发计划 B10。
- 66 项本地回归 + 13 项真实临时 PostgreSQL 测试通过，覆盖事务队列回滚、咨询不修改记录、追问日期、备份完整性、账号切换、刷新及重试。未访问生产用户记录或调用付费模型。
- 最终生产部署 `dpl_D5Phy5gW6pwLhWBd4UoDd6YHhMHR` 状态 Ready；原网址 https://boji-food-coach.vercel.app 已更新。函数继续位于 `sin1`，没有数据库结构变更，无需迁移。
- Vercel 构建的生产依赖安装审计报告 0 个已知漏洞；本机独立 `npm audit` 因证书链错误无法完成，未关闭 TLS 校验。
- 本机只读访问生产登录页 20 秒后连接超时，未完成公网页面复测。大陆网络、实体手机、真实麦克风、容量压测和站点灾备继续按既有未完成项推进，未把本地模拟测试作为这些验收。


## 2026-10-12 即时反馈与历史展示

- Today 先给中文结论与下一顿行动，再解释热量范围、蛋白质进度与记录餐次；餐后反馈显示本餐回执及当前蛋白质完成比例，自动从反馈顶部开始展示。模型解释可展开，实际思考文本保留。
- History 以日总结与四餐记录为主；过去日期卡片包含结论与食物摘要，原始交流默认收起，以简短关联说明替代重复的大回执。照片、修正入口、删除标记与思考仍可查看；删除后汇总更新，已展开的交流保持打开。
- 历史使用当日保存的计划；缺少目标明确提示。只按已记录食物估算，不把午餐后尚未完整记录的一天评价为吃得过少。最近日期的摄入也从有效餐食计算，避免旧汇总或缺失字段造成误显示。
- 73 项本地回归与静态构建通过。隔离临时 SQLite / 模拟流式模型页面验证餐后进度、交流展开、单餐删除及思考，1280 / 390 / 320px 无横向溢出，状态卡与输入框对齐；手机历史压缩为并列关键指标。Chrome 原生控制捕捉失败，本次使用 Tabbit 完成视觉检查。
- 代码提交 bde4bdc；生产部署 dpl_21NtUPTCGF2QGN1dh6Z9tNQNH3NE Ready，别名 https://boji-food-coach.vercel.app 已更新。通过本机现有代理只读获取 app.js、nutrition.js 和 styles.css，三个文件与本地哈希一致。
- 本轮没有在生产账号执行餐食操作，没有发起真实模型调用；生产登录后的浏览器流程、大陆直连网络与实体手机仍按既有验收项推进。用户数据采用原存储，本轮不需要数据库迁移。
