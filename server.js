const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
function readLocalConfig() {
  let source;
  try { source = fsSync.readFileSync(path.join(ROOT, 'api-key.local.json'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('无法读取 api-key.local.json，请检查文件权限。');
  }
  let config;
  try { config = JSON.parse(source); }
  catch { throw new Error('api-key.local.json 不是有效 JSON，请检查引号和逗号。'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || (config.apiKey !== undefined && typeof config.apiKey !== 'string')
    || (config.model !== undefined && typeof config.model !== 'string')) {
    throw new Error('api-key.local.json 中的 apiKey 和 model 必须是文本。');
  }
  return config;
}
const localConfig = readLocalConfig();
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.DEEPSEEK_MODEL || localConfig.model?.trim() || 'deepseek-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY || localConfig.apiKey?.trim() || '';

const mealSchema = {
  type: 'object',
  properties: {
    name: {type: 'string'},
    type: {type: 'string', enum: ['早餐', '午餐', '晚餐', '加餐']},
    calories: {type: 'integer'},
    calorie_min: {type: ['integer', 'null']},
    calorie_max: {type: ['integer', 'null']},
    protein: {type: 'integer'},
    carbs: {type: 'integer'},
    fat: {type: 'integer'},
    fiber: {type: 'integer'},
  },
  required: ['name', 'type', 'calories', 'calorie_min', 'calorie_max', 'protein', 'carbs', 'fat', 'fiber'],
  additionalProperties: false,
};

const turnSchema = {
  type: 'object',
  properties: {
    action: {type: 'string', enum: ['consumed', 'planned', 'question', 'correction', 'clarify']},
    reply: {type: 'string'},
    target_meal_id: {type: ['string', 'null']},
    meal: {anyOf: [mealSchema, {type: 'null'}]},
  },
  required: ['action', 'reply', 'target_meal_id', 'meal'],
  additionalProperties: false,
};

const instructions = `你是“薄肌”App 的 AI 饮食教练，面向普通健身用户。用自然、简洁的中文回复，通常 1–3 小段。数据都是估算，不要伪精确；不做医学诊断。

根据用户本轮输入选择 action：
- consumed：明确已经吃过，或直接上传食物照片作为记录。估算整顿饭的营养并返回 meal。
- planned：准备吃、想吃、假设要吃。不要记录，meal 为 null。
- question：营养咨询或食物决策问题。不要记录，meal 为 null。
- correction：用户修改已经记录的一顿。根据提供的餐次 ID 找到目标，target_meal_id 填该 ID；meal 填修正后“整顿饭”的总估算。如果无法判断要改哪顿，用 clarify。
- clarify：信息不足，只有一个关键追问；meal 为 null。

只有 consumed 或有明确目标的 correction 才能改变用户今日营养状态。对照片要结合用户补充描述；用户说“准备吃”时即使有照片也不能记录。能够合理估算就直接估算，低把握用热量区间。reply 要先回应用户最关心的问题；记录后简述本餐、今日状态和下一步建议。不要在 reply 中输出 JSON、Markdown 表格或内部字段名。结合用户目标、已记录餐次和训练状态回答。`;

function sendEvent(res, type, data) {
  if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractOutputText(response) {
  return (response?.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
}

function extractReasoning(response) {
  return (response?.output || [])
    .filter(item => item.type === 'reasoning')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'reasoning_text')
    .map(part => part.text || '')
    .filter(Boolean)
    .join('\n\n');
}

async function* readSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (dataLines.length) {
            const payload = dataLines.join('\n');
            dataLines = [];
            if (payload !== '[DONE]') {
              try { yield JSON.parse(payload); } catch { /* Ignore malformed upstream event. */ }
            }
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
    if (dataLines.length) {
      const payload = dataLines.join('\n');
      if (payload !== '[DONE]') {
        try { yield JSON.parse(payload); } catch { /* Ignore malformed trailing event. */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readRequestJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) {
      const error = new Error('图片或消息过大，请缩小后重试');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('请求格式无效'); error.status = 400; throw error; }
}

function validContext(body) {
  return body && typeof body.text === 'string' && body.text.length <= 4000
    && (!body.image || (typeof body.image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.image) && body.image.length < 1_600_000))
    && body.profile && typeof body.profile === 'object'
    && Array.isArray(body.meals) && Array.isArray(body.messages);
}

function buildInput(body) {
  const context = {
    date: body.date,
    profile: body.profile,
    today: body.today,
    meals: body.meals.slice(-20).map(m => ({id: m.id, type: m.type, name: m.name, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber})),
    recent_messages: body.messages.slice(-12).map(m => ({role: m.role, text: m.text || '', after: m.after || ''})),
    user_message: body.text || (body.image ? '我上传了一张食物照片，请帮我记录。' : ''),
  };
  const content = [{type: 'input_text', text: JSON.stringify(context)}];
  if (body.image) content.push({type: 'input_image', image_url: body.image, detail: 'low'});
  return [{role: 'user', content}];
}

function validateResult(result) {
  if (!result || !['consumed', 'planned', 'question', 'correction', 'clarify'].includes(result.action) || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('模型回复格式不完整');
  if (['consumed', 'correction'].includes(result.action)) {
    const m = result.meal;
    if (!m || !m.name || !['早餐', '午餐', '晚餐', '加餐'].includes(m.type)) throw new Error('模型没有返回可用的餐次');
    for (const field of ['calories', 'protein', 'carbs', 'fat', 'fiber']) {
      if (!Number.isInteger(m[field]) || m[field] < 0 || m[field] > 10000) throw new Error('模型返回的营养数据无效');
    }
  }
  return result;
}

function enforceRecordBoundary(result, text, hasImage) {
  if (result.action !== 'consumed') return result;
  const eaten = /(吃了|喝了|吃过|喝过|吃的|喝的|已吃|刚吃|刚喝|吃完|喝完)/.test(text);
  const planned = /((想|准备|打算|计划).{0,10}吃|还没吃|如果.{0,12}吃|明天.{0,12}吃)/.test(text);
  const question = /(多少卡|多少热量|能不能吃|可不可以吃|可以吃|还能吃|会不会超|为什么|[?？])/.test(text);
  if (planned && !eaten) return {...result, action: 'planned', meal: null, target_meal_id: null, reply: '这顿还没有计入今天的记录。你吃完后告诉我，我再结合当时的份量帮你估算和记录。'};
  if (question && !eaten) return {...result, action: 'question', meal: null, target_meal_id: null, reply: '这是饮食咨询，暂时不会计入今天的记录。你可以问我怎么安排；真正吃完后再告诉我。'};
  if (!hasImage && !eaten) return {...result, action: 'clarify', meal: null, target_meal_id: null, reply: '这份是已经吃了，还是准备吃？确认后我再帮你记录。'};
  return result;
}

function apiErrorMessage(status, detail) {
  if (status === 401) return 'DeepSeek API Key 无效，请检查本地配置。';
  if (status === 402) return 'DeepSeek 账户余额不足，请查看平台用量与余额。';
  if (status === 403 || status === 404) return '当前 Key 无法使用所选模型，请检查 DEEPSEEK_MODEL。';
  if (status === 429) return 'DeepSeek 请求速率达到上限，请稍后再试。';
  return `模型请求失败（HTTP ${status}）${detail ? `：${detail.slice(0, 160)}` : ''}`;
}

function createAppServer({apiKey = API_KEY, model = MODEL, fetchImpl = globalThis.fetch} = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({configured: Boolean(apiKey), model, provider: 'DeepSeek'}));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!apiKey) {
        res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '未配置 DeepSeek API Key。'}));
        return;
      }
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        res.writeHead(415, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({error: '仅接受 JSON 请求。'}));
        return;
      }

      let abort;
      try {
        const body = await readRequestJson(req);
        if (!validContext(body)) {
          res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: '消息数据不完整或图片过大。'}));
          return;
        }
        abort = new AbortController();
        res.on('close', () => abort.abort());
        const upstream = await fetchImpl('https://api.deepseek.com/responses', {
          method: 'POST',
          headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            model, instructions, input: buildInput(body), stream: true,
            reasoning: {effort: 'low'},
            max_output_tokens: 5000,
            text: {format: {type: 'json_schema', name: 'nutrition_turn', schema: turnSchema}},
          }),
          signal: abort.signal,
        });

        if (!upstream.ok) {
          const errorText = await upstream.text();
          res.writeHead(upstream.status, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: apiErrorMessage(upstream.status, errorText)}));
          return;
        }
        if (!upstream.body) {
          res.writeHead(502, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: 'DeepSeek 没有返回数据流，请重试。'}));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
        });
        sendEvent(res, 'status', {phase: 'thinking'});

        let outputText = '';
        let reasoning = '';
        let completed = false;
        let composing = false;
        const reasoningParts = new Map();
        for await (const event of readSSE(upstream.body)) {
          if (event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_text.done') {
            const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
            const current = reasoningParts.get(key) || '';
            reasoningParts.set(key, event.type.endsWith('.done') ? (event.text || current) : current + (event.delta || ''));
            reasoning = [...reasoningParts.values()].join('\n\n');
            sendEvent(res, 'reasoning', {text: reasoning});
          } else if (event.type === 'response.output_text.delta') {
            outputText += event.delta || '';
            if (!composing) {composing = true; sendEvent(res, 'status', {phase: 'composing'});}
          } else if (event.type === 'response.completed') {
            completed = true;
            outputText ||= extractOutputText(event.response);
            reasoning ||= extractReasoning(event.response);
          } else if (event.type === 'response.incomplete') {
            throw new Error('模型输出被截断，请缩短输入后重试。');
          } else if (event.type === 'response.failed' || event.type === 'error') {
            throw new Error(event.response?.error?.message || event.message || '模型生成失败');
          }
        }
        if (!completed) throw new Error('模型连接中断，请重试');
        const result = enforceRecordBoundary(validateResult(JSON.parse(outputText)), body.text, Boolean(body.image));
        sendEvent(res, 'result', {result, reasoning});
        res.end();
      } catch (error) {
        if (res.writableEnded || abort?.signal.aborted) return;
        if (res.headersSent) { sendEvent(res, 'error', {message: error.message || '模型请求失败'}); res.end(); }
        else {
          res.writeHead(error.status || 500, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({error: error.message || '模型请求失败'}));
        }
      }
      return;
    }

    const files = {'/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/nutrition.js': ['nutrition.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css']};
    const file = files[req.url];
    if (req.method !== 'GET' || !file) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const content = await fs.readFile(path.join(ROOT, file[0]));
      res.writeHead(200, {'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store'});
      res.end(content);
    } catch { res.writeHead(500); res.end('Could not load file'); }
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.on('error', error => {
    console.error(`无法启动本地服务：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`薄肌 Demo 已启动：http://${HOST}:${PORT}`);
    console.log(API_KEY ? `LLM 已配置：${MODEL}` : '未配置 API Key；页面将使用本地演示回复。');
  });
}

module.exports = {createAppServer, turnSchema, validateResult, readSSE};
