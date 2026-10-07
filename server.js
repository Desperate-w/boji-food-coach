const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const {Store} = require('./store.js');
const {Accounts} = require('./accounts.js');

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
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';
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
    food_items: {type:'array', minItems:1, maxItems:20, items:{
      type:'object', properties:{
        food_name:{type:'string'}, estimated_amount:{type:'string'}, calories:{type:'integer'},
        protein:{type:'integer'}, carbs:{type:'integer'}, fat:{type:'integer'}, fiber:{type:'integer'},
        confidence:{type:'string',enum:['high','medium','low']},
      },
      required:['food_name','estimated_amount','calories','protein','carbs','fat','fiber','confidence'],
      additionalProperties:false,
    }},
  },
  required: ['name', 'type', 'calories', 'calorie_min', 'calorie_max', 'protein', 'carbs', 'fat', 'fiber','food_items'],
  additionalProperties: false,
};

const turnSchema = {
  type: 'object',
  properties: {
    action: {type: 'string', enum: ['consumed', 'planned', 'question', 'correction', 'clarify']},
    reply: {type: 'string'},
    target_meal_id: {type: ['string', 'null']},
    occurred_on: {type:['string','null']},
    meal: {anyOf: [mealSchema, {type: 'null'}]},
  },
  required: ['action', 'reply', 'target_meal_id', 'occurred_on', 'meal'],
  additionalProperties: false,
};

const instructions = `你是“薄肌”App 的 AI 饮食教练，面向普通健身用户。用自然、简洁的中文回复，通常 1–3 小段。数据都是估算，不要伪精确；不做医学诊断。

根据用户本轮输入选择 action：
- consumed：明确已经吃过，或直接上传食物照片作为记录。估算整顿饭的营养并返回 meal。若用户明确提到昨天、前天或过去日期，occurred_on 填对应 YYYY-MM-DD；否则为 null。
- planned：准备吃、想吃、假设要吃。不要记录，meal 为 null。
- question：营养咨询或食物决策问题。不要记录，meal 为 null。
- correction：用户修改已经记录的一顿。根据提供的餐次 ID 找到目标，target_meal_id 填该 ID；meal 填修正后“整顿饭”的总估算。如果无法判断要改哪顿，用 clarify。
- clarify：信息不足，只有一个关键追问；meal 为 null。

只有 consumed 或有明确目标的 correction 才能改变营养记录。普通附图提问不自动记录；补记过去日期只改变对应日期，不要说“今日已增加”。能够合理估算就直接估算，低把握用热量区间。meal.food_items 应拆出每种主要食物和调味/饮料，估算份量、热量与宏量营养素；整餐数值应等于食物项相加。常见参考：一个鸡蛋约 70–80 kcal、蛋白质约 6g；熟米饭每 100g 约 115 kcal；一片吐司约 70–90 kcal；调味油每 10g 约 90 kcal。其他食物请用常见营养参考保守估算。追问只问一次最重要的问题。近七天统计必须使用服务端提供的 last_seven_days，不要编造。长期习惯仅作为相关时的参考，本轮用户明确描述优先于旧习惯；一次性修正不代表永久偏好。reply 要先回应用户最关心的问题，记录后简述本餐和一条建议；不要自行编造记录后的累计数字，服务端会追加权威累计。不要在 reply 中输出 JSON、Markdown 表格或内部字段名。结合用户目标、真实已记录餐次和训练状态回答。`;

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

async function readRequestJson(req, maxBytes=2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
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
    && (body.text.trim() || body.image)
    && (!body.image || (typeof body.image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(body.image) && body.image.length < 1_600_000))
    && typeof body.requestId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
    && (!body.targetMealId || typeof body.targetMealId === 'string');
}

