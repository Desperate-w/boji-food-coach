const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const nutrition=require('./nutrition.js');
const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const snapshot=(calories=0)=>({profile:{...profile,...nutrition.calculate(profile)},activeDate:'2026-10-01',meals:calories?[{id:'meal-1',name:'鸡蛋',type:'早餐',calories,protein:12,carbs:1,fat:10,fiber:0}]:[],messages:[],archives:{},memories:[],today:{calories,protein:calories?12:0,carbs:1,fat:10,fiber:0,status:'待记录',advice:'测试建议'}});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function openApp() {
  const handlers={},listeners={},app={innerHTML:''},input={id:'message-input',value:'',focus(){}},sent=[];
  const control={state:snapshot(),csrf:'session-a',reloads:0,stateRead:null,send:null};
  const fileInput={addEventListener(){}};
  const document={getElementById(id){return id==='app'?app:id==='message-input'?input:id==='photo-input'?fileInput:null;},addEventListener(name,fn){handlers[name]=fn;},querySelector(){return null;}};
  const Recognition=class {constructor(){control.recognition=this;}start(){this.onstart?.();}abort(){}};
  const context={window:{SpeechRecognition:Recognition,location:{protocol:'https:',search:'',replace(){},reload(){control.reloads++;}},addEventListener(name,fn){listeners[name]=fn;},scrollTo(){}},document,URLSearchParams,AbortController,
    localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame(fn){fn();},setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},console,
    fetch:async(url,options={})=>{
      if(url==='/api/auth/session')return json({csrf:control.csrf});
      if(url==='/api/health')return json({model:'test',configured:true});
      if(url==='/api/state')return control.stateRead?control.stateRead():json(control.state);
      if(url==='/api/chat'){const body=JSON.parse(options.body);sent.push(body);return control.send(body);}
      return json({error:'未找到'},404);
    }};
  vm.createContext(context);
  for(const file of ['nutrition.js','photos.js','app.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context);
  return {app,sent,control,focus:()=>listeners.focus(),
    edit:(id,value)=>handlers.input({target:{id,value}}),
    click:(action,data={})=>handlers.click({target:{closest(){return {dataset:{action,...data}};}}}),
    send:text=>{input.value=text;handlers.submit({target:{id:'chat-form'},preventDefault(){}});}};
}
const completed=state=>json({state,assistantMessage:{id:'answer-1',role:'assistant',text:'账号 A 的私人反馈',live:true}});

test('a delayed refresh cannot overwrite a newer completed meal',async()=>{
  const ui=openApp();await settle();
  const old=deferred();ui.control.stateRead=()=>old.promise;ui.focus();await settle();
  ui.control.send=()=>completed(snapshot(150));ui.send('刚吃了两个鸡蛋');await settle();
  assert.ok(/热量 150 千卡/.test(ui.app.innerHTML),'recorded calories remain visible');
  old.resolve(json(snapshot()));await settle();
  assert.ok(/热量 150 千卡/.test(ui.app.innerHTML),'recorded calories remain visible');
});

test('background refresh preserves an unfinished profile edit',async()=>{
  const ui=openApp();await settle();await ui.click('onboarding');ui.edit('ob-age','42');
  ui.focus();await settle();assert.ok(/id="ob-age"[^>]+value="42"/.test(ui.app.innerHTML),'age draft is preserved');
});

test('switching accounts in another tab clears old feedback and drafts before reload',async()=>{
  const ui=openApp();await settle();ui.control.send=()=>completed(snapshot(150));ui.send('刚吃了两个鸡蛋');await settle();
  ui.edit('message-input','账号 A 的私人草稿');ui.control.csrf='session-b';ui.focus();await settle();
  assert.equal(ui.control.reloads,1);assert.doesNotMatch(ui.app.innerHTML,/账号 A 的私人/);
});

test('normal send after an ambiguous failure reuses the same request; changed retry uses a new one',async()=>{
  const ui=openApp();await settle();let fail=true;
  ui.control.send=()=>{if(fail)throw new Error('连接断开');return completed(snapshot(150));};
  ui.send('刚吃了两个鸡蛋');await settle();assert.match(ui.app.innerHTML,/连接断开/);
  fail=false;ui.send('刚吃了两个鸡蛋');await settle();assert.equal(ui.sent[1].requestId,ui.sent[0].requestId);
  fail=true;ui.send('刚吃了一碗饭');await settle();ui.edit('message-input','刚吃了半碗饭');
  await ui.click('retry-live');await settle();assert.notEqual(ui.sent[3].requestId,ui.sent[2].requestId);
  assert.equal(ui.sent[3].text,'刚吃了半碗饭');
  const voice=openApp();await settle();voice.control.send=()=>{throw new Error('语音发送断线');};
  await voice.click('voice-demo');
  const result=[{transcript:'刚喝了一杯牛奶'}];result.isFinal=true;
  voice.control.recognition.onresult({results:[result]});voice.control.recognition.onend();await settle();
  assert.equal(voice.sent[0].source,'voice');
  voice.control.send=()=>completed(snapshot(150));voice.send('刚喝了一杯牛奶');await settle();
  assert.equal(voice.sent[1].source,'voice');assert.equal(voice.sent[1].requestId,voice.sent[0].requestId);
});

test('the today label follows the account date rather than the device timezone',async()=>{
  const ui=openApp();await settle();assert.ok(/topbar-date">10月1日星期四/.test(ui.app.innerHTML),'date uses the account day');
});
