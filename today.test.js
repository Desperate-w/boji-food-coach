const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function openToday(options={}) {
  const handlers={};
  const app={innerHTML:''};
  const descriptionField={value:'',focus(){}};
  const typeField={value:'早餐'};
  const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
  const storage={value:JSON.stringify({onboardingComplete:true,profile,meals:[],messages:[],view:'chat'})};
  const document={
    getElementById(id) {return id==='app'?app:id==='photo-input'?{addEventListener(){}}:id==='meal-description'?descriptionField:id==='meal-type'?typeField:null;},
    addEventListener(name,handler) {handlers[name]=handler;},
  };
  const context={
    window:{location:{protocol:options.live?'http:':'file:',search:''},addEventListener(){},scrollTo(){}},document,URLSearchParams,
    localStorage:{getItem(){return storage.value;},setItem(_key,value){storage.value=value;}},
    requestAnimationFrame(callback){callback();},setTimeout(){return 1;},clearTimeout(){},AbortController,
    setInterval(){return 1;},clearInterval(){},console,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${__dirname}/nutrition.js`,'utf8'),context);
  const saved=JSON.parse(storage.value);
  saved.profile={...profile,...context.window.BojiNutrition.calculate(profile)};
  Object.assign(saved,options.saved||{});
  storage.value=JSON.stringify(saved);
  if (options.live) {
    const serverState={profile:saved.profile,activeDate:new Date().toLocaleDateString('sv-SE'),meals:[],messages:[{role:'user',text:'测试记录'}],archives:{},memories:[],today:{calories:0,protein:0,carbs:0,fat:0,fiber:0,status:'待记录',advice:'今天还没有饮食记录。'},...(options.live.state||{})};
    context.fetch=async (url,request) => {
      if (url==='/api/auth/session') return {ok:true,json:async()=>({authenticated:true,csrf:'test-csrf'})};
      if (url==='/api/health') return {ok:true,json:async()=>({configured:true,model:'test'})};
      if (url==='/api/state') return {ok:true,json:async()=>serverState};
      if (url==='/api/chat' && options.live.turn) return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({...options.live.turn,state:serverState})};
      if ((!request?.method||request.method==='GET') && url.startsWith('/api/history?')) return {ok:true,json:async()=>options.live.historyPage};
      if ((!request?.method||request.method==='GET') && url.startsWith('/api/history/')) return {ok:true,json:async()=>({day:options.live.historyDay})};
      if (request?.method==='DELETE') return options.live.deleteResponse;
      throw new Error(`Unexpected request: ${url}`);
    };
  }
  vm.runInContext(fs.readFileSync(`${__dirname}/photos.js`,'utf8'),context);
  vm.runInContext(fs.readFileSync(`${__dirname}/app.js`,'utf8'),context);
  const click=(action,textOrData)=>handlers.click({target:{closest(){return {dataset:{action,...(typeof textOrData==='string'?{text:textOrData}:textOrData||{})}};}}});
  const proteinFill=()=>Number(app.innerHTML.match(/class="protein-fill" style="width:(\d+)%"/)?.[1]);
  const submitMeal=({type,description})=>{typeField.value=type;descriptionField.value=description;handlers.submit({target:{id:'meal-form'},preventDefault(){}});};
  return {app,click,proteinFill,storage,profile:saved.profile,submitMeal};
}

test('Today progress follows recorded and corrected meals without changing for questions', () => {
  const today=openToday();
  assert.equal(today.proteinFill(),0);
  assert.match(today.app.innerHTML,/等待第一顿记录/);

  today.click('example','刚吃了两个鸡蛋');
  assert.equal(JSON.parse(today.storage.value).meals.length,1);
  assert.equal(today.proteinFill(),Math.round(13/today.profile.proteinTarget*100));
  assert.match(today.app.innerHTML,/距建议下限/);
  today.click('nav',{view:'history'});
  assert.match(today.app.innerHTML,/鸡蛋 × 2/);
  assert.match(today.app.innerHTML,/meal-foods/);
  today.click('nav',{view:'chat'});

  today.click('example','两个鸡蛋有多少热量？');
  assert.equal(JSON.parse(today.storage.value).meals.length,1);
  assert.equal(today.proteinFill(),Math.round(13/today.profile.proteinTarget*100));

  today.click('example','其实刚才鸡蛋只吃了一半');
  assert.equal(JSON.parse(today.storage.value).meals[0].protein,11);
  assert.equal(today.proteinFill(),Math.round(11/today.profile.proteinTarget*100));
  today.click('expand-today');
  assert.match(today.app.innerHTML,/膳食纤维/);
  assert.match(today.app.innerHTML,/鸡蛋 × 2（已修正）/);
});

test('History groups food by meal and manual edits update Today nutrition', () => {
  const today=openToday();
  today.click('nav',{view:'history'});
  assert.match(today.app.innerHTML,/早餐/);
  assert.match(today.app.innerHTML,/午餐/);
  assert.match(today.app.innerHTML,/晚餐/);
  assert.match(today.app.innerHTML,/加餐/);
  today.click('meal-open',{day:'today',type:'午餐'});
  today.submitMeal({type:'午餐',description:'鸡蛋 2 个'});
  const added=JSON.parse(today.storage.value).meals[0];
  assert.equal(added.type,'午餐');
  assert.match(today.app.innerHTML,/鸡蛋 2 个/);
  assert.match(today.app.innerHTML,/碳水/);
  assert.match(today.app.innerHTML,/蛋白质进度/);

  today.click('meal-open',{day:'today',type:'午餐',meal:added.id});
  today.submitMeal({type:'晚餐',description:'牛肉面'});
  const edited=JSON.parse(today.storage.value).meals[0];
  assert.equal(edited.id,added.id);
  assert.equal(edited.type,'晚餐');
  assert.equal(edited.calories,750);
  today.click('nav',{view:'chat'});
  assert.match(today.app.innerHTML,/750<span class="stat-unit">kcal/);
});

test('History confirms meal and day deletion before updating preview nutrition', () => {
  const today=openToday();
  today.click('nav',{view:'history'});
  today.click('meal-open',{day:'today',type:'早餐'});
  today.submitMeal({type:'早餐',description:'鸡蛋 2 个'});
  const meal=JSON.parse(today.storage.value).meals[0];
  today.click('meal-delete',{day:'today',meal:meal.id});
  assert.match(today.app.innerHTML,/删除这顿餐食？/);
  assert.equal(JSON.parse(today.storage.value).meals.length,1);
  today.click('close-modal');
  assert.equal(JSON.parse(today.storage.value).meals.length,1);
  today.click('meal-delete',{day:'today',meal:meal.id});
  today.click('delete-confirm');
  assert.equal(JSON.parse(today.storage.value).meals.length,0);
  assert.match(today.app.innerHTML,/等待第一顿记录/);

  today.click('nav',{view:'chat'});
  today.click('example','刚吃了两个鸡蛋');
  today.click('history-day',{day:'today'});
  const chatMeal=JSON.parse(today.storage.value).meals[0];
  today.click('meal-delete',{day:'today',meal:chatMeal.id});
  today.click('delete-confirm');
  assert.equal(JSON.parse(today.storage.value).meals.length,0);
  assert.equal(JSON.parse(today.storage.value).messages.length>0,true);
  assert.match(today.app.innerHTML,/这顿餐食记录已删除/);
  today.click('history-delete-day',{day:'today'});
  assert.match(today.app.innerHTML,/删除当天所有记录？/);
  assert.equal(JSON.parse(today.storage.value).messages.length>0,true);
  today.click('delete-confirm');
  const saved=JSON.parse(today.storage.value);
  assert.equal(saved.meals.length,0);
  assert.equal(saved.messages.length,0);
});

test('History deletion explains when a running server lacks the deletion route', async () => {
  const today=openToday({live:{deleteResponse:{ok:false,status:404,headers:{get:()=>null}}}});
  await new Promise(resolve=>setImmediate(resolve));
  today.click('history-day',{day:'today'});
  today.click('history-delete-day',{day:'today'});
  await today.click('delete-confirm');
  assert.match(today.app.innerHTML,/本地服务尚未加载删除功能/);
  assert.match(today.app.innerHTML,/重新启动 npm start/);
  assert.match(today.app.innerHTML,/删除当天所有记录？/);
});

test('Profile shows resting, activity and maintenance energy without double counting training', () => {
  const today=openToday();
  today.click('nav',{view:'profile'});
  const p=today.profile;
  const active=Math.round(p.maintenanceMin-p.bmrMin).toLocaleString('en-US');
  assert.match(today.app.innerHTML,/静息代谢/);
  assert.match(today.app.innerHTML,/日常活动增量/);
  assert.match(today.app.innerHTML,/全天维持消耗/);
  assert.match(today.app.innerHTML,new RegExp(`<strong>${p.bmrMin.toLocaleString('en-US')}<\\/strong>`));
  assert.match(today.app.innerHTML,new RegExp(`${active}<\\/strong>`));
  assert.match(today.app.innerHTML,new RegExp(`<strong>${p.maintenanceMin.toLocaleString('en-US')}<\\/strong>`));
  assert.match(today.app.innerHTML,/不能可靠地拆出单次运动消耗/);
});

test('live History loads older dates and full conversation on demand without mislabeling backdated meals',async()=>{
  const oldDate='2026-08-01';
  const meal={id:'old-meal',name:'补记早餐',type:'早餐',calories:80,protein:6,carbs:1,fat:5,fiber:0};
  const archive={date:oldDate,meals:[meal],messages:[],messageCount:1,calories:80,protein:6,status:'待记录',summary:'历史记录'};
  const today=openToday({live:{
    state:{messages:[{role:'assistant',text:'已补记',receipt:meal,latestReceipt:meal}],historyPage:{hasMore:true,nextBefore:'2026-09-01'}},
    historyPage:{archives:{[oldDate]:archive},historyPage:{hasMore:false,nextBefore:oldDate}},
    historyDay:{...archive,messages:[{role:'assistant',live:true,text:'以前的反馈',reasoningText:'历史思考文本'}]},
  }});
  await new Promise(resolve=>setImmediate(resolve));
  await today.click('history-day',{day:'today'});
  assert.match(today.app.innerHTML,/补记早餐/);
  assert.doesNotMatch(today.app.innerHTML,/这顿餐食记录已删除/);
  today.click('history-back');
  assert.match(today.app.innerHTML,/加载更早的记录/);
  await today.click('history-more');
  assert.match(today.app.innerHTML,/1 条交流/);
  await today.click('history-day',{day:oldDate});
  assert.match(today.app.innerHTML,/以前的反馈/);
  assert.match(today.app.innerHTML,/历史思考文本/);
});


test('a recorded meal produces plain daily feedback and an expandable coach explanation', () => {
  const today=openToday();today.click('example','刚吃了两个鸡蛋');
  assert.match(today.app.innerHTML,/今天吃得怎么样/);
  assert.match(today.app.innerHTML,/今天蛋白质已完成/);
  assert.match(today.app.innerHTML,/class="record-impact/);
  assert.match(today.app.innerHTML,/<details class="coach-explanation">/);
  assert.match(today.app.innerHTML,/下一顿这样吃/);
  assert.match(today.app.innerHTML,/未记录/);
});

test('history leads with meals and collapses the original transcript without repeating receipt cards', () => {
  const today=openToday();today.click('example','刚吃了两个鸡蛋');today.click('history-day',{day:'today'});
  assert.match(today.app.innerHTML,/今天吃了什么/);
  assert.match(today.app.innerHTML,/<details class="history-conversation" >/);
  assert.match(today.app.innerHTML,/查看原始交流/);
  assert.doesNotMatch(today.app.innerHTML,/class="receipt"/);
  assert.match(today.app.innerHTML,/message-record-reference/);
  assert.match(today.app.innerHTML,/<details class="nutrition-extra">/);
});

test('history summaries retain historical targets and missing targets stay explicit', () => {
  const day='2026-08-01',meal={id:'old',type:'晚餐',name:'历史晚餐',calories:1900,protein:80,carbs:100,fat:50,fiber:5};
  const oldPlan={caloriesMin:1800,caloriesMax:2000,proteinTarget:80,carbsTarget:200,fatTarget:60};
  const make=plan=>openToday({saved:{archives:{[day]:{meals:[meal],messages:[],plan}},activeDate:new Date().toLocaleDateString('sv-SE')}});
  const old=make(oldPlan);old.click('history-day',{day});
  assert.match(old.app.innerHTML,/记录里的热量和蛋白质都接近计划/);
  assert.match(old.app.innerHTML,/建议 1,800–2,000 kcal/);
  const unknown=make(null);unknown.click('history-day',{day});
  assert.match(unknown.app.innerHTML,/无当日目标/);
  assert.doesNotMatch(unknown.app.innerHTML,/NaN|Infinity/);
});

test('backdated meal confirmation never claims the meal increased today progress',async()=>{
  const meal={id:'past-meal',name:'昨天的燕麦',type:'午餐',calories:300,protein:14,carbs:48,fat:8,fiber:5};
  const date='2026-08-01';
  const today=openToday({live:{state:{archives:{[date]:{meals:[meal],messages:[],calories:300,protein:14}}},turn:{assistantMessage:{role:'assistant',live:true,text:'已补记这一天',receipt:meal,after:'所补日期累计约 300 kcal。'}}}});
  await new Promise(resolve=>setImmediate(resolve));
  await today.click('example','昨天吃了燕麦');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(today.app.innerHTML,/对应日期的记录已更新/);
  assert.doesNotMatch(today.app.innerHTML,/class="record-impact/);
  assert.equal(today.proteinFill(),0);
});

test('visible meal feedback praises recording and correction rather than waiting for nutrition targets',()=>{
  const today=openToday();assert.doesNotMatch(today.app.innerHTML,/class="day-encouragement"/);
  today.click('example','两个鸡蛋多少热量？');assert.doesNotMatch(today.app.innerHTML,/class="day-encouragement"/);
  today.click('example','刚吃了两个鸡蛋');assert.match(today.app.innerHTML,/data-encouragement-kind="first"/);
  today.click('example','其实鸡蛋只吃了一半');assert.match(today.app.innerHTML,/data-encouragement-kind="correction"/);
});

test('today and historical day summaries recognize three meal types without claiming the whole day is complete',()=>{
  const meals=['早餐','午餐','晚餐'].map((type,i)=>({id:`meal-${i}`,type,name:type,calories:300,protein:10,carbs:40,fat:8,fiber:3}));
  const date='2026-08-01',today=openToday({saved:{meals,archives:{[date]:{meals,messages:[]}},activeDate:new Date().toLocaleDateString('sv-SE')}});
  assert.match(today.app.innerHTML,/data-encouragement-kind="three-meals"/);
  today.click('history-day',{day:date});assert.match(today.app.innerHTML,/data-encouragement-kind="three-meals"/);
  assert.doesNotMatch(today.app.innerHTML,/所有食物都已记录|全天记录完整|连续记录/);
});
