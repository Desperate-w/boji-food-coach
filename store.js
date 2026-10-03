const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const nutrition = require('./nutrition.js');

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const parse = value => value ? JSON.parse(value) : null;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const fields = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

function localDate(timeZone, instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).format(instant);
}

function safeTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80) return 'Asia/Shanghai';
  try { new Intl.DateTimeFormat('en', {timeZone:value}); return value; }
  catch { return 'Asia/Shanghai'; }
}

function totals(meals) {
  return meals.reduce((sum, meal) => {
    for (const field of fields) sum[field] += meal[field] || 0;
    return sum;
  }, Object.fromEntries(fields.map(field => [field, 0])));
}

function dailyStatus(meals, plan) {
  if (!plan) return '尚未建档';
  if (!meals.length) return '待记录';
  const sum = totals(meals);
  if (sum.calories > plan.caloriesMax + 150) return '略高于建议';
  if (sum.calories >= plan.caloriesMin - 150) return '接近今日目标';
  if (sum.calories < 500) return '刚刚开始';
  return '目前节奏合适';
}

function dailyAdvice(meals, plan) {
  if (!plan) return '完成建档后可查看建议';
  if (!meals.length) return '今天还没有饮食记录。吃完告诉我，就从第一顿开始。';
  const sum = totals(meals);
  if (sum.calories > plan.caloriesMax + 150) return '今天热量已略高，接下来正常吃即可，不必刻意补偿。';
  const gap = Math.max(0, plan.proteinTarget - sum.protein);
  if (gap <= 8) return '蛋白质基本达标，下一顿按平时的食量正常吃就好。';
  return `今天蛋白质还差约 ${Math.round(gap / 5) * 5}g，下一顿优先选高蛋白主菜。`;
}

