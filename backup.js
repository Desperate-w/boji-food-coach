const photos=require('./photos.js');
const crypto=require('node:crypto');
const fields=['calories','protein','carbs','fat','fiber'];
const uid=()=>crypto.randomUUID();

function normalizeBackup(backup,mode,today) {
  if (!backup || !['boji-browser-v1','boji-backup-v1'].includes(backup.format) || !['all','profile','records'].includes(mode)) {
    const error=new Error('备份格式或导入范围无效。');error.status=400;throw error;
  }
  const rawMeals=Array.isArray(backup.meals)?backup.meals:[],rawMessages=Array.isArray(backup.messages)?backup.messages:[],rawMemories=Array.isArray(backup.memories)?backup.memories:[];
  if (rawMeals.length>5000 || rawMessages.length>10000 || rawMemories.length>50) {
    const error=new Error('备份记录过多，请分批导入。');error.status=413;throw error;
  }
  const safeDate=value=>{
    if (typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed=new Date(value+'T12:00:00Z');
    return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:null;
  };
  const checkedDate=value=>{
    if (value===undefined || value===null || value==='') return null;
    const date=safeDate(value);
    if (!date || date>today) throw new Error('备份日期无效或晚于今天，请核对后导入。');
    return date;
  };
  const backupDate=checkedDate(backup.activeDate)||today,legacy=backup.format==='boji-browser-v1';
  const sampleIds=new Set(['meal-breakfast','meal-lunch','meal-snack']);
  const sampleTexts=new Set(['中午吃了一份鸡腿饭，加一个蛋，米饭剩了一点。','晚上可以吃火锅吗？','可以。按今天的进度，火锅优先选牛肉、虾、鱼和蔬菜；蘸料清淡一点，主食按食欲吃就好。']);
  const meals=mode==='profile'?[]:rawMeals.filter(row=>row&&(!legacy||!sampleIds.has(row.id))).map(source=>{
    if (typeof source!=='object') throw new Error('备份中的餐食格式无效。');
    const meal={...source},date=checkedDate(source.date)||backupDate;
    if (!['早餐','午餐','晚餐','加餐'].includes(meal.type)||typeof meal.name!=='string'||!meal.name.trim()||meal.name.length>200) throw new Error('备份中的餐食名称或餐次无效。');
    for (const field of fields) if (!Number.isInteger(meal[field])||meal[field]<0||meal[field]>10000) throw new Error('备份中的营养数据无效。');
    meal.id=typeof meal.id==='string'&&/^[\w-]{1,80}$/.test(meal.id)?meal.id:uid();
    meal.input=typeof meal.input==='string'?meal.input.slice(0,4000):'';
    meal.time=typeof meal.time==='string'?meal.time.slice(0,30):'';
    meal.source=legacy?'legacy-demo':(meal.source||'restored');meal.importedDemo=legacy||Boolean(meal.importedDemo);
    if (meal.foodItems!==undefined && !Array.isArray(meal.foodItems)) throw new Error('备份中的食物项格式无效。');
    const wholeMeal=()=>[{food_name:meal.name,estimated_amount:meal.importedDemo?'旧版演示估算，未拆分':'整餐估算，未拆分',...Object.fromEntries(fields.map(field=>[field,meal[field]])),confidence:'low'}];
    meal.foodItems=Array.isArray(meal.foodItems)&&meal.foodItems.length?meal.foodItems:wholeMeal();
    if (meal.foodItems.length>20) throw new Error('备份中的一餐食物项过多。');
    const sums=Object.fromEntries(fields.map(field=>[field,0]));
    for (const item of meal.foodItems) {
      if (!item || typeof item.food_name!=='string' || !item.food_name.trim() || item.food_name.length>200
        || typeof item.estimated_amount!=='string' || !item.estimated_amount.trim() || item.estimated_amount.length>200
        || !['high','medium','low'].includes(item.confidence)) throw new Error('备份中的食物项无效。');
      for (const field of fields) {
        if (!Number.isInteger(item[field]) || item[field]<0 || item[field]>10000) throw new Error('备份中的食物项营养数据无效。');
        sums[field]+=item[field];
      }
    }
    if (fields.some(field=>sums[field]!==meal[field])) {
      if (meal.importedDemo) meal.foodItems=wholeMeal();
      else throw new Error('备份中的食物项与整餐营养数据不一致。');
    }
    return {date,meal};
  });
  const messages=mode==='profile'?[]:rawMessages.filter(row=>row&&(!legacy||!sampleTexts.has(row.text))).map(source=>{
    if (typeof source!=='object'||!['user','assistant'].includes(source.role)||typeof source.text!=='string'||source.text.length>8000) throw new Error('备份中的交流记录无效。');
    const date=checkedDate(source.date)||backupDate;
    const message={id:typeof source.id==='string'&&/^[\w-]{1,80}$/.test(source.id)?source.id:uid(),role:source.role,text:source.text,time:typeof source.time==='string'?source.time.slice(0,30):''};
    if (typeof source.reasoningText==='string') message.reasoningText=source.reasoningText.slice(0,30000);
    if (typeof source.reasoningSummary==='string') message.reasoningSummary=source.reasoningSummary.slice(0,30000);
    if (!legacy && source.live===true) message.live=true;
    if (Number.isFinite(source.elapsedSeconds) && source.elapsedSeconds>=0) message.elapsedSeconds=source.elapsedSeconds;
    if (typeof source.after==='string') message.after=source.after.slice(0,8000);
    Object.assign(message,photos.withPhotoUrls(message,photos.backupPhotoUrls(source)));
    if (source.receipt && typeof source.receipt==='object') message.receipt=source.receipt;
    if (source.revised===true) message.revised=true;
    if (source.recordDeleted===true) message.recordDeleted=true;
    message.importedDemo=legacy||Boolean(source.importedDemo);
    return {date,message};
  });
  const memories=mode==='records'?[]:rawMemories.map(row=>row?.text).filter(text=>typeof text==='string'&&text.trim().length>=2&&text.trim().length<=200);
  return {meals,messages,memories};
}
module.exports={normalizeBackup};
