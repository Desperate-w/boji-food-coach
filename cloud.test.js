const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {CloudDatabase}=require('./cloud-db.js');
const {CloudAccounts}=require('./cloud-accounts.js');
const {CloudStore}=require('./cloud-store.js');
const {BlobMedia,decodePhoto}=require('./blob-media.js');
const {createAppServer}=require('./server.js');
const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const egg={name:'鸡蛋 × 2',type:'早餐',calories:150,calorie_min:140,calorie_max:160,protein:12,carbs:1,fat:10,fiber:0,food_items:[{food_name:'鸡蛋',estimated_amount:'2 个',calories:150,protein:12,carbs:1,fat:10,fiber:0,confidence:'high'}]};
const turn=(action='question',meal=null,target_meal_id=null)=>({action,meal,target_meal_id,occurred_on:null,reply:'已处理。'});
const stream=result=>new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
const password='local-test-password-only';

async function freePort() {
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}

test('real PostgreSQL adapters remain consistent across independent application instances',async t=>{
  const EmbeddedPostgres=(await import('embedded-postgres')).default;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-pg-'));
  const port=await freePort();
  const pg=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'postgres',password,port,persistent:false,
    postgresFlags:['-h','127.0.0.1','-k',dir],onLog:()=>{},onError:()=>{}});
  const dbs=[],apps=[],objects=new Map();let failDeletion=false,modelCalls=0,block,uploadCount=0,failUploadNumber=0;
  const visionRequests=[];
  const media={put:async(key,bytes)=>{if(++uploadCount===failUploadNumber)throw new Error('simulated Blob upload failure');objects.set(key,bytes);},get:async key=>objects.get(key)||null,
    del:async key=>{if(failDeletion) throw new Error('temporary storage failure');objects.delete(key);}};
  const outputs=[];
  try {
    await pg.initialise();await pg.start();await pg.createDatabase('boji_test');
    const url=`postgresql://postgres:${password}@127.0.0.1:${port}/boji_test`;
    for(let i=0;i<2;i++) dbs.push(new CloudDatabase(url));
    await dbs[0].migrate();await dbs[1].migrate();
    for(const db of dbs) {
      const app=createAppServer({apiKey:'test-key',cloudDatabase:db,mediaStorage:media,modelConcurrency:1,fetchImpl:async(_url,init)=>{
        const body=JSON.parse(init.body);
        if(body.model==='deepseek-flash') {visionRequests.push(body);return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'两个鸡蛋。'}]}]}));}
        modelCalls++;if(block) await block;
        const result=outputs.shift()||turn();
        if(body.text?.format?.name==='manual_meal') return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
        return stream(result);
      }});
      await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));apps.push(app);
    }
    const call=async(index,route,{user,method='GET',body,headers={}}={})=>{
      const res=await fetch(`http://127.0.0.1:${apps[index].address().port}${route}`,{method,redirect:'manual',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
      const text=await res.text();return {status:res.status,headers:res.headers,data:res.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text};
    };
    const register=async name=>{
      const r=await call(0,'/api/auth/register',{method:'POST',body:{username:name,password}});
      assert.equal(r.status,200,JSON.stringify(r.data));return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};
    };
    const first=await register('cloudfirst'),second=await register('cloudsecond');
    const accountIds=(await dbs[0].pool.query('SELECT id,username FROM boji_account')).rows;
    const firstId=accountIds.find(x=>x.username==='cloudfirst').id,secondId=accountIds.find(x=>x.username==='cloudsecond').id;
    const accounts=dbs.map(db=>new CloudAccounts(db));
    await t.test('sessions, profiles and private routes work across instances',async()=>{
      assert.equal((await call(1,'/api/state')).status,401);
      for(const [i,user] of [first,second].entries()) {
        const r=await call(i,'/api/profile',{method:'PUT',user,body:{profile:{...profile,age:26+i},timezone:'Asia/Shanghai'}});assert.equal(r.status,200,JSON.stringify(r.data));
      }
      assert.equal((await call(1,'/api/state',{user:first})).data.profile.age,26);
      assert.equal((await call(0,'/api/state',{user:second})).data.profile.age,27);
      assert.equal((await call(1,'/api/profile',{method:'PUT',user:first,body:{profile},headers:{'X-CSRF-Token':'wrong'}})).status,403);
    });
    let mealId,photoUrl,today;
    const body={requestId:'cloud-photo-turn-01',text:'刚吃了两个鸡蛋',image:photo,source:'photo'};
    await t.test('photos and completed turns persist; replay does not call the model twice',async()=>{
      outputs.push(turn('consumed',egg));
      const r=await call(0,'/api/chat',{method:'POST',user:first,body});assert.match(r.data,/event: result/);
      const state=(await call(1,'/api/state',{user:first})).data;
      assert.equal(state.today.calories,150);assert.equal(state.messages.length,2);
      mealId=state.meals[0].id;photoUrl=state.messages[0].photoUrl;today=state.activeDate;
      assert.equal(objects.size,1);
      assert.equal((await call(1,photoUrl,{user:first})).status,200);
      assert.equal((await call(1,photoUrl,{user:second})).status,404);
      assert.equal((await call(1,'/api/meals/'+mealId,{method:'DELETE',user:second})).status,404);
      assert.equal((await call(1,'/api/state',{user:second})).data.meals.length,0);
      const calls=modelCalls;
      assert.equal((await call(1,'/api/chat',{method:'POST',user:first,body})).data.replayed,true);assert.equal(modelCalls,calls);
      assert.equal((await call(1,'/api/chat',{method:'POST',user:first,body:{...body,text:'另一个请求'}})).status,409);
      const backup=(await call(1,'/api/export',{user:first})).data;assert.equal(backup.messages[0].photoUrl,photo);
    });
    await t.test('manual edits keep revisions, and deletions cannot resurrect through replay',async()=>{
      const corrected={...egg,name:'一个鸡蛋',calories:75,calorie_min:70,calorie_max:80,protein:6,carbs:1,fat:5,food_items:[{...egg.food_items[0],estimated_amount:'1 个',calories:75,protein:6,carbs:1,fat:5}]};
      outputs.push(corrected);
      const r=await call(1,'/api/meals/'+mealId,{method:'PUT',user:first,body:{type:'早餐',description:'其实只有一个鸡蛋'}});
      assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.state.today.calories,75);
      assert.equal((await call(0,'/api/export',{user:first})).data.revisions.length,1);
      assert.equal((await call(0,'/api/meals/'+mealId,{method:'DELETE',user:first})).status,200);
      const replay=await call(1,'/api/chat',{method:'POST',user:first,body});assert.equal(replay.data.receipt,null);
      failDeletion=true;
      assert.equal((await call(1,'/api/history/'+today,{method:'DELETE',user:first})).status,200);
      assert.equal((await call(0,photoUrl,{user:first})).status,404);
      assert.equal(objects.size,1);
      failDeletion=false;
      await new CloudStore(dbs[0],firstId,media).flushMediaGarbage();assert.equal(objects.size,0);
      assert.equal((await call(0,'/api/state',{user:first})).data.messages.length,0);
      assert.equal((await call(0,'/api/chat',{method:'POST',user:first,body})).data.deleted,true);
    });
    await t.test('six-photo message survives export/import, isolates users and deletes individual or all photos',async()=>{
      const multi={requestId:'cloud-six-photos-01',text:'刚吃了这餐，照片是不同角度',images:Array(6).fill(photo)};
      const beforeVision=visionRequests.length;outputs.push(turn('consumed',egg));
      assert.match((await call(0,'/api/chat',{method:'POST',user:first,body:multi})).data,/event: result/);
      let state=(await call(1,'/api/state',{user:first})).data;
      const urls=state.messages[0].photoUrls;assert.equal(urls.length,6);assert.equal(objects.size,6);
      assert.equal(state.meals.length,1);assert.equal(state.today.calories,150);
      assert.equal(visionRequests.length,beforeVision+1);
      assert.equal(visionRequests.at(-1).input[0].content.filter(item=>item.type==='input_image').length,6);
      assert.equal((await call(1,'/api/chat',{method:'POST',user:first,body:multi})).data.replayed,true);
      assert.equal(objects.size,6);assert.equal(visionRequests.length,beforeVision+1);
      for(const url of urls)assert.equal((await call(1,url,{user:second})).status,404);
      const backup=(await call(1,'/api/export',{user:first})).data;
      assert.deepEqual(backup.messages[0].photoUrls,Array(6).fill(photo));
      assert.equal((await call(0,urls[0],{method:'DELETE',user:first})).status,200);
      state=(await call(1,'/api/state',{user:first})).data;
      assert.deepEqual(state.messages[0].photoUrls,urls.slice(1));assert.equal(state.messages[0].photoUrl,urls[1]);
      assert.equal((await call(1,urls[0],{user:first})).status,404);
      assert.equal((await call(0,'/api/import',{method:'POST',user:second,body:{backup,mode:'records'}})).status,200);
      const restored=(await call(1,'/api/state',{user:second})).data.messages[0].photoUrls;
      assert.equal(restored.length,6);
      for(const url of restored)assert.equal((await call(1,url,{user:second})).status,200);
      for(const user of [first,second])assert.equal((await call(0,'/api/history/'+today,{method:'DELETE',user})).status,200);
      await new CloudStore(dbs[0],firstId,media).flushMediaGarbage();await new CloudStore(dbs[0],secondId,media).flushMediaGarbage();
      assert.equal(objects.size,0);
    });
    await t.test('second Blob upload failure leaves no half-turn and retry saves the complete batch',async()=>{
      const body={requestId:'cloud-batch-failure-01',text:'刚吃了两个鸡蛋',images:[photo,photo]};
      failUploadNumber=uploadCount+2;outputs.push(turn('consumed',egg));
      const response=await call(0,'/api/chat',{method:'POST',user:first,body});
      assert.match(response.data,/event: error/);failUploadNumber=0;
      const store=new CloudStore(dbs[0],firstId,media);
      assert.equal((await store.meals()).length,0);assert.equal((await store.messages()).length,0);
      assert.equal(await store.priorTurn(body.requestId),null);
      await store.flushMediaGarbage();assert.equal(objects.size,0);
      outputs.push(turn('consumed',egg));
      assert.match((await call(1,'/api/chat',{method:'POST',user:first,body})).data,/event: result/);
      assert.equal((await store.messages())[0].photoUrls.length,2);assert.equal(objects.size,2);
      assert.equal((await call(1,'/api/history/'+today,{method:'DELETE',user:first})).status,200);
      await store.flushMediaGarbage();assert.equal(objects.size,0);
    });
    await t.test('shared leases serialize users, enforce global concurrency and recover after failure',async()=>{
      let finish;block=new Promise(resolve=>{finish=resolve;});
      const before=modelCalls;
      const original=call(0,'/api/chat',{method:'POST',user:first,body:{requestId:'cloud-parallel-01',text:'晚餐吃什么？'}});
      for(let i=0;i<100&&modelCalls===before;i++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(modelCalls,before+1);
      assert.equal((await call(1,'/api/profile',{method:'PUT',user:first,body:{profile}})).status,409);
      const busy=await call(1,'/api/chat',{method:'POST',user:second,body:{requestId:'cloud-parallel-02',text:'晚餐吃什么？'}});
      assert.equal(busy.status,503);assert.equal(busy.data.code,'MODEL_BUSY');
      finish();await original;block=null;
      for(let i=0;i<100&&(await dbs[0].pool.query('SELECT * FROM boji_lease')).rowCount;i++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal((await dbs[0].pool.query('SELECT * FROM boji_lease')).rowCount,0);
      const old=await accounts[0].acquireWrite(firstId);
      await dbs[0].pool.query("UPDATE boji_lease SET expires_at=clock_timestamp()-interval '1 second' WHERE key=$1",[old.key]);
      const fresh=await accounts[1].acquireWrite(firstId);
      await assert.rejects(new CloudStore(dbs[0],firstId,media,{lease:old}).saveProfile(profile),/已过期/);
      await old();assert.equal(await accounts[0].acquireWrite(firstId),null);
      await fresh();
    });
    await t.test('rate limits and model quotas are atomic across pools',async()=>{
      const rates=await Promise.all(Array.from({length:20},(_,i)=>accounts[i%2].rateAllowed('atomic-test',5,60000)));
      assert.equal(rates.filter(Boolean).length,5);
      await dbs[0].pool.query('TRUNCATE boji_usage');
      const limits=await Promise.all(Array.from({length:20},(_,i)=>accounts[i%2].reserveModelCall(firstId,5,100)));
      assert.equal(limits.filter(Boolean).length,5);
      const global=await Promise.all(Array.from({length:20},(_,i)=>accounts[i%2].reserveModelCall(secondId,100,8)));
      assert.equal(global.filter(Boolean).length,3);
    });
    await t.test('failed import rolls back profile, records and attachments; pagination is stable',async()=>{
      const lease=await accounts[0].acquireWrite(secondId),store=new CloudStore(dbs[0],secondId,media,{lease});
      try {
        for(let i=0;i<50;i++) await store.saveMemory('已有习惯 '+i);
        const before=await store.profile();
        await assert.rejects(store.importData({format:'boji-backup-v1',profile:{...profile,age:40},messages:[{id:'rollback-photo',role:'user',text:'photo',photoUrl:photo}],memories:[{text:'不能再增加习惯'}]}),/最多保存/);
        assert.deepEqual(await store.profile(),before);assert.equal((await store.messages()).length,0);
        await store.flushMediaGarbage();assert.equal(objects.size,0);
        for(let i=1;i<=65;i++) {
          const date=new Date(Date.parse(today+'T12:00:00Z')-i*86400000).toISOString().slice(0,10);
          await store.saveManualMeal({date,type:'早餐',description:'鸡蛋',data:egg});
        }
        const a=await store.state(),b=await store.historyPage(a.historyPage.nextBefore),c=await store.historyPage(b.historyPage.nextBefore);
        assert.equal(Object.keys(a.archives).length,30);assert.equal(Object.keys(b.archives).length,30);assert.equal(Object.keys(c.archives).length,5);
        assert.equal(Object.keys(b.archives).some(date=>date in a.archives),false);assert.equal(c.historyPage.hasMore,false);
        assert.equal((await store.exportData()).meals.length,65);
      } finally {await lease();}
    });
    await t.test('maintenance requires a secret and schema migration rejects newer databases',async()=>{
      assert.equal((await call(0,'/api/maintenance')).status,401);
      const old=process.env.CRON_SECRET;process.env.CRON_SECRET='local-test-maintenance';
      try {assert.equal((await call(1,'/api/maintenance',{headers:{Authorization:'Bearer local-test-maintenance'}})).status,200);}
      finally {if(old===undefined) delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
      await dbs[0].pool.query('UPDATE boji_schema SET version=2');
      await assert.rejects(dbs[1].migrate(),/不能降级/);
      await dbs[0].pool.query('UPDATE boji_schema SET version=1');
    });
  } finally {
    for(const app of apps) await new Promise(resolve=>app.close(resolve));
    for(const db of dbs) await db.close();
    await pg.stop().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Blob SDK uses private access, and rejects disguised files or public stores',async()=>{
  const options=[];
  const media=new BlobMedia({sdk:{put:async(path,bytes,opts)=>{options.push(opts);return {pathname:path,url:'https://store.private.blob.vercel-storage.com/'+path};},get:async(path,opts)=>{options.push(opts);return {stream:new Blob(['hello']).stream()};},del:async()=>{}}});
  const decoded=decodePhoto(photo);await media.put('private.png',decoded.bytes,decoded.mime);assert.equal(options[0].access,'private');
  assert.equal((await media.get('private.png')).toString(),'hello');assert.equal(options[1].access,'private');assert.equal(options[1].useCache,false);
  assert.throws(()=>decodePhoto('data:image/png;base64,aGVsbG8='),/不匹配/);
  const publicMedia=new BlobMedia({sdk:{put:async path=>({pathname:path,url:'https://store.public.blob.vercel-storage.com/'+path})}});
  await assert.rejects(publicMedia.put('x',Buffer.from('x'),'image/png'),/私有/);
});
