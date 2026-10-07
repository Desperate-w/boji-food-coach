const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Accounts} = require('./accounts.js');
const {Store} = require('./store.js');
const {createAppServer} = require('./server.js');
const {clientAddress, UserStores} = require('./runtime.js');

const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const password='test-password-long-enough';
const question={action:'question',meal:null,target_meal_id:null,occurred_on:null,reply:'按平时的食量正常吃。'};
const modelResponse=()=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(question)}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});

async function setup(options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-multiuser-'));
  const server=createAppServer({apiKey:'test-key',dataDir:dir,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=async(route,{method='GET',body,user,headers={}}={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...headers},
      body:body?JSON.stringify(body):undefined,redirect:'manual'});
    const text=await response.text();
    return {status:response.status,headers:response.headers,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text};
  };
  const register=async username=>{
    const result=await call('/api/auth/register',{method:'POST',body:{username,password}});
    assert.equal(result.status,200,JSON.stringify(result.data));
    return {cookie:result.headers.get('set-cookie').split(';')[0],csrf:result.data.csrf,username};
  };
  return {dir,server,call,register,close:async()=>{if (server.listening) await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

test('eight self-service users share one deployment and run AI concurrently without data leakage',async()=>{
  let calls=0,active=0,peak=0;
  const app=await setup({storeLimit:3,fetchImpl:async()=>{
    calls++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,25));active--;return modelResponse();
  }});
  try {
    assert.equal((await app.call('/api/auth/config')).data.registration,'open');
    const users=[];
    for (let i=0;i<8;i++) users.push(await app.register(`person${i}`));
    const accounts=new Accounts(path.join(app.dir,'accounts.sqlite'));
    assert.equal(accounts.db.prepare('SELECT COUNT(*) AS count FROM account').get().count,8);
    assert.equal(accounts.db.prepare("SELECT COUNT(*) AS count FROM account WHERE role='owner' OR storage_key='legacy'").get().count,0);
    accounts.close();
    // Exercise eviction with more users than cached database connections.
    for (let i=0;i<users.length;i++) assert.equal((await app.call('/api/profile',{method:'PUT',user:users[i],body:{profile:{...profile,age:26+i}}})).status,200);
    for (let i=0;i<users.length;i++) assert.equal((await app.call('/api/state',{user:users[i]})).data.profile.age,26+i);
    // Raise the cache for simultaneous leases in a separate server below.
    await new Promise(resolve=>app.server.close(resolve));
    const concurrent=createAppServer({apiKey:'test-key',dataDir:app.dir,storeLimit:16,fetchImpl:async()=>{
      calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,25));active--;return modelResponse();
    }});
    await new Promise(resolve=>concurrent.listen(0,'127.0.0.1',resolve));
    try {
      const responses=await Promise.all(users.map(user=>fetch(`http://127.0.0.1:${concurrent.address().port}/api/chat`,{
        method:'POST',headers:{Cookie:user.cookie,'X-CSRF-Token':user.csrf,'Content-Type':'application/json'},
        body:JSON.stringify({requestId:'same-request-0001',text:`${user.username} 晚上吃什么？`}),
      }).then(async response=>({status:response.status,text:await response.text()}))));
      assert.equal(calls,8);assert.equal(peak,8);
      responses.forEach(response=>{assert.equal(response.status,200);assert.match(response.text,/event: result/);});
      for (const user of users) {
        const response=await fetch(`http://127.0.0.1:${concurrent.address().port}/api/state`,{headers:{Cookie:user.cookie}});
        const state=await response.json();
        assert.equal(state.messages.length,2);assert.equal(state.messages[0].text,`${user.username} 晚上吃什么？`);
      }
    } finally {await new Promise(resolve=>concurrent.close(resolve));}
  } finally {await app.close();}
});

test('same-user writes and duplicate in-flight turns cannot race; global concurrency recovers',async()=>{
  let enter,finish,calls=0;
  const entered=new Promise(resolve=>{enter=resolve;});
  const pending=new Promise(resolve=>{finish=resolve;});
  const app=await setup({modelConcurrency:1,fetchImpl:async()=>{calls++;enter();await pending;return modelResponse();}});
  try {
    const first=await app.register('firstuser'), second=await app.register('seconduser');
    for (const user of [first,second]) await app.call('/api/profile',{method:'PUT',user,body:{profile}});
    const body={requestId:'parallel-request-01',text:'今晚吃什么？'};
    const original=app.call('/api/chat',{method:'POST',user:first,body});
    await entered;
    assert.equal((await app.call('/healthz')).status,200);
    const duplicate=await app.call('/api/chat',{method:'POST',user:first,body});
    assert.equal(duplicate.status,409);assert.equal(duplicate.data.code,'ACCOUNT_BUSY');
    assert.equal((await app.call('/api/profile',{method:'PUT',user:first,body:{profile:{...profile,age:30}}})).status,409);
    const busy=await app.call('/api/chat',{method:'POST',user:second,body});
    assert.equal(busy.status,503);assert.equal(busy.data.code,'MODEL_BUSY');
    assert.equal((await app.call('/api/state',{user:second})).status,200);
    finish();assert.equal((await original).status,200);
    const replay=await app.call('/api/chat',{method:'POST',user:first,body});
    assert.equal(replay.data.replayed,true);assert.equal(calls,1);
    assert.equal((await app.call('/api/chat',{method:'POST',user:second,body})).status,200);assert.equal(calls,2);
  } finally {finish();await app.close();}
});

