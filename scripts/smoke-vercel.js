// Use only dedicated temporary accounts. Never log passwords, cookies or credentials.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {CloudDatabase}=require('../cloud-db.js');
const {CloudStore}=require('../cloud-store.js');
const {BlobMedia}=require('../blob-media.js');
const base=process.argv[2];
if(!base?.startsWith('https://')) throw new Error('请传入待验收的 HTTPS 生产地址。');
const names=[],db=new CloudDatabase(process.env.DATABASE_URL);
const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const password=crypto.randomBytes(24).toString('base64url');
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
async function call(route,{method='GET',body,user}={}) {
 const res=await fetch(base+route,{method,redirect:'manual',signal:AbortSignal.timeout(150000),headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{})},body:body?JSON.stringify(body):undefined});
 const text=await res.text();let data;
 try {data=res.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text;}catch{throw new Error('服务返回了无法解析的响应，HTTP '+res.status);}
 return {status:res.status,headers:res.headers,data};
}
async function main() {
 assert.equal((await call('/')).status,302);assert.equal((await call('/api/state')).status,401);
 for(const route of ['/api-key.local.json','/.env.vercel.local','/data/accounts.sqlite','/server.js','/db/schema.sql','/package.json']) assert.equal((await call(route)).status,404,route);
 console.log('通过：公网登录入口、未登录保护和本机配置不可访问。');
 const users=[];
 for(let i=0;i<2;i++) {
  const username='smoke_'+crypto.randomBytes(6).toString('hex');names.push(username);
  const r=await call('/api/auth/register',{method:'POST',body:{username,password}});assert.equal(r.status,200,JSON.stringify(r.data));
  assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/Secure/);
  const user={cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};users.push(user);
  const saved=await call('/api/profile',{method:'PUT',user,body:{profile:{...profile,age:26+i},timezone:'Asia/Shanghai'}});
  assert.equal(saved.status,200,JSON.stringify(saved.data));
 }
 const [a,b]=users;assert.equal((await call('/api/state',{user:a})).data.profile.age,26);assert.equal((await call('/api/state',{user:b})).data.profile.age,27);
 assert.equal((await call('/api/health',{user:a})).data.configured,true);
 console.log('通过：两个独立账号注册、建档、跨请求持久化。');
 const requestId=crypto.randomUUID(),body={requestId,text:'我今天早餐已经吃了两个水煮鸡蛋，请记录。',source:'text'};
 const r=await call('/api/chat',{method:'POST',user:a,body});assert.equal(r.status,200,JSON.stringify(r.data));
 if(!/event: result/.test(r.data)) throw new Error('真实模型没有完成记录：'+String(r.data).slice(-500));
 const state=(await call('/api/state',{user:a})).data;assert.equal(state.meals.length,1);assert.ok(state.today.calories>0);assert.ok(state.today.protein>0);
 assert.equal((await call('/api/state',{user:b})).data.meals.length,0);
 const replay=await call('/api/chat',{method:'POST',user:a,body});assert.equal(replay.data.replayed,true);assert.equal(replay.data.state.meals.length,1);
 console.log('通过：真实 DeepSeek 记餐、营养进度更新、重复请求去重和双账号隔离。');
 // Import a tiny known PNG to exercise Blob without representing a real meal.
 const date=state.activeDate;
 const imported=await call('/api/import',{method:'POST',user:a,body:{mode:'records',backup:{format:'boji-backup-v1',messages:[{id:'smoke-photo-'+requestId,date,role:'user',text:'存储验收测试图片',photoUrl:photo}]}}});
 assert.equal(imported.status,200,JSON.stringify(imported.data));
 const photoUrl=imported.data.state.messages.find(x=>x.id==='smoke-photo-'+requestId)?.photoUrl;assert.ok(photoUrl);
 assert.equal((await call(photoUrl,{user:a})).status,200);assert.equal((await call(photoUrl,{user:b})).status,404);assert.equal((await call(photoUrl)).status,401);
 const backup=await call('/api/export',{user:a});assert.equal(backup.status,200);assert.ok(backup.data.messages.some(x=>x.photoUrl===photo));
 const restored=await call('/api/import',{method:'POST',user:b,body:{mode:'records',backup:backup.data}});assert.equal(restored.status,200,JSON.stringify(restored.data));assert.equal(restored.data.state.meals.length,1);
 console.log('通过：私有照片上传/读取、权限隔离、带照片备份导出与另一测试账号恢复。');
 for(const user of users) {
  const del=await call('/api/history/'+date,{method:'DELETE',user});assert.equal(del.status,200,JSON.stringify(del.data));
  assert.equal((await call('/api/state',{user})).data.meals.length,0);
  assert.equal((await call('/api/auth/logout',{method:'POST',user})).status,200);
  assert.equal((await call('/api/state',{user})).status,401);
 }
 console.log('通过：删除记录、重新计算与退出会话失效。');
}
main().catch(error=>{console.error('公网验收失败：'+error.message);process.exitCode=1;}).finally(async()=>{
 try {
  for(const username of names) {
   const account=(await db.pool.query('SELECT id FROM boji_account WHERE username=$1',[username])).rows[0];if(!account) continue;
   const media=new BlobMedia();
   await db.pool.query("UPDATE boji_media SET status='deleting' WHERE account_id=$1",[account.id]);
   await new CloudStore(db,account.id,media).flushMediaGarbage(100);
   const remains=(await db.pool.query('SELECT 1 FROM boji_media WHERE account_id=$1',[account.id])).rowCount;
   if(remains) {console.error('测试照片清理待重试，暂留对应测试账号。');continue;}
   await db.pool.query('DELETE FROM boji_usage WHERE key=$1',['account:'+account.id]);
   await db.pool.query('DELETE FROM boji_account WHERE id=$1',[account.id]);
  }
 }catch(error){console.error('测试数据清理失败：'+(error.code||'CLEANUP_ERROR'));process.exitCode=1;}
 await db.close();
});
