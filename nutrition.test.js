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
