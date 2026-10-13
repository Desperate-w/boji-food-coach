/* Frontend estimate for the prototype. It is not a measured metabolic rate. */
(() => {
  const ACTIVITY = Object.freeze({
    sedentary: {label:'以久坐为主', factor:1.2, detail:'日常活动较少，运动也较少'},
    light: {label:'轻度活动', factor:1.375, detail:'有走动，或每周少量运动'},
    moderate: {label:'中等活动', factor:1.55, detail:'经常走动，或规律训练'},
    high: {label:'高活动量', factor:1.725, detail:'体力活动较多，或高频训练'},
  });
  const GOALS = Object.freeze({
    '减一点脂，让线条更明显': {offset:-200, protein:1.8, strategy:'轻度减脂 · 保持肌肉', explanation:'从维持消耗中温和减去约 200 kcal，观察训练表现和体重趋势。'},
    '保持体型，增加一点肌肉': {offset:100, protein:1.6, strategy:'维持体型 · 增加肌肉', explanation:'在维持消耗附近小幅增加摄入，优先保证训练和蛋白质。'},
    '现在偏瘦，想增加肌肉感': {offset:200, protein:1.6, strategy:'温和增肌 · 保持线条', explanation:'在维持消耗上温和增加约 200 kcal，留意体重变化。'},
    '维持目前状态': {offset:0, protein:1.4, strategy:'稳定维持 · 保持状态', explanation:'先以估算的维持消耗为参考，结合实际变化再调整。'},
  });
  const round = (value, step=1) => Math.round(value/step)*step;

  function validate(input) {
    if (!input || typeof input!=='object' || Array.isArray(input)) return '身体资料格式无效。';
    const age=Number(input.age), height=Number(input.height), weight=Number(input.weight);
    if (!Number.isInteger(age) || age<18 || age>100) return '年龄请填写 18–100 岁；当前估算仅适用于成年人。';
    if (!Number.isFinite(height) || height<120 || height>230) return '身高请填写 120–230 cm。';
    if (!Number.isFinite(weight) || weight<30 || weight>250) return '体重请填写 30–250 kg。';
    if (!['男','女','其他'].includes(input.gender)) return '请选择计算所用的性别参数。';
    if (typeof input.goal!=='string' || !Object.hasOwn(GOALS,input.goal)) return '请选择当前目标。';
    if (typeof input.activity!=='string' || !Object.hasOwn(ACTIVITY,input.activity)) return '请选择日常活动程度。';
    if (!['0–1 次','每周 2–3 次','每周 4–5 次','每周 6+ 次'].includes(input.frequency)) return '请选择每周训练频率。';
    if (!['力量训练','跑步 / 有氧','综合训练','暂无固定训练'].includes(input.training)) return '请选择主要训练类型。';
    return '';
  }

  function calculate(input) {
    const error=validate(input);
    if (error) throw new Error(error);
    const age=Number(input.age), height=Number(input.height), weight=Number(input.weight);
    const base=10*weight+6.25*height-5*age;
    const female=base-161, male=base+5;
    const bmrLow=input.gender==='男'?male:female;
    const bmrHigh=input.gender==='女'?female:male;
    const factor=ACTIVITY[input.activity].factor;
    const maintenanceLow=bmrLow*factor, maintenanceHigh=bmrHigh*factor;
    const goal=GOALS[input.goal];
    const targetLow=Math.max(bmrLow,maintenanceLow+goal.offset-100);
    const targetHigh=Math.max(targetLow+100,maintenanceHigh+goal.offset+100);
    if (targetLow<1200) throw new Error('按当前资料计算出的建议热量过低。请核对信息；通用计划不适合这种情况。');
    const caloriesMin=round(targetLow,25), caloriesMax=round(targetHigh,25);
    const proteinTarget=round(Math.min(weight*goal.protein,200),5);
    const midpoint=(caloriesMin+caloriesMax)/2;
    const fatTarget=round(midpoint*.3/9,5);
    const carbsTarget=round(Math.max(0,(midpoint-proteinTarget*4-fatTarget*9)/4),5);
    return {
      bmrMin:round(bmrLow), bmrMax:round(bmrHigh),
      maintenanceMin:round(maintenanceLow), maintenanceMax:round(maintenanceHigh),
      caloriesMin, caloriesMax, proteinTarget, fatTarget, carbsTarget,
      strategy:goal.strategy, explanation:goal.explanation,
      activityLabel:ACTIVITY[input.activity].label, activityFactor:factor,
      isRange:input.gender==='其他',
    };
  }

  function dayEncouragement({meals,plan,calories,protein,isToday,date,moment}) {
    if (!meals.length) return {encouragement:'',encouragementKind:'none'};
    const day=isToday?'今天':'这一天';
    const types=new Set(meals.map(meal=>meal.type));
    const threeMeals=['早餐','午餐','晚餐'].every(type=>types.has(type));
    let kind;
    if (moment==='correction') kind='correction';
    else if (moment==='backfill') kind='backfill';
    else if (threeMeals) kind='three-meals';
    else if (meals.length===1) kind='first';
    else if (plan && calories>plan.caloriesMax) kind='honest-record';
    else if (plan && calories>=plan.caloriesMin && protein>=plan.proteinTarget-8) kind='on-plan';
    else kind='keep-recording';
    const messages={
      first:[
        '这一餐记下来了，照顾自己有了一个小小的起点。做得不错。',
        '这一餐的记录已经留下了，给愿意花这份心思的自己一点肯定。',
        '记下一餐，就是认真照顾自己的一个小动作。慢慢来就很好。',
      ],
      'three-meals':[
        `${day}的三餐都有记录了，这份认真，值得你给自己一点肯定。`,
        '早餐、午餐和晚餐都留下记录了。能为自己花这份心思，做得不错。',
        `${day}你认真记下了三餐，对自己的这份用心也值得被看见。`,
      ],
      'honest-record':[
        '愿意如实记下吃过的食物，这份认真值得肯定。按自己的节奏慢慢调整。',
        `${day}的数字有些波动，也不影响这份记录的价值。愿意记下来，做得不错。`,
        '把真实吃过的食物记下来，就多了一份了解自己的依据。给这份认真一点肯定。',
      ],
      'on-plan':[
        '这份贴近计划的记录，是认真照顾自己的小小成果。给自己一点肯定。',
        '这些小小的选择，让记录更贴近你的计划了。做得不错，继续按自己的节奏来。',
        '你为自己做的这些小选择，值得一句“做得不错”。轻松一点，慢慢来。',
      ],
      'keep-recording':[
        '愿意把吃过的食物认真记下来，已经是在好好照顾自己。按自己的节奏就好。',
        '一餐一餐留下记录，你对自己吃过什么也更清楚了。慢慢调整就很好。',
        '又为自己的饮食留下一点清楚的记录了。这份用心，值得被肯定。',
      ],
      correction:[
        '你愿意核对实际份量，这份认真值得肯定。按真实情况记录就很好。',
        '这顿已经按你的说明改好了，愿意认真核对，也是在照顾自己。',
        '谢谢你把实际吃过的份量说清楚。愿意调整记录，这件事本身就做得不错。',
      ],
      backfill:[
        '这顿补记好了，愿意回来补上，也是认真照顾自己的一个小动作。',
        '又补上了一份真实的饮食记录，给这份用心一点肯定。',
        '愿意把之前吃过的食物补记下来，也值得一句“做得不错”。',
      ],
    };
    // Stable across rerenders; dates and newly confirmed records add gentle variety.
    let hash=0;
    for (const char of `${date}|${kind}|${meals.length}|${moment}`) hash=(hash*31+char.charCodeAt(0))>>>0;
    const variants=messages[kind];
    return {encouragement:variants[hash%variants.length],encouragementKind:kind};
  }

  // Explain confirmed totals, without treating an unfinished food log as a full day.
  function describeDay({totals={},plan,meals=[],isToday=true,date='',moment='day'}={}) {
    const calories=Math.max(0,Number(totals.calories)||0),protein=Math.max(0,Number(totals.protein)||0);
    const hasPlan=Boolean(plan && Number.isFinite(plan.caloriesMin) && plan.caloriesMin>0 &&
      Number.isFinite(plan.caloriesMax) && plan.caloriesMax>=plan.caloriesMin && Number.isFinite(plan.proteinTarget) && plan.proteinTarget>0);
    const note=isToday?'仅按已记录的食物估算，漏记的可以随时补上。':'只根据已记录食物汇总，漏记会影响这一天的结果。';
    const base={hasPlan,note,tone:'neutral',badge:isToday?'正在记录':'记录反馈',proteinGap:0,proteinPercent:0,
      ...dayEncouragement({meals,plan:hasPlan?plan:null,calories,protein,isToday,date,moment})};
    if (!meals.length) return {...base,badge:'待记录',headline:isToday?'从第一顿开始，看懂今天怎么吃。':'这一天还没有餐食记录。',calorieLabel:'等待第一顿记录',proteinLabel:'等待第一顿记录',next:'吃过的食物都可以补记，记录后这里会更新。'};
    if (!hasPlan) return {...base,badge:'无当日目标',headline:`这一天记下了 ${meals.length} 笔餐食。`,calorieLabel:'已记录的热量',proteinLabel:'已记录的蛋白质',next:'没有保存这一天的目标，先查看或补齐吃过的食物。'};
    const proteinGap=Math.max(0,plan.proteinTarget-protein),proteinPercent=Math.min(100,Math.max(0,Math.round(protein/plan.proteinTarget*100)));
    const enough=proteinGap<=8,over=calories>plan.caloriesMax,inRange=calories>=plan.caloriesMin&&!over;
    const calorieLabel=over?'热量已高于建议':inRange?'热量在建议范围内':isToday?'热量还有正餐空间':'记录热量低于建议';
    const proteinLabel=enough?(proteinGap===0?'蛋白质已达到目标':'蛋白质基本够了'):'蛋白质还可以补一补';
    let headline,next,tone='neutral',badge=isToday?'继续记录':'记录反馈';
    if (over) {
      headline=isToday?'热量已高于建议，接下来正常吃。':'记录热量高于当天建议。';
      next=isToday?'下一顿按食欲正常吃，不必跳餐或刻意补偿。':'先核对份量和漏记；一天的波动不用刻意补偿。';
      tone='attention';badge='留意热量';
    } else if (inRange && enough) {
      headline=isToday?'热量合适，蛋白质也基本够了。':'记录里的热量和蛋白质都接近计划。';
      next=isToday?'接下来按食欲正常吃，吃过后继续记下来。':'可以回看这一天的搭配，作为以后安排饮食的参考。';
      tone='positive';badge='接近计划';
    } else if (inRange) {
      headline=isToday?'热量在范围内，蛋白质再补一点。':'热量在范围内，蛋白质还没达到目标。';
      next=isToday?'下一顿优先鱼、鸡肉或豆腐，按食欲搭配主食和蔬菜。':'检查是否漏记蛋白质食物；以后正餐可以加一份鱼、鸡肉或豆腐。';
    } else if (enough) {
      headline=isToday?'蛋白质基本够了，热量还有空间。':'蛋白质基本够了，记录热量低于建议。';
      next=isToday?'下一顿正常搭配主食和蔬菜，不用为了数字刻意吃满。':'如果有漏记先补上，之后按食欲安排正常的正餐。';
    } else {
      headline=isToday?'今天还有正餐空间，下一顿加份蛋白质。':'记录里的热量和蛋白质都低于目标。';
      next=isToday?'鱼、鸡肉或豆腐选一份，配上主食和蔬菜，按食欲吃。':'如果还有没记的餐食，先补齐，再看这一天的结果。';
    }
    return {...base,headline,next,tone,badge,calorieLabel,proteinLabel,proteinGap,proteinPercent};
  }

  const api={calculate,validate,describeDay,ACTIVITY,GOALS};
  if (typeof window!=='undefined') window.BojiNutrition=api;
  if (typeof module!=='undefined') module.exports=api;
})();
