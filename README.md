# 薄肌饮食教练 Demo

这是一个本地前端 Demo。直接打开 `index.html` 时使用本地模拟回复；通过本地服务并配置 DeepSeek API Key 后，输入、照片和咨询会由 DeepSeek 处理。

## 启动真实模型模式

打开同目录的 `api-key.local.json`，把 `apiKey` 后面的空字符串改为你的 DeepSeek API Key，并保留两侧的英文双引号。`model` 使用 `deepseek-flash`，支持文字、照片和思考模式。这个文件只供本机服务端读取，已经加入 `.gitignore`，不会提交到 Git。不要把 Key 填进网页或聊天消息。

例如文件格式如下（示意值不可用）：

```json
{
  "apiKey": "在这里填写你的 Key",
  "model": "deepseek-flash"
}
```

保存文件后，在终端进入本目录并运行：

```zsh
npm start
```

浏览器打开 <http://127.0.0.1:3000>。看到右上角显示“DeepSeek · deepseek-flash”后即可体验。修改 Key 后需要重新启动服务。也可以用 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL` 环境变量临时覆盖本地配置。

请用上面的本地服务地址体验真实模型；原来的 `file://` 页面仍是本地模拟回复。两个地址的浏览器存储彼此独立，因此原来文件版的历史记录不会自动出现在本地服务版。

模型回复使用 DeepSeek 的流式 Responses API。等待时显示“模型正在思考”；下拉区域会逐步显示 DeepSeek 本轮实际返回的思考文本。如果本轮没有返回思考文本，页面会如实提示。营养判断和记录为估算，仍应允许用户修正。

## 查看交互

- 说“刚吃了两个鸡蛋”，查看记录和 Today 的更新。
- 问“晚上想吃火锅”，查看不修改 Today 的建议。
- 说“米饭其实只吃了一半”，查看餐次修正。
- 上传餐食照片并补充一句话，查看图片输入。
- 在「历史 → 今天」查看已完成的交流、餐次和模型思考过程。

当前数据保存在浏览器本机的 `localStorage`，尚未接入账号或数据库。没有配置 API Key 时，页面仍可使用原有本地模拟流程。

如遇到余额提示，可以登录 [DeepSeek 用量页面](https://platform.deepseek.com/usage) 查看账户状态。

## Git 记录

项目已用 Git 保存版本。以后的代码修改会提交到本地仓库；`api-key.local.json` 始终留在本机，不纳入提交。新环境可复制 `api-key.example.json` 为 `api-key.local.json` 后再填写自己的 Key。
