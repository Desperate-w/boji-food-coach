const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function openToday() {
  const handlers={};
  const app={innerHTML:''};
  const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
  const storage={value:JSON.stringify({onboardingComplete:true,profile,meals:[],messages:[],view:'chat'})};
  const document={
    getElementById(id) {return id==='app'?app:id==='photo-input'?{addEventListener(){}}:null;},
    addEventListener(name,handler) {handlers[name]=handler;},
  };
  const context={
    window:{location:{protocol:'file:',search:''},addEventListener(){}},document,URLSearchParams,
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
  const click=(action,text)=>handlers.click({target:{closest(){return {dataset:{action,text}};}}});
  const proteinFill=()=>Number(app.innerHTML.match(/class="protein-fill" style="width:(\d+)%"/)?.[1]);
  return {app,click,proteinFill,storage,profile:saved.profile};
}

test('Today progress follows recorded and corrected meals without changing for questions', () => {
  const today=openToday();
  assert.equal(today.proteinFill(),0);
  assert.match(today.app.innerHTML,/等待第一顿记录/);

  today.click('example','刚吃了两个鸡蛋');
  assert.equal(JSON.parse(today.storage.value).meals.length,1);
  assert.equal(today.proteinFill(),Math.round(13/today.profile.proteinTarget*100));
  assert.match(today.app.innerHTML,/距建议下限/);

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
