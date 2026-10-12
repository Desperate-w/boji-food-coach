const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context={window:{}};
vm.runInNewContext(fs.readFileSync(`${__dirname}/nutrition.js`, 'utf8'),context);
const {calculate}=context.window.BojiNutrition;

const person={gender:'男',age:26,height:176,weight:68,goal:'减一点脂，让线条更明显',activity:'moderate',frequency:'每周 2–3 次',training:'力量训练'};

test('uses actual body data, activity, and goal to derive the visible plan', () => {
  const plan=calculate(person);
  assert.equal(plan.bmrMin,1655);
  assert.equal(plan.maintenanceMin,2565);
  assert.equal(plan.caloriesMin,2275);
  assert.equal(plan.caloriesMax,2475);
  assert.equal(plan.proteinTarget,120);
  assert.ok(Math.abs((plan.proteinTarget+plan.carbsTarget)*4+plan.fatTarget*9-2375)<30);
  const updated=calculate({...person,weight:70});
  assert.equal(updated.bmrMin,1675);
  assert.equal(updated.caloriesMin,2300);
  assert.equal(updated.proteinTarget,125);
});

test('shows a range when the sex parameter is not specified', () => {
  const female=calculate({...person,gender:'女'});
  const male=calculate(person);
  const unspecified=calculate({...person,gender:'其他'});
  assert.equal(unspecified.bmrMin,female.bmrMin);
  assert.equal(unspecified.bmrMax,male.bmrMax);
  assert.ok(unspecified.caloriesMin<=female.caloriesMin);
  assert.ok(unspecified.caloriesMax>=male.caloriesMax);
});

test('rejects nonadult and implausibly low general plans', () => {
  assert.throws(()=>calculate({...person,age:17}),/18–100/);
  assert.throws(()=>calculate({...person,activity:''}),/活动程度/);
  assert.throws(()=>calculate({...person,gender:'女',age:90,height:120,weight:30,activity:'sedentary'}),/过低/);
});


test('daily feedback explains an unfinished log without treating it as a full-day deficit', () => {
  const {describeDay}=context.window.BojiNutrition,plan=calculate(person);
  const day=describeDay({totals:{calories:300,protein:14},plan,meals:[{type:'午餐'}]});
  assert.match(day.headline,/还有正餐空间/);
  assert.match(day.next,/鱼、鸡肉或豆腐/);
  assert.doesNotMatch(day.headline,/偏低|吃得太少|不达标/);
  assert.equal(day.proteinGap,106);
  assert.equal(day.proteinPercent,12);
  assert.match(day.note,/仅按已记录/);
});

test('daily feedback distinguishes target range, protein progress and excess calories', () => {
  const {describeDay}=context.window.BojiNutrition,plan=calculate(person),meals=[{type:'午餐'}];
  const reached=describeDay({totals:{calories:2300,protein:120},plan,meals});
  assert.equal(reached.tone,'positive');assert.equal(reached.proteinPercent,100);
  assert.match(reached.headline,/热量合适/);
  assert.equal(describeDay({totals:{calories:2300,protein:60},plan,meals}).tone,'neutral');
  const over=describeDay({totals:{calories:3000,protein:300},plan,meals});
  assert.equal(over.tone,'attention');assert.equal(over.proteinGap,0);assert.equal(over.proteinPercent,100);
  assert.match(over.next,/不必跳餐/);
});

test("history feedback uses that day's plan and never invents a missing target", () => {
  const {describeDay}=context.window.BojiNutrition,meals=[{type:'晚餐'}];
  const previous=describeDay({totals:{calories:1900,protein:90},plan:{caloriesMin:1800,caloriesMax:2000,proteinTarget:90},meals,isToday:false});
  assert.equal(previous.tone,'positive');assert.match(previous.headline,/记录里/);
  assert.doesNotMatch(previous.next,/下一顿/);
  const unknown=describeDay({totals:{calories:1900,protein:90},meals,isToday:false});
  assert.equal(unknown.hasPlan,false);assert.equal(unknown.badge,'无当日目标');
  assert.equal(describeDay({plan:{caloriesMin:0,caloriesMax:2000,proteinTarget:0},meals}).hasPlan,false);
  assert.equal(describeDay({plan:calculate(person),meals:[]}).badge,'待记录');
});
