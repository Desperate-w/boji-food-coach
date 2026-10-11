const photos=require('./photos.js');
const crypto=require('node:crypto');
const nutrition=require('./nutrition.js');
const {localDate,totals,dailyStatus,dailyAdvice,safeTimeZone}=require('./store.js');
const {decodePhoto}=require('./blob-media.js');
const {normalizeBackup}=require('./backup.js');
const uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const encoded=value=>JSON.stringify(value);
const failure=(message,status=409)=>Object.assign(new Error(message),{status});

class CloudStore {
  constructor(database,accountId,media,{client,lease}={}) {
    this.database=database;this.accountId=accountId;this.media=media;this.client=client;this.lease=lease;
  }
  close() {}
  async readSnapshot(work) {
    if (this.client) return work(this);
    return this.database.transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return work(new CloudStore(this.database,this.accountId,this.media,{client,lease:this.lease}));
    });
  }
  async query(sql,values=[]) {await this.database.ready();return (this.client||this.database.pool).query(sql,values);}
  async transaction(work) {
    if (this.client) return work(this);
    return this.database.transaction(async client=>{
      const lease=this.lease;
      if (!lease) throw failure('此写入没有有效租约，请重试。');
      const held=await client.query('SELECT token FROM boji_lease WHERE key=$1 AND token=$2 AND expires_at>clock_timestamp() FOR UPDATE',[lease.key,lease.token]);
      if (!held.rowCount || lease.key!=='write:'+this.accountId) throw failure('操作已过期，请重试。');
      return work(new CloudStore(this.database,this.accountId,this.media,{client,lease}));
    });
  }
  async profile() {
    const result=await this.query('SELECT p.input,p.timezone,n.version,n.calculation,n.effective_at FROM boji_profile p JOIN LATERAL (SELECT * FROM boji_plan WHERE account_id=p.account_id ORDER BY version DESC LIMIT 1) n ON true WHERE p.account_id=$1',[this.accountId]);
    const row=result.rows[0];
    return row?{...row.input,...row.calculation,timezone:row.timezone,planVersion:row.version,planEffectiveAt:row.effective_at}:null;
  }
  async timeZone() {return (await this.query('SELECT timezone FROM boji_profile WHERE account_id=$1',[this.accountId])).rows[0]?.timezone||'Asia/Shanghai';}
  async today() {return localDate(await this.timeZone());}
  async saveProfile(input,timeZone) {
    const error=nutrition.validate(input);if (error) throw failure(error,400);
    const calculation=nutrition.calculate(input),tz=safeTimeZone(timeZone),savedAt=now();
    const profileInput=Object.fromEntries(['gender','age','height','weight','goal','frequency','training','activity'].map(key=>[key,['age','height','weight'].includes(key)?Number(input[key]):input[key]]));
    return this.transaction(async store=>{
      const version=(await store.query('SELECT coalesce(max(version),0)+1 AS version FROM boji_plan WHERE account_id=$1',[this.accountId])).rows[0].version;
      await store.query('INSERT INTO boji_profile(account_id,input,timezone,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET input=EXCLUDED.input,timezone=EXCLUDED.timezone,updated_at=EXCLUDED.updated_at',[this.accountId,encoded(profileInput),tz,savedAt]);
      await store.query('INSERT INTO boji_plan(account_id,version,calculation,effective_at,local_date) VALUES($1,$2,$3,$4,$5)',[this.accountId,version,encoded(calculation),savedAt,localDate(tz,new Date(savedAt))]);
      return store.profile();
    });
  }
  async planRow(date) {
    return (await this.query('SELECT version,calculation FROM boji_plan WHERE account_id=$1 ORDER BY CASE WHEN local_date<=$2 THEN 0 ELSE 1 END, CASE WHEN local_date<=$2 THEN version END DESC,version ASC LIMIT 1',[this.accountId,date])).rows[0]||null;
  }
  async planFor(date) {return (await this.planRow(date))?.calculation||null;}
  async planVersionFor(date) {return (await this.planRow(date))?.version;}
  async meals(date) {
    const result=date?await this.query('SELECT payload FROM boji_meal WHERE account_id=$1 AND date=$2 ORDER BY created_at,id',[this.accountId,date])
      :await this.query('SELECT date,payload FROM boji_meal WHERE account_id=$1 ORDER BY created_at,id',[this.accountId]);
    return result.rows.map(row=>date?row.payload:{...row.payload,date:row.date});
  }
  async manualTarget(id) {
    const row=(await this.query('SELECT date,payload FROM boji_meal WHERE account_id=$1 AND id=$2',[this.accountId,id])).rows[0];
    return row?{date:row.date,meal:row.payload}:null;
  }
  async writeMeal(meal,date,timestamp,prior,reason) {
    if (prior) {
      await this.query('INSERT INTO boji_revision(account_id,id,meal_id,changed_at,before_json,after_json,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.accountId,uid(),meal.id,timestamp,encoded(prior.meal),encoded(meal),reason]);
      await this.query('UPDATE boji_meal SET payload=$3,updated_at=$4 WHERE account_id=$1 AND id=$2',[this.accountId,meal.id,encoded(meal),timestamp]);
    } else {
      const version=await this.planVersionFor(date);
      await this.query('INSERT INTO boji_meal(account_id,id,date,created_at,updated_at,plan_version,payload) VALUES($1,$2,$3,$4,$4,$5,$6)',[this.accountId,meal.id,date,timestamp,version,encoded(meal)]);
    }
  }
  async saveManualMeal({id,date,type,description,data}) {
    return this.transaction(async store=>{
      const prior=id?await store.manualTarget(id):null;
      if (id&&!prior) throw failure('找不到要修改的餐食。',404);
      const timestamp=now(),displayTime=new Date(timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:await store.timeZone()});
      const meal={id:id||uid(),type,name:data.name,calories:data.calories,protein:data.protein,carbs:data.carbs,fat:data.fat,fiber:data.fiber,
        ...(data.calorie_min!==null&&data.calorie_max!==null?{min:data.calorie_min,max:data.calorie_max}:{}),
        time:prior?.meal.time||displayTime,input:description,foodItems:data.food_items,source:'manual'};
      await store.writeMeal(meal,prior?.date||date,timestamp,prior,'用户在饮食历史中手动修改');
      return meal;
    });
  }
  async markMealDeleted(id) {
    const messages=(await this.query('SELECT id,payload FROM boji_message WHERE account_id=$1 AND related_meal_id=$2',[this.accountId,id])).rows;
    for (const row of messages) {
      const message=row.payload;message.recordDeleted=true;
      if (message.receipt?.id===id) {message.receipt=null;message.revised=false;message.after='这顿餐食记录已删除，不再计入营养汇总。';}
      await this.query('UPDATE boji_message SET related_meal_id=NULL,payload=$3 WHERE account_id=$1 AND id=$2',[this.accountId,row.id,encoded(message)]);
    }
  }
  async scrubDeletedTurns(mealIds,messageIds=[]) {
    const rows=(await this.query("SELECT request_id,result FROM boji_turn WHERE account_id=$1 AND (result->'receipt'->>'id'=ANY($2::text[]) OR result->'assistantMessage'->'receipt'->>'id'=ANY($2::text[]) OR result->'assistantMessage'->>'id'=ANY($3::text[]))",[this.accountId,mealIds,messageIds])).rows;
    for (const row of rows) {
      let result=row.result;
      if (messageIds.includes(result?.assistantMessage?.id)) result={deleted:true,assistantMessage:null,receipt:null};
      else {
        result.receipt=null;if (result.result) result.result.meal=null;
        if (result.assistantMessage) Object.assign(result.assistantMessage,{receipt:null,revised:false,recordDeleted:true,after:'这顿餐食记录已删除，不再计入营养汇总。'});
      }
      await this.query('UPDATE boji_turn SET result=$3 WHERE account_id=$1 AND request_id=$2',[this.accountId,row.request_id,encoded(result)]);
    }
  }
  async deleteMeal(id) {
    return this.transaction(async store=>{
      const target=await store.manualTarget(id);if (!target) return null;
      await store.markMealDeleted(id);await store.scrubDeletedTurns([id]);
      await store.query('DELETE FROM boji_meal WHERE account_id=$1 AND id=$2',[this.accountId,id]);
      return {id,date:target.date};
    });
  }
  async deleteDay(date) {
    return this.transaction(async store=>{
      const meals=await store.meals(date),messages=await store.messages(date);
      if (!meals.length&&!messages.length) return null;
      for (const meal of meals) await store.markMealDeleted(meal.id);
      await store.scrubDeletedTurns(meals.map(row=>row.id),messages.map(row=>row.id));
      await store.query('DELETE FROM boji_meal WHERE account_id=$1 AND date=$2',[this.accountId,date]);
      await store.query('DELETE FROM boji_message WHERE account_id=$1 AND date=$2',[this.accountId,date]);
      await store.query('DELETE FROM boji_clarification WHERE account_id=$1 AND date=$2',[this.accountId,date]);
      for (const id of new Set(messages.flatMap(row=>photos.photoUrls(row)).map(url=>/^\/api\/media\/([a-f0-9-]{36})$/.exec(url)?.[1]).filter(Boolean))) {
        const references=await store.query("SELECT 1 FROM boji_message WHERE account_id=$1 AND (payload->>'photoUrl'=$2 OR payload->'photoUrls' ? $2) LIMIT 1",[this.accountId,'/api/media/'+id]);
        if (!references.rowCount) await store.query("UPDATE boji_media SET status='deleting' WHERE account_id=$1 AND id=$2",[this.accountId,id]);
      }
      return {date,deletedMeals:meals.length,deletedMessages:messages.length};
    });
  }
  async messages(date) {
    const result=date?await this.query('SELECT payload FROM boji_message WHERE account_id=$1 AND date=$2 ORDER BY created_at,sequence',[this.accountId,date])
      :await this.query('SELECT date,payload FROM boji_message WHERE account_id=$1 ORDER BY created_at,sequence',[this.accountId]);
    return result.rows.map(row=>date?row.payload:{...row.payload,date:row.date});
  }
  async memories() {return (await this.query('SELECT id,text,created_at AS "createdAt",updated_at AS "updatedAt" FROM boji_memory WHERE account_id=$1 ORDER BY updated_at DESC LIMIT 50',[this.accountId])).rows;}
  async saveMemory(text) {
    if (typeof text!=='string'||text.trim().length<2||text.trim().length>200) throw failure('习惯内容请填写 2–200 字。',400);
    return this.transaction(async store=>{
      const clean=text.trim(),timestamp=now();
      const existing=await store.query('SELECT 1 FROM boji_memory WHERE account_id=$1 AND text=$2',[this.accountId,clean]);
      if (!existing.rowCount && (await store.memories()).length>=50) throw failure('最多保存 50 条长期习惯，请先删除不再需要的内容。');
      return (await store.query('INSERT INTO boji_memory(account_id,id,text,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT(account_id,text) DO UPDATE SET updated_at=EXCLUDED.updated_at RETURNING id,text,created_at AS "createdAt",updated_at AS "updatedAt"',[this.accountId,uid(),clean,timestamp])).rows[0];
    });
  }
  async updateMemory(id,text) {
    if (typeof text!=='string'||text.trim().length<2||text.trim().length>200) throw failure('习惯内容请填写 2–200 字。',400);
    return this.transaction(async store=>{
      try {return (await store.query('UPDATE boji_memory SET text=$3,updated_at=$4 WHERE account_id=$1 AND id=$2',[this.accountId,id,text.trim(),now()])).rowCount>0;}
      catch(error) {if (error.code==='23505') throw failure('这条习惯已经保存。');throw error;}
    });
  }
  async deleteMemory(id) {return this.transaction(async store=>(await store.query('DELETE FROM boji_memory WHERE account_id=$1 AND id=$2',[this.accountId,id])).rowCount>0);}
  async lastSevenSummary(today) {
    today ||= await this.today();
    const dates=Array.from({length:7},(_,index)=>new Date(Date.parse(today+'T12:00:00Z')-(6-index)*86400000).toISOString().slice(0,10));
    const meals=(await this.query('SELECT date,payload FROM boji_meal WHERE account_id=$1 AND date=ANY($2::text[])',[this.accountId,dates])).rows;
    const days=dates.map(date=>{const rows=meals.filter(row=>row.date===date);return {date,mealCount:rows.length,...totals(rows.map(row=>row.payload))};});
    return {days,averageProtein:Math.round(days.reduce((sum,day)=>sum+day.protein,0)/7),highestCalories:days.reduce((best,day)=>day.calories>best.calories?{date:day.date,calories:day.calories}:best,{date:null,calories:0})};
  }
  async day(date,{includeMessages=true}={}) {
    if (!this.client) return this.readSnapshot(store=>store.day(date,{includeMessages}));
    const [meals,plan,messageRows]=await Promise.all([this.meals(date),this.planFor(date),
      includeMessages?this.query("SELECT msg.payload,meal.payload AS latest_receipt FROM boji_message msg LEFT JOIN boji_meal meal ON meal.account_id=msg.account_id AND meal.id=msg.payload->'receipt'->>'id' WHERE msg.account_id=$1 AND msg.date=$2 ORDER BY msg.created_at,msg.sequence",[this.accountId,date])
      :this.query('SELECT count(*)::int AS count FROM boji_message WHERE account_id=$1 AND date=$2',[this.accountId,date])]);
    const messages=includeMessages?messageRows.rows.map(row=>row.payload.receipt?{...row.payload,latestReceipt:row.latest_receipt||null}:row.payload):[];
    return {date,meals,messages,messageCount:includeMessages?messages.length:messageRows.rows[0].count,...totals(meals),plan,status:dailyStatus(meals,plan),summary:dailyAdvice(meals,plan)};
  }
  async historyPage(before) {
    if (!this.client) return this.readSnapshot(store=>store.historyPage(before));
    before ||= await this.today();
    const dates=(await this.query('SELECT date FROM (SELECT date FROM boji_meal WHERE account_id=$1 AND date<$2 UNION SELECT date FROM boji_message WHERE account_id=$1 AND date<$2) dates ORDER BY date DESC LIMIT 31',[this.accountId,before])).rows.map(row=>row.date);
    const page=dates.slice(0,30),archives={};
    if (page.length) {
      const [meals,counts,plans]=await Promise.all([
        this.query('SELECT date,payload FROM boji_meal WHERE account_id=$1 AND date=ANY($2::text[]) ORDER BY created_at,id',[this.accountId,page]),
        this.query('SELECT date,count(*)::int AS count FROM boji_message WHERE account_id=$1 AND date=ANY($2::text[]) GROUP BY date',[this.accountId,page]),
        this.query('SELECT local_date,calculation FROM boji_plan WHERE account_id=$1 ORDER BY version DESC',[this.accountId])]);
      for (const date of page) {
        const rows=meals.rows.filter(row=>row.date===date).map(row=>row.payload);
        const plan=(plans.rows.find(row=>row.local_date<=date)||plans.rows.at(-1))?.calculation||null;
        archives[date]={date,meals:rows,messages:[],messageCount:counts.rows.find(row=>row.date===date)?.count||0,...totals(rows),plan,status:dailyStatus(rows,plan),summary:dailyAdvice(rows,plan)};
      }
    }
    return {archives,historyPage:{hasMore:dates.length>30,nextBefore:page.at(-1)||null}};
  }
  async state({focusDate}={}) {
    if (!this.client) return this.readSnapshot(store=>store.state({focusDate}));
    const date=await this.today();
    const [profile,current,history,memories]=await Promise.all([this.profile(),this.day(date),this.historyPage(date),this.memories()]);
    const {archives,historyPage}=history;
    if (typeof focusDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(focusDate)&&focusDate<date) {
      const day=await this.day(focusDate);if (day.meals.length||day.messages.length) archives[focusDate]=day;
    }
    return {profile,activeDate:date,meals:current.meals,messages:current.messages,archives,historyPage,memories,today:{...totals(current.meals),status:current.status,advice:current.summary}};
  }
  async clarification() {return (await this.query('SELECT original_text,date,image_json FROM boji_clarification WHERE account_id=$1',[this.accountId])).rows[0]||null;}
  async logModelCall({requestId,model,purpose,status,inputTokens,outputTokens}) {
    await this.query('INSERT INTO boji_model_call(account_id,id,request_id,model,purpose,status,created_at,input_tokens,output_tokens) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[this.accountId,uid(),requestId,model,purpose,status,now(),inputTokens??null,outputTokens??null]);
  }
  async preparePhoto(dataUrl) {
    const photo=decodePhoto(dataUrl);
    photo.pathname='boji/'+this.accountId+'/'+photo.id+'.'+photo.extension;
    photo.url='/api/media/'+photo.id;
    await this.transaction(store=>store.query("INSERT INTO boji_media(account_id,id,mime,pathname,status) VALUES($1,$2,$3,$4,'pending')",[this.accountId,photo.id,photo.mime,photo.pathname]));
    try {await this.media.put(photo.pathname,photo.bytes,photo.mime);return photo;}
    catch(error) {await this.discardPhoto(photo.id).catch(()=>{});throw error;}
  }
  async discardPhoto(id) {
    // Never remove a committed photo after an ambiguous COMMIT/network failure.
    await this.query("UPDATE boji_media SET status='deleting' WHERE account_id=$1 AND id=$2 AND status='pending'",[this.accountId,id]);
  }
  async attachPhoto(photo) {
    const changed=await this.query("UPDATE boji_media SET status='ready' WHERE account_id=$1 AND id=$2 AND status='pending' RETURNING id",[this.accountId,photo.id]);
    if (!changed.rowCount) throw failure('照片上传已过期，请重试。');
  }
  async readMedia(id) {
    const row=(await this.query("SELECT mime,pathname FROM boji_media WHERE account_id=$1 AND id=$2 AND status='ready'",[this.accountId,id])).rows[0];
    if (!row) return null;
    const bytes=await this.media.get(row.pathname);
    return bytes?{mime:row.mime,bytes}:null;
  }
  async deleteMedia(id) {
    return this.transaction(async store=>{
      const row=(await store.query("SELECT id FROM boji_media WHERE account_id=$1 AND id=$2 AND status='ready'",[this.accountId,id])).rows[0];
      if (!row) return false;
      const url='/api/media/'+id;
      const messages=(await store.query("SELECT id,payload FROM boji_message WHERE account_id=$1 AND (payload->>'photoUrl'=$2 OR payload->'photoUrls' ? $2)",[this.accountId,url])).rows;
      for (const message of messages) await store.query('UPDATE boji_message SET payload=$3 WHERE account_id=$1 AND id=$2',[this.accountId,message.id,encoded(photos.withPhotoUrls(message.payload,photos.photoUrls(message.payload).filter(item=>item!==url)))]);
      await store.query("UPDATE boji_media SET status='deleting' WHERE account_id=$1 AND id=$2",[this.accountId,id]);
      return true;
    });
  }
  async flushMediaGarbage(limit=6) {
    const rows=(await this.query("UPDATE boji_media SET status='deleting' WHERE (account_id,id) IN (SELECT account_id,id FROM boji_media WHERE account_id=$1 AND (status='deleting' OR (status='pending' AND created_at<clock_timestamp()-interval '15 minutes')) ORDER BY created_at LIMIT $2) RETURNING id,pathname",[this.accountId,limit])).rows;
    await Promise.all(rows.map(async row=>{
      try {
        await this.media.del(row.pathname);
        await this.query("DELETE FROM boji_media WHERE account_id=$1 AND id=$2 AND status='deleting'",[this.accountId,row.id]);
      } catch(error) {console.error('照片待重试清理：'+(error.code||'STORAGE_ERROR'));}
    }));
  }
  async priorTurn(requestId) {
    const row=(await this.query('SELECT request_hash,result FROM boji_turn WHERE account_id=$1 AND request_id=$2',[this.accountId,requestId])).rows[0];
    return row?{hash:row.request_hash,result:row.result}:null;
  }
  async commitTurn({requestId,requestHash,conversationDate,mealDate,text,image,images,imageDescription,source,result,reasoning,elapsedSeconds}) {
    conversationDate ||= await this.today();mealDate ||= conversationDate;
    const existing=await this.priorTurn(requestId);
    if (existing) {
      if (existing.hash!==requestHash) throw failure('请求 ID 已用于另一条消息。');
      return existing.result;
    }
    const preparedPhotos=[],inputPhotos=photos.validateImages(photos.inputImages({image,images}));
    let attached=false;
    try {
      for (const url of inputPhotos) preparedPhotos.push(await this.preparePhoto(url));
      const response=await this.transaction(async store=>{
        const prior=await store.priorTurn(requestId);
        if (prior) {
          if (prior.hash!==requestHash) throw failure('请求 ID 已用于另一条消息。');
          return prior.result;
        }
        const timestamp=now(),displayTime=new Date(timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:await store.timeZone()});
        let receipt=null,revised=false,relatedMealId=null;
        if (['consumed','correction'].includes(result.action)) {
          const data=result.meal,priorMeal=result.action==='correction'?await store.manualTarget(result.target_meal_id):null;
          if (result.action==='correction'&&!priorMeal) throw failure('找不到要修正的餐食，请指明是哪一顿。',422);
          if (priorMeal) {mealDate=priorMeal.date;revised=true;}
          const meal={id:priorMeal?.meal.id||uid(),type:data.type,name:data.name,calories:data.calories,protein:data.protein,carbs:data.carbs,fat:data.fat,fiber:data.fiber,
            ...(data.calorie_min!==null&&data.calorie_max!==null?{min:data.calorie_min,max:data.calorie_max}:{}),
            time:priorMeal?.meal.time||displayTime,input:priorMeal?.meal.input||text,foodItems:data.food_items,source:priorMeal?.meal.source||source};
          await store.writeMeal(meal,mealDate,timestamp,priorMeal,text);
          receipt=meal;relatedMealId=meal.id;
        }
        if (result.action==='clarify') {
          await store.query('INSERT INTO boji_clarification(account_id,original_text,date,image_json,asked_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO UPDATE SET original_text=EXCLUDED.original_text,date=EXCLUDED.date,image_json=EXCLUDED.image_json,asked_at=EXCLUDED.asked_at',
            [this.accountId,text,conversationDate,imageDescription||mealDate!==conversationDate?encoded({description:imageDescription||null,mealDate}):null,timestamp]);
        } else await store.query('DELETE FROM boji_clarification WHERE account_id=$1',[this.accountId]);
        const explicitMemory=/^(?:请)?记住[：:，, ]*(.+?)[。.!！]?$/u.exec(text)?.[1];
        if (explicitMemory&&!/[?？]|今天|这顿|刚才|本次/.test(explicitMemory)&&explicitMemory.length>=2&&explicitMemory.length<=200) await store.saveMemory(explicitMemory);
        for (const photo of preparedPhotos) await store.attachPhoto(photo);
        attached=true;
        const userMessage=photos.withPhotoUrls({id:uid(),role:'user',text:text||`上传了 ${inputPhotos.length} 张食物照片`,time:displayTime},preparedPhotos.map(photo=>photo.url));
        const assistantMessage={id:uid(),role:'assistant',text:result.reply,receipt,revised,time:displayTime,live:true,reasoningText:reasoning||'',elapsedSeconds};
        if (receipt) {
          const dayMeals=await store.meals(mealDate),sum=totals(dayMeals);
          assistantMessage.after=(mealDate===conversationDate?'今天':'所补日期')+'累计约 '+sum.calories+' kcal、蛋白质 '+sum.protein+'g。'+dailyAdvice(dayMeals,await store.planFor(mealDate));
        }
        for (const message of [userMessage,assistantMessage]) {
          await store.query('INSERT INTO boji_message(account_id,id,date,created_at,role,related_meal_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [this.accountId,message.id,conversationDate,timestamp,message.role,relatedMealId,encoded(message)]);
        }
        const committed={result,reasoning,assistantMessage,receipt,revised};
        await store.query('INSERT INTO boji_turn(account_id,request_id,request_hash,completed_at,result) VALUES($1,$2,$3,$4,$5)',[this.accountId,requestId,requestHash,timestamp,encoded(committed)]);
        return committed;
      });
      if (!attached) for (const photo of preparedPhotos) await this.discardPhoto(photo.id);
      return response;
    } catch(error) {for (const photo of preparedPhotos) await this.discardPhoto(photo.id).catch(()=>{});throw error;}
  }
  async exportData() {
    return this.readSnapshot(async store=>{
      const messages=await store.messages();
      for (const message of messages) {
        const urls=[];
        for (const url of photos.photoUrls(message)) {
          const id=/^\/api\/media\/([a-f0-9-]{36})$/.exec(url)?.[1];
          if (!id) {urls.push(url);continue;}
          const photo=await store.readMedia(id);
          if (photo) urls.push('data:'+photo.mime+';base64,'+photo.bytes.toString('base64'));
        }
        Object.assign(message,photos.withPhotoUrls(message,urls));
      }
      return {format:'boji-backup-v1',exportedAt:now(),profile:await store.profile(),meals:await store.meals(),messages,memories:await store.memories(),
        revisions:(await store.query('SELECT meal_id,changed_at,before_json,after_json,reason FROM boji_revision WHERE account_id=$1 ORDER BY changed_at',[this.accountId])).rows};
    });
  }
  async importData(backup,mode='all') {
    const {meals,messages,memories}=normalizeBackup(backup,mode,await this.today());
    if (mode!=='profile'&&!await this.profile()&&!(mode!=='records'&&backup.profile)) throw failure('请先建档，或选择同时导入档案。');
    const preparedPhotos=[];
    try {
      for (const {message} of messages) {
        const inputPhotos=photos.photoUrls(message);
        if (!inputPhotos.length) continue;
        const exists=await this.query('SELECT 1 FROM boji_message WHERE account_id=$1 AND id=$2',[this.accountId,message.id]);
        if (exists.rowCount) continue;
        const urls=[];
        for (const url of inputPhotos) {
          const photo=await this.preparePhoto(url);preparedPhotos.push(photo);urls.push(photo.url);
        }
        Object.assign(message,photos.withPhotoUrls(message,urls));
      }
      const result=await this.transaction(async store=>{
        if (mode!=='records'&&backup.profile) await store.saveProfile(backup.profile,backup.profile.timezone||backup.timezone);
        for (const memory of memories) await store.saveMemory(memory);
        let mealCount=0,messageCount=0;
        const profile=await store.profile();
        for (const {date,meal} of meals) {
          const timestamp=new Date(date+'T12:00:00.000Z').toISOString();
          const inserted=await store.query('INSERT INTO boji_meal(account_id,id,date,created_at,updated_at,plan_version,payload) VALUES($1,$2,$3,$4,$4,$5,$6) ON CONFLICT(account_id,id) DO NOTHING',
            [this.accountId,meal.id,date,timestamp,profile.planVersion,encoded(meal)]);
          mealCount+=inserted.rowCount;
        }
        for (let index=0;index<messages.length;index++) {
          const {date,message}=messages[index];
          const timestamp=new Date(Date.parse(date+'T12:00:00.000Z')+index*1000).toISOString();
          const inserted=await store.query('INSERT INTO boji_message(account_id,id,date,created_at,role,related_meal_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,id) DO NOTHING',
            [this.accountId,message.id,date,timestamp,message.role,message.receipt?.id||null,encoded(message)]);
          messageCount+=inserted.rowCount;
        }
        for (const photo of preparedPhotos) await store.attachPhoto(photo);
        return {importedMeals:mealCount,importedMessages:messageCount,profileUpdated:mode!=='records'&&Boolean(backup.profile)};
      });
      return {...result,state:await this.state()};
    } catch(error) {for (const photo of preparedPhotos) await this.discardPhoto(photo.id).catch(()=>{});throw error;}
  }
}
module.exports={CloudStore};
