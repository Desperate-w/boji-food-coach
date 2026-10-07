const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Accounts}=require('./accounts.js');
const {Store}=require('./store.js');
const {createAppServer}=require('./server.js');

const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};

test('invited users are isolated from legacy data and each other',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-accounts-'));
  const dbPath=path.join(dir,'boji.sqlite');
  const existing=new Store(dbPath);
  existing.saveProfile(profile,'Asia/Shanghai');
  existing.saveManualMeal({date:existing.today(),type:'早餐',description:'鸡蛋',data:{name:'鸡蛋',type:'早餐',calories:80,calorie_min:70,calorie_max:90,protein:6,carbs:1,fat:5,fiber:0,food_items:[{food_name:'鸡蛋',estimated_amount:'1 个',calories:80,protein:6,carbs:1,fat:5,fiber:0,confidence:'high'}]}});
  const legacyMealId=existing.state().meals[0].id;
  const legacyPhoto=existing.savePhoto('data:image/png;base64,iVBORw0KGgo=').url;
  existing.close();
  let accountDb=new Accounts(path.join(dir,'accounts.sqlite'));
  const ownerCode=accountDb.createInvite('owner');
  accountDb.close();
  const server=createAppServer({apiKey:'test-key',dbPath,dailyModelLimit:1,fetchImpl:async()=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({action:'question',meal:null,target_meal_id:null,occurred_on:null,reply:'好的。'})}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,{method='GET',body,cookie,csrf}={})=>{
    const headers={};
    if (body) headers['Content-Type']='application/json';
    if (cookie) headers.Cookie=cookie;
    if (csrf) headers['X-CSRF-Token']=csrf;
    const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'manual'});
    const type=response.headers.get('content-type')||'';
    return {status:response.status,headers:response.headers,body:type.includes('application/json')?await response.json():await response.text()};
  };
  try {
    assert.equal((await call('/api/state')).status,401);
    assert.equal((await call('/')).headers.get('location'),'/login');
    assert.equal((await call('/app.js')).status,404);
    assert.equal((await call('/api/auth/register',{method:'POST',body:{inviteCode:'wrong',username:'friend1',password:'very-long-password'}})).status,400);
    const owner=await call('/api/auth/register',{method:'POST',body:{inviteCode:ownerCode,username:'owner1',password:'very-long-password'}});
    assert.equal(owner.status,200);
    assert.match(owner.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    assert.equal((await call('/api/auth/register',{method:'POST',body:{inviteCode:ownerCode,username:'owner2',password:'very-long-password'}})).status,400);
    const ownerCookie=owner.headers.get('set-cookie').split(';')[0];
    const ownerCsrf=owner.body.csrf;
    assert.equal((await call('/api/state',{cookie:ownerCookie})).body.meals[0].id,legacyMealId);
    assert.equal((await call(legacyPhoto,{cookie:ownerCookie})).status,200);
    assert.equal((await call('/api/profile',{method:'PUT',body:{profile},cookie:ownerCookie})).status,403);

    accountDb=new Accounts(path.join(dir,'accounts.sqlite'));
    const friendCode=accountDb.createInvite('member');
    accountDb.close();
    const friend=await call('/api/auth/register',{method:'POST',body:{inviteCode:friendCode,username:'friend1',password:'another-long-password'}});
    assert.equal(friend.status,200);
    const friendCookie=friend.headers.get('set-cookie').split(';')[0];
    const friendCsrf=friend.body.csrf;
    assert.equal((await call('/api/state',{cookie:friendCookie})).body.profile,null);
    assert.equal((await call('/api/export',{cookie:friendCookie})).body.meals.length,0);
    assert.equal((await call(legacyPhoto,{cookie:friendCookie})).status,404);
    assert.equal((await call(legacyPhoto,{method:'DELETE',cookie:friendCookie,csrf:friendCsrf})).status,404);
    assert.equal((await call(`/api/meals/${legacyMealId}`,{method:'DELETE',cookie:friendCookie,csrf:friendCsrf})).status,404);
    assert.equal((await call('/api/state',{cookie:ownerCookie})).body.meals.length,1);
    assert.equal((await call('/api/profile',{method:'PUT',body:{profile},cookie:friendCookie,csrf:friendCsrf})).status,200);
    assert.equal((await call('/api/state',{cookie:friendCookie})).body.meals.length,0);

    const chatBody={requestId:'shared-request-01',text:'晚上吃什么？'};
    assert.equal((await call('/api/chat',{method:'POST',body:chatBody,cookie:ownerCookie,csrf:ownerCsrf})).status,200);
    assert.equal((await call('/api/chat',{method:'POST',body:{...chatBody,requestId:'shared-request-02'},cookie:ownerCookie,csrf:ownerCsrf})).status,429);
    assert.equal((await call('/api/chat',{method:'POST',body:chatBody,cookie:friendCookie,csrf:friendCsrf})).status,200);
    assert.equal((await call('/api/turn/shared-request-01',{cookie:friendCookie})).status,200);
    assert.equal((await call('/api/auth/logout',{method:'POST',cookie:friendCookie,csrf:friendCsrf})).status,200);
    assert.equal((await call('/api/state',{cookie:friendCookie})).status,401);
    assert.equal((await call('/api/state',{cookie:ownerCookie})).body.meals.length,1);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('account session and personal plan survive a server restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-auth-restart-'));
  const dbPath=path.join(dir,'boji.sqlite');
  const accounts=new Accounts(path.join(dir,'accounts.sqlite'));
  const owner=accounts.register({inviteCode:accounts.createInvite('owner'),username:'restartowner',password:'very-long-password'});
  const session=accounts.createSession(owner);
  accounts.close();
  const request=async(server,route,method='GET',body)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{
      method,headers:{Cookie:`boji_session=${session.token}`,...(body?{'Content-Type':'application/json'}:{}),...(method==='GET'?{}:{'X-CSRF-Token':session.csrf})},
      body:body?JSON.stringify(body):undefined,
    });
    return {status:response.status,body:await response.json()};
  };
  try {
    const first=createAppServer({apiKey:'',dbPath});
    await new Promise(resolve=>first.listen(0,'127.0.0.1',resolve));
    try {
      assert.equal((await request(first,'/api/auth/session')).body.username,'restartowner');
      assert.equal((await request(first,'/api/profile','PUT',{profile})).status,200);
    } finally {await new Promise(resolve=>first.close(resolve));}
    const second=createAppServer({apiKey:'',dbPath});
    await new Promise(resolve=>second.listen(0,'127.0.0.1',resolve));
    try {
      assert.equal((await request(second,'/api/auth/session')).status,200);
      assert.equal((await request(second,'/api/state')).body.profile.age,26);
    } finally {await new Promise(resolve=>second.close(resolve));}
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