test('public registration never claims legacy data; owner bootstrap and registration modes remain explicit',async()=>{
  const app=await setup({registration:'closed'});
  try {
    assert.equal((await app.call('/api/auth/register',{method:'POST',body:{username:'publicuser',password}})).status,400);
    const accounts=new Accounts(path.join(app.dir,'accounts.sqlite'));
    const code=accounts.createInvite('owner');accounts.close();
    const owner=await app.call('/api/auth/register',{method:'POST',body:{username:'siteowner',password,inviteCode:code}});
    assert.equal(owner.status,200);
    const invalid=await app.call('/api/auth/register',{method:'POST',body:{username:'attacker',password,role:'owner'}});
    assert.equal(invalid.status,400);
  } finally {await app.close();}
  assert.throws(()=>createAppServer({registration:'typo'}),/REGISTRATION_MODE/);
  assert.throws(()=>createAppServer({globalModelLimit:0}),/GLOBAL_DAILY_MODEL_LIMIT/);
});

test('proxy identity is explicit, login limits are per client and persist in the database',async()=>{
  assert.equal(clientAddress({socket:{remoteAddress:'203.0.113.1'},headers:{'x-real-ip':'1.2.3.4'}},['127.0.0.1']),'203.0.113.1');
  assert.equal(clientAddress({socket:{remoteAddress:'127.0.0.1'},headers:{'x-real-ip':'1.2.3.4, 5.6.7.8'}},['127.0.0.1']),'127.0.0.1');
  const app=await setup({trustedProxies:['127.0.0.1']});
  try {
    for (let i=0;i<30;i++) await app.call('/api/auth/login',{method:'POST',body:{username:`missing${i}`,password},headers:{'X-Real-IP':'203.0.113.1'}});
    assert.equal((await app.call('/api/auth/login',{method:'POST',body:{username:'missing30',password},headers:{'X-Real-IP':'203.0.113.1'}})).status,429);
    assert.equal((await app.call('/api/auth/login',{method:'POST',body:{username:'another',password},headers:{'X-Real-IP':'203.0.113.2'}})).status,401);
    const accounts=new Accounts(path.join(app.dir,'accounts.sqlite'));
    assert.equal(accounts.rateAllowed('/api/auth/login:203.0.113.1',30,900_000),false);
    accounts.close();
    assert.equal((await app.call('/api/auth/register',{method:'POST',body:{username:'crosssite',password},headers:{Origin:'https://evil.example'}})).status,403);
  } finally {await app.close();}
});

test('failed model calls release user and global slots for the next request',async()=>{
  let calls=0;
  const app=await setup({modelConcurrency:1,fetchImpl:async()=>{if (++calls===1) throw new Error('test upstream failure');return modelResponse();}});
  try {
    const user=await app.register('retryuser');
    await app.call('/api/profile',{method:'PUT',user,body:{profile}});
    const body={requestId:'retry-request-01',text:'晚上吃什么？'};
    assert.equal((await app.call('/api/chat',{method:'POST',user,body})).status,500);
    assert.equal((await app.call('/api/state',{user})).data.messages.length,0);
    assert.equal((await app.call('/api/chat',{method:'POST',user,body})).status,200);
    assert.equal(calls,2);
  } finally {await app.close();}
});