function buildInput(body, state, clarification, imageDescription, historySummary) {
  const allMeals=[...state.meals,...Object.values(state.archives).flatMap(archive=>archive.meals||[])];
  const context = {
    date: state.activeDate,
    profile: state.profile,
    today: state.today,
    meals: state.meals.slice(-20).map(m => ({id:m.id,type:m.type,name:m.name,food_items:m.foodItems,calories:m.calories,protein:m.protein,carbs:m.carbs,fat:m.fat,fiber:m.fiber})),
    target_meal:body.targetMealId?allMeals.find(meal=>meal.id===body.targetMealId)||null:null,
    last_seven_days:historySummary,
    confirmed_habits:state.memories.slice(0,20).map(memory=>memory.text),
    recent_messages: state.messages.filter(message=>!message.recordDeleted).slice(-12).map(m => ({role:m.role,text:m.text||'',after:m.after||''})),
    prior_clarification: clarification ? {original_text:clarification.original_text, date:clarification.date, image_description:clarification.image_json?JSON.parse(clarification.image_json).description:null} : null,
    target_meal_id: body.targetMealId || null,
    image_description: imageDescription || null,
    image_intent: body.image ? (body.text.trim() ? '结合文字判断记录或咨询' : '拍照记录一餐') : null,
    user_message: body.text || (body.image ? '我上传了一张食物照片，请帮我记录。' : ''),
  };
  return [{role:'user',content:[{type:'input_text',text:JSON.stringify(context)}]}];
}

