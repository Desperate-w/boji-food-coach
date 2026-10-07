# 薄肌邀请试用 API

Node 服务仍只监听 `127.0.0.1`，公网部署通过 HTTPS 反向代理访问。所有私人页面和数据 API 都要求登录；非 GET 请求额外使用会话 CSRF token。每个账号有独立 SQLite 和媒体目录；原单用户数据库由第一个站长账号接管。JSON 接口返回 `Cache-Control: no-store`。日期采用各自资料中保存的 IANA 时区；时间戳以 UTC ISO 8601 保存。

## 账号接口

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/auth/register` | 提交一次性 `inviteCode`、`username`、`password`，创建独立账号并设置 HttpOnly、SameSite=Strict 会话 Cookie。 |
| `POST /api/auth/login` | 用用户名和密码登录；密码以 scrypt 加盐摘要保存。 |
| `GET /api/auth/session` | 返回当前用户名及供浏览器发送非 GET 请求的 `csrf` token；未登录返回 401。 |
| `POST /api/auth/logout` | 注销当前会话并清除 Cookie。 |

站长与朋友的邀请码只能通过服务器管理员命令生成，没有公开邀请生成 API。邀请码一次有效，默认 72 小时后过期。除登录和注册外，所有写请求必须发送 `X-CSRF-Token`；未登录返回 401，缺失或错误 token 返回 403。模型请求按账号与全站每日配额分别限制，超额返回 429。

## 模型路由

- 文字理解、营养估算、建议和思考过程：`deepseek-v4-pro`，Responses API，`reasoning.effort=high`。
- 照片描述：`deepseek-flash` 的原生图片输入；描述随后交给 V4 Pro 结合用户资料和真实记录处理。V4 Pro 不直接接收图片。
- `DEEPSEEK_MODEL`、`DEEPSEEK_VISION_MODEL` 可覆盖对应模型。旧版 `api-key.local.json` 中的 `model` 字段不再决定运行模型；`apiKey` 仍由服务端读取。

## 数据接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 返回 `{configured, model, visionModel, provider, persistent}`，不返回密钥。 |
| `GET /api/state` | 返回权威 `{profile, activeDate, meals, messages, archives, today}`。未建档时 `profile=null`，今日营养为零。 |
| `PUT /api/profile` | 请求 `{profile, timezone}`；服务端验证输入、计算计划并生成新版本；返回 `{profile, state}`。 |
| `POST /api/chat` | 请求 `{requestId, text, image?, source?, targetMealId?}`。`requestId` 为 8–80 位字母、数字或连字符；`image` 为压缩后的 JPEG/PNG/WebP data URL。 |
| `POST /api/meals` | 在 History 手动补记。请求 `{date, type, description}`；`type` 为早餐、午餐、晚餐或加餐，`description` 是食物名称和份量。DeepSeek V4 Pro 估算食物项，服务端校验后保存，返回 `{meal, state}`。 |
| `PUT /api/meals/:id` | 在 History 修改已有餐食。请求 `{type, description}`；沿用原记录日期，重新估算并保存修订，返回 `{meal, state}`。 |
| `DELETE /api/meals/:id` | 删除单餐及其食物项、修订；原对话保留并标记该餐已删除，返回 `{deleted, state}`。不调用模型。 |
| `DELETE /api/history/:date` | 删除该日期全部餐食、交流及不再引用的照片，返回 `{deletedMeals, deletedMessages, state}`。不调用模型。 |
| `GET /api/turn/:requestId` | 断流后按请求 ID 对账。已提交返回结果和最新状态；未完成返回 404。 |
| `GET /api/export` | 下载服务端完整备份 JSON，包含资料、餐食、交流、照片和修订历史。 |
| `POST /api/import` | 请求 `{backup, mode}`，`mode` 为 `profile`、`records` 或 `all`；导入旧版浏览器备份或服务端备份，相同记录 ID 不重复导入。 |
| `GET /api/media/:id` | 读取本机保存的餐食照片。 |
| `DELETE /api/media/:id` | 删除照片，保留文字与餐食记录，并返回最新状态。 |
| `GET /api/memories` | 查看已确认的长期饮食习惯。 |
| `POST /api/memories`、`PUT /api/memories/:id`、`DELETE /api/memories/:id` | 添加、修改、删除习惯。以“请记住：…”明确表达的习惯也会在本轮交流完成后保存。 |

`POST /api/chat` 首次处理时返回 SSE：`status`（`thinking` / `composing`）、`reasoning`（本轮实际思考文本）、`result`（验证并提交后的 `{result, reasoning, assistantMessage, receipt, revised, state, requestId}`）或 `error`。重复的 `requestId` 和相同输入返回 JSON，字段相同且 `replayed=true`，不会重复记餐；同一 ID 携带不同输入返回 409。客户端在断流后应先查询 `GET /api/turn/:requestId`，再用原 ID 重试。

`result.action` 为 `consumed`、`planned`、`question`、`correction`、`clarify` 之一。只有 `consumed` 或目标明确的 `correction` 可更改餐食。模型内部的 `occurred_on` 可标注明确的过去日期；服务端再次核对文字并限制补记范围。过去日期餐食进入对应 History，当天发起的交流留在当天。近七天数据由服务端先汇总，再提供给模型解释。服务端校验食物项、营养数值及整餐合计；每日汇总从餐食重算。未建档返回 409；输入无效返回 400；图片过大返回 413；未配置密钥返回 503；模型错误以相应状态码或 SSE `error` 返回。

History 手动餐食接口只接受过去一年内的有效日期。用户选定的餐次优先于模型推断；修改保留原日期与餐食 ID，不新增对话消息。保存成功后的 `state` 是当前营养与目标进度的权威结果；前端立即替换显示。手动填写的食物描述会发送给 DeepSeek 估算，未配置密钥时接口返回 503。

账号索引在 `data/accounts.sqlite`。站长旧数据库在 `data/boji.sqlite`，照片在 `data/media/`；新账号的数据库和照片分别在 `data/users/<账号 ID>/`，均已排除 Git。数据表包括资料、计划版本、餐食、食物项、修订、交流、追问、请求去重、模型调用、长期习惯和照片；`daily_nutrition_state` 视图按有效餐食汇总。`meta.schema_version` 用于后续迁移。备份文件含私人资料和照片，请妥善保管。
