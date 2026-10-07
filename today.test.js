const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function openToday() {
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
    window:{location:{protocol:'file:',search:''},addEventListener(){},scrollTo(){}},document,URLSearchParams,
    localStorage:{getItem(){return storage.value;},setItem(_key,value){storage.value=value;}},
    requestAnimationFrame(callback){callback();},setTimeout(){return 1;},clearTimeout(){},
    setInterval(){return 1;},clearInterval(){},console,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${__dirname}/nutrition.js`,'utf8'),context);
  const saved=JSON.parse(storage.value);
  saved.profile={...profile,...context.window.BojiNutrition.calculate(profile)};
  storage.value=JSON.stringify(saved);
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