test('disconnecting manual estimation aborts upstream work and releases the shared model slot',async()=>{
  let enter,wasAborted,calls=0;
  const entered=new Promise(resolve=>{enter=resolve;});
  const aborted=new Promise(resolve=>{wasAborted=resolve;});
  const app=await setup({modelConcurrency:1,fetchImpl:async(_url,{signal})=>{
    if (++calls>1) return modelResponse();
    enter();
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{wasAborted();reject(signal.reason);},{once:true}));
  }});
  const controller=new AbortController();
  try {
    const user=await app.register('canceluser');
    await app.call('/api/profile',{method:'PUT',user,body:{profile}});
    const request=fetch(`http://127.0.0.1:${app.server.address().port}/api/meals`,{method:'POST',signal:controller.signal,
      headers:{Cookie:user.cookie,'X-CSRF-Token':user.csrf,'Content-Type':'application/json'},
      body:JSON.stringify({date:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),type:'早餐',description:'一个鸡蛋'}),
    }).catch(error=>error);
    await entered;controller.abort();await request;await aborted;
    assert.equal((await app.call('/api/chat',{method:'POST',user,body:{requestId:'after-cancel-01',text:'晚餐吃什么？'}})).status,200);
    assert.equal((await app.call('/api/state',{user})).data.meals.length,0);
  } finally {controller.abort();await app.close();}
});

test('a database with an active lease is never evicted and idle databases close',()=>{
  const closed=[];
  const pool=new UserStores('/unused',{limit:1,idleMs:10,factory:filename=>({filename,close(){closed.push(filename);}})});
  const a=pool.acquire({id:'a',storageKey:'a'});
  assert.throws(()=>pool.acquire({id:'b',storageKey:'b'}),/繁忙/);
  pool.sweep(Date.now()+1000);assert.equal(closed.length,0);
  a.release();a.release();
  const b=pool.acquire({id:'b',storageKey:'b'});assert.equal(closed.length,1);
  b.release();pool.sweep(Date.now()+1000);assert.equal(closed.length,2);assert.equal(pool.entries.size,0);
  pool.close();
});

test('history uses stable date cursors, retains an edited old day, and export remains complete',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-pagination-'));
  const store=new Store(path.join(dir,'boji.sqlite'));
  try {
    store.saveProfile(profile,'Asia/Shanghai');
    const today=store.today();
    for (let i=1;i<=65;i++) {
      const date=new Date(Date.parse(`${today}T12:00:00Z`)-i*86400_000).toISOString().slice(0,10);
      store.saveManualMeal({date,type:'早餐',description:'鸡蛋',data:{name:'鸡蛋',calories:80,calorie_min:70,calorie_max:90,protein:6,carbs:1,fat:5,fiber:0,food_items:[]}});
    }
    const first=store.state();assert.equal(Object.keys(first.archives).length,30);assert.equal(first.historyPage.hasMore,true);
    const second=store.historyPage(first.historyPage.nextBefore);assert.equal(Object.keys(second.archives).length,30);
    assert.equal(Object.keys(second.archives).some(date=>date in first.archives),false);
    const third=store.historyPage(second.historyPage.nextBefore);assert.equal(Object.keys(third.archives).length,5);assert.equal(third.historyPage.hasMore,false);
    const focus=Object.keys(third.archives).at(-1);assert.ok(store.state({focusDate:focus}).archives[focus]);
    const oldMeal=store.meals(focus)[0];
    const insert=store.db.prepare('INSERT INTO conversation_message(id,date,created_at,role,related_meal_id,payload_json) VALUES(?,?,?,?,?,?)');
    insert.run('older-message',focus,new Date().toISOString(),'assistant',oldMeal.id,JSON.stringify({role:'assistant',text:'历史交流',reasoningText:'历史思考文本'}));
    insert.run('current-message',today,new Date().toISOString(),'assistant',oldMeal.id,JSON.stringify({role:'assistant',text:'补记',receipt:oldMeal}));
    assert.equal(store.historyPage(second.historyPage.nextBefore).archives[focus].messages.length,0);
    assert.equal(store.historyPage(second.historyPage.nextBefore).archives[focus].messageCount,1);
    assert.equal(store.state({focusDate:focus}).archives[focus].messages[0].reasoningText,'历史思考文本');
    assert.equal(store.state().messages[0].latestReceipt.id,oldMeal.id);
    assert.equal(store.exportData().meals.length,65);
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a failed photo import rolls back profile, records, and new media together',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-import-rollback-'));
  const store=new Store(path.join(dir,'boji.sqlite'));
  try {
    store.saveProfile(profile,'Asia/Shanghai');
    const before=store.profile();
    assert.throws(()=>store.importData({format:'boji-backup-v1',profile:{...profile,age:40},messages:[
      {id:'photo-good',role:'user',text:'photo',photoUrl:'data:image/png;base64,iVBORw0KGgo='},
      {id:'photo-bad',role:'user',text:'bad photo',photoUrl:'data:image/png;base64,'},
    ]}),/照片格式无效/);
    assert.deepEqual(store.profile(),before);
    assert.equal(store.messages().length,0);
    assert.equal(fs.readdirSync(store.mediaDir).length,0);
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
