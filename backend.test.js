const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createAppServer,validateResult} = require('./server.js');
const {Store} = require('./store.js');

const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const egg={name:'鸡蛋 × 2',type:'早餐',calories:150,calorie_min:140,calorie_max:160,protein:12,carbs:1,fat:10,fiber:0,food_items:[{food_name:'鸡蛋',estimated_amount:'2 个',calories:150,protein:12,carbs:1,fat:10,fiber:0,confidence:'high'}]};
const turn=(action,meal=null,target_meal_id=null)=>({action,meal,target_meal_id,occurred_on:null,reply:action==='question'?'两个鸡蛋约 150 kcal。':'已处理。'});
const fakeStream=result=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});

async function withServer(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-test-'));
  const calls=[];
  const outputs=[];
  const fetchImpl=async (_url,init)=>{
    const request=JSON.parse(init.body);calls.push(request);
    if (request.model==='deepseek-flash') return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'一份鸡肉饭，含米饭和鸡肉。'}]}]}),{headers:{'Content-Type':'application/json'}});
    const output=outputs.shift()||turn('question');
    if (request.text?.format?.name==='manual_meal') return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}),{headers:{'Content-Type':'application/json'}});
    if (output.incomplete) return new Response(`data: ${JSON.stringify({type:'response.incomplete'})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
    return fakeStream(output);
  };
  const server=createAppServer({apiKey:'test-key',fetchImpl,dbPath:path.join(dir,'boji.sqlite')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async (route,method='GET',body)=>{
    const response=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const contentType=response.headers.get('content-type')||'';
    return {status:response.status,payload:contentType.startsWith('image/')?await response.arrayBuffer():contentType.includes('text/event-stream')?await response.text():await response.json()};
  };
  try {await fn({request,outputs,calls,dir});}
  finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
}

test('profile and meals are saved; retries do not duplicate a recorded meal',async()=>withServer(async({request,outputs,calls})=>{
  let state=(await request('/api/state')).payload;
  assert.equal(state.profile,null);assert.equal(state.meals.length,0);
  const saved=await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  assert.equal(saved.status,200);assert.equal(saved.payload.profile.planVersion,1);
  outputs.push(turn('consumed',egg));
  const body={requestId:'test-consumed-1',text:'刚吃了两个鸡蛋',source:'text'};
  const first=await request('/api/chat','POST',body);
  assert.equal(first.status,200);assert.match(first.payload,/event: result/);
  state=(await request('/api/state')).payload;
  assert.equal(state.meals.length,1);assert.equal(state.meals[0].foodItems.length,1);
  assert.equal(state.today.calories,150);
  assert.match(state.messages.at(-1).after,/今天累计约 150 kcal/);
  const retry=await request('/api/chat','POST',body);
  assert.equal(retry.payload.replayed,true);
  assert.equal((await request('/api/turn/test-consumed-1')).status,200);
  assert.equal((await request('/api/state')).payload.meals.length,1);
  assert.equal(calls[0].model,'deepseek-v4-pro');
  assert.equal(calls.length,1);
}));

test('saved profile and meal survive reopening the database',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-reopen-'));
  const filename=path.join(dir,'boji.sqlite');
  let store=new Store(filename);
  try {
    store.saveProfile(profile,'Asia/Shanghai');
    store.commitTurn({requestId:'reopen-meal-01',requestHash:'same',date:store.today(),text:'刚吃了两个鸡蛋',image:null,source:'text',result:turn('consumed',egg),reasoning:'',elapsedSeconds:1});
    store.close();store=new Store(filename);
    assert.equal(store.profile().planVersion,1);
    assert.equal(store.state().meals.length,1);
    assert.equal(store.state().today.calories,150);
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('question does not write meal; correction revises the saved meal',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'test-question-1',text:'两个鸡蛋多少热量？'});
  assert.equal((await request('/api/state')).payload.meals.length,0);
  outputs.push(turn('consumed',egg));
  await request('/api/chat','POST',{requestId:'test-consumed-2',text:'刚吃了两个鸡蛋'});
  const old=(await request('/api/state')).payload.meals[0];
  const corrected={...egg,calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
  outputs.push(turn('correction',corrected,old.id));
  await request('/api/chat','POST',{requestId:'test-correction-1',text:'其实只吃了一个鸡蛋',targetMealId:old.id});
  const state=(await request('/api/state')).payload;
  assert.equal(state.meals.length,1);assert.equal(state.today.calories,75);
  assert.equal(state.meals[0].id,old.id);
  const backup=(await request('/api/export')).payload;
  assert.equal(backup.revisions.length,1);
}));

test('manual History add and edit refresh nutrition totals and keep a revision',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  const today=(await request('/api/state')).payload.activeDate;
  outputs.push(egg);
  const added=await request('/api/meals','POST',{date:today,type:'午餐',description:'鸡蛋 2 个'});
  assert.equal(added.status,201);
  const id=added.payload.meal.id;
  assert.equal(added.payload.state.meals[0].type,'午餐');
  assert.equal(added.payload.state.meals[0].foodItems[0].food_name,'鸡蛋');
  assert.equal(added.payload.state.today.calories,150);
  assert.equal(added.payload.state.today.protein,12);
  assert.equal(added.payload.state.today.carbs,1);
  assert.equal(added.payload.state.messages.length,0);
  const corrected={...egg,calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
  outputs.push(corrected);
  const edited=await request(`/api/meals/${id}`,'PUT',{type:'晚餐',description:'鸡蛋 1 个'});
  assert.equal(edited.status,200);
  assert.equal(edited.payload.state.meals.length,1);
  assert.equal(edited.payload.state.meals[0].type,'晚餐');
  assert.equal(edited.payload.state.today.calories,75);
  assert.equal(edited.payload.state.today.protein,6);
  assert.equal(edited.payload.state.today.fat,5);
  assert.equal((await request('/api/export')).payload.revisions.length,1);
  assert.equal(calls.filter(call=>call.text?.format?.name==='manual_meal').length,2);
  assert.equal((await request('/api/meals','POST',{date:'2026-02-30',type:'早餐',description:'鸡蛋'})).status,400);
}));

test('deleting one meal recalculates Today, marks its conversation, and cannot be replayed into existence',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  const body={requestId:'delete-meal-turn-1',text:'刚吃了两个鸡蛋'};
  await request('/api/chat','POST',body);
  const before=(await request('/api/state')).payload;
  const id=before.meals[0].id;
  const removed=await request(`/api/meals/${id}`,'DELETE');
  assert.equal(removed.status,200);
  assert.equal(removed.payload.state.today.calories,0);
  assert.equal(removed.payload.state.meals.length,0);
  assert.equal(removed.payload.state.messages.length,2);
  assert.equal(removed.payload.state.messages[0].recordDeleted,true);
  assert.equal(removed.payload.state.messages[1].recordDeleted,true);
  assert.equal(removed.payload.state.messages[1].receipt,null);
  assert.equal((await request('/api/export')).payload.meals.length,0);
  assert.equal((await request(`/api/meals/${id}`,'DELETE')).status,404);
  const replay=await request('/api/chat','POST',body);
  assert.equal(replay.payload.replayed,true);
  assert.equal(replay.payload.assistantMessage.receipt,null);
  assert.equal((await request('/api/state')).payload.meals.length,0);
  assert.equal(calls.length,1);
}));

test('deleting a day removes its meals, conversation and photo while preserving another date',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  const today=(await request('/api/state')).payload.activeDate;
  const yesterday=new Date(Date.parse(`${today}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  outputs.push(egg);
  await request('/api/meals','POST',{date:yesterday,type:'早餐',description:'鸡蛋 2 个'});
  outputs.push(turn('consumed',egg));
  const body={requestId:'delete-day-turn-1',text:'',image:'data:image/png;base64,'+Buffer.from('fake-image').toString('base64'),source:'photo'};
  await request('/api/chat','POST',body);
  const before=(await request('/api/state')).payload;
  const mediaUrl=before.messages[0].photoUrl;
  assert.equal(before.archives[yesterday].calories,150);
  assert.equal(before.today.calories,150);
  const removed=await request(`/api/history/${today}`,'DELETE');
  assert.equal(removed.status,200);
  assert.equal(removed.payload.deletedMeals,1);
  assert.equal(removed.payload.deletedMessages,2);
  assert.equal(removed.payload.state.today.calories,0);
  assert.equal(removed.payload.state.messages.length,0);
  assert.equal(removed.payload.state.archives[yesterday].calories,150);
  assert.equal((await request(mediaUrl)).status,404);
  assert.equal((await request('/api/turn/delete-day-turn-1')).payload.deleted,true);
  assert.equal((await request('/api/chat','POST',body)).payload.replayed,true);
  assert.equal((await request('/api/state')).payload.meals.length,0);
  assert.equal((await request(`/api/history/${today}`,'DELETE')).status,404);
  assert.equal((await request('/api/history/2026-02-30','DELETE')).status,400);
  const old=await request(`/api/history/${yesterday}`,'DELETE');
  assert.equal(old.status,200);
  assert.equal(old.payload.state.archives[yesterday],undefined);
}));