function validateResult(result) {
  if (!result || !['consumed', 'planned', 'question', 'correction', 'clarify'].includes(result.action) || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('模型回复格式不完整');
  if (['consumed', 'correction'].includes(result.action)) {
    const m = result.meal;
    if (!m || typeof m.name!=='string' || !m.name.trim() || m.name.length>200 || !['早餐', '午餐', '晚餐', '加餐'].includes(m.type)) throw new Error('模型没有返回可用的餐次');
    for (const field of ['calories', 'protein', 'carbs', 'fat', 'fiber']) {
      if (!Number.isInteger(m[field]) || m[field] < 0 || m[field] > 10000) throw new Error('模型返回的营养数据无效');
    }
    if (!Array.isArray(m.food_items) || m.food_items.length < 1 || m.food_items.length > 20) throw new Error('模型没有给出可用的食物项');
    const sums={calories:0,protein:0,carbs:0,fat:0,fiber:0};
    for (const item of m.food_items) {
      if (!item || typeof item.food_name !== 'string' || !item.food_name.trim() || typeof item.estimated_amount !== 'string' || !item.estimated_amount.trim() || !['high','medium','low'].includes(item.confidence)) throw new Error('模型食物项无效');
      for (const field of Object.keys(sums)) {
        if (!Number.isInteger(item[field]) || item[field] < 0 || item[field] > 5000) throw new Error('模型食物项营养数据无效');
        sums[field]+=item[field];
      }
    }
    if (Math.abs(sums.calories-m.calories)>Math.max(40,m.calories*.2)) throw new Error('模型整餐热量与食物项不一致');
    for (const field of Object.keys(sums)) m[field]=sums[field];
    if (m.calorie_min!==null && m.calorie_max!==null && (!Number.isInteger(m.calorie_min)||!Number.isInteger(m.calorie_max)||m.calorie_min>m.calories||m.calorie_max<m.calories||m.calorie_min<0)) throw new Error('模型热量区间无效');
    if ((m.calorie_min===null)!==(m.calorie_max===null)) throw new Error('模型热量区间不完整');
  }
  return result;
}

function enforceRecordBoundary(result, text, hasImage, targetMealId, clarification, meals=[]) {
  if (result.action === 'correction') {
    const chosen=targetMealId ? meals.find(meal=>meal.id===targetMealId) : null;
    const candidates=meals.filter(meal=>text.includes(meal.name)||meal.foodItems?.some(item=>{
      const name=item.food_name.replace(/^(熟|生|一份)/,'');return name.length>=2&&text.includes(name);
    }));
    const inferred=chosen || (meals.length===1?meals[0]:candidates.length===1?candidates[0]:null);
    if (!inferred) return {...result,action:'clarify',target_meal_id:null,meal:null,reply:'你想修改哪一顿？说一下餐次或食物，我再帮你调整。'};
    result.target_meal_id=inferred.id;
  }
  if (result.action === 'clarify' && clarification) return {...result,action:'question',meal:null,target_meal_id:null,reply:'目前信息仍不足，我先不记录这顿。你想起来主要食物后再告诉我即可。'};
  if (result.action !== 'consumed') return result;
  const eaten = /(吃了|喝了|吃过|喝过|吃的|喝的|已吃|刚吃|刚喝|吃完|喝完|吃了一碗|吃了一份)/.test(text);
  const planned = /((想|准备|打算|计划).{0,10}吃|还没吃|如果.{0,12}吃|明天.{0,12}吃|想要吃)/.test(text);
  const question = /(多少卡|多少热量|能不能吃|可不可以吃|可以吃|还能吃|会不会超|为什么|[?？])/.test(text);
  if (planned && !eaten) return {...result, action: 'planned', meal: null, target_meal_id: null, reply: '这顿还没有计入今天的记录。你吃完后告诉我，我再结合当时的份量帮你估算和记录。'};
  if (question && !eaten) return {...result, action: 'question', meal: null, target_meal_id: null, reply: '这是饮食咨询，暂时不会计入今天的记录。你可以问我怎么安排；真正吃完后再告诉我。'};
  if (!hasImage && !eaten && !clarification) return {...result, action: 'clarify', meal: null, target_meal_id: null, reply: '这份是已经吃了，还是准备吃？确认后我再帮你记录。'};
  return result;
}

function resolveMealDate(result, text, today, clarification) {
  if (result.action!=='consumed') return today;
  const shift=days=>new Date(Date.parse(`${today}T12:00:00Z`)-days*86400000).toISOString().slice(0,10);
  if (/前天/.test(text)) return shift(2);
  if (/昨天/.test(text)) return shift(1);
  if (/(^|\D)\d{4}-\d{2}-\d{2}(\D|$)|\d{1,2}月\d{1,2}日/.test(text) && /^\d{4}-\d{2}-\d{2}$/.test(result.occurred_on||'')) {
    const proposed=result.occurred_on;
    const parsed=new Date(`${proposed}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===proposed && proposed<=today && proposed>=shift(365)) return proposed;
  }
  return clarification?.date||today;
}

function apiErrorMessage(status, detail) {
  if (status === 401) return 'DeepSeek API Key 无效，请检查本地配置。';
  if (status === 402) return 'DeepSeek 账户余额不足，请查看平台用量与余额。';
  if (status === 403 || status === 404) return '当前 Key 无法使用所选模型，请检查 DEEPSEEK_MODEL。';
  if (status === 429) return 'DeepSeek 请求速率达到上限，请稍后再试。';
  return `模型请求失败（HTTP ${status}）${detail ? `：${detail.slice(0, 160)}` : ''}`;
}

async function describeImage(image, {apiKey, visionModel, fetchImpl, signal}) {
  const response=await fetchImpl('https://api.deepseek.com/responses',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:visionModel,reasoning:{effort:'none'},max_output_tokens:1200,
      instructions:'请只描述照片中可辨认的食物、可能的份量和无法辨认的部分。不要声称用户已经吃了，也不要编造看不到的配料。简洁中文。',
      input:[{role:'user',content:[{type:'input_text',text:'请描述这张饮食照片。'},{type:'input_image',image_url:image,detail:'high'}]}]}),signal,
  });
  if (!response.ok) throw new Error(apiErrorMessage(response.status,await response.text()));
  const payload=await response.json();
  if (payload.status!=='completed') throw new Error('照片识别未完成，请重试。');
  const description=extractOutputText(payload).trim();
  if (!description) throw new Error('没有识别到照片内容，请补充文字说明。');
  return description.slice(0,3000);
}

async function estimateManualMeal({apiKey,model,fetchImpl,description,type,profile}) {
  const response=await fetchImpl('https://api.deepseek.com/responses',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,reasoning:{effort:'high'},max_output_tokens:8000,
      instructions:'你是饮食记录的营养估算助手。用户已经吃了输入中的食物。只按用户提供的食物名称和份量估算，不添加未提及的食物。food_items 分别列出主要食物；整餐数据为各食物项之和。无法确定份量时使用常见份量的保守约值，并用热量区间表达不确定性。type 必须使用用户指定的餐次。不要做医学诊断。',
      input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({type,description,goal:profile.goal})}]}],
      text:{format:{type:'json_schema',name:'manual_meal',schema:mealSchema}}}),
  });
  if (!response.ok) throw new Error(apiErrorMessage(response.status,await response.text()));
  const payload=await response.json();
  if (payload.status!=='completed') throw new Error('餐食估算没有完成，请重试。');
  let data;
  try {data=JSON.parse(extractOutputText(payload));}
  catch {throw new Error('模型没有返回可用的餐食估算，请重试。');}
  validateResult({action:'consumed',reply:'已估算',meal:data});
  data.type=type;
  return data;
}

function validMealDate(date,today) {
  if (typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed=Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===date
    && date<=today&&parsed>=Date.parse(`${today}T12:00:00Z`)-365*86400000;
}

function validHistoryDate(date,today) {
  if (typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed=Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===date&&date<=today;
}

function json(res, status, data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}

function cookieValue(req,name) {
  const match=String(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`));
  return match?match.slice(name.length+1):null;
}

function sessionCookie(req,token,maxAge) {
  const localProxy=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const secure=req.socket.encrypted || (localProxy && req.headers['x-forwarded-proto']==='https');
  return `boji_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}

function loginThrottle() {
  const attempts=new Map();
  return (key,limit,windowMs) => {
    const now=Date.now();
    if (attempts.size>2000) for (const [entry,value] of attempts) if (value.until<now) attempts.delete(entry);
    const current=attempts.get(key);
    if (!current||current.until<now) {attempts.set(key,{count:1,until:now+windowMs});return true;}
    current.count++;
    return current.count<=limit;
  };
}

function createAppServer({apiKey = API_KEY, model = MODEL, visionModel = VISION_MODEL, fetchImpl = globalThis.fetch, dbPath, auth = true, dailyModelLimit = Number(process.env.DAILY_MODEL_LIMIT||30), globalModelLimit = Number(process.env.GLOBAL_DAILY_MODEL_LIMIT||100)} = {}) {
  dailyModelLimit=Number.isInteger(dailyModelLimit)&&dailyModelLimit>0?dailyModelLimit:30;
  globalModelLimit=Number.isInteger(globalModelLimit)&&globalModelLimit>0?globalModelLimit:100;
  const dataDir=dbPath?path.dirname(dbPath):path.join(ROOT,'data');
  const accounts=auth?new Accounts(path.join(dataDir,'accounts.sqlite')):null;
  const stores=new Map();
  const legacyStore=auth?null:new Store(dbPath);
  const throttle=loginThrottle();
  const storeFor=account => {
    if (!accounts) return legacyStore;
    const filename=account.storageKey==='legacy'?path.join(dataDir,'boji.sqlite'):path.join(dataDir,'users',account.id,'boji.sqlite');
    if (!stores.has(account.id)) stores.set(account.id,new Store(filename));
    return stores.get(account.id);
  };
  const server=http.createServer(async (req, res) => {
    const token=cookieValue(req,'boji_session');
    const account=accounts?accounts.session(token):null;
    if (accounts && req.url==='/api/auth/session' && req.method==='GET') {
      return account?json(res,200,{authenticated:true,username:account.username,csrf:Accounts.csrfForToken(token)}):json(res,401,{authenticated:false});
    }
    if (accounts && ['/api/auth/login','/api/auth/register'].includes(req.url) && req.method==='POST') {
      const key=`${req.url}:${req.socket.remoteAddress}`;
      if (!throttle(key,30,15*60_000)) return json(res,429,{error:'尝试次数过多，请稍后再试。'});
      try {
        if (!String(req.headers['content-type']||'').startsWith('application/json')) return json(res,415,{error:'仅接受 JSON 请求。'});
        const body=await readRequestJson(req,4096);
        let user;
        if (req.url==='/api/auth/register') user=accounts.register(body);
        else {
          if (!throttle(`login:${String(body.username||'').toLowerCase()}`,8,15*60_000)) return json(res,429,{error:'此账号尝试次数过多，请稍后再试。'});
          user=accounts.verify(body.username,body.password);
          if (!user) return json(res,401,{error:'用户名或密码不正确。'});
        }
        const session=accounts.createSession(user);
        res.setHeader('Set-Cookie',sessionCookie(req,session.token,30*24*3600));
        return json(res,200,{authenticated:true,username:user.username,csrf:session.csrf});
      } catch(error) {return json(res,400,{error:error.message||'无法完成登录。'});}
    }
    if (accounts && req.url==='/login' && ['GET','HEAD'].includes(req.method)) {
      if (account) {res.writeHead(302,{Location:'/'});res.end();return;}
      const page=await fs.readFile(path.join(ROOT,'login.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:page);return;
    }
    if (accounts && ['/login.js','/styles.css'].includes(req.url) && ['GET','HEAD'].includes(req.method)) {
      const filename=req.url==='/login.js'?'login.js':'styles.css';
      const content=await fs.readFile(path.join(ROOT,filename));
      res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:content);return;
    }
    if (accounts && !account) {
      if (['GET','HEAD'].includes(req.method) && (req.url==='/'||req.url==='/index.html')) {res.writeHead(302,{Location:'/login'});res.end();return;}
      if (req.url.startsWith('/api/')) return json(res,401,{error:'请先登录。'});
      res.writeHead(404);res.end('Not found');return;
    }
    if (accounts && !['GET','HEAD'].includes(req.method) && !accounts.validCsrf(account,req.headers['x-csrf-token'])) return json(res,403,{error:'会话校验失败，请刷新页面重试。'});
    if (accounts && req.url==='/api/auth/logout' && req.method==='POST') {
      accounts.revokeSession(token);
      res.setHeader('Set-Cookie',sessionCookie(req,'',0));
      return json(res,200,{authenticated:false});
    }
    const store=storeFor(account);
    if (req.method === 'GET' && req.url === '/api/health') {
      json(res,200,{configured:Boolean(apiKey),model,visionModel,provider:'DeepSeek',persistent:true});
      return;
    }
    if (req.method === 'GET' && req.url === '/api/state') {
      json(res,200,store.state());
      return;
    }
    if (req.method === 'GET' && req.url === '/api/export') {
      res.setHeader('Content-Disposition','attachment; filename="boji-backup.json"');
      json(res,200,store.exportData());
      return;
    }
    if (req.method === 'GET' && /^\/api\/media\/[a-f0-9-]{36}$/.test(req.url)) {
      const media=store.readMedia(req.url.slice('/api/media/'.length));
      if (!media) return json(res,404,{error:'照片不存在。'});
      res.writeHead(200,{'Content-Type':media.mime,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
      res.end(media.bytes);return;
    }
    if (req.method === 'DELETE' && /^\/api\/media\/[a-f0-9-]{36}$/.test(req.url)) {
      const deleted=store.deleteMedia(req.url.slice('/api/media/'.length));
      json(res,deleted?200:404,deleted?{deleted:true,state:store.state()}:{error:'照片不存在。'});
      return;
    }
    if (req.method === 'GET' && /^\/api\/turn\/[a-zA-Z0-9-]{8,80}$/.test(req.url)) {
      const prior=store.priorTurn(req.url.slice('/api/turn/'.length));
      json(res,prior?200:404,prior?{...prior.result,state:store.state()}:{error:'请求尚未完成或不存在。'});
      return;
    }
    if (req.method === 'PUT' && req.url === '/api/profile') {
      try {
        if (!String(req.headers['content-type']||'').startsWith('application/json')) return json(res,415,{error:'仅接受 JSON 请求。'});
        const body=await readRequestJson(req);
        const profile=store.saveProfile(body.profile||body,body.timezone);
        json(res,200,{profile,state:store.state()});
      } catch(error) { json(res,error.status||500,{error:error.message||'保存资料失败'}); }
      return;
    }
    const manualRoute=/^\/api\/meals(?:\/([a-f0-9-]{36}))?$/.exec(req.url);
    if (manualRoute && ((req.method==='POST'&&!manualRoute[1])||(req.method==='PUT'&&manualRoute[1]))) {
      try {
        if (!String(req.headers['content-type']||'').startsWith('application/json')) return json(res,415,{error:'仅接受 JSON 请求。'});
        const body=await readRequestJson(req);
        const profile=store.profile();
        if (!profile) return json(res,409,{error:'请先完成建档。'});
        const target=manualRoute[1]?store.manualTarget(manualRoute[1]):null;
        if (manualRoute[1]&&!target) return json(res,404,{error:'找不到要修改的餐食。'});
        const date=target?.date||body.date;
        if (!validMealDate(date,store.today())) return json(res,400,{error:'只能记录或修改过去一年内的日期。'});
        if (!['早餐','午餐','晚餐','加餐'].includes(body.type)) return json(res,400,{error:'请选择早餐、午餐、晚餐或加餐。'});
        if (typeof body.description!=='string'||!body.description.trim()||body.description.trim().length>1000) return json(res,400,{error:'请填写 1–1000 字的食物和份量。'});
        if (!apiKey) return json(res,503,{error:'请先配置 DeepSeek API Key，才能估算手动填写的餐食。'});
        const description=body.description.trim();
        if (accounts && !accounts.reserveModelCall(account.id,dailyModelLimit,globalModelLimit)) return json(res,429,{error:'今天的 AI 使用次数已达上限，请明天再试。'});
        const data=await estimateManualMeal({apiKey,model,fetchImpl,description,type:body.type,profile});
        const meal=store.saveManualMeal({id:manualRoute[1]||null,date,type:body.type,description,data});
        json(res,manualRoute[1]?200:201,{meal,state:store.state()});
      } catch(error) {json(res,error.status||500,{error:error.message||'保存餐食失败'});}
      return;
    }
    const deleteMealRoute=/^\/api\/meals\/([\w-]{1,80})$/.exec(req.url);
    if (req.method==='DELETE'&&deleteMealRoute) {
      try {
        const deleted=store.deleteMeal(deleteMealRoute[1]);
        json(res,deleted?200:404,deleted?{deleted,state:store.state()}:{error:'餐食记录不存在。'});
      } catch(error) {json(res,error.status||500,{error:error.message||'删除餐食失败'});}
      return;
    }
    const deleteDayRoute=/^\/api\/history\/(\d{4}-\d{2}-\d{2})$/.exec(req.url);
    if (req.method==='DELETE'&&deleteDayRoute) {
      try {
        const date=deleteDayRoute[1];
        if (!validHistoryDate(date,store.today())) return json(res,400,{error:'历史日期无效。'});
        const deleted=store.deleteDay(date);
        json(res,deleted?200:404,deleted?{...deleted,state:store.state()}:{error:'当天没有可删除的记录。'});
      } catch(error) {json(res,error.status||500,{error:error.message||'删除当天记录失败'});}
      return;
    }
    if (req.method === 'POST' && req.url === '/api/import') {
      try {
        if (!String(req.headers['content-type']||'').startsWith('application/json')) return json(res,415,{error:'仅接受 JSON 请求。'});
        const body=await readRequestJson(req,20_000_000);
        json(res,200,store.importData(body.backup,body.mode));
      } catch(error) {json(res,error.status||400,{error:error.message||'导入失败'});}
      return;
    }
    if (req.url === '/api/memories' && req.method === 'GET') return json(res,200,{memories:store.memories()});
    if (req.url === '/api/memories' && req.method === 'POST') {
      try {
        const body=await readRequestJson(req);
        const memory=store.saveMemory(body.text);
        json(res,201,{memory,state:store.state()});
      } catch(error) {json(res,error.status||400,{error:error.message||'保存习惯失败'});}
      return;
    }
    if (/^\/api\/memories\/[a-f0-9-]{36}$/.test(req.url) && ['PUT','DELETE'].includes(req.method)) {
      try {
        const id=req.url.slice('/api/memories/'.length);
        const changed=req.method==='DELETE'?store.deleteMemory(id):store.updateMemory(id,(await readRequestJson(req)).text);
        json(res,changed?200:404,changed?{changed:true,state:store.state()}:{error:'习惯不存在。'});
      } catch(error) {json(res,error.status||400,{error:error.message||'更新习惯失败'});}
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!apiKey) return json(res,503,{error:'未配置 DeepSeek API Key。'});
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return json(res,415,{error:'仅接受 JSON 请求。'});
      }

      let abort, timeout, clientClosed=false, timedOut=false;
      try {
        const startedAt=Date.now();
        const body = await readRequestJson(req);
        if (!validContext(body)) {
          return json(res,400,{error:'消息数据不完整或图片过大。'});
        }
        if (body.targetMealId && /^请把这顿改为[：:]?\s*$/.test(body.text)) return json(res,400,{error:'请先补充这顿实际吃了什么或改了多少。'});
        const profile=store.profile();
        if (!profile) return json(res,409,{error:'请先完成基本资料建档。'});
        const source=['voice','photo','text'].includes(body.source)?body.source:(body.image?'photo':'text');
        const requestInput={text:body.text.trim(),image:body.image||null,targetMealId:body.targetMealId||null,source};
        const requestHash=Store.hashRequest(requestInput);
        const prior=store.priorTurn(body.requestId);
        if (prior) {
          if (prior.hash!==requestHash) return json(res,409,{error:'请求 ID 已用于另一条消息。'});
          return json(res,200,{...prior.result,state:store.state(),replayed:true});
        }
        if (accounts && !accounts.reserveModelCall(account.id,dailyModelLimit,globalModelLimit)) return json(res,429,{error:'今天的 AI 使用次数已达上限，请明天再试。'});
        const state=store.state();
        const clarification=store.clarification();
        abort = new AbortController();
        res.on('close', () => {clientClosed=true;abort.abort();});
        timeout=setTimeout(()=>{timedOut=true;abort.abort();},120000);
        let imageDescription='';
        if (body.image) {
          imageDescription=await describeImage(body.image,{apiKey,visionModel,fetchImpl,signal:abort.signal});
          store.logModelCall({requestId:body.requestId,model:visionModel,purpose:'vision',status:'completed'});
        }
        const upstream = await fetchImpl('https://api.deepseek.com/responses', {
          method: 'POST',
          headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            model, instructions, input: buildInput(body,state,clarification,imageDescription,store.lastSevenSummary(state.activeDate)), stream: true,
            reasoning: {effort: 'high'},
            max_output_tokens: 8000,
            text: {format: {type: 'json_schema', name: 'nutrition_turn', schema: turnSchema}},
          }),
          signal: abort.signal,
        });

        if (!upstream.ok) {
          const errorText = await upstream.text();
          return json(res,upstream.status,{error:apiErrorMessage(upstream.status,errorText)});
        }
        if (!upstream.body) {
          return json(res,502,{error:'DeepSeek 没有返回数据流，请重试。'});
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
        let usage=null;
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
            usage=event.response?.usage||null;
          } else if (event.type === 'response.incomplete') {
            throw new Error('模型输出被截断，请缩短输入后重试。');
          } else if (event.type === 'response.failed' || event.type === 'error') {
            throw new Error(event.response?.error?.message || event.message || '模型生成失败');
          }
        }
        if (!completed) throw new Error('模型连接中断，请重试');
        const allMeals=[...state.meals,...Object.values(state.archives).flatMap(archive=>archive.meals||[])];
        const result = enforceRecordBoundary(validateResult(JSON.parse(outputText)),body.text,Boolean(body.image),body.targetMealId,clarification,allMeals);
        store.logModelCall({requestId:body.requestId,model,purpose:'nutrition-turn',status:'completed',inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens});
        const committed=store.commitTurn({requestId:body.requestId,requestHash,conversationDate:state.activeDate,mealDate:resolveMealDate(result,body.text,state.activeDate,clarification),text:body.text.trim(),image:body.image||null,imageDescription,source,result,reasoning,elapsedSeconds:Math.max(1,Math.round((Date.now()-startedAt)/1000))});
        sendEvent(res, 'result', {...committed,state:store.state(),requestId:body.requestId});
        res.end();
      } catch (error) {
        if (res.writableEnded || clientClosed) return;
        const message=timedOut?'模型响应超时，请重试。':(error.message||'模型请求失败');
        if (res.headersSent) { sendEvent(res, 'error', {message}); res.end(); }
        else json(res,error.status||500,{error:message});
      } finally {clearTimeout(timeout);}
      return;
    }

    const files = {'/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/nutrition.js': ['nutrition.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css']};
    const file = files[req.url];
    if (!['GET','HEAD'].includes(req.method) || !file) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const content = await fs.readFile(path.join(ROOT, file[0]));
      res.writeHead(200, {'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch { res.writeHead(500); res.end('Could not load file'); }
  });
  server.on('close',()=>{legacyStore?.close();for (const store of stores.values()) store.close();accounts?.close();});
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.on('error', error => {
    console.error(`无法启动本地服务：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`薄肌 Demo 已启动：http://${HOST}:${PORT}`);
    console.log(API_KEY ? `LLM 已配置：文字 ${MODEL}，图片 ${VISION_MODEL}` : '未配置 API Key；页面将使用本地演示回复。');
  });
}

module.exports = {createAppServer, turnSchema, validateResult, readSSE, enforceRecordBoundary};
