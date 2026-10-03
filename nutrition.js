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
    const age=Number(input.age), height=Number(input.height), weight=Number(input.weight);
    if (!Number.isInteger(age) || age<18 || age>100) return '年龄请填写 18–100 岁；当前估算仅适用于成年人。';
    if (!Number.isFinite(height) || height<120 || height>230) return '身高请填写 120–230 cm。';
    if (!Number.isFinite(weight) || weight<30 || weight>250) return '体重请填写 30–250 kg。';
    if (!['男','女','其他'].includes(input.gender)) return '请选择计算所用的性别参数。';
    if (!GOALS[input.goal]) return '请选择当前目标。';
    if (!ACTIVITY[input.activity]) return '请选择日常活动程度。';
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

  const api={calculate,validate,ACTIVITY,GOALS};
  if (typeof window!=='undefined') window.BojiNutrition=api;
  if (typeof module!=='undefined') module.exports=api;
})();