test('deleting a backdated meal keeps today conversation out of future model context',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  await request('/api/chat','POST',{requestId:'backdated-delete-1',text:'昨天吃了两个鸡蛋'});
  const before=(await request('/api/state')).payload;
  const yesterday=Object.keys(before.archives)[0];
  const id=before.archives[yesterday].meals[0].id;
  const deleted=await request(`/api/meals/${id}`,'DELETE');
  assert.equal(deleted.status,200);
  assert.equal(deleted.payload.state.archives[yesterday],undefined);
  assert.equal(deleted.payload.state.messages.length,2);
  assert.equal(deleted.payload.state.messages[0].recordDeleted,true);
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'backdated-delete-2',text:'今天晚餐怎么吃？'});
  const input=JSON.parse(calls.at(-1).input[0].content[0].text);
  assert.equal(input.recent_messages.length,0);
  assert.equal(input.last_seven_days.days.find(day=>day.date===yesterday).calories,0);
}));

test('manual edits to a past day update that day without changing Today',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  const today=(await request('/api/state')).payload.activeDate;
  const yesterday=new Date(Date.parse(`${today}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  outputs.push(egg);
  const added=await request('/api/meals','POST',{date:yesterday,type:'早餐',description:'鸡蛋 2 个'});
  assert.equal(added.status,201);
  assert.equal(added.payload.state.today.calories,0);
  assert.equal(added.payload.state.archives[yesterday].calories,150);
  assert.ok(added.payload.state.archives[yesterday].plan.caloriesMin);
  const corrected={...egg,calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
  outputs.push(corrected);
  const edited=await request(`/api/meals/${added.payload.meal.id}`,'PUT',{type:'早餐',description:'鸡蛋 1 个'});
  assert.equal(edited.payload.state.today.calories,0);
  assert.equal(edited.payload.state.archives[yesterday].calories,75);
}));

test('a meal recorded by chat can be changed in History without duplicating it',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  await request('/api/chat','POST',{requestId:'chat-before-manual-1',text:'早餐吃了两个鸡蛋'});
  const prior=(await request('/api/state')).payload;
  const id=prior.meals[0].id;
  const corrected={...egg,calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
  outputs.push(corrected);
  const edited=await request(`/api/meals/${id}`,'PUT',{type:'午餐',description:'鸡蛋 1 个'});
  assert.equal(edited.status,200);
  assert.equal(edited.payload.state.meals.length,1);
  assert.equal(edited.payload.state.meals[0].id,id);
  assert.equal(edited.payload.state.meals[0].type,'午餐');
  assert.equal(edited.payload.state.today.calories,75);
  assert.equal(edited.payload.state.messages.length,2);
  assert.equal((await request('/api/export')).payload.revisions.length,1);
}));

test('photo uses Flash for vision then Pro for reasoning',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  const image='data:image/png;base64,'+Buffer.from('fake-image').toString('base64');
  await request('/api/chat','POST',{requestId:'test-photo-001',text:'',image,source:'photo'});
  assert.deepEqual(calls.map(call=>call.model),['deepseek-flash','deepseek-v4-pro']);
  let state=(await request('/api/state')).payload;
  assert.equal(state.meals.length,1);
  assert.match(state.messages[0].photoUrl,/^\/api\/media\//);
  const mediaUrl=state.messages[0].photoUrl;
  assert.equal((await request(mediaUrl)).status,200);
  assert.equal((await request(mediaUrl,'DELETE')).status,200);
  state=(await request('/api/state')).payload;
  assert.equal(state.messages[0].photoUrl,null);
}));

test('a question with a photo never creates a meal even if model says consumed',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  const image='data:image/png;base64,'+Buffer.from('fake-image').toString('base64');
  await request('/api/chat','POST',{requestId:'test-photo-q01',text:'这份鸡肉饭大概多少热量？',image,source:'photo'});
  assert.equal((await request('/api/state')).payload.meals.length,0);
}));

test('browser backup imports user records once and excludes old seed meals',async()=>withServer(async({request})=>{
  const day=(await request('/api/state')).payload.activeDate;
  const backup={format:'boji-browser-v1',activeDate:day,timezone:'Asia/Shanghai',profile,
    meals:[{id:'meal-breakfast',type:'早餐',name:'样本早餐',calories:100,protein:2,carbs:4,fat:8,fiber:0},
      {id:'user-meal-1',type:'午餐',name:'鸡肉饭',calories:600,protein:35,carbs:70,fat:18,fiber:5,input:'吃了鸡肉饭'}],
    messages:[{id:'user-msg-1',role:'user',text:'吃了鸡肉饭'}]};
  const first=await request('/api/import','POST',{backup,mode:'all'});
  assert.equal(first.status,200);
  assert.equal(first.payload.importedMeals,1);
  assert.equal(first.payload.importedMessages,1);
  assert.equal(first.payload.state.meals[0].importedDemo,true);
  const retry=await request('/api/import','POST',{backup,mode:'records'});
  assert.equal(retry.payload.importedMeals,0);
  assert.equal(retry.payload.importedMessages,0);
}));

test('historical dates use the plan effective on that local date',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-plan-'));
  const store=new Store(path.join(dir,'boji.sqlite'));
  try {
    store.saveProfile(profile,'Asia/Shanghai');
    store.db.prepare("UPDATE nutrition_plan SET local_date='2026-10-01' WHERE version=1").run();
    const first=store.planFor('2026-10-02');
    store.saveProfile({...profile,goal:'减一点脂，让线条更明显'},'Asia/Shanghai');
    store.db.prepare("UPDATE nutrition_plan SET local_date='2026-10-03' WHERE version=2").run();
    assert.equal(store.planFor('2026-10-02').caloriesMin,first.caloriesMin);
    assert.notEqual(store.planFor('2026-10-03').caloriesMin,first.caloriesMin);
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unclear food is asked once and never silently recorded',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('clarify'));
  const first=await request('/api/chat','POST',{requestId:'test-clarify-01',text:'中午随便吃了点东西'});
  assert.match(first.payload,/"action":"clarify"/);
  outputs.push(turn('clarify'));
  const second=await request('/api/chat','POST',{requestId:'test-clarify-02',text:'记不清了'});
  assert.match(second.payload,/"action":"question"/);
  assert.equal((await request('/api/state')).payload.meals.length,0);
}));

test('backdated food changes its historical day and seven-day aggregates',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push(turn('consumed',egg));
  await request('/api/chat','POST',{requestId:'test-yesterday-1',text:'昨天吃了两个鸡蛋'});
  const state=(await request('/api/state')).payload;
  assert.equal(state.today.calories,0);
  const yesterday=new Date(Date.parse(`${state.activeDate}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  assert.equal(state.archives[yesterday].calories,150);
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'test-history-q1',text:'近七天平均蛋白质是多少？'});
  const context=JSON.parse(calls.at(-1).input[0].content[0].text);
  assert.equal(context.last_seven_days.days.find(day=>day.date===yesterday).protein,12);
  const old=state.archives[yesterday].meals[0];
  const corrected={...egg,calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
  outputs.push(turn('correction',corrected,old.id));
  await request('/api/chat','POST',{requestId:'test-yesterday-fix',text:'昨天那顿鸡蛋其实只吃了一个',targetMealId:old.id});
  const revised=(await request('/api/state')).payload;
  assert.equal(revised.today.calories,0);
  assert.equal(revised.archives[yesterday].calories,75);
}));

