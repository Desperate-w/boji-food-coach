const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const photos=require('./photos.js');
const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64');

function openComposer({live=false,oversized=false}={}) {
  const handlers={},app={innerHTML:''},photoInput={value:'',addEventListener(name,fn){handlers['photo-'+name]=fn;}},input={value:'',focus(){}};
  const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
  const storage={value:''},sent=[];
  let reads=0,encodes=0;
  const document={getElementById(id){return id==='app'?app:id==='photo-input'?photoInput:id==='message-input'?input:null;},
    addEventListener(name,fn){handlers[name]=fn;},createElement(){return {getContext(){return {fillRect(){},drawImage(){}};},toDataURL(){encodes++;return oversized&&encodes===1?'data:image/jpeg;base64,'+Buffer.alloc(600_000).toString('base64'):image;}};}};
  const context={window:{location:{protocol:live?'http:':'file:',search:''},addEventListener(){},scrollTo(){}},document,URLSearchParams,AbortController,
    localStorage:{getItem(){return storage.value;},setItem(_key,value){storage.value=value;}},
    requestAnimationFrame(fn){fn();},setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},console,
    FileReader:class {readAsDataURL(file){reads++;this.result=file.name;if(file.fail)this.onerror();else this.onload();}},
    Image:class {constructor(){this.width=2400;this.height=1600;}set src(_url){this.onload();}},
    fetch:async(url,options)=>{
      if(url==='/api/auth/session')return {ok:true,json:async()=>({csrf:'test'})};
      if(url==='/api/health')return {ok:true,json:async()=>({model:'test',configured:true})};
      if(url==='/api/state')return {ok:true,json:async()=>({profile,activeDate:new Date().toLocaleDateString('sv-SE'),meals:[],messages:[],archives:{},memories:[]})};
      if(url==='/api/chat'){sent.push(JSON.parse(options.body));return {ok:false,json:async()=>({error:'测试断线'})};}
      return {ok:false,json:async()=>({})};
    }};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname+'/nutrition.js','utf8'),context);
  storage.value=JSON.stringify({onboardingComplete:true,profile:{...profile,...context.window.BojiNutrition.calculate(profile)},meals:[],messages:[]});
  for(const file of ['photos.js','app.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
  return {app,sent,storage,reads:()=>reads,encodes:()=>encodes,
    select:files=>handlers['photo-change']({target:{files}}),
    click:(action,index)=>handlers.click({target:{closest(){return {dataset:{action,...(typeof index==='object'?index:{index})}};}}}),
    send:text=>{input.value=text;handlers.submit({target:{id:'chat-form'},preventDefault(){}});}};
}
const file=name=>({name,type:'image/jpeg',size:1234});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test('composer appends multiple images, removes one, and preserves order in history',async()=>{
  const ui=openComposer({oversized:true});
  await ui.select([file('a.jpg'),file('b.jpg')]);
  assert.match(ui.app.innerHTML,/2 \/ 6 张照片/);assert.equal(ui.encodes(),3);
  await ui.select([file('c.jpg')]);
  ui.click('remove-photo','1');
  assert.match(ui.app.innerHTML,/待发送照片 2：c.jpg/);assert.doesNotMatch(ui.app.innerHTML,/b.jpg/);
  ui.send('刚吃了照片里的饭');
  const message=JSON.parse(ui.storage.value).messages.find(row=>row.role==='user');
  assert.equal(message.photoUrls.length,2);assert.equal(message.photoUrl,message.photoUrls[0]);
  ui.click('history-day',{day:'today'});
  // The history gallery renders every photo, including two identical image files.
  assert.equal((ui.app.innerHTML.match(/class="user-photo"/g)||[]).length,2);
});

test('selection limit and an unreadable batch preserve existing attachments and text',async()=>{
  const ui=openComposer();await ui.select([file('kept.jpg')]);
  await ui.select(Array.from({length:6},(_,i)=>file(i+'.jpg')));
  assert.equal(ui.reads(),1);assert.match(ui.app.innerHTML,/1 \/ 6 张照片/);
  await ui.select([file('new.jpg'),{...file('bad.jpg'),fail:true}]);
  assert.match(ui.app.innerHTML,/待发送照片 1：kept.jpg/);assert.doesNotMatch(ui.app.innerHTML,/待发送照片 2/);
});

test('live multi-image request and all attachments survive a failed send and retry',async()=>{
  const ui=openComposer({live:true});await settle();
  await ui.select([file('a.jpg'),file('b.jpg')]);ui.send('这两张是同一餐');await settle();
  assert.equal(ui.sent.length,1);assert.equal(ui.sent[0].images.length,2);assert.equal(ui.sent[0].image,undefined);
  assert.match(ui.app.innerHTML,/2 \/ 6 张照片/);assert.match(ui.app.innerHTML,/这两张是同一餐/);
  ui.click('retry-live');await settle();
  assert.equal(ui.sent[1].requestId,ui.sent[0].requestId);assert.deepEqual(ui.sent[1].images,ui.sent[0].images);
});

test('image bounds reject seven images, oversized batches and malformed base64; legacy URLs still work',()=>{
  assert.deepEqual(photos.photoUrls({photoUrl:'/api/media/legacy'}),['/api/media/legacy']);
  assert.throws(()=>photos.validateImages(Array(7).fill(image)),/最多/);
  const big='data:image/jpeg;base64,'+Buffer.alloc(1_000_000).toString('base64');
  assert.throws(()=>photos.validateImages([big,big,big]),/总大小/);
  assert.throws(()=>photos.validateImages(['data:image/png;base64,====']),/格式/);
});
