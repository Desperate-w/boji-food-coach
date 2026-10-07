(() => {
  const STORAGE_KEY = 'boji-ui-demo-v1';
  const icons = {
    spark: '<path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z"/><path d="m19 17 .6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z"/>',
    chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
    send: '<path d="m4 12 16-8-4 16-4-7-8-1Z"/><path d="m12 13 8-9"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    camera: '<path d="M4 7h4l2-2h4l2 2h4v12H4V7Z"/><circle cx="12" cy="13" r="3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m21 16-5-5L5 21"/>',
    close: '<path d="M5 5 19 19M19 5 5 19"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6M9 12h12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const timeNow = () => new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
  const todayLabel = () => new Date().toLocaleDateString('zh-CN', {month:'long', day:'numeric', weekday:'long'});
  const dateKey = (date=new Date()) => date.toLocaleDateString('sv-SE');
  const uid = () => Math.random().toString(36).slice(2, 10);
  const sampleIds = new Set(['meal-breakfast','meal-lunch','meal-snack']);
  const sampleTexts = new Set(['中午吃了一份鸡腿饭，加一个蛋，米饭剩了一点。','晚上可以吃火锅吗？','可以。按今天的进度，火锅优先选牛肉、虾、鱼和蔬菜；蘸料清淡一点，主食按食欲吃就好。']);
  const withoutSamples = records => records.filter(record => !sampleIds.has(record.id) && !sampleIds.has(record.receipt?.id) && !sampleTexts.has(record.text));
  const nutrition = window.BojiNutrition;
  const emptyDraft = () => ({gender:'',age:'',height:'',weight:'',goal:'',frequency:'',training:'',activity:''});
  const profileDraft = profile => profile ? {
    gender:profile.gender||'',age:profile.age||'',height:profile.height||'',weight:profile.weight||'',
    goal:profile.goal||'',frequency:profile.frequency||'',training:profile.training||'',activity:profile.activity||'',
  } : emptyDraft();

  function seedState() {
    return {
      view:'chat', historyDetail:null, expanded:false, menuOpen:false, modal:null, onboardStep:0, onboardingDraft:emptyDraft(), onboardingComplete:false, correctionTarget:null,
      voiceStatus:'idle', voiceTranscript:'', voiceError:'',
      activeDate:dateKey(), archives:{},
      attachment:null, draft:'', currentFeedback:null, pending:null, requestError:null,
      connection:{mode:'checking', model:'', provider:''},
      serverToday:null, retryRequestId:null, retrySource:null, importBackup:null, memories:[], memoryDraft:'', memoryEditId:null,
      profile:null, meals:[], messages:[], mealDraft:null, mealSaving:false, mealError:'',
    };
  }

  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    state = saved && Array.isArray(saved.meals) && Array.isArray(saved.messages)
      ? {...seedState(), ...saved, attachment:null, currentFeedback:null, pending:null, requestError:null, connection:{mode:'checking', model:''}, modal:null, menuOpen:false}
      : seedState();
    if (saved && !saved.onboardingComplete && !saved.onboardingDraft) {
      const legacyProfile=saved.profile;
      const customized=legacyProfile && (legacyProfile.age!==26 || legacyProfile.gender!=='男' || legacyProfile.height!==176 || legacyProfile.weight!==68);
      state.onboardingDraft=customized?profileDraft(legacyProfile):emptyDraft();
      state.onboardingComplete=false;
      state.profile=null;
      state.meals=withoutSamples(state.meals);
      state.messages=withoutSamples(state.messages);
      for (const [date,archive] of Object.entries(state.archives||{})) {
        const meals=withoutSamples(archive.meals||[]),messages=withoutSamples(archive.messages||[]);
        if (!meals.length && !messages.length) {delete state.archives[date];continue;}
        if (meals.length!==(archive.meals||[]).length || messages.length!==(archive.messages||[]).length) {
          Object.assign(archive,{meals,messages,calories:meals.reduce((sum,meal)=>sum+meal.calories,0),protein:meals.reduce((sum,meal)=>sum+meal.protein,0),status:'旧记录',summary:'已保留旧版新增记录。'});
        }
      }
    }
  } catch { state = seedState(); }
  const app = document.getElementById('app');
  const photoInput = document.getElementById('photo-input');
  const backupInput = document.getElementById('backup-input');
  let toastTimer;
  let thinkingTimer;
  let reasoningRenderTimer;
  let voiceRecognition=null;
  let liveController=null;
  function scheduleReasoningRender() {
    if (reasoningRenderTimer) return;
    reasoningRenderTimer=setTimeout(()=>{reasoningRenderTimer=null;if(state.pending) render();},120);
  }

  function persist() {
    if (state.connection.mode==='live') return;
    const {view, historyDetail, expanded, activeDate, archives, profile, onboardingComplete, onboardingDraft, meals, messages} = state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({view, historyDetail, expanded, activeDate, archives, profile, onboardingComplete, onboardingDraft, meals, messages})); } catch {}
  }
  function totals() { if (state.connection.mode==='live'&&state.serverToday) return state.serverToday; return state.meals.reduce((a, meal) => ({calories:a.calories+meal.calories, protein:a.protein+meal.protein, carbs:a.carbs+(meal.carbs||0), fat:a.fat+(meal.fat||0), fiber:a.fiber+(meal.fiber||0)}), {calories:0, protein:0, carbs:0, fat:0, fiber:0}); }
  function status() {
    if (state.connection.mode==='live'&&state.serverToday) return state.serverToday.status;
    const t=totals(), p=state.profile;
    if (!t.calories && !state.meals.length) return '待记录';
    if (t.calories > p.caloriesMax + 150) return '略高于建议';
    if (t.calories >= p.caloriesMin - 150) return '接近今日目标';
    if (t.calories < 500) return '刚刚开始';
    return '目前节奏合适';
  }
  function advice() {
    if (state.connection.mode==='live'&&state.serverToday) return state.serverToday.advice;
    const t=totals(), p=state.profile, gap=Math.max(0, p.proteinTarget-t.protein);
    if (!state.meals.length) return '今天还没有饮食记录。吃完告诉我，就从第一顿开始。';
    if (t.calories > p.caloriesMax+150) return '今天热量已略高，接下来正常吃即可，不必刻意补偿。';
    if (gap <= 8) return '蛋白质基本达标，下一顿按平时的食量正常吃就好。';
    if (gap <= 45) return `下一顿再补约 ${Math.round(gap/5)*5}g 蛋白质即可。`;
    return `今天蛋白质还差约 ${Math.round(gap/5)*5}g，下一顿优先选高蛋白主菜。`;
  }
  function ensureCurrentDay() {
    if (state.connection.mode==='live') return false;
    const current=dateKey();
    state.archives ||= {};
    if (!state.activeDate) {state.activeDate=current;return false;}
    if (state.activeDate===current) return false;
    const previous=state.activeDate, t=totals();
    if (state.meals.length || state.messages.length) state.archives[previous]={date:previous,meals:state.meals,messages:state.messages,calories:t.calories,protein:t.protein,status:state.profile?status():'尚未建档',summary:state.profile?advice():'完成建档后可查看建议'};
    state.activeDate=current;state.meals=[];state.messages=[];state.currentFeedback=null;
    state.pending=null;state.requestError=null;state.view='chat';state.historyDetail=null;
    return true;
  }
  function renderSidebar() {
    const recent=Object.keys(state.archives||{}).sort().reverse().slice(0,2);
    return `<aside class="sidebar" aria-label="主导航">
      <div class="brand"><div class="brand-mark">${icon('spark')}</div><div><div class="brand-name">薄肌</div><div class="brand-caption">YOUR FOOD COACH</div></div></div>
      <nav class="side-nav">
        ${navButton('chat','chat','今天')}${navButton('history','calendar','饮食历史')}${navButton('profile','user','我的计划')}
      </nav>
      <div class="side-divider"></div><div class="side-label">最近记录</div>
      ${state.meals.length||state.messages.length?`<button class="recent-day" data-action="history-day" data-day="today">今天 · ${fmt(totals().calories)} kcal</button>`:'<div class="recent-day recent-empty">还没有记录</div>'}
      ${recent.map(day=>`<button class="recent-day" data-action="history-day" data-day="${day}">${day.slice(5).replace('-','月')}日 · ${fmt(state.archives[day].calories)} kcal</button>`).join('')}
      <div class="sidebar-bottom"><button class="side-action" data-action="onboarding">${icon('spark')} 调整我的计划</button><button class="side-action" data-action="export-backup">${icon('calendar')} 导出我的记录</button>${state.connection.mode==='live'?'<button class="side-action" data-action="import-backup">导入旧版记录</button>':`<button class="side-action" data-action="reset">${icon('reset')} 重新体验建档</button>`}<div class="demo-note">${state.connection.mode==='live'?'资料和记录保存在本机服务；文字由 DeepSeek V4 Pro 处理，照片先由 Flash 识别':state.connection.mode==='unavailable'?'本地服务不可用，请刷新页面重试':'对话与图片识别为本地模拟'}</div></div>
    </aside>`;
  }
  function navButton(view, glyph, text) { return `<button class="nav-button ${state.view===view?'active':''}" data-action="nav" data-view="${view}">${icon(glyph)}${text}</button>`; }
  function renderMobileNav() { return `<nav class="mobile-nav" aria-label="底部导航">${[['chat','chat','今天'],['history','calendar','历史'],['profile','user','我的']].map(([view,glyph,label])=>`<button class="${state.view===view?'active':''}" data-action="nav" data-view="${view}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`; }
  function renderTopbar() {
    const title=state.view==='chat'?'今天':state.view==='history'?'饮食历史':'我的计划';
    const badge=state.connection.mode==='live'?'':`<span class="demo-pill">${state.connection.mode==='checking'?'检查连接中':state.connection.mode==='unavailable'?'本地服务不可用':state.connection.mode==='preview'?'前端预览 · 对话模拟':'本地演示'}</span>`;
    return `<header class="topbar"><div class="topbar-title"><h1>${title}</h1><span class="topbar-date">${state.view==='chat'?todayLabel():'AI 薄肌饮食教练'}</span></div><div class="topbar-actions">${badge}${state.view==='chat'?`<button class="icon-button mobile-only" data-action="nav" data-view="history" aria-label="查看历史">${icon('calendar')}</button>`:''}</div></header>`;
  }
  function renderToday() {
    const t=totals(), p=state.profile;
    const calorieScale=Math.max(1,p.caloriesMax+300);
    const caloriePct=Math.min(100,Math.max(0,Math.round(t.calories/calorieScale*100)));
    const targetStart=Math.min(100,Math.max(0,Math.round(p.caloriesMin/calorieScale*100)));
    const targetWidth=Math.max(1,Math.min(100-targetStart,Math.round((p.caloriesMax-p.caloriesMin)/calorieScale*100)));
    const proteinTarget=Math.max(1,p.proteinTarget);
    const proteinPct=Math.max(0,Math.round(t.protein/proteinTarget*100));
    const calorieProgress=!state.meals.length?'等待第一顿记录':t.calories<p.caloriesMin?`距建议下限 ${fmt(p.caloriesMin-t.calories)} kcal`:t.calories<=p.caloriesMax?'处于建议范围':`高出建议上限 ${fmt(t.calories-p.caloriesMax)} kcal`;
    const proteinProgress=!state.meals.length?'等待第一顿记录':t.protein>=p.proteinTarget?'已达到今日目标':`已完成 ${proteinPct}% · 还差约 ${fmt(p.proteinTarget-t.protein)}g`;
    const mealRows=state.meals.map(meal=>`<li class="today-meal"><span class="today-meal-name">${escapeHtml(meal.type||'餐食')} · ${escapeHtml(meal.name||'一顿饮食')}</span><span class="today-meal-values">${fmt(meal.calories||0)} kcal <span aria-hidden="true">·</span> 蛋白质 ${fmt(meal.protein||0)}g</span></li>`).join('');
    return `<section class="today-card ${state.expanded?'expanded':''}" aria-label="今日饮食状态">
      <div class="today-main"><div class="today-heading"><span class="eyebrow">TODAY / 今日状态</span><span class="status-badge"><span class="status-dot"></span>${escapeHtml(status())}</span></div>
      <div class="today-stats"><div class="today-stat ${t.calories>p.caloriesMax?'is-over':''}"><div class="stat-label">已摄入热量</div><div class="stat-value">${fmt(t.calories)}<span class="stat-unit">kcal</span></div><div class="stat-sub">今日建议 ${fmt(p.caloriesMin)}–${fmt(p.caloriesMax)} kcal</div>
      <div class="range-track ${t.calories>p.caloriesMax?'is-over':''}" role="img" aria-label="热量 ${fmt(t.calories)} 千卡，建议范围 ${fmt(p.caloriesMin)} 到 ${fmt(p.caloriesMax)} 千卡"><div class="range-target" style="left:${targetStart}%;width:${targetWidth}%"></div><div class="range-fill" style="width:${caloriePct}%"></div></div><div class="progress-caption">${calorieProgress}</div></div>
      <div class="today-stat"><div class="stat-label">蛋白质</div><div class="stat-value protein-value">${fmt(t.protein)}<span class="slash">/</span><span class="target">${fmt(p.proteinTarget)}</span><span class="stat-unit">g</span></div><div class="stat-sub">今日目标</div>
      <div class="protein-track" role="progressbar" aria-label="今日蛋白质" aria-valuemin="0" aria-valuemax="${Math.round(proteinTarget)}" aria-valuenow="${Math.round(Math.min(t.protein,proteinTarget))}" aria-valuetext="已摄入 ${fmt(t.protein)} 克，目标 ${fmt(p.proteinTarget)} 克"><div class="protein-fill" style="width:${Math.min(100,proteinPct)}%"></div></div><div class="progress-caption">${proteinProgress}</div></div></div>
      <div class="today-advice">${icon('spark')}<span>${escapeHtml(advice())}</span></div></div>
      <div class="today-detail"><div class="detail-grid"><div class="detail-cell"><span class="stat-label">碳水</span><div class="detail-number">${fmt(t.carbs)}g</div><div class="detail-caption">参考约 ${fmt(p.carbsTarget)}g</div></div><div class="detail-cell"><span class="stat-label">脂肪</span><div class="detail-number">${fmt(t.fat)}g</div><div class="detail-caption">参考约 ${fmt(p.fatTarget)}g</div></div><div class="detail-cell"><span class="stat-label">膳食纤维</span><div class="detail-number">${fmt(t.fiber||0)}g</div><div class="detail-caption">估算摄入</div></div></div><p class="detail-note">碳水和脂肪是参考分配，无需刻意吃满。</p><div class="today-meals-heading">今天已记录 <span>${state.meals.length} 餐</span></div>${mealRows?`<ul class="today-meals">${mealRows}</ul>`:'<p class="today-meals-empty">还没有餐食记录</p>'}</div>
      <button class="today-expand" data-action="expand-today">${state.expanded?'收起详细数据':'查看详细数据'} ${icon('down')}</button>
    </section>`;
  }
  function renderReceipt(r, revised=false, showEdit=true) {
    return `<div class="receipt"><div class="receipt-top"><div><div class="receipt-label">${icon('check')}${revised?'已更新':'已记录'}${escapeHtml(r.type)}</div><div class="receipt-title">${escapeHtml(r.name)}</div></div><div class="receipt-time">${escapeHtml(r.time||'刚刚')}</div></div>
      <div class="receipt-values"><div><div class="receipt-value">${r.min?`${fmt(r.min)}–${fmt(r.max)}`:`约 ${fmt(r.calories)}`}<small>kcal</small></div></div><div><div class="receipt-value">约 ${fmt(r.protein)}<small>g 蛋白质</small></div></div></div>
      <div class="receipt-foot"><span>${r.importedDemo?'旧版演示估算，建议核对':'营养数据为估算值'}</span>${showEdit?`<button class="text-button" data-action="correct-meal" data-meal="${escapeHtml(r.id)}">修正这顿</button>`:''}</div></div>`;
  }
  function renderRichText(value) {
    const inline=text=>escapeHtml(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
    return String(value || '').split(/\n\s*\n/).map(paragraph=>`<p>${inline(paragraph).replace(/\n/g,'<br>')}</p>`).join('');
  }
  function renderReasoning(m) {
    if (!m.live) return '';
    const legacySummary=!m.reasoningText&&Boolean(m.reasoningSummary);
    const content=m.reasoningText||m.reasoningSummary
      ? renderRichText(m.reasoningText||m.reasoningSummary)
      : '<p>本次模型没有返回可展示的思考文本。</p>';
    return `<details class="reasoning-details"><summary>${m.elapsedSeconds!=null?`思考了 ${m.elapsedSeconds} 秒 · `:''}查看${legacySummary?'思考摘要':'思考过程'} ${icon('down')}</summary><div class="reasoning-content">${content}<small>${legacySummary?'这是之前模型提供的思考摘要。':'这里显示 DeepSeek 本轮实际返回的思考文本。'}</small></div></details>`;
  }
  function renderMessage(m, showEdit=true) {
    if (m.role==='user') return `<article class="message user"><div class="user-bubble">${m.photoUrl?`<img class="user-photo" src="${escapeHtml(m.photoUrl)}" alt="上传的饮食照片">${state.connection.mode==='live'&&/^\/api\/media\/[a-f0-9-]{36}$/.test(m.photoUrl)?`<button class="photo-delete" data-action="delete-photo" data-id="${m.photoUrl.slice('/api/media/'.length)}">删除这张照片</button>`:''}`:''}${escapeHtml(m.text||'上传了一张食物照片')}</div></article>`;
    return `<article class="message assistant"><div class="assistant-message"><div class="assistant-avatar">${icon('spark')}</div><div class="assistant-body">${renderRichText(m.text)}${m.receipt?renderReceipt(m.receipt,m.revised,showEdit):''}${m.after?renderRichText(m.after):''}${renderReasoning(m)}<div class="message-meta">${escapeHtml(m.time||'刚刚')}</div></div></div></article>`;
  }
  function renderComposer() {
    const disabled=state.pending?'disabled':'';
    const hint=state.connection.mode==='live'
      ? `由 ${escapeHtml(state.connection.model)} 回复；营养数据仍是估算值`
      : state.connection.mode==='unavailable'?'无法连接本地服务；刷新页面重试':state.connection.mode==='preview'?'对话为本地模拟；个人计划按填写资料实时估算':'当前为本地模拟回复；启动服务并配置 API Key 后可体验真实模型';
    return `<div class="composer-wrap"><div class="composer-inner"><div class="composer-menu ${state.menuOpen?'open':''}" id="composer-menu"><button data-action="open-photo">${icon('camera')} 拍照或选择照片</button><button data-action="voice-demo">${icon('mic')} 语音输入</button></div>
      <div class="attachment-preview ${state.attachment?'visible':''}">${state.attachment?`<img src="${escapeHtml(state.attachment.url)}" alt="待发送照片"><span>照片已添加</span><button data-action="remove-photo" aria-label="移除照片">${icon('close')}</button>`:''}</div>
      <form class="composer" id="chat-form"><button class="composer-button" type="button" data-action="toggle-menu" aria-label="添加照片或语音" aria-expanded="${state.menuOpen}" ${disabled}>${icon('plus')}</button><textarea id="message-input" rows="1" placeholder="说说吃了什么，或问我怎么吃…" aria-label="输入消息" ${disabled}>${escapeHtml(state.draft||'')}</textarea><button class="composer-button" type="button" data-action="voice-demo" aria-label="语音输入" ${disabled}>${icon('mic')}</button><button class="composer-button send" type="submit" aria-label="发送消息" ${disabled}>${icon('send')}</button></form><div class="composer-hint">${hint}</div></div></div>`;
  }
  function renderPending() {
    const pending=state.pending;
    const label=pending.phase==='composing'?'正在整理回答…':'模型正在思考…';
    const reasoning=`<button class="thinking-expand" data-action="toggle-pending-reasoning" aria-expanded="${pending.reasoningOpen}">${pending.reasoning?'查看思考过程':'思考过程生成中'} ${icon('down')}</button>${pending.reasoningOpen?`<div class="reasoning-content pending-summary">${pending.reasoning?renderRichText(pending.reasoning):'<p>模型尚未返回思考文本。</p>'}</div>`:''}`;
    return `<section class="thinking-panel" aria-live="polite"><div class="thinking-row"><span class="thinking-pulse" aria-hidden="true"><i></i><i></i><i></i></span><strong>${label}</strong><span class="thinking-seconds" id="thinking-seconds">${Math.floor((Date.now()-pending.startedAt)/1000)} 秒</span></div><p>正在结合你的今日记录和目标给出建议。</p>${reasoning}<button class="stop-live" data-action="stop-live">停止生成</button></section>`;
  }
  function renderChat() {
    const response=state.pending?renderPending():state.requestError
      ? `<section class="request-error" role="alert"><strong>这次没有收到模型回复</strong><p>${escapeHtml(state.requestError)}</p><button class="text-button" data-action="retry-live">重试发送</button></section>`
      : state.currentFeedback
        ? `<section class="feedback-panel" aria-live="polite"><div class="feedback-heading"><span class="eyebrow">刚刚的反馈</span><button class="text-button" data-action="dismiss-feedback">收起</button></div>${renderMessage(state.currentFeedback)}</section>`
        : `<section class="welcome-block"><div class="eyebrow">随手记录</div><h2>吃完，告诉我就好。</h2><p>拍一张照、说一句话，或者直接问下一顿怎么吃。</p></section>`;
    return `<div class="page chat-page wide-page">${renderTopbar()}<main class="chat-scroll" id="chat-scroll"><div class="content-column today-content">${renderToday()}<div class="conversation-column">${response}<div class="suggestions"><button class="suggestion" data-action="example" data-text="刚吃了两个鸡蛋">试试记录：刚吃了两个鸡蛋</button><button class="suggestion" data-action="example" data-text="我晚上还能吃麦当劳吗？">问问：今晚还能吃麦当劳吗？</button>${state.meals.length?`<button class="suggestion" data-action="example" data-text="米饭其实只吃了一半">修正：米饭只吃了一半</button>`:''}</div>${state.meals.length||state.messages.length?`<button class="history-inline-link" data-action="history-day" data-day="today">查看今天的饮食与交流记录 ${icon('chevron')}</button>`:''}</div></div></main>${renderComposer()}</div>`;
  }

  function historyFor(day) {
    if (day==='today') {
      const t=totals();return {title:'今天',day:String(new Date().getDate()),month:`${new Date().getMonth()+1}月`,date:state.activeDate,...t,plan:state.profile,status:status(),summary:advice(),meals:state.meals,messages:state.messages};
    }
    const date=new Date(`${day}T12:00:00`);
    const archived=state.archives?.[dateKey(date)];
    const title=`${date.getMonth()+1}月${date.getDate()}日`;
    const sum=mealTotals(archived.meals||[]);
    return {title,day:String(date.getDate()),month:`${date.getMonth()+1}月`,date:day,...sum,plan:archived.plan||null,status:archived.status,summary:archived.summary,meals:archived.meals||[],messages:archived.messages||[]};
  }
  function mealTotals(meals) {
    return meals.reduce((sum,meal)=>({calories:sum.calories+(meal.calories||0),protein:sum.protein+(meal.protein||0),carbs:sum.carbs+(meal.carbs||0),fat:sum.fat+(meal.fat||0),fiber:sum.fiber+(meal.fiber||0)}),{calories:0,protein:0,carbs:0,fat:0,fiber:0});
  }
  function renderHistoryNutrition(d) {
    const p=d.plan;
    const calorieText=p?(d.meals.length?d.calories<p.caloriesMin?`距建议下限 ${fmt(p.caloriesMin-d.calories)} kcal`:d.calories<=p.caloriesMax?'处于建议范围':`高出建议上限 ${fmt(d.calories-p.caloriesMax)} kcal`:'等待第一顿记录'):'暂无该日目标';
    const proteinText=p?(d.meals.length?d.protein>=p.proteinTarget?'已达到目标':`完成 ${Math.round(d.protein/Math.max(1,p.proteinTarget)*100)}% · 还差 ${fmt(p.proteinTarget-d.protein)}g`:'等待第一顿记录'):'暂无该日目标';
    const scale=p?Math.max(1,p.caloriesMax+300):1;
    const caloriePct=p?Math.min(100,Math.max(0,Math.round(d.calories/scale*100))):0;
    const targetStart=p?Math.min(100,Math.max(0,Math.round(p.caloriesMin/scale*100))):0;
    const targetWidth=p?Math.max(1,Math.min(100-targetStart,Math.round((p.caloriesMax-p.caloriesMin)/scale*100))):0;
    const proteinPct=p?Math.min(100,Math.max(0,Math.round(d.protein/Math.max(1,p.proteinTarget)*100))):0;
    return `<section class="history-nutrition" aria-label="${escapeHtml(d.title)}营养汇总"><div class="history-nutrition-head"><div><span class="eyebrow">NUTRITION / 摄入与目标</span><h3>${escapeHtml(d.title)}的营养进度</h3></div><span class="status-badge"><span class="status-dot"></span>${escapeHtml(d.status)}</span></div><div class="history-macro-grid">
      <div class="history-macro primary"><span>热量</span><strong>${fmt(d.calories)} <small>kcal</small></strong><em>${p?`建议 ${fmt(p.caloriesMin)}–${fmt(p.caloriesMax)} kcal`:'估算摄入'}</em></div>
      <div class="history-macro primary"><span>蛋白质</span><strong>${fmt(d.protein)} <small>g</small></strong><em>${p?`目标约 ${fmt(p.proteinTarget)}g`:'估算摄入'}</em></div>
      <div class="history-macro"><span>碳水</span><strong>${fmt(d.carbs)} <small>g</small></strong><em>${p?`参考约 ${fmt(p.carbsTarget)}g`:'估算摄入'}</em></div>
      <div class="history-macro"><span>脂肪</span><strong>${fmt(d.fat)} <small>g</small></strong><em>${p?`参考约 ${fmt(p.fatTarget)}g`:'估算摄入'}</em></div>
      <div class="history-macro"><span>膳食纤维</span><strong>${fmt(d.fiber)} <small>g</small></strong><em>估算摄入</em></div></div>
      <div class="history-goal-line"><span>热量区间</span><strong>${calorieText}</strong></div>${p?`<div class="range-track ${d.calories>p.caloriesMax?'is-over':''}" role="img" aria-label="热量 ${fmt(d.calories)} 千卡，建议范围 ${fmt(p.caloriesMin)} 到 ${fmt(p.caloriesMax)} 千卡"><div class="range-target" style="left:${targetStart}%;width:${targetWidth}%"></div><div class="range-fill" style="width:${caloriePct}%"></div></div>`:''}<div class="history-goal-line"><span>蛋白质进度</span><strong>${proteinText}</strong></div>${p?`<div class="protein-track" role="progressbar" aria-label="${escapeHtml(d.title)}蛋白质" aria-valuemin="0" aria-valuemax="${Math.round(p.proteinTarget)}" aria-valuenow="${Math.round(Math.min(d.protein,p.proteinTarget))}"><div class="protein-fill" style="width:${proteinPct}%"></div></div>`:''}<p class="history-nutrition-note">营养数值是估算；碳水和脂肪为参考分配，无需刻意吃满。</p></section>`;
  }
  function renderMealBoard(d,day) {
    const types=['早餐','午餐','晚餐','加餐'];
    return `<section class="meal-board" aria-label="${escapeHtml(d.title)}餐食记录"><div class="meal-board-heading"><div class="eyebrow">MEALS / 餐食记录</div><p>对话中记下的食物会自动放进对应餐次；也可以在这里添加或修改。</p></div><div class="meal-slot-grid">${types.map(type=>{
      const meals=d.meals.filter(meal=>meal.type===type||(!types.includes(meal.type)&&type==='加餐'));
      return `<section class="meal-slot"><div class="meal-slot-heading"><h3>${type}</h3><button class="text-button" data-action="meal-open" data-day="${escapeHtml(day)}" data-type="${type}" aria-label="添加${type}餐食">${icon('plus')} 添加</button></div>${meals.length?meals.map(meal=>{
        const foods=meal.foodItems?.length?meal.foodItems.map(item=>`${item.food_name}${item.estimated_amount?` ${item.estimated_amount}`:''}`):[meal.name];
        return `<article class="meal-entry"><div class="meal-entry-top"><strong>${escapeHtml(meal.name)}</strong><button class="text-button" data-action="meal-open" data-day="${escapeHtml(day)}" data-type="${type}" data-meal="${escapeHtml(meal.id)}" aria-label="修改${escapeHtml(meal.name)}">修改</button></div><div class="meal-foods">${foods.map(food=>`<span>${escapeHtml(food)}</span>`).join('')}</div><div class="meal-entry-nutrition">${fmt(meal.calories)} kcal <span>蛋白质 ${fmt(meal.protein)}g</span><span>碳水 ${fmt(meal.carbs||0)}g</span><span>脂肪 ${fmt(meal.fat||0)}g</span></div></article>`;
      }).join(''):'<p class="meal-slot-empty">还没有记录</p>'}</section>`;
    }).join('')}</div></section>`;
  }
  function renderHistoryDetail() {
    const d=historyFor(state.historyDetail);
    const currentMeals=new Map([...state.meals,...Object.values(state.archives||{}).flatMap(archive=>archive.meals||[])].map(meal=>[meal.id,meal]));
    const conversation=d.messages.length
      ? `<section class="history-conversation"><div class="eyebrow">CONVERSATION / 当天交流</div><div class="message-list">${d.messages.map(m=>{
          const latest=m.receipt&&currentMeals.get(m.receipt.id);
          const changed=latest&&(latest.name!==m.receipt.name||latest.type!==m.receipt.type||latest.calories!==m.receipt.calories||latest.protein!==m.receipt.protein);
          return renderMessage(changed?{...m,receipt:latest,revised:true,after:'这顿后来已修改；请以当前餐次和营养汇总为准。'}:m,state.connection.mode==='live');
        }).join('')}</div></section>` : '';
    return `<div class="history-detail"><button class="back-button" data-action="history-back">${icon('arrowLeft')} 返回历史</button><div class="history-overview-grid">${renderHistoryNutrition(d)}${renderMealBoard(d,state.historyDetail)}</div><div class="history-ai">${icon('spark')}　${escapeHtml(d.summary)}</div>${conversation}</div>`;
  }
  function renderHistory() {
    if (state.historyDetail && state.historyDetail!=='today' && !state.archives?.[state.historyDetail]) state.historyDetail=null;
    const entries=Object.keys(state.archives||{}).sort().reverse();
    const today=historyFor('today');
    return `<div class="page wide-page">${renderTopbar()}<main class="section-page"><div class="section-inner wide-inner"><div class="page-heading"><div class="eyebrow">YOUR DAYS / 饮食历史</div><h1>每天都更了解自己一点。</h1><p>按餐次整理吃过的食物，随时补记或修改。</p></div>${state.historyDetail?renderHistoryDetail():`<div class="history-overview-grid">${renderHistoryNutrition(today)}${renderMealBoard(today,'today')}</div><section class="history-archive"><div class="eyebrow">PAST DAYS / 过去的日子</div>${entries.length?`<div class="history-list">${entries.map(day=>{const d=historyFor(day);return `<button class="history-card" data-action="history-day" data-day="${day}"><span class="history-date"><strong>${d.day}</strong><span>${d.month}</span></span><span class="history-info"><strong>${d.title} <span class="status-badge"><span class="status-dot"></span>${escapeHtml(d.status)}</span></strong><small>${fmt(d.calories)} kcal　·　蛋白质 ${fmt(d.protein)}g　·　${d.meals.length} 餐${d.messages.length?`　·　${d.messages.length} 条交流`:''}</small></span>${icon('chevron')}</button>`}).join('')}</div>`:'<p class="history-archive-empty">过去的记录会显示在这里。</p>'}</section>${today.messages.length?`<button class="history-inline-link" data-action="history-day" data-day="today">查看今天的完整交流 ${icon('chevron')}</button>`:''}`}</div></main></div>`;
  }
  function renderProfileMemories() {
    if (state.connection.mode!=='live') return '';
    return `<section class="profile-card memory-section"><div class="memory-heading"><div><div class="eyebrow">HABITS / 长期习惯</div><h3>让建议更了解你</h3></div><button class="secondary-button" data-action="memory-open">添加习惯</button></div><p>只保存你明确要长期记住的饮食习惯；单次份量修正不会变成偏好。</p>${state.memories.length?`<div class="memory-list">${state.memories.map(memory=>`<div class="memory-row"><span>${escapeHtml(memory.text)}</span><div><button class="text-button" data-action="memory-open" data-id="${memory.id}">编辑</button><button class="text-button" data-action="memory-delete" data-id="${memory.id}">删除</button></div></div>`).join('')}</div>`:'<p>还没有保存的长期习惯。</p>'}</section>`;
  }
  function energyRange(p,low,high) {return `${fmt(low)}${p.isRange?`–${fmt(high)}`:''}`;}
  function renderEnergySummary(p) {
    const extraMin=Math.max(0,p.maintenanceMin-p.bmrMin);
    const extraMax=Math.max(0,p.maintenanceMax-p.bmrMax);
    const activityLabel=p.training==='暂无固定训练'?'日常活动增量':'日常活动与运动增量';
    return `<section class="energy-card" aria-label="每日能量消耗估算"><div class="energy-heading"><div><span class="eyebrow">ENERGY / 每日消耗</span><h2>你的身体每天大约消耗多少？</h2></div><span class="energy-unit">估算值 · kcal/天</span></div><div class="energy-equation">
      <div class="energy-part"><span class="energy-part-label">静息代谢</span><strong>${energyRange(p,p.bmrMin,p.bmrMax)}</strong><small>安静休息时维持身体基本运作</small></div><span class="energy-operator" aria-hidden="true">+</span>
      <div class="energy-part activity"><span class="energy-part-label">${activityLabel}</span><strong>${energyRange(p,extraMin,extraMax)}</strong><small>按「${escapeHtml(p.activityLabel)}」活动等级估算</small></div><span class="energy-operator" aria-hidden="true">=</span>
      <div class="energy-part total"><span class="energy-part-label">全天维持消耗</span><strong>${energyRange(p,p.maintenanceMin,p.maintenanceMax)}</strong><small>维持当前体重的大致消耗</small></div></div><p class="energy-explain">${p.training==='暂无固定训练'?'增量主要来自走动、起居等日常活动。':'活动等级已包含日常运动，不会把训练热量再加一次。'} 目前只知道训练类型与频率，缺少每次运动的时长和强度，因此不能可靠地拆出单次运动消耗。</p></section>`;
  }
  function renderProfile() {
    const p=state.profile;
    return `<div class="page profile-page">${renderTopbar()}<main class="section-page"><div class="section-inner profile-inner"><div class="page-heading"><div class="eyebrow">YOUR PLAN / 我的计划</div><h1>你的饮食起点。</h1><p>这些数字由你填写的资料估算；身体和训练习惯变化时，可以随时更新。</p></div><div class="profile-top-grid"><div class="profile-hero"><div class="eyebrow">CURRENT STRATEGY / 当前策略</div><h2>${escapeHtml(p.strategy)}</h2><p>${escapeHtml(p.explanation)} 你负责记录吃了什么，薄肌帮你整理今天的进度。</p></div>${renderEnergySummary(p)}</div><div class="profile-grid"><div class="profile-card"><h3>每日建议</h3><dl><div><dt>热量范围</dt><dd>${fmt(p.caloriesMin)}–${fmt(p.caloriesMax)} kcal</dd></div><div><dt>蛋白质目标</dt><dd>约 ${fmt(p.proteinTarget)}g</dd></div><div><dt>碳水 / 脂肪</dt><dd>约 ${fmt(p.carbsTarget)}g / ${fmt(p.fatTarget)}g</dd></div><div><dt>当前目标</dt><dd>${escapeHtml(p.goal)}</dd></div></dl></div><div class="profile-card"><h3>身体与训练</h3><dl><div><dt>基础信息</dt><dd>${escapeHtml(p.gender)} · ${p.age} 岁</dd></div><div><dt>身高 / 体重</dt><dd>${p.height} cm / ${p.weight} kg</dd></div><div><dt>训练频率</dt><dd>${escapeHtml(p.frequency)}</dd></div><div><dt>训练类型</dt><dd>${escapeHtml(p.training)}</dd></div><div><dt>日常活动</dt><dd>${escapeHtml(p.activityLabel)}</dd></div></dl></div></div><div class="estimate-note"><strong>这些建议怎样得来</strong><p>静息消耗使用成人 Mifflin–St Jeor 公式估算，再按所选活动等级得到全天维持消耗，并根据目标调整每日建议摄入。训练频率不重复乘入活动系数。结果不是实测值，也不适用于未成年人、孕哺期或需要特殊饮食管理的人。</p></div><button class="profile-action" data-action="onboarding">更新身体信息与目标</button><div class="profile-data-actions"><button class="secondary-button" data-action="export-backup">导出记录备份</button>${state.connection.mode==='live'?'<button class="secondary-button" data-action="import-backup">导入旧版记录</button>':''}</div>${renderProfileMemories()}</div></main></div>`;
  }
  function setupOption(action,value,label,selected,description='') {
    return `<button type="button" class="option ${selected?'selected':''}" data-action="${action}" data-value="${escapeHtml(value)}" aria-pressed="${selected}"><strong>${escapeHtml(label)}</strong>${description?`<small>${escapeHtml(description)}</small>`:''}</button>`;
  }
  function renderSetup(overlay=false) {
    const s=state.onboardStep, d=state.onboardingDraft;
    const titles=['先了解你的身体','你想达到什么状态？','你的活动和训练','这是你的初始计划'];
    const progress=['身体信息','当前目标','活动习惯','计划结果'];
    let content='';
    if (s===0) content=`<div class="form-grid"><label class="field">计算所用的性别参数<select id="ob-gender"><option value="" ${!d.gender?'selected':''} disabled>请选择</option>${['男','女','其他'].map(x=>`<option value="${x}" ${d.gender===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field">年龄 <span>岁</span><input id="ob-age" type="number" min="18" max="100" inputmode="numeric" placeholder="例如 26" value="${escapeHtml(d.age)}"></label><label class="field">身高 <span>cm</span><input id="ob-height" type="number" min="120" max="230" inputmode="decimal" placeholder="例如 176" value="${escapeHtml(d.height)}"></label><label class="field">体重 <span>kg</span><input id="ob-weight" type="number" min="30" max="250" inputmode="decimal" placeholder="例如 68" value="${escapeHtml(d.weight)}"></label></div><p class="setup-help">选择“其他”时会展示两种公式系数形成的估算范围，不根据性别身份推断身体数据。</p>`;
    if (s===1) content=`<div class="option-list">${Object.keys(nutrition.GOALS).map(x=>setupOption('select-goal',x,x,d.goal===x)).join('')}</div><p class="setup-help">不需要填写目标体重。先选最接近你现在想做的事，之后可以修改。</p>`;
    if (s===2) content=`<div class="setup-group"><div class="field">日常活动程度 <span>包含运动，避免重复计算</span></div><div class="activity-options">${Object.entries(nutrition.ACTIVITY).map(([key,value])=>setupOption('select-activity',key,value.label,d.activity===key,value.detail)).join('')}</div></div><div class="setup-group"><div class="field">每周训练频率</div><div class="option-list option-grid">${['0–1 次','每周 2–3 次','每周 4–5 次','每周 6+ 次'].map(x=>setupOption('select-frequency',x,x,d.frequency===x)).join('')}</div></div><div class="setup-group"><div class="field">主要训练类型</div><div class="option-list option-grid">${['暂无固定训练','力量训练','跑步 / 有氧','综合训练'].map(x=>setupOption('select-training',x,x,d.training===x)).join('')}</div></div><p class="setup-help">身体照片以后可以选择补充；当前 Demo 不上传或分析身体照片。</p>`;
    if (s===3) {
      const r=nutrition.calculate(d);
      content=`<div class="result-highlight"><span>每日建议热量</span><strong>${fmt(r.caloriesMin)}–${fmt(r.caloriesMax)} <small>kcal</small></strong><p>${escapeHtml(r.strategy)}</p></div><div class="result-journey"><div><span>01 静息消耗</span><strong>${energyRange(r,r.bmrMin,r.bmrMax)} kcal/天</strong><small>根据年龄、身高、体重及所选公式参数估算</small></div><div><span>02 ${d.training==='暂无固定训练'?'日常活动增量':'活动与运动增量'}</span><strong>${energyRange(r,Math.max(0,r.maintenanceMin-r.bmrMin),Math.max(0,r.maintenanceMax-r.bmrMax))} kcal/天</strong><small>含日常走动及所选活动等级中的运动，不是单次训练消耗</small></div><div><span>03 维持消耗</span><strong>${energyRange(r,r.maintenanceMin,r.maintenanceMax)} kcal/天</strong><small>${escapeHtml(r.activityLabel)} · 活动系数 ${r.activityFactor}</small></div><div><span>04 按目标调整</span><strong>${escapeHtml(r.strategy)}</strong><small>${escapeHtml(r.explanation)}</small></div></div><div class="result-macros"><span>蛋白质 <strong>约 ${fmt(r.proteinTarget)}g</strong></span><span>碳水 <strong>约 ${fmt(r.carbsTarget)}g</strong></span><span>脂肪 <strong>约 ${fmt(r.fatTarget)}g</strong></span></div><p class="setup-help">这是一份成人初始估算，不是代谢实测或医疗建议。先按日常记录观察，再结合真实变化调整；未成年人、孕哺期及特殊健康情况不适用。</p>`;
    }
    const card=`<div class="setup-card"><div class="setup-card-top"><span class="eyebrow">YOUR STARTING POINT / 建立计划</span>${overlay?`<button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button>`:''}</div><div class="setup-progress" aria-label="建档进度">${progress.map((label,index)=>`<div class="${index===s?'active':index<s?'done':''}"><i>${index<s?icon('check'):index+1}</i><span>${label}</span></div>`).join('')}</div><div class="setup-content"><h2>${titles[s]}</h2><p class="setup-intro">${['用 1 分钟建立适合你的饮食起点。','选一个当前方向，之后随时可以调整。','让估算更接近你的真实生活。','先看清数字的来路，再开始记录。'][s]}</p>${content}</div><div class="setup-actions">${s>0?`<button class="secondary-button" data-action="onboard-back">上一步</button>`:'<span></span>'}<button class="primary-button" data-action="onboard-next">${s===3?(overlay?'保存新计划':'开始记录'):s===2?'查看我的计划':'继续'} ${icon('chevron')}</button></div></div>`;
    if (overlay) return `<div class="modal-backdrop setup-overlay" role="dialog" aria-modal="true" aria-label="更新饮食计划">${card}</div>`;
    return `<main class="setup-shell"><aside class="setup-aside"><div class="setup-brand"><div class="brand-mark">${icon('spark')}</div><strong>薄肌</strong></div><div class="setup-aside-copy"><div class="eyebrow">FOOD COACH / 饮食教练</div><h1>先了解你，<br>再谈怎么吃。</h1><p>从身体信息与活动习惯出发，给你一份能看懂、能随时调整的饮食起点。</p></div><div class="setup-aside-foot">${state.connection.mode==='live'?'身体信息和记录只保存在本机服务中。':'身体信息只保存在当前浏览器的演示记录中。'} <button class="setup-export" data-action="export-backup">导出旧记录</button>${state.connection.mode==='live'?'<button class="setup-export" data-action="import-backup">导入旧记录</button>':''}</div></aside>${card}<div class="toast" id="toast" role="status"></div></main>`;
  }
  function renderModal() {
    if (!state.modal) return '';
    if (state.modal==='meal') {
      const d=state.mealDraft;
      return `<div class="modal-backdrop"><div class="modal meal-editor" role="dialog" aria-modal="true" aria-label="${d.id?'修改':'添加'}餐食"><div class="modal-top"><div><div class="eyebrow">MEAL / ${d.date==='today'?'今天':escapeHtml(d.date)}</div><h2>${d.id?'修改这顿吃了什么':'添加一顿餐食'}</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭" ${state.mealSaving?'disabled':''}>${icon('close')}</button></div><p>写下食物名称和大致份量，每行一种食物。保存后会重新估算这顿并更新当日进度。</p><form id="meal-form"><label class="field">餐次<select id="meal-type" ${state.mealSaving?'disabled':''}>${['早餐','午餐','晚餐','加餐'].map(type=>`<option value="${type}" ${d.type===type?'selected':''}>${type}</option>`).join('')}</select></label><label class="field">吃了什么<textarea id="meal-description" rows="5" maxlength="1000" placeholder="例如：鸡蛋 2 个&#10;吐司 2 片" ${state.mealSaving?'disabled':''}>${escapeHtml(d.description)}</textarea></label>${state.mealError?`<p class="meal-editor-error" role="alert">${escapeHtml(state.mealError)}</p>`:''}<div class="meal-editor-actions"><button type="button" class="secondary-button" data-action="close-modal" ${state.mealSaving?'disabled':''}>取消</button><button type="submit" class="primary-button" ${state.mealSaving?'disabled':''}>${state.mealSaving?'正在估算并保存…':'保存并更新进度'}</button></div></form><p class="meal-editor-note">${state.connection.mode==='live'?'食物描述会发送给 DeepSeek 估算，结果保存到本机。':'当前为前端预览，营养值是本地模拟估算。'}</p></div></div>`;
    }
    if (state.modal==='memory') return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="编辑长期习惯"><div class="modal-top"><div><div class="eyebrow">HABIT / 长期习惯</div><h2>${state.memoryEditId?'修改习惯':'添加习惯'}</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><label class="field voice-field">饮食习惯<textarea id="memory-text" maxlength="200" rows="3" placeholder="例如：平时喝无糖拿铁">${escapeHtml(state.memoryDraft)}</textarea></label><div class="voice-actions"><button class="primary-button" data-action="memory-save">保存习惯</button></div></div></div>`;
    if (state.modal==='import') return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="导入旧记录"><div class="modal-top"><div><div class="eyebrow">IMPORT / 导入记录</div><h2>选择要迁入的内容</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p>旧版餐食是演示估算，导入后会标注来源，不会覆盖现有记录。文件：${escapeHtml(state.importBackup?.fileName||'')}</p><div class="voice-actions"><button class="secondary-button" data-action="import-select" data-mode="profile">仅身体资料</button><button class="secondary-button" data-action="import-select" data-mode="records">仅饮食与交流</button><button class="primary-button" data-action="import-select" data-mode="all">全部导入</button></div></div></div>`;
    if (state.modal==='voice') {
      const busy=['starting','listening','processing'].includes(state.voiceStatus);
      const status={idle:'准备好后点击“开始说话”',starting:'正在请求麦克风权限…',listening:'正在听，说完会自动发送',processing:'正在整理识别结果…',review:'已结束录音，可检查文字后发送',error:'这次语音识别没有完成',unsupported:'当前浏览器不支持语音识别'}[state.voiceStatus];
      return `<div class="modal-backdrop"><div class="modal voice-modal" role="dialog" aria-modal="true" aria-label="语音输入"><div class="modal-top"><div><div class="eyebrow">VOICE / 语音输入</div><h2>说一句，就能记下来。</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p>语音由浏览器识别，可能需要网络和麦克风权限。说完会自动发送；也可以点“结束录音”先检查文字。</p><div class="voice-status ${state.voiceStatus==='listening'?'recording':''}" role="status">${icon('mic')}<span>${status}</span></div>${state.voiceError?`<p class="voice-error" role="alert">${escapeHtml(state.voiceError)}</p>`:''}<label class="field voice-field">识别文字<textarea id="voice-transcript" rows="3" placeholder="识别后会出现在这里，也可以直接输入或修改" ${busy?'readonly':''}>${escapeHtml(state.voiceTranscript)}</textarea></label><div class="voice-actions"><button class="secondary-button" data-action="voice-type">改用文字输入</button>${state.voiceStatus==='unsupported'?'':`<button class="secondary-button" data-action="voice-toggle" ${state.voiceStatus==='processing'?'disabled':''}>${busy?'结束录音':'开始说话'}</button>`}<button class="primary-button" data-action="voice-use" ${state.voiceTranscript.trim()?'':'disabled'}>使用这段文字</button></div></div></div>`;
    }
    if (state.modal!=='onboarding') return '';
    return renderSetup(true);
  }
  function render() {
    app.innerHTML=state.onboardingComplete
      ? `<div class="app-shell">${renderSidebar()}<div class="main">${state.view==='chat'?renderChat():state.view==='history'?renderHistory():renderProfile()}</div></div>${renderMobileNav()}${renderModal()}<div class="toast" id="toast" role="status"></div>`
      : renderSetup()+(state.modal==='import'?renderModal():'');
    persist();
  }
  function toast(message) {
    const el=document.getElementById('toast'); if (!el) return;
    clearTimeout(toastTimer); el.textContent=message; el.classList.add('visible');
    toastTimer=setTimeout(()=>el.classList.remove('visible'),2500);
  }
  function scrollBottom() { requestAnimationFrame(()=>{const el=document.getElementById('chat-scroll'); if (el) el.scrollTop=el.scrollHeight;}); }
  function updateComposerPhoto() { render(); requestAnimationFrame(()=>document.getElementById('message-input')?.focus()); }
  function browserBackup() {
    const meals=state.meals.map(meal=>({...meal,date:state.activeDate}));
    const messages=state.messages.map(message=>({...message,date:state.activeDate}));
    for (const [date,archive] of Object.entries(state.archives||{})) {
      meals.push(...(archive.meals||[]).map(meal=>({...meal,date})));
      messages.push(...(archive.messages||[]).map(message=>({...message,date})));
    }
    return {format:'boji-browser-v1',exportedAt:new Date().toISOString(),activeDate:state.activeDate,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,profile:state.profile,meals,messages};
  }
  async function exportBackup() {
    try {
      if (state.connection.mode==='unavailable'||(state.connection.mode==='checking'&&/^https?:$/.test(window.location?.protocol||''))) throw new Error('本地服务尚未就绪，无法导出服务端记录。');
      let data=browserBackup();
      if (state.connection.mode==='live') {
        const response=await fetch('/api/export',{cache:'no-store'});
        if (!response.ok) throw new Error('导出失败');
        data=await response.json();
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`boji-backup-${dateKey()}.json`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {toast(error.message||'导出失败');}
  }
  function inferMealType(text) {
    if (/早餐|早上/.test(text)) return '早餐'; if (/午餐|中午/.test(text)) return '午餐'; if (/晚餐|晚上/.test(text)) return '晚餐';
    const h=new Date().getHours(); return h<11?'早餐':h<15?'午餐':h<20?'晚餐':'加餐';
  }
  function estimateMeal(text, withPhoto) {
    let m;
    if (withPhoto) m={name:'鸡肉饭 · 蔬菜（照片演示）', calories:620, protein:45, carbs:65, fat:19, fiber:6, min:570, max:670};
    else if (/牛肉面/.test(text)) m={name:'牛肉面', calories:750, protein:32, carbs:93, fat:26, fiber:5, min:650, max:850};
    else if (/鸡蛋|蛋/.test(text)&&/吐司|面包/.test(text)) m={name:'鸡蛋 · 吐司', calories:320, protein:19, carbs:30, fat:14, fiber:3};
    else if (/鸡蛋|蛋/.test(text)&&!/饭/.test(text)) m={name:'鸡蛋 × 2', calories:155, protein:13, carbs:1, fat:11, fiber:0};
    else if (/鸡腿饭|鸡肉饭|鸡胸饭/.test(text)) m={name:'鸡肉饭', calories:700, protein:40, carbs:72, fat:24, fiber:5, min:650, max:750};
    else if (/拿铁/.test(text)) m={name:'拿铁', calories:140, protein:8, carbs:12, fat:7, fiber:0};
    else if (/火锅/.test(text)) m={name:'火锅', calories:800, protein:44, carbs:50, fat:45, fiber:7, min:650, max:950};
    else m={name:'一顿饮食（演示估算）', calories:520, protein:27, carbs:60, fat:19, fiber:5, min:450, max:600};
    return {id:uid(), type:inferMealType(text), ...m, time:timeNow(), input:text||'上传了一张食物照片'};
  }
  function saveDemoMealDraft(d) {
    const parts=d.description.split(/[\n,，、]+/).map(part=>part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('请填写至少一种食物。');
    const foodItems=parts.map(part=>{
      const estimate=estimateMeal(part,false);
      return {food_name:part,estimated_amount:'演示估算',calories:estimate.calories,protein:estimate.protein,carbs:estimate.carbs,fat:estimate.fat,fiber:estimate.fiber,confidence:'low'};
    });
    const sum=mealTotals(foodItems);
    const list=d.date==='today'?state.meals:state.archives[d.date].meals;
    const index=d.id?list.findIndex(meal=>meal.id===d.id):-1;
    if (d.id&&index<0) throw new Error('找不到要修改的餐食，请刷新页面重试。');
    const prior=index>=0?list[index]:null;
    const meal={id:prior?.id||uid(),type:d.type,name:parts.join(' · ').slice(0,100),...sum,foodItems,time:prior?.time||timeNow(),input:d.description,source:'manual-demo',importedDemo:true};
    if (index>=0) list[index]=meal; else list.push(meal);
    if (d.date!=='today') {
      const archive=state.archives[d.date], daily=mealTotals(list);
      Object.assign(archive,daily,{status:'已更新',summary:'这一天的餐食和营养汇总已更新。'});
    }
  }
  async function saveMealDraft() {
    const d=state.mealDraft;
    if (!d||state.mealSaving) return;
    const description=document.getElementById('meal-description')?.value.trim()||'';
    const type=document.getElementById('meal-type')?.value||d.type;
    state.mealDraft={...d,type,description};
    if (!description) {state.mealError='请先填写吃了什么。';render();return;}
    if (['checking','unavailable'].includes(state.connection.mode)&&/^https?:$/.test(window.location?.protocol||'')) {state.mealError='本地服务尚未就绪，请稍后刷新重试。';render();return;}
    state.mealSaving=true;state.mealError='';render();
    try {
      if (state.connection.mode==='live') {
        const response=await fetch(d.id?`/api/meals/${encodeURIComponent(d.id)}`:'/api/meals',{
          method:d.id?'PUT':'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({date:d.date==='today'?state.activeDate:d.date,type,description}),
        });
        const payload=await response.json();
        if (!response.ok) throw new Error(payload.error||'保存失败，请重试。');
        applyServerState(payload.state);
      } else saveDemoMealDraft({...d,type,description});
      state.currentFeedback=null;state.modal=null;state.mealDraft=null;
      render();toast(d.id?'餐食已修改，营养进度已更新':'餐食已添加，营养进度已更新');
    } catch(error) {state.mealSaving=false;state.mealError=error.message||'保存失败，请重试。';render();}
    finally {state.mealSaving=false;}
  }
  function classify(text, withPhoto) {
    if (state.correctionTarget || (/(其实|刚才|不是|没那么多|更正|改成)/.test(text) && state.meals.length)) return 'correction';
    if (/(随便吃了点|吃了点东西|吃了一些东西)/.test(text)) return 'vague';
    if (/(想吃|准备吃|打算吃|还没吃|可以吃|能吃|如果|会不会|计划吃|大概多少热量|多少卡|为什么)/.test(text) || /[？?]/.test(text)) return 'question';
    if (withPhoto) return 'consumed';
    if (/(吃了|喝了|吃过|刚吃|刚喝|早餐|午餐|晚餐|吃一碗|吃一份)/.test(text)) return 'consumed';
    return 'question';
  }
  function findMealToCorrect(text) {
    const selected=state.meals.find(m=>m.id===state.correctionTarget);
    if (selected) return selected;
    const matchers=[[/米饭|饭量/,/饭/],[/吐司|面包/,/吐司|面包/],[/鸡腿|鸡肉|鸡胸/,/鸡/],[/牛肉面/,/牛肉面/]];
    const matcher=matchers.find(([input])=>input.test(text))?.[1];
    return (matcher?[...state.meals].reverse().find(m=>matcher.test(m.name)):null)||state.meals[state.meals.length-1];
  }
  async function* readAppEvents(body) {
    const reader=body.getReader();
    const decoder=new TextDecoder();
    let buffer='', eventName='', dataLines=[];
    try {
      while (true) {
        const {done,value}=await reader.read();
        if (done) break;
        buffer+=decoder.decode(value,{stream:true});
        let newline;
        while ((newline=buffer.indexOf('\n'))!==-1) {
          const line=buffer.slice(0,newline).replace(/\r$/,'');
          buffer=buffer.slice(newline+1);
          if (!line) {
            if (dataLines.length) {
              const payload=dataLines.join('\n');
              dataLines=[];
              let data;
              try {data=JSON.parse(payload);} catch {data=null;}
              if (data) yield {type:eventName||'message',data};
              eventName='';
            }
          } else if (line.startsWith('event:')) eventName=line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
      }
      if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
      if (dataLines.length) {
        let data;
        try {data=JSON.parse(dataLines.join('\n'));} catch {data=null;}
        if (data) yield {type:eventName||'message',data};
      }
    } finally {reader.releaseLock();}
  }
  function applyServerState(snapshot) {
    state.profile=snapshot.profile;
    state.onboardingComplete=Boolean(snapshot.profile);
    state.onboardingDraft=profileDraft(snapshot.profile);
    state.activeDate=snapshot.activeDate;
    state.meals=snapshot.meals;
    state.messages=snapshot.messages;
    state.archives=snapshot.archives;
    state.memories=snapshot.memories||[];
    state.serverToday=snapshot.today;
  }
  async function refreshLiveState() {
    const response=await fetch('/api/state',{cache:'no-store'});
    if (!response.ok) throw new Error('无法读取服务端记录');
    applyServerState(await response.json());
    render();
  }
  function finishLiveTurn(payload) {
    clearInterval(thinkingTimer);
    clearTimeout(reasoningRenderTimer); reasoningRenderTimer=null;
    applyServerState(payload.state);
    state.currentFeedback=payload.assistantMessage;
    state.pending=null;state.requestError=null;state.retryRequestId=null;state.retrySource=null;state.correctionTarget=null;
    render();scrollBottom();
  }
  async function sendLiveMessage(rawText, attachment, options={}) {
    const text=rawText.trim();
    if (!text&&!attachment) return;
    const requestId=options.requestId||uid()+uid();
    state.pending={phase:'thinking',reasoning:'',reasoningOpen:false,text,startedAt:Date.now()};
    state.requestError=null;state.currentFeedback=null;state.menuOpen=false;
    state.draft='';state.attachment=null;render();scrollBottom();
    clearInterval(thinkingTimer);
    thinkingTimer=setInterval(()=>{const el=document.getElementById('thinking-seconds');if(el&&state.pending)el.textContent=`${Math.floor((Date.now()-state.pending.startedAt)/1000)} 秒`;},1000);
    const controller=new AbortController();liveController=controller;
    try {
      const response=await fetch('/api/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({requestId,text,image:attachment?.url||null,targetMealId:state.correctionTarget||null,source:options.source||(attachment?'photo':'text')}),
        signal:controller.signal,
      });
      if (!response.ok) {
        const error=await response.json().catch(()=>({}));
        throw new Error(error.error||`服务暂时不可用（HTTP ${response.status}）`);
      }
      if (response.headers?.get('content-type')?.includes('application/json')) {finishLiveTurn(await response.json());return;}
      if (!response.body) throw new Error('浏览器没有收到模型的数据流');
      let result=null;
      for await (const event of readAppEvents(response.body)) {
        if (event.type==='status') {
          state.pending.phase=event.data.phase||'thinking';
          render();
        } else if (event.type==='reasoning') {
          state.pending.reasoning=event.data.text||'';
          scheduleReasoningRender();
        } else if (event.type==='result') {
          result=event.data;
        } else if (event.type==='error') throw new Error(event.data.message||'模型生成失败');
      }
      if (!result) throw new Error('模型没有返回完整结果，请重试');
      finishLiveTurn(result);
    } catch (error) {
      try {
        const reconcile=await fetch(`/api/turn/${encodeURIComponent(requestId)}`,{cache:'no-store'});
        if (reconcile.ok) {finishLiveTurn(await reconcile.json());return;}
      } catch {}
      clearInterval(thinkingTimer);
      clearTimeout(reasoningRenderTimer); reasoningRenderTimer=null;
      state.pending=null;state.requestError=controller.signal.aborted?'已停止生成。输入已保留，可以重试。':(error.message||'连接失败，请重试');
      state.retryRequestId=requestId;state.retrySource=options.source||(attachment?'photo':'text');state.draft=text;state.attachment=attachment||null;render();
    } finally {if (liveController===controller) liveController=null;}
  }
  function sendMessage(rawText, attachment=state.attachment, options={}) {
    if (ensureCurrentDay()) render();
    if (state.pending) return;
    if (['checking','unavailable'].includes(state.connection.mode)&&/^https?:$/.test(window.location?.protocol||'')) return toast('本地服务尚未就绪，请稍后刷新重试');
    if (state.connection.mode==='live') return sendLiveMessage(rawText,attachment,options);
    return sendDemoMessage(rawText,attachment);
  }
  function sendDemoMessage(rawText, attachment=state.attachment) {
    const text=rawText.trim(); if (!text && !attachment) return;
    const photoUrl=attachment?.url||null;
    state.messages.push({id:uid(), role:'user', text:text||'上传了一张食物照片', photoUrl, time:timeNow()});
    const kind=classify(text, !!attachment);
    let reply;
    if (kind==='consumed') {
      const meal=estimateMeal(text, !!attachment); state.meals.push(meal);
      const t=totals();
      reply={text:attachment?'已根据照片做了一次演示估算，记下了。':'记下了。', receipt:{...meal}, after:`今天累计约 ${fmt(t.calories)} kcal、蛋白质 ${fmt(t.protein)}g。${advice()}`};
    } else if (kind==='correction') {
      const meal=findMealToCorrect(text);
      const reduction=/一半|只有|少一点|没那么多/.test(text)?120:80;
      meal.calories=Math.max(50,meal.calories-reduction); meal.protein=Math.max(1,meal.protein-2); meal.carbs=Math.max(0,(meal.carbs||0)-25); meal.name=meal.name.replace(/（已修正）/g,'')+'（已修正）'; delete meal.min; delete meal.max;
      const t=totals();
      reply={text:'好的，已经把那顿的份量改过来了。', receipt:{...meal}, revised:true, after:`Today 已同步更新：约 ${fmt(t.calories)} kcal、蛋白质 ${fmt(t.protein)}g。${advice()}`};
    } else if (kind==='vague') {
      reply={text:'大概吃了哪些？说出主要食物就好，不用称重。'};
    } else if (/麦当劳/.test(text)) {
      reply={text:`可以吃。你今天已摄入约 ${fmt(totals().calories)} kcal；如果打算吃麦当劳，优先选一个主食配蛋白质来源，饮料选无糖即可。你吃完告诉我，我再帮你记。`};
    } else if (/火锅/.test(text)) {
      reply={text:`可以。你今天蛋白质还差约 ${Math.max(0,state.profile.proteinTarget-totals().protein)}g，火锅可以优先选牛肉、虾、鱼和蔬菜。等你吃完再告诉我，当前不会记录。`};
    } else if (/鸡蛋/.test(text)&&/(热量|多少卡)/.test(text)) {
      reply={text:'两个普通大小的鸡蛋大约 140–160 kcal，蛋白质约 12–13g。这只是营养咨询，我没有把它计入今天的饮食。'};
    } else if (/蛋白质/.test(text)&&/(为什么|减脂)/.test(text)) {
      reply={text:'减脂时吃够蛋白质，有助于在控制热量的同时维持肌肉。对你的当前目标，重点是每天稳定接近约 135g，不需要每顿都精确计算。'};
    } else if (/(想吃|准备吃|打算吃|如果)/.test(text)) {
      reply={text:`可以先这样规划。按你今天的状态，下一顿优先安排一份蛋白质来源，再根据食欲搭配主食和蔬菜。等真正吃完再告诉我，我会帮你记录。`};
    } else {
      reply={text:`按你今天的进度：约 ${fmt(totals().calories)} kcal、蛋白质 ${fmt(totals().protein)}g。${advice()} 如果你要记录饮食，可以直接说“我刚吃了……”`};
    }
    const assistantMessage={id:uid(), role:'assistant', ...reply, time:timeNow()};
    state.messages.push(assistantMessage);
    state.currentFeedback=assistantMessage;
    state.attachment=null; state.draft=''; state.menuOpen=false; state.correctionTarget=null; render(); scrollBottom();
  }
  async function handleOnboardNext() {
    const d=state.onboardingDraft;
    if (state.onboardStep===0) {
      Object.assign(d,{gender:document.getElementById('ob-gender').value,age:document.getElementById('ob-age').value,height:document.getElementById('ob-height').value,weight:document.getElementById('ob-weight').value});
      if (!d.gender) return toast('请选择计算所用的性别参数');
      if (!Number.isInteger(Number(d.age)) || Number(d.age)<18 || Number(d.age)>100) return toast('当前估算适用于 18–100 岁成年人');
      if (!Number.isFinite(Number(d.height)) || Number(d.height)<120 || Number(d.height)>230) return toast('身高请填写 120–230 cm');
      if (!Number.isFinite(Number(d.weight)) || Number(d.weight)<30 || Number(d.weight)>250) return toast('体重请填写 30–250 kg');
    }
    if (state.onboardStep===1 && !d.goal) return toast('请先选择当前目标');
    if (state.onboardStep===2) {
      try {nutrition.calculate(d);} catch (error) {return toast(error.message);}
    }
    if (state.onboardStep<3) {state.onboardStep++;render();return;}
    if (['checking','unavailable'].includes(state.connection.mode)&&/^https?:$/.test(window.location?.protocol||'')) return toast('本地服务尚未就绪，请刷新页面重试');
    const wasComplete=state.onboardingComplete;
    if (state.connection.mode==='live') {
      try {
        const response=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:d,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
        const payload=await response.json();
        if (!response.ok) throw new Error(payload.error||'保存资料失败');
        applyServerState(payload.state);
      } catch(error) {toast(error.message||'保存资料失败');return;}
    } else state.profile={...d,age:Number(d.age),height:Number(d.height),weight:Number(d.weight),...nutrition.calculate(d)};
    state.onboardingComplete=true;state.onboardingDraft=profileDraft(state.profile);
    state.modal=null;state.view=wasComplete?'profile':'chat';render();toast(wasComplete?'计划已更新':'计划已建立，可以开始记录');
  }
  document.addEventListener('click', async e => {
    const button=e.target.closest('[data-action]'); if (!button) return;
    const action=button.dataset.action;
    if (action==='nav') {state.view=button.dataset.view;state.historyDetail=null;state.currentFeedback=null;render();window.scrollTo(0,0);}
    else if (action==='history-day') {state.view='history';state.historyDetail=button.dataset.day;state.currentFeedback=null;render();window.scrollTo(0,0);}
    else if (action==='history-back') {state.historyDetail=null;render();}
    else if (action==='meal-open') {
      const day=button.dataset.day||'today',type=button.dataset.type||'加餐',id=button.dataset.meal||null;
      const list=day==='today'?state.meals:state.archives?.[day]?.meals||[];
      const meal=id?list.find(entry=>entry.id===id):null;
      if (id&&!meal) return toast('找不到这顿餐食，请刷新页面重试。');
      state.mealDraft={id,date:day,type:meal?.type||type,description:meal?.importedDemo?(meal.input||meal.name):meal?.foodItems?.length?meal.foodItems.map(item=>`${item.food_name}${item.estimated_amount?` ${item.estimated_amount}`:''}`).join('\n'):meal?.input||''};
      state.mealError='';state.mealSaving=false;state.modal='meal';render();requestAnimationFrame(()=>document.getElementById('meal-description')?.focus());
    }
    else if (action==='expand-today') {state.expanded=!state.expanded;render();}
    else if (action==='dismiss-feedback') {state.currentFeedback=null;render();}
    else if (action==='toggle-pending-reasoning' && state.pending) {state.pending.reasoningOpen=!state.pending.reasoningOpen;render();}
    else if (action==='stop-live') liveController?.abort();
    else if (action==='retry-live') sendMessage(state.draft,state.attachment,{requestId:state.retryRequestId,source:state.retrySource});
    else if (action==='toggle-menu') {state.menuOpen=!state.menuOpen;document.getElementById('composer-menu')?.classList.toggle('open',state.menuOpen);button.setAttribute('aria-expanded',String(state.menuOpen));}
    else if (action==='open-photo') {state.menuOpen=false;document.getElementById('composer-menu')?.classList.remove('open');photoInput.click();}
    else if (action==='remove-photo') {state.attachment=null;updateComposerPhoto();}
    else if (action==='example') sendMessage(button.dataset.text);
    else if (action==='correct-meal') {state.correctionTarget=button.dataset.meal;state.draft=state.connection.mode==='live'?'请把这顿改为：':'米饭其实只吃了一半';state.view='chat';render();requestAnimationFrame(()=>document.getElementById('message-input')?.focus());}
    else if (action==='onboarding') {state.modal='onboarding';state.onboardStep=0;state.onboardingDraft=profileDraft(state.profile);render();}
    else if (action==='export-backup') exportBackup();
    else if (action==='import-backup') backupInput?.click();
    else if (action==='memory-open') {const memory=state.memories.find(item=>item.id===button.dataset.id);state.memoryEditId=memory?.id||null;state.memoryDraft=memory?.text||'';state.modal='memory';render();}
    else if (action==='memory-save') {
      const text=state.memoryDraft.trim();if (text.length<2) return toast('习惯内容至少写 2 个字');
      try {
        const endpoint=state.memoryEditId?`/api/memories/${state.memoryEditId}`:'/api/memories';
        const response=await fetch(endpoint,{method:state.memoryEditId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
        const payload=await response.json();if (!response.ok) throw new Error(payload.error||'保存失败');
        applyServerState(payload.state);state.modal=null;state.memoryDraft='';state.memoryEditId=null;render();toast('习惯已保存');
      } catch(error) {toast(error.message||'保存失败');}
    }
    else if (action==='memory-delete') {
      if (!window.confirm('删除这条长期习惯？')) return;
      try {const response=await fetch(`/api/memories/${button.dataset.id}`,{method:'DELETE'});const payload=await response.json();if (!response.ok) throw new Error(payload.error||'删除失败');applyServerState(payload.state);render();toast('习惯已删除');}
      catch(error) {toast(error.message||'删除失败');}
    }
    else if (action==='delete-photo') {
      if (!window.confirm('删除这张照片？文字与餐食记录会保留。')) return;
      try {
        const response=await fetch(`/api/media/${encodeURIComponent(button.dataset.id)}`,{method:'DELETE'});
        const payload=await response.json();
        if (!response.ok) throw new Error(payload.error||'删除失败');
        applyServerState(payload.state);state.currentFeedback=null;render();toast('照片已删除');
      } catch(error) {toast(error.message||'删除失败');}
    }
    else if (action==='import-select') {
      const backup=state.importBackup?.data,mode=button.dataset.mode;
      if (!backup) return;
      try {
        const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup,mode})});
        const payload=await response.json();
        if (!response.ok) throw new Error(payload.error||'导入失败');
        applyServerState(payload.state);state.importBackup=null;state.modal=null;render();toast(`已导入 ${payload.importedMeals} 餐、${payload.importedMessages} 条交流`);
      } catch(error) {toast(error.message||'导入失败');}
    }
    else if (action==='close-modal'&&!state.mealSaving) {if (state.modal==='voice') cancelVoiceRecognition();state.modal=null;state.mealDraft=null;render();}
    else if (action==='onboard-back') {state.onboardStep=Math.max(0,state.onboardStep-1);render();}
    else if (action==='onboard-next') handleOnboardNext();
    else if (action==='select-goal') {state.onboardingDraft.goal=button.dataset.value;render();}
    else if (action==='select-frequency') {state.onboardingDraft.frequency=button.dataset.value;render();}
    else if (action==='select-training') {state.onboardingDraft.training=button.dataset.value;render();}
    else if (action==='select-activity') {state.onboardingDraft.activity=button.dataset.value;render();}
    else if (action==='voice-demo') startVoice();
    else if (action==='voice-toggle') {
      if (voiceRecognition) {state.voiceStatus='processing';try {voiceRecognition.stop();} catch {cancelVoiceRecognition();state.voiceStatus='error';state.voiceError='录音未能正常结束，请再试一次。';}render();}
      else beginVoiceRecognition();
    }
    else if (action==='voice-type') {cancelVoiceRecognition();state.draft=[state.draft.trim(),state.voiceTranscript.trim()].filter(Boolean).join(' ');state.modal=null;render();requestAnimationFrame(()=>document.getElementById('message-input')?.focus());}
    else if (action==='voice-use') {
      const transcript=state.voiceTranscript.trim();if (!transcript) return;
      cancelVoiceRecognition();state.draft=[state.draft.trim(),transcript].filter(Boolean).join(' ');
      state.modal=null;render();requestAnimationFrame(()=>document.getElementById('message-input')?.focus());
    }
    else if (action==='reset' && window.confirm('这会清空当前浏览器里的建档、饮食和交流记录。确定重新开始吗？')) {state=seedState();render();toast('已清空本机演示记录');}
  });
  document.addEventListener('submit', e => { if (e.target.id==='chat-form') {e.preventDefault();sendMessage(document.getElementById('message-input').value);} else if (e.target.id==='meal-form') {e.preventDefault();saveMealDraft();} });
  document.addEventListener('input', e => {
    if (e.target.id==='message-input') state.draft=e.target.value;
    if (e.target.id==='meal-description'&&state.mealDraft) state.mealDraft.description=e.target.value;
    if (e.target.id==='memory-text') state.memoryDraft=e.target.value;
    if (e.target.id==='voice-transcript') {state.voiceTranscript=e.target.value;const use=document.querySelector('[data-action="voice-use"]');if (use) use.disabled=!state.voiceTranscript.trim();}
    const key={'ob-gender':'gender','ob-age':'age','ob-height':'height','ob-weight':'weight'}[e.target.id];
    if (key && state.onboardingDraft) {state.onboardingDraft[key]=e.target.value;persist();}
  });
  document.addEventListener('change', e => {
    if (e.target.id==='ob-gender') {state.onboardingDraft.gender=e.target.value;persist();}
    if (e.target.id==='meal-type'&&state.mealDraft) state.mealDraft.type=e.target.value;
  });
  document.addEventListener('keydown', e => { if (e.target.id==='message-input'&&e.key==='Enter'&&!e.shiftKey) {e.preventDefault();sendMessage(e.target.value);} });
  function preparePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('读取照片失败'));
      reader.onload=()=>{
        const image=new Image();
        image.onerror=()=>reject(new Error('照片格式不受支持'));
        image.onload=()=>{
          const scale=Math.min(1,900/Math.max(image.width,image.height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.round(image.width*scale); canvas.height=Math.round(image.height*scale);
          const context=canvas.getContext('2d');
          if (!context) {reject(new Error('无法处理照片'));return;}
          context.fillStyle='#fff'; context.fillRect(0,0,canvas.width,canvas.height);
          context.drawImage(image,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',.76));
        };
        image.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  photoInput.addEventListener('change', async e => {
    const file=e.target.files?.[0]; if (!file) return;
    photoInput.value='';
    try {
      state.attachment={name:file.name,url:await preparePhoto(file)};
      updateComposerPhoto(); toast('照片已添加，可以补充一句说明');
    } catch { toast('照片读取失败，请换一张试试'); }
  });
  backupInput?.addEventListener('change', async e => {
    const file=e.target.files?.[0];if (!file) return;
    backupInput.value='';
    try {
      if (file.size>20_000_000) throw new Error('备份文件过大，请检查文件内容。');
      const data=JSON.parse(await file.text());
      if (!['boji-browser-v1','boji-backup-v1'].includes(data.format)) throw new Error('这不是薄肌记录备份。');
      state.importBackup={data,fileName:file.name};state.modal='import';render();
    } catch(error) {toast(error.message||'备份文件读取失败');}
  });
  function voiceErrorMessage(code) {
    const messages={
      'not-allowed':'麦克风权限被拒绝。请在浏览器里允许此页面使用麦克风后重试。',
      'service-not-allowed':'浏览器阻止了语音识别服务。请在支持语音识别的浏览器中打开本地服务地址。',
      'audio-capture':'没有检测到可用的麦克风。请检查设备连接和系统麦克风权限。',
      network:'语音识别服务暂时无法连接。检查网络后重试，或改用文字输入。',
      'no-speech':'没有听到清晰语音。靠近麦克风，再试一次。',
      'language-not-supported':'当前浏览器的语音识别不支持中文。请改用文字输入。',
      aborted:'语音识别已中断，可以重试或改用文字输入。',
    };
    return messages[code]||'语音识别未完成。请重试；如果仍失败，请改用文字输入。';
  }
  function cancelVoiceRecognition() {
    if (!voiceRecognition) return;
    const recognition=voiceRecognition;voiceRecognition=null;
    recognition.onstart=null;recognition.onresult=null;recognition.onerror=null;recognition.onend=null;
    try {recognition.abort();} catch {}
  }
  function startVoice() {
    state.menuOpen=false;
    state.modal='voice';state.voiceTranscript='';state.voiceError='';
    state.voiceStatus=window.SpeechRecognition||window.webkitSpeechRecognition?'idle':'unsupported';
    if (state.voiceStatus==='unsupported') state.voiceError='当前浏览器没有提供语音识别。请用 Chrome 打开 npm start 显示的本地地址，或改用文字输入。';
    render();
    if (state.voiceStatus==='idle') beginVoiceRecognition();
  }
  function beginVoiceRecognition() {
    cancelVoiceRecognition();
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!Recognition) {state.voiceStatus='unsupported';state.voiceError=voiceErrorMessage('service-not-allowed');render();return;}
    let recognition;
    try {recognition=new Recognition();} catch {state.voiceStatus='error';state.voiceError='无法启动当前浏览器的语音识别。请改用文字输入。';render();return;}
    voiceRecognition=recognition;
    recognition.lang='zh-CN';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
    recognition.onstart=()=>{if (voiceRecognition!==recognition) return;state.voiceStatus='listening';render();};
    recognition.onresult=event=>{
      if (voiceRecognition!==recognition) return;
      state.voiceTranscript=Array.from(event.results).map(result=>result[0]?.transcript||'').join('').trim();
      const input=document.getElementById('voice-transcript');if (input) input.value=state.voiceTranscript;
      const use=document.querySelector('[data-action="voice-use"]');if (use) use.disabled=!state.voiceTranscript;
    };
    recognition.onerror=event=>{
      if (voiceRecognition!==recognition) return;
      state.voiceStatus='error';state.voiceError=voiceErrorMessage(event.error);render();
    };
    recognition.onend=()=>{
      if (voiceRecognition!==recognition) return;
      voiceRecognition=null;
      if (state.modal!=='voice'||state.voiceStatus==='error') return;
      if (!state.voiceTranscript) {state.voiceStatus='error';state.voiceError='没有识别到文字。请重试，或改用文字输入。';render();return;}
      if (state.voiceStatus==='processing') {state.voiceStatus='review';render();return;}
      state.modal=null;sendMessage(state.voiceTranscript,null,{source:'voice'});
    };
    state.voiceStatus='starting';state.voiceError='';
    try {recognition.start();render();}
    catch {voiceRecognition=null;state.voiceStatus='error';state.voiceError='浏览器未能启动麦克风。请检查麦克风权限，或改用文字输入。';render();}
  }
  async function checkConnection() {
    if (new URLSearchParams(window.location?.search||'').get('preview')==='1') {
      state.connection={mode:'preview',model:'',provider:''};render();return;
    }
    if (!/^https?:$/.test(window.location?.protocol||'')) {
      state.connection={mode:'demo',model:'',provider:''};render();return;
    }
    try {
      const response=await fetch('/api/health',{cache:'no-store'});
      if (!response.ok) throw new Error('服务未连接');
      const health=await response.json();
      state.connection=health.configured?{mode:'live',model:health.model||'LLM',visionModel:health.visionModel,provider:health.provider||'DeepSeek'}:{mode:'demo',model:'',provider:''};
      if (health.configured) await refreshLiveState();
    } catch {state.connection={mode:'unavailable',model:'',provider:''};}
    render();
  }
  window.addEventListener?.('focus',()=>{if (state.connection.mode==='live') refreshLiveState().catch(()=>{});else if (ensureCurrentDay()) render();});
  ensureCurrentDay();
  render();
  checkConnection();
})();
