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
    if (!meals.length) return {encouragement:'',encouragementDetail:'',encouragementContext:'',encouragementKind:'none'};
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
    const contexts={first:'一餐已记录','three-meals':'三餐都有记录','honest-record':'如实记录','on-plan':'接近计划','keep-recording':'又记下一餐',correction:'记录已修正',backfill:'补记已完成'};
    const messages={
      first:[
        ['走过的每一步都算数。','这一餐已记录。你把照顾自己的想法，变成了行动。'],
        ['从这一餐，掌握自己的节奏。','记录已经留下，接下来一餐一餐来。这一步，做得漂亮。'],
        ['给自己一个开始，就从这一餐。','你认真记下了吃过什么。为自己的这份行动，鼓一次掌。'],
      ],
      'three-meals':[
        ['走过的每一步都算数。',`${day}的三餐都有记录了。为自己花的这份心思，值得认真庆祝。`],
        ['三餐记下，这份认真很有分量。','早餐、午餐和晚餐都留下了记录。为这份实实在在的行动，鼓掌。'],
        ['三餐都记下，为自己鼓一次掌。',`${day}你把认真落在了每一餐里。这份投入，值得骄傲。`],
      ],
      'honest-record':[
        ['一顿的波动，带不走你的主动权。','你如实记下了吃过什么，这份坦诚值得肯定。接下来正常吃饭，按自己的节奏来。'],
        ['把真实记下来，继续走自己的路。',`${day}的数字高于建议，也不抹去记录的价值。如实面对这一步，做得好。`],
        ['敢看真实，也是一种力量。','你愿意留下真实的饮食记录。给这份认真一句肯定，下一顿照常安排。'],
      ],
      'on-plan':[
        ['这一次，你把计划落在了行动里。','记录中的热量和蛋白质都接近计划。为自己做出的这些选择，值得骄傲。'],
        ['把目标落到每一餐，做得漂亮。',`${day}的记录接近计划。认真吃饭、好好照顾自己，这份投入值得被看见。`],
        ['认真做出的选择，值得你骄傲。','热量和蛋白质接近计划了。给自己一个肯定，接下来按食欲正常吃。'],
      ],
      'keep-recording':[
        ['一餐一餐来，自己的节奏自己掌握。','又记下一餐，你更清楚自己吃过什么了。为这份行动，加把劲。'],
        ['把认真，留在每一餐里。','吃过的食物又多了一份清楚的记录。你愿意为自己花心思，这就值得肯定。'],
        ['记录在继续，主动权在你手里。','这一餐也记好了。一步一步了解自己的饮食，做得漂亮。'],
      ],
      correction:[
        ['敢调整，就是在认真向前。','这一餐已按实际份量更新。愿意回来核对，这一步做得漂亮。'],
        ['把真实记清楚，这一步很有分量。','记录已经修正。你认真对待自己的实际情况，这份用心值得骄傲。'],
        ['认真核对的人，自带向前的力量。','这顿按你的说明改好了。为愿意核对、主动调整的自己，鼓一次掌。'],
      ],
      backfill:[
        ['回来补上，这一步也算数。','之前吃过的这顿已经补记。愿意回头把记录补清楚，做得漂亮。'],
        ['补上一餐，也是在为自己加把劲。','这顿已经记到对应日期。你为自己多花的这份心思，值得被看见。'],
        ['现在补上，也值得为自己鼓掌。','这份之前的饮食记录已留下。照顾自己的行动，可以从此刻继续。'],
      ],
    };
    // Stable across rerenders; dates and newly confirmed records add gentle variety.
    let hash=0;
    for (const char of `${date}|${kind}|${meals.length}|${moment}`) hash=(hash*31+char.charCodeAt(0))>>>0;
    const variants=messages[kind];
    const [encouragement,encouragementDetail]=variants[hash%variants.length];
    return {encouragement,encouragementDetail,encouragementContext:contexts[kind],encouragementKind:kind};
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