test('model item totals are checked before recording',()=>{
  const inconsistent={...egg,calories:600};
  assert.throws(()=>validateResult(turn('consumed',inconsistent)),/不一致/);
  assert.throws(()=>validateResult(turn('consumed',{...egg,food_items:[{...egg.food_items[0],calories:-1}]})),/无效/);
});

test('confirmed habit can be saved, used, edited and deleted; one-off corrections are not memories',async()=>withServer(async({request,outputs,calls})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  const created=await request('/api/memories','POST',{text:'平时喝无糖拿铁'});
  assert.equal(created.status,201);
  const id=created.payload.memory.id;
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'test-memory-q1',text:'明天早餐怎么安排？'});
  const context=JSON.parse(calls.at(-1).input[0].content[0].text);
  assert.deepEqual(context.confirmed_habits,['平时喝无糖拿铁']);
  assert.equal((await request(`/api/memories/${id}`,'PUT',{text:'平时喝无糖咖啡'})).status,200);
  assert.equal((await request(`/api/memories/${id}`,'DELETE')).status,200);
  assert.equal((await request('/api/memories')).payload.memories.length,0);
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'test-memory-set',text:'请记住：我平时喝无糖拿铁'});
  assert.equal((await request('/api/memories')).payload.memories.length,1);
  outputs.push(turn('question'));
  await request('/api/chat','POST',{requestId:'test-memory-once',text:'这顿只吃一半'});
  assert.equal((await request('/api/memories')).payload.memories.length,1);
}));

test('truncated model output leaves no meal and no committed request',async()=>withServer(async({request,outputs})=>{
  await request('/api/profile','PUT',{profile,timezone:'Asia/Shanghai'});
  outputs.push({incomplete:true});
  const response=await request('/api/chat','POST',{requestId:'test-incomplete-1',text:'刚吃了两个鸡蛋'});
  assert.match(response.payload,/event: error/);
  assert.equal((await request('/api/state')).payload.meals.length,0);
  assert.equal((await request('/api/turn/test-incomplete-1')).status,404);
}));
