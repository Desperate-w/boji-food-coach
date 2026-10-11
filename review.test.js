const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('./store.js');
const {normalizeBackup}=require('./backup.js');
const nutrition=require('./nutrition.js');
const {validateResult,enforceRecordBoundary}=require('./server.js');
const profile={age:26,gender:'男',height:176,weight:68,goal:'维持目前状态',frequency:'0–1 次',training:'暂无固定训练',activity:'sedentary'};
const today='2026-10-11';
const food={food_name:'鸡蛋',estimated_amount:'2 个',calories:150,protein:12,carbs:1,fat:10,fiber:0,confidence:'high'};
const meal={id:'imported-egg',type:'早餐',name:'鸡蛋',calories:150,protein:12,carbs:1,fat:10,fiber:0,foodItems:[food],date:today};

test('only declared goal and activity values can produce a finite plan',()=>{
  for(const key of ['constructor','toString','__proto__'])for(const field of ['goal','activity']) {
    const invalid={...profile,[field]:key};
    assert.notEqual(nutrition.validate(invalid),'',`${field}: ${key}`);
    assert.throws(()=>nutrition.calculate(invalid));
  }
  assert.notEqual(nutrition.validate(null),'');
});

test('personal backup retains genuine messages matching old demo text and reasoning metadata',()=>{
  const message={id:'restore-thought',role:'assistant',text:'晚上可以吃火锅吗？',date:today,live:true,reasoningText:'实际思考',elapsedSeconds:12,after:'今日累计约 150 kcal。',recordDeleted:true};
  const restored=normalizeBackup({format:'boji-backup-v1',meals:[{...meal,id:'meal-breakfast'}],messages:[message]},'records',today);
  assert.equal(restored.meals.length,1);assert.equal(restored.messages.length,1);
  for(const key of ['live','reasoningText','elapsedSeconds','after','recordDeleted'])assert.deepEqual(restored.messages[0].message[key],message[key]);
  assert.equal(normalizeBackup({format:'boji-browser-v1',meals:[{...meal,id:'meal-breakfast'}],messages:[message]},'records',today).messages.length,0);
});

test('bad backup dates and malformed food items fail before any import writes',()=>{
  for(const bad of [
    {...meal,date:'2026-02-30'}, {...meal,date:'2027-01-01'},
    {...meal,foodItems:[null]}, {...meal,foodItems:[{...food,food_name:42}]},
    {...meal,foodItems:[{...food,protein:-1}]}, {...meal,foodItems:[{...food,calories:900}]}
  ])assert.throws(()=>normalizeBackup({format:'boji-backup-v1',meals:[bad]},'records',today));
});

test('SQLite personal backup preserves deleted markers and visible reasoning on restore',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boji-review-backup-')),store=new Store(path.join(dir,'test.sqlite'));
  try {
    store.saveProfile(profile);
    const message={id:'full-recovery',role:'assistant',text:'晚上可以吃火锅吗？',live:true,reasoningText:'保存的思考',elapsedSeconds:8,after:'恢复后的说明',recordDeleted:true};
    store.importData({format:'boji-backup-v1',messages:[message]},'records');
    assert.equal(store.messages().length,1);assert.equal(store.messages()[0].live,true);assert.equal(store.messages()[0].recordDeleted,true);
    assert.equal(store.messages()[0].after,message.after);
  } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('hypothetical corrections and negated consumption never write a meal even if the model misclassifies them',()=>{
  const correction=()=>({action:'correction',reply:'已处理',target_meal_id:meal.id,meal:{...meal,food_items:[food]}});
  const cases=['如果鸡蛋只吃一半，会少多少热量？','如果我吃了一个鸡蛋，会少多少热量？','假设我喝了半瓶牛奶呢？','我想把鸡蛋改成一个，先不要修改记录','鸡蛋还没吃完，问问这份多少热量？'];
  for(const text of cases)assert.equal(enforceRecordBoundary(correction(),text,false,meal.id,null,[meal]).meal,null,text);
  const eaten={action:'consumed',reply:'已处理',meal:{...meal,food_items:[food]}};
  assert.equal(enforceRecordBoundary(eaten,'鸡蛋还没吃完，问问这份多少热量？',true,null,null,[]).meal,null);
  assert.equal(enforceRecordBoundary(correction(),'鸡蛋其实只吃了一个，请修改记录',false,meal.id,null,[meal]).action,'correction');
});

test('model aggregate bounds are checked after food-item totals are applied',()=>{
  const items=Array.from({length:3},()=>({...food,calories:50,protein:5000}));
  assert.throws(()=>validateResult({action:'consumed',reply:'已处理',meal:{...meal,calorie_min:null,calorie_max:null,food_items:items}}));
  assert.throws(()=>validateResult({action:'consumed',reply:'已处理',meal:{...meal,calorie_min:100,calorie_max:1000000000,food_items:[food]}}));
});

test('old demo totals stay authoritative when stale food-item estimates are migrated and re-exported',()=>{
  const old={...meal,calories:75,protein:6,carbs:1,fat:5};
  const migrated=normalizeBackup({format:'boji-browser-v1',meals:[old]},'records',today).meals[0].meal;
  assert.equal(migrated.foodItems[0].calories,75);assert.equal(migrated.importedDemo,true);
  const restored=normalizeBackup({format:'boji-backup-v1',meals:[migrated]},'records',today).meals[0].meal;
  assert.equal(restored.calories,75);assert.equal(restored.foodItems[0].protein,6);
  // Existing personal exports made before this migration can also be recovered.
  assert.equal(normalizeBackup({format:'boji-backup-v1',meals:[{...old,importedDemo:true}]},'records',today).meals[0].meal.foodItems[0].calories,75);
});
