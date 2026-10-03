# 薄肌本机 API（MVP）

服务只监听 `127.0.0.1`。所有数据由同一个本机用户使用，尚无账号认证或远程部署支持。JSON 接口返回 `Cache-Control: no-store`。日期采用资料中保存的 IANA 时区；时间戳以 UTC ISO 8601 保存。

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
| `GET /api/turn/:requestId` | 断流后按请求 ID 对账。已提交返回结果和最新状态；未完成返回 404。 |
| `GET /api/export` | 下载服务端完整备份 JSON，包含资料、餐食、交流、照片和修订历史。 |
| `POST /api/import` | 请求 `{backup, mode}`，`mode` 为 `profile`、`records` 或 `all`；导入旧版浏览器备份或服务端备份，相同记录 ID 不重复导入。 |
| `GET /api/media/:id` | 读取本机保存的餐食照片。 |
| `DELETE /api/media/:id` | 删除照片，保留文字与餐食记录，并返回最新状态。 |
| `GET /api/memories` | 查看已确认的长期饮食习惯。 |
| `POST /api/memories`、`PUT /api/memories/:id`、`DELETE /api/memories/:id` | 添加、修改、删除习惯。以“请记住：…”明确表达的习惯也会在本轮交流完成后保存。 |

`POST /api/chat` 首次处理时返回 SSE：`status`（`thinking` / `composing`）、`reasoning`（本轮实际思考文本）、`result`（验证并提交后的 `{result, reasoning, assistantMessage, receipt, revised, state, requestId}`）或 `error`。重复的 `requestId` 和相同输入返回 JSON，字段相同且 `replayed=true`，不会重复记餐；同一 ID 携带不同输入返回 409。客户端在断流后应先查询 `GET /api/turn/:requestId`，再用原 ID 重试。

`result.action` 为 `consumed`、`planned`、`question`、`correction`、`clarify` 之一。只有 `consumed` 或目标明确的 `correction` 可更改餐食。模型内部的 `occurred_on` 可标注明确的过去日期；服务端再次核对文字并限制补记范围。过去日期餐食进入对应 History，当天发起的交流留在当天。近七天数据由服务端先汇总，再提供给模型解释。服务端校验食物项、营养数值及整餐合计；每日汇总从餐食重算。未建档返回 409；输入无效返回 400；图片过大返回 413；未配置密钥返回 503；模型错误以相应状态码或 SSE `error` 返回。

数据库在 `data/boji.sqlite`，照片在 `data/media/`，均已排除 Git。数据表包括资料、计划版本、餐食、食物项、修订、交流、追问、请求去重、模型调用、长期习惯和照片；`daily_nutrition_state` 视图按有效餐食汇总。`meta.schema_version` 用于后续迁移。备份文件含私人资料和照片，请妥善保管。