class Store {
  constructor(filename = path.join(__dirname, 'data', 'boji.sqlite')) {
    fs.mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
    this.mediaDir=path.join(path.dirname(filename),'media');
    fs.mkdirSync(this.mediaDir,{recursive:true,mode:0o700});
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY CHECK(id=1), input_json TEXT NOT NULL, timezone TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nutrition_plan (version INTEGER PRIMARY KEY, profile_json TEXT NOT NULL, effective_at TEXT NOT NULL, local_date TEXT);
      CREATE TABLE IF NOT EXISTS meal (id TEXT PRIMARY KEY, date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, input_text TEXT NOT NULL, source TEXT NOT NULL, plan_version INTEGER NOT NULL, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS food_item (id TEXT PRIMARY KEY, meal_id TEXT NOT NULL REFERENCES meal(id) ON DELETE CASCADE, position INTEGER NOT NULL, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meal_revision (id TEXT PRIMARY KEY, meal_id TEXT NOT NULL REFERENCES meal(id) ON DELETE CASCADE, changed_at TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversation_message (id TEXT PRIMARY KEY, date TEXT NOT NULL, created_at TEXT NOT NULL, role TEXT NOT NULL, related_meal_id TEXT, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turn_request (request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, completed_at TEXT NOT NULL, result_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clarification (id INTEGER PRIMARY KEY CHECK(id=1), original_text TEXT NOT NULL, date TEXT NOT NULL, image_json TEXT, asked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_call (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER);
      CREATE TABLE IF NOT EXISTS user_memory (id TEXT PRIMARY KEY, text TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE VIEW IF NOT EXISTS daily_nutrition_state AS SELECT date,COUNT(*) AS meal_count,
        SUM(json_extract(payload_json,'$.calories')) AS calories,
        SUM(json_extract(payload_json,'$.protein')) AS protein,
        SUM(json_extract(payload_json,'$.carbs')) AS carbs,
        SUM(json_extract(payload_json,'$.fat')) AS fat,
        SUM(json_extract(payload_json,'$.fiber')) AS fiber FROM meal GROUP BY date;
      CREATE INDEX IF NOT EXISTS meal_date_idx ON meal(date, created_at);
      CREATE INDEX IF NOT EXISTS message_date_idx ON conversation_message(date, created_at);
    `);
    const planColumns=this.db.prepare('PRAGMA table_info(nutrition_plan)').all().map(column=>column.name);
    if (!planColumns.includes('local_date')) this.db.exec('ALTER TABLE nutrition_plan ADD COLUMN local_date TEXT');
    for (const plan of this.db.prepare('SELECT version,effective_at FROM nutrition_plan WHERE local_date IS NULL').all()) {
      this.db.prepare('UPDATE nutrition_plan SET local_date=? WHERE version=?').run(localDate(this.timeZone(),new Date(plan.effective_at)),plan.version);
    }
    const schemaVersion=Number(this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value||0);
    if (schemaVersion>1) throw new Error('数据库版本高于当前程序，请升级应用。');
    if (schemaVersion<1) this.db.prepare("INSERT INTO meta(key,value) VALUES('schema_version','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  }

  close() { this.db.close(); }
  profile() {
    const row = this.db.prepare('SELECT input_json, timezone FROM user_profile WHERE id=1').get();
    const plan = this.db.prepare('SELECT version, profile_json, effective_at FROM nutrition_plan ORDER BY version DESC LIMIT 1').get();
    return row && plan ? {...parse(row.input_json), ...parse(plan.profile_json), planVersion:plan.version, planEffectiveAt:plan.effective_at, timezone:row.timezone} : null;
  }
  timeZone() { return this.db.prepare('SELECT timezone FROM user_profile WHERE id=1').get()?.timezone || 'Asia/Shanghai'; }
  today() { return localDate(this.timeZone()); }
  saveProfile(input, timeZone) {
    const error = nutrition.validate(input);
    if (error) { const e = new Error(error); e.status = 400; throw e; }
    const calculation = nutrition.calculate(input);
    const tz = safeTimeZone(timeZone);
    const profileInput = Object.fromEntries(['gender','age','height','weight','goal','frequency','training','activity'].map(key => [key, key==='age'||key==='height'||key==='weight' ? Number(input[key]) : input[key]]));
    const savedAt = now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const version = (this.db.prepare('SELECT MAX(version) AS version FROM nutrition_plan').get().version || 0) + 1;
      this.db.prepare('INSERT INTO user_profile(id,input_json,timezone,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET input_json=excluded.input_json,timezone=excluded.timezone,updated_at=excluded.updated_at').run(JSON.stringify(profileInput),tz,savedAt);
      this.db.prepare('INSERT INTO nutrition_plan(version,profile_json,effective_at,local_date) VALUES(?,?,?,?)').run(version,JSON.stringify(calculation),savedAt,localDate(tz,new Date(savedAt)));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.profile();
  }
  planFor(date) {
    const row = this.db.prepare('SELECT profile_json FROM nutrition_plan WHERE local_date<=? ORDER BY version DESC LIMIT 1').get(date)
      || this.db.prepare('SELECT profile_json FROM nutrition_plan ORDER BY version ASC LIMIT 1').get();
    return parse(row?.profile_json);
  }
  planVersionFor(date) {
    return this.db.prepare('SELECT version FROM nutrition_plan WHERE local_date<=? ORDER BY version DESC LIMIT 1').get(date)?.version
      || this.db.prepare('SELECT version FROM nutrition_plan ORDER BY version ASC LIMIT 1').get()?.version;
  }
  meals(date) {
    const rows = date ? this.db.prepare('SELECT payload_json FROM meal WHERE date=? ORDER BY created_at,id').all(date)
      : this.db.prepare('SELECT date,payload_json FROM meal ORDER BY created_at,id').all();
    return rows.map(row => date ? parse(row.payload_json) : {...parse(row.payload_json), date:row.date});
  }
  messages(date) {
    const rows = date ? this.db.prepare('SELECT payload_json FROM conversation_message WHERE date=? ORDER BY created_at,rowid').all(date)
      : this.db.prepare('SELECT date,payload_json FROM conversation_message ORDER BY created_at,rowid').all();
    return rows.map(row => date ? parse(row.payload_json) : {...parse(row.payload_json), date:row.date});
  }
  memories() {return this.db.prepare('SELECT id,text,created_at AS createdAt,updated_at AS updatedAt FROM user_memory ORDER BY updated_at DESC LIMIT 50').all();}
  saveMemory(text) {
    if (typeof text!=='string'||text.trim().length<2||text.trim().length>200) {const e=new Error('习惯内容请填写 2–200 字。');e.status=400;throw e;}
    const clean=text.trim(), timestamp=now();
    this.db.prepare('INSERT INTO user_memory(id,text,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(text) DO UPDATE SET updated_at=excluded.updated_at').run(uid(),clean,timestamp,timestamp);
    return this.db.prepare('SELECT id,text,created_at AS createdAt,updated_at AS updatedAt FROM user_memory WHERE text=?').get(clean);
  }
  updateMemory(id,text) {
    if (typeof text!=='string'||text.trim().length<2||text.trim().length>200) {const e=new Error('习惯内容请填写 2–200 字。');e.status=400;throw e;}
    const change=this.db.prepare('UPDATE user_memory SET text=?,updated_at=? WHERE id=?').run(text.trim(),now(),id);
    return change.changes>0;
  }
  deleteMemory(id) {return this.db.prepare('DELETE FROM user_memory WHERE id=?').run(id).changes>0;}
  lastSevenSummary(today=this.today()) {
    const days=[];
    for (let offset=6;offset>=0;offset--) {
      const date=new Date(Date.parse(`${today}T12:00:00Z`)-offset*86400000).toISOString().slice(0,10);
      const meals=this.meals(date);
      days.push({date,mealCount:meals.length,...totals(meals)});
    }
    return {days,averageProtein:Math.round(days.reduce((sum,day)=>sum+day.protein,0)/7),highestCalories:days.reduce((best,day)=>day.calories>best.calories?{date:day.date,calories:day.calories}:best,{date:null,calories:0})};
  }
  state() {
    const date = this.today();
    const allMeals = this.meals();
    const allMessages = this.messages();
    const dates = new Set([...allMeals, ...allMessages].map(row => row.date).filter(day => day !== date));
    const archives = {};
    for (const day of dates) {
      const meals = allMeals.filter(row => row.date === day).map(({date:unused, ...rest}) => rest);
      const messages = allMessages.filter(row => row.date === day).map(({date:unused, ...rest}) => rest);
      const sum = totals(meals), plan = this.planFor(day);
      archives[day] = {date:day, meals, messages, ...sum, status:dailyStatus(meals,plan), summary:dailyAdvice(meals,plan)};
    }
    const meals = allMeals.filter(row => row.date === date).map(({date:unused,...rest}) => rest);
    const messages = allMessages.filter(row => row.date === date).map(({date:unused,...rest}) => rest);
    return {profile:this.profile(), activeDate:date, meals, messages, archives, memories:this.memories(), today:{...totals(meals),status:dailyStatus(meals,this.planFor(date)),advice:dailyAdvice(meals,this.planFor(date))}};
  }
  clarification() { return this.db.prepare('SELECT original_text,date,image_json FROM clarification WHERE id=1').get() || null; }
  logModelCall({requestId,model,purpose,status,inputTokens,outputTokens}) {
    this.db.prepare('INSERT INTO model_call(id,request_id,model,purpose,status,created_at,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?)').run(uid(),requestId,model,purpose,status,now(),inputTokens??null,outputTokens??null);
  }
  savePhoto(dataUrl) {
    const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl||'');
    if (!match) throw new Error('照片格式无效。');
    const bytes=Buffer.from(match[2],'base64');
    if (!bytes.length||bytes.length>1_200_000) throw new Error('照片过大或无效。');
    const id=uid(), ext=match[1]==='jpeg'?'jpg':match[1];
    const filename=`${id}.${ext}`;
    fs.writeFileSync(path.join(this.mediaDir,filename),bytes,{mode:0o600,flag:'wx'});
    try {this.db.prepare('INSERT INTO media(id,mime,filename,created_at) VALUES(?,?,?,?)').run(id,`image/${match[1]}`,filename,now());}
    catch(error) {fs.rmSync(path.join(this.mediaDir,filename),{force:true});throw error;}
    return {url:`/api/media/${id}`,filename};
  }
  readMedia(id) {
    const row=this.db.prepare('SELECT mime,filename FROM media WHERE id=?').get(id);
    return row?{mime:row.mime,bytes:fs.readFileSync(path.join(this.mediaDir,row.filename))}:null;
  }
  deleteMedia(id) {
    const row=this.db.prepare('SELECT filename FROM media WHERE id=?').get(id);
    if (!row) return false;
    const url=`/api/media/${id}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const message of this.db.prepare('SELECT id,payload_json FROM conversation_message WHERE payload_json LIKE ?').all(`%${url}%`)) {
        const payload=parse(message.payload_json);
        if (payload.photoUrl===url) {payload.photoUrl=null;this.db.prepare('UPDATE conversation_message SET payload_json=? WHERE id=?').run(JSON.stringify(payload),message.id);}
      }
      this.db.prepare('DELETE FROM media WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    fs.rmSync(path.join(this.mediaDir,row.filename),{force:true});
    return true;
  }
  priorTurn(requestId) { const row=this.db.prepare('SELECT request_hash,result_json FROM turn_request WHERE request_id=?').get(requestId); return row ? {hash:row.request_hash,result:parse(row.result_json)} : null; }
  static hashRequest(input) { return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
  commitTurn({requestId, requestHash, conversationDate, mealDate, text, image, imageDescription, source, result, reasoning, elapsedSeconds}) {
    conversationDate ||= this.today();mealDate ||= conversationDate;
    let savedPhoto=null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.priorTurn(requestId);
      if (prior) {
        if (prior.hash !== requestHash) { const e=new Error('请求 ID 已用于另一条消息');e.status=409;throw e; }
        this.db.exec('COMMIT'); return prior.result;
      }
      const timestamp=now(), displayTime=new Date(timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:this.timeZone()});
      let receipt=null, revised=false, relatedMealId=null;
      if (result.action === 'consumed' || result.action === 'correction') {
        const data=result.meal;
        let id=uid(), priorMeal=null;
        if (result.action === 'correction') {
          priorMeal=this.db.prepare('SELECT id,date,payload_json FROM meal WHERE id=?').get(result.target_meal_id);
          if (!priorMeal) { const e=new Error('找不到要修正的餐食，请指明是哪一顿。');e.status=422;throw e; }
          id=priorMeal.id;mealDate=priorMeal.date;revised=true;
        }
        const meal={id,type:data.type,name:data.name,calories:data.calories,protein:data.protein,carbs:data.carbs,fat:data.fat,fiber:data.fiber,
          ...(data.calorie_min!==null&&data.calorie_max!==null?{min:data.calorie_min,max:data.calorie_max}:{}),
          time:priorMeal ? parse(priorMeal.payload_json).time : displayTime,input:priorMeal ? parse(priorMeal.payload_json).input : text,
          foodItems:data.food_items,source:priorMeal ? parse(priorMeal.payload_json).source : source};
        const version=this.planVersionFor(mealDate);
        if (priorMeal) {
          this.db.prepare('INSERT INTO meal_revision(id,meal_id,changed_at,before_json,after_json,reason) VALUES(?,?,?,?,?,?)').run(uid(),id,timestamp,priorMeal.payload_json,JSON.stringify(meal),text);
          this.db.prepare('UPDATE meal SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(meal),timestamp,id);
          this.db.prepare('DELETE FROM food_item WHERE meal_id=?').run(id);
        } else this.db.prepare('INSERT INTO meal(id,date,created_at,updated_at,input_text,source,plan_version,payload_json) VALUES(?,?,?,?,?,?,?,?)').run(id,mealDate,timestamp,timestamp,text,source,version,JSON.stringify(meal));
        for (let index=0;index<data.food_items.length;index++) this.db.prepare('INSERT INTO food_item(id,meal_id,position,payload_json) VALUES(?,?,?,?)').run(uid(),id,index,JSON.stringify(data.food_items[index]));
        receipt=meal; relatedMealId=id;
      }
      if (result.action === 'clarify') this.db.prepare('INSERT INTO clarification(id,original_text,date,image_json,asked_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET original_text=excluded.original_text,date=excluded.date,image_json=excluded.image_json,asked_at=excluded.asked_at').run(text,conversationDate,imageDescription?JSON.stringify({description:imageDescription}):null,timestamp);
      else this.db.prepare('DELETE FROM clarification WHERE id=1').run();
      const explicitMemory=/^(?:请)?记住[：:，, ]*(.+?)[。.!！]?$/u.exec(text)?.[1];
      if (explicitMemory&&!/[?？]|今天|这顿|刚才|本次/.test(explicitMemory)&&explicitMemory.length>=2&&explicitMemory.length<=200) this.saveMemory(explicitMemory);
      if (image) savedPhoto=this.savePhoto(image);
      const userMessage={id:uid(),role:'user',text:text||'上传了一张食物照片',photoUrl:savedPhoto?.url||null,time:displayTime};
      const assistantMessage={id:uid(),role:'assistant',text:result.reply,receipt,revised,time:displayTime,live:true,reasoningText:reasoning||'',elapsedSeconds};
      if (receipt) {
        const dayMeals=this.meals(mealDate), sum=totals(dayMeals);
        assistantMessage.after=`${mealDate===conversationDate?'今天':'所补日期'}累计约 ${sum.calories} kcal、蛋白质 ${sum.protein}g。${dailyAdvice(dayMeals,this.planFor(mealDate))}`;
      }
      this.db.prepare('INSERT INTO conversation_message(id,date,created_at,role,related_meal_id,payload_json) VALUES(?,?,?,?,?,?)').run(userMessage.id,conversationDate,timestamp,'user',relatedMealId,JSON.stringify(userMessage));
      this.db.prepare('INSERT INTO conversation_message(id,date,created_at,role,related_meal_id,payload_json) VALUES(?,?,?,?,?,?)').run(assistantMessage.id,conversationDate,timestamp,'assistant',relatedMealId,JSON.stringify(assistantMessage));
      const response={result,reasoning,assistantMessage,receipt,revised};
      this.db.prepare('INSERT INTO turn_request(request_id,request_hash,completed_at,result_json) VALUES(?,?,?,?)').run(requestId,requestHash,timestamp,JSON.stringify(response));
      this.db.exec('COMMIT');
      return response;
    } catch (error) { this.db.exec('ROLLBACK');if (savedPhoto) fs.rmSync(path.join(this.mediaDir,savedPhoto.filename),{force:true});throw error; }
  }
  exportData() {
    const messages=this.messages().map(message=>{
      const id=/^\/api\/media\/([a-f0-9-]+)$/.exec(message.photoUrl||'')?.[1];
      if (!id) return message;
      const photo=this.readMedia(id);
      return photo?{...message,photoUrl:`data:${photo.mime};base64,${photo.bytes.toString('base64')}`}:message;
    });
    return {format:'boji-backup-v1',exportedAt:now(),profile:this.profile(),meals:this.meals(),messages,memories:this.memories(),revisions:this.db.prepare('SELECT meal_id,changed_at,before_json,after_json,reason FROM meal_revision ORDER BY changed_at').all()};
  }
  importData(backup, mode='all') {
    if (!backup || !['boji-browser-v1','boji-backup-v1'].includes(backup.format) || !['all','profile','records'].includes(mode)) { const e=new Error('备份格式或导入范围无效。');e.status=400;throw e; }
    const rawMeals=Array.isArray(backup.meals)?backup.meals:[];
    const rawMessages=Array.isArray(backup.messages)?backup.messages:[];
    const rawMemories=Array.isArray(backup.memories)?backup.memories:[];
    if (rawMeals.length>5000 || rawMessages.length>10000 || rawMemories.length>50) {const e=new Error('备份记录过多，请分批导入。');e.status=413;throw e;}
    const safeDate=value=>{
      if (typeof value!=='string'||!datePattern.test(value)) return null;
      const parsed=new Date(`${value}T12:00:00Z`);
      return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:null;
    };
    const backupDate=safeDate(backup.activeDate)||this.today();
    const legacy=backup.format==='boji-browser-v1';
    const normalizeMeal=source=>{
      if (!source || typeof source!=='object') throw new Error('备份中的餐食格式无效。');
      const date=safeDate(source.date)||backupDate;
      const meal={...source};
      if (!['早餐','午餐','晚餐','加餐'].includes(meal.type)||typeof meal.name!=='string'||!meal.name.trim()||meal.name.length>200) throw new Error('备份中的餐食名称或餐次无效。');
      for (const field of fields) if (!Number.isInteger(meal[field])||meal[field]<0||meal[field]>10000) throw new Error('备份中的营养数据无效。');
      meal.id=typeof meal.id==='string'&&/^[\w-]{1,80}$/.test(meal.id)?meal.id:uid();
      meal.input=typeof meal.input==='string'?meal.input.slice(0,4000):'';
      meal.time=typeof meal.time==='string'?meal.time.slice(0,30):'';
      meal.source=legacy?'legacy-demo':(meal.source||'restored');meal.importedDemo=legacy||Boolean(meal.importedDemo);
      meal.foodItems=Array.isArray(meal.foodItems)&&meal.foodItems.length?meal.foodItems:[{food_name:meal.name,estimated_amount:'旧版演示估算，未拆分',...Object.fromEntries(fields.map(field=>[field,meal[field]])),confidence:'low'}];
      return {date,meal};
    };
    const normalizeMessage=source=>{
      const date=safeDate(source.date)||backupDate;
      if (!source||typeof source!=='object'||!['user','assistant'].includes(source.role)||typeof source.text!=='string'||source.text.length>8000) throw new Error('备份中的交流记录无效。');
      const message={id:typeof source.id==='string'&&/^[\w-]{1,80}$/.test(source.id)?source.id:uid(),role:source.role,text:source.text,time:typeof source.time==='string'?source.time.slice(0,30):''};
      if (typeof source.reasoningText==='string') message.reasoningText=source.reasoningText.slice(0,30000);
      if (typeof source.photoUrl==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(source.photoUrl)&&source.photoUrl.length<1_600_000) message.photoUrl=source.photoUrl;
      if (source.receipt && typeof source.receipt==='object') message.receipt=source.receipt;
      if (source.revised===true) message.revised=true;
      message.importedDemo=legacy||Boolean(source.importedDemo);
      return {date,message};
    };
    const sampleIds=new Set(['meal-breakfast','meal-lunch','meal-snack']);
    const sampleTexts=new Set(['中午吃了一份鸡腿饭，加一个蛋，米饭剩了一点。','晚上可以吃火锅吗？','可以。按今天的进度，火锅优先选牛肉、虾、鱼和蔬菜；蘸料清淡一点，主食按食欲吃就好。']);
    const meals=mode==='profile'?[]:rawMeals.filter(row=>row&&!sampleIds.has(row.id)).map(normalizeMeal);
    const messages=mode==='profile'?[]:rawMessages.filter(row=>row&&!sampleTexts.has(row.text)).map(normalizeMessage);
    const memories=mode==='records'?[]:rawMemories.map(row=>row?.text).filter(text=>typeof text==='string'&&text.trim().length>=2&&text.trim().length<=200);
    if (mode!=='records'&&backup.profile) this.saveProfile(backup.profile,backup.profile.timezone||backup.timezone);
    if (mode!=='profile'&&!this.profile()) {const e=new Error('请先建档，或选择同时导入档案。');e.status=409;throw e;}
    let mealCount=0,messageCount=0;
    const importedMedia=[];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const memory of memories) this.saveMemory(memory);
      for (const {date,meal} of meals) {
        const timestamp=new Date(`${date}T12:00:00.000Z`).toISOString();
        const change=this.db.prepare('INSERT OR IGNORE INTO meal(id,date,created_at,updated_at,input_text,source,plan_version,payload_json) VALUES(?,?,?,?,?,?,?,?)').run(meal.id,date,timestamp,timestamp,meal.input,meal.source,this.profile().planVersion,JSON.stringify(meal));
        if (change.changes) {
          mealCount++;
          for (let index=0;index<meal.foodItems.length;index++) this.db.prepare('INSERT INTO food_item(id,meal_id,position,payload_json) VALUES(?,?,?,?)').run(uid(),meal.id,index,JSON.stringify(meal.foodItems[index]));
        }
      }
      for (let index=0;index<messages.length;index++) {
        const {date,message}=messages[index];
        if (this.db.prepare('SELECT 1 FROM conversation_message WHERE id=?').get(message.id)) continue;
        if (message.photoUrl?.startsWith('data:image/')) {
          const photo=this.savePhoto(message.photoUrl);
          importedMedia.push(photo.filename);
          message.photoUrl=photo.url;
        }
        const timestamp=new Date(Date.parse(`${date}T12:00:00.000Z`)+index*1000).toISOString();
        const change=this.db.prepare('INSERT OR IGNORE INTO conversation_message(id,date,created_at,role,related_meal_id,payload_json) VALUES(?,?,?,?,?,?)').run(message.id,date,timestamp,message.role,message.receipt?.id||null,JSON.stringify(message));
        messageCount+=change.changes;
      }
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');for (const filename of importedMedia) fs.rmSync(path.join(this.mediaDir,filename),{force:true});throw error;}
    return {importedMeals:mealCount,importedMessages:messageCount,profileUpdated:mode!=='records'&&Boolean(backup.profile),state:this.state()};
  }
}

module.exports={Store,localDate,totals,dailyStatus,dailyAdvice,safeTimeZone};
