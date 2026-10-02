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

  function seedState() {
    const lunch = {id:'meal-lunch', type:'午餐', name:'鸡腿饭 · 鸡蛋', calories:700, min:650, max:750, protein:40, carbs:72, fat:24, fiber:5, time:'12:35', input:'中午吃了一份鸡腿饭，加一个蛋，米饭剩了一点。'};
    return {
      view:'chat', historyDetail:null, expanded:false, menuOpen:false, modal:null, onboardStep:0, correctionTarget:null,
      activeDate:dateKey(), archives:{},
      attachment:null, draft:'', currentFeedback:null, pending:null, requestError:null,
      connection:{mode:'checking', model:'', provider:''},
      profile:{age:26, gender:'男', height:176, weight:68, goal:'减一点脂，让线条更明显', frequency:'每周 2–3 次', training:'力量训练', caloriesMin:2000, caloriesMax:2200, proteinTarget:135, strategy:'轻度减脂 · 保持肌肉'},
      meals:[
        {id:'meal-breakfast', type:'早餐', name:'吐司 · 鸡蛋 · 拿铁', calories:420, protein:28, carbs:45, fat:14, fiber:4, time:'08:12'},
        lunch,
        {id:'meal-snack', type:'加餐', name:'希腊酸奶 · 香蕉', calories:300, protein:28, carbs:33, fat:7, fiber:3, time:'15:06'},
      ],
      messages:[
        {id:uid(), role:'user', text:'中午吃了一份鸡腿饭，加一个蛋，米饭剩了一点。', time:'12:35'},
        {id:uid(), role:'assistant', text:'记下了。这顿蛋白质补得不错。', receipt:{...lunch}, after:'今天累计约 1,120 kcal、蛋白质 68g。晚餐再补一份高蛋白主菜就可以。', time:'12:35'},
        {id:uid(), role:'user', text:'晚上可以吃火锅吗？', time:'17:24'},
        {id:uid(), role:'assistant', text:'可以。按今天的进度，火锅优先选牛肉、虾、鱼和蔬菜；蘸料清淡一点，主食按食欲吃就好。', time:'17:24'},
      ],
    };
  }

  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    state = saved && saved.profile && saved.meals && saved.messages ? {...seedState(), ...saved, attachment:null, currentFeedback:null, pending:null, requestError:null, connection:{mode:'checking', model:''}, modal:null, menuOpen:false} : seedState();
  } catch { state = seedState(); }
  const app = document.getElementById('app');
  const photoInput = document.getElementById('photo-input');
  let toastTimer;
  let thinkingTimer;
  let reasoningRenderTimer;
  function scheduleReasoningRender() {
    if (reasoningRenderTimer) return;
    reasoningRenderTimer=setTimeout(()=>{reasoningRenderTimer=null;if(state.pending) render();},120);
  }

  function persist() {
    const {view, historyDetail, expanded, activeDate, archives, profile, meals, messages} = state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({view, historyDetail, expanded, activeDate, archives, profile, meals, messages})); } catch {}
  }
  function totals() { return state.meals.reduce((a, meal) => ({calories:a.calories+meal.calories, protein:a.protein+meal.protein, carbs:a.carbs+(meal.carbs||0), fat:a.fat+(meal.fat||0), fiber:a.fiber+(meal.fiber||0)}), {calories:0, protein:0, carbs:0, fat:0, fiber:0}); }
  function status() {
    const t=totals(), p=state.profile;
    if (t.calories > p.caloriesMax + 150) return '略高于建议';
    if (t.calories >= p.caloriesMin - 150) return '接近今日目标';
    if (t.calories < 500) return '刚刚开始';
    return '目前节奏合适';
  }
  function advice() {
    const t=totals(), p=state.profile, gap=Math.max(0, p.proteinTarget-t.protein);
    if (t.calories > p.caloriesMax+150) return '今天热量已略高，接下来正常吃即可，不必刻意补偿。';
    if (gap <= 8) return '蛋白质基本达标，下一顿按平时的食量正常吃就好。';
    if (gap <= 45) return `下一顿再补约 ${Math.round(gap/5)*5}g 蛋白质即可。`;
    return `今天蛋白质还差约 ${Math.round(gap/5)*5}g，下一顿优先选高蛋白主菜。`;
  }
  function ensureCurrentDay() {
    const current=dateKey();
    state.archives ||= {};
    if (!state.activeDate) {state.activeDate=current;return false;}
    if (state.activeDate===current) return false;
    const previous=state.activeDate, t=totals();
    state.archives[previous]={date:previous,meals:state.meals,messages:state.messages,calories:t.calories,protein:t.protein,status:status(),summary:advice()};
    state.activeDate=current;state.meals=[];state.messages=[];state.currentFeedback=null;
    state.pending=null;state.requestError=null;state.view='chat';state.historyDetail=null;
    return true;
  }
  function renderSidebar() {
    return `<aside class="sidebar" aria-label="主导航">
      <div class="brand"><div class="brand-mark">${icon('spark')}</div><div><div class="brand-name">薄肌</div><div class="brand-caption">YOUR FOOD COACH</div></div></div>
      <nav class="side-nav">
        ${navButton('chat','chat','今天')}${navButton('history','calendar','饮食历史')}${navButton('profile','user','我的计划')}
      </nav>
      <div class="side-divider"></div><div class="side-label">最近记录</div>
      <button class="recent-day" data-action="history-day" data-day="today">今天 · ${fmt(totals().calories)} kcal</button>
      <button class="recent-day" data-action="history-day" data-day="yesterday">昨天 · ${fmt(historyFor('yesterday').calories)} kcal</button>
      <button class="recent-day" data-action="history-day" data-day="before">前天 · ${fmt(historyFor('before').calories)} kcal</button>
      <div class="sidebar-bottom"><button class="side-action" data-action="onboarding">${icon('spark')} 体验新用户引导</button><button class="side-action" data-action="reset">${icon('reset')} 重置演示</button><div class="demo-note">${state.connection.mode==='live'?'交互原型 · DeepSeek 实时回复':'交互原型 · AI 与图片识别为本地模拟'}</div></div>
    </aside>`;
  }
  function navButton(view, glyph, text) { return `<button class="nav-button ${state.view===view?'active':''}" data-action="nav" data-view="${view}">${icon(glyph)}${text}</button>`; }
  function renderMobileNav() { return `<nav class="mobile-nav" aria-label="底部导航">${[['chat','chat','今天'],['history','calendar','历史'],['profile','user','我的']].map(([view,glyph,label])=>`<button class="${state.view===view?'active':''}" data-action="nav" data-view="${view}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`; }
  function renderTopbar() {
    const title=state.view==='chat'?'今天':state.view==='history'?'饮食历史':'我的计划';
    const live=state.connection.mode==='live';
    const badge=live?`<span class="demo-pill live-pill"><span class="status-dot"></span>${escapeHtml(state.connection.provider||'LLM')} · ${escapeHtml(state.connection.model)}</span>`:`<span class="demo-pill">${state.connection.mode==='checking'?'检查连接中':'本地演示'}</span>`;
    return `<header class="topbar"><div class="topbar-title"><h1>${title}</h1><span class="topbar-date">${state.view==='chat'?todayLabel():'AI 薄肌饮食教练'}</span></div><div class="topbar-actions">${badge}${state.view==='chat'?`<button class="icon-button mobile-only" data-action="nav" data-view="history" aria-label="查看历史">${icon('calendar')}</button>`:''}</div></header>`;
  }
  function renderToday() {
    const t=totals(), p=state.profile, pct=Math.min(100,Math.round(t.calories/(p.caloriesMax+300)*100));
    return `<section class="today-card ${state.expanded?'expanded':''}" aria-label="今日饮食状态">
      <div class="today-main"><div class="today-heading"><span class="eyebrow">TODAY / 今日状态</span><span class="status-badge"><span class="status-dot"></span>${status()}</span></div>
      <div class="today-stats"><div><div class="stat-label">已摄入热量</div><div class="stat-value">${fmt(t.calories)}<span class="stat-unit">kcal</span></div><div class="stat-sub">今日建议 ${fmt(p.caloriesMin)}–${fmt(p.caloriesMax)} kcal</div></div>
      <div><div class="stat-label">蛋白质</div><div class="stat-value protein-value">${fmt(t.protein)}<span class="slash">/</span><span class="target">${fmt(p.proteinTarget)}</span><span class="stat-unit">g</span></div><div class="stat-sub">${t.protein>=p.proteinTarget?'今天已达标':`还差约 ${fmt(p.proteinTarget-t.protein)}g`}</div></div></div>
      <div class="range-track" aria-label="热量摄入相对目标范围"><div class="range-target"></div><div class="range-fill" style="width:${pct}%"></div></div>
      <div class="today-advice">${icon('spark')}<span>${advice()}</span></div></div>
      <div class="today-detail"><div class="detail-grid"><div class="detail-cell"><span class="stat-label">碳水</span><div class="detail-number">${fmt(t.carbs)}g</div><div class="detail-caption">估算摄入</div></div><div class="detail-cell"><span class="stat-label">脂肪</span><div class="detail-number">${fmt(t.fat)}g</div><div class="detail-caption">估算摄入</div></div><div class="detail-cell"><span class="stat-label">已记录</span><div class="detail-number">${state.meals.length} 餐</div><div class="detail-caption">今天</div></div></div></div>
      <button class="today-expand" data-action="expand-today">${state.expanded?'收起详细数据':'查看详细数据'} ${icon('down')}</button>
    </section>`;
  }
  function renderReceipt(r, revised=false, showEdit=true) {
    return `<div class="receipt"><div class="receipt-top"><div><div class="receipt-label">${icon('check')}${revised?'已更新':'已记录'}${escapeHtml(r.type)}</div><div class="receipt-title">${escapeHtml(r.name)}</div></div><div class="receipt-time">${escapeHtml(r.time||'刚刚')}</div></div>
      <div class="receipt-values"><div><div class="receipt-value">${r.min?`${fmt(r.min)}–${fmt(r.max)}`:`约 ${fmt(r.calories)}`}<small>kcal</small></div></div><div><div class="receipt-value">约 ${fmt(r.protein)}<small>g 蛋白质</small></div></div></div>
      <div class="receipt-foot"><span>营养数据为估算值</span>${showEdit?`<button class="text-button" data-action="correct-meal" data-meal="${escapeHtml(r.id)}">修正这顿</button>`:''}</div></div>`;
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
    if (m.role==='user') return `<article class="message user"><div class="user-bubble">${m.photoUrl?`<img class="user-photo" src="${escapeHtml(m.photoUrl)}" alt="上传的饮食照片">`:''}${escapeHtml(m.text||'上传了一张食物照片')}</div></article>`;
    return `<article class="message assistant"><div class="assistant-message"><div class="assistant-avatar">${icon('spark')}</div><div class="assistant-body">${renderRichText(m.text)}${m.receipt?renderReceipt(m.receipt,m.revised,showEdit):''}${m.after?renderRichText(m.after):''}${renderReasoning(m)}<div class="message-meta">${escapeHtml(m.time||'刚刚')}</div></div></div></article>`;
  }
  function renderComposer() {
    const disabled=state.pending?'disabled':'';
    const hint=state.connection.mode==='live'
      ? `由 ${escapeHtml(state.connection.model)} 回复；营养数据仍是估算值`
      : '当前为本地模拟回复；启动服务并配置 API Key 后可体验真实模型';
    return `<div class="composer-wrap"><div class="composer-inner"><div class="composer-menu ${state.menuOpen?'open':''}" id="composer-menu"><button data-action="open-photo">${icon('camera')} 拍照或选择照片</button><button data-action="voice-demo">${icon('mic')} 语音输入</button></div>
      <div class="attachment-preview ${state.attachment?'visible':''}">${state.attachment?`<img src="${escapeHtml(state.attachment.url)}" alt="待发送照片"><span>照片已添加</span><button data-action="remove-photo" aria-label="移除照片">${icon('close')}</button>`:''}</div>
      <form class="composer" id="chat-form"><button class="composer-button" type="button" data-action="toggle-menu" aria-label="添加照片或语音" aria-expanded="${state.menuOpen}" ${disabled}>${icon('plus')}</button><textarea id="message-input" rows="1" placeholder="说说吃了什么，或问我怎么吃…" aria-label="输入消息" ${disabled}>${escapeHtml(state.draft||'')}</textarea><button class="composer-button" type="button" data-action="voice-demo" aria-label="语音输入" ${disabled}>${icon('mic')}</button><button class="composer-button send" type="submit" aria-label="发送消息" ${disabled}>${icon('send')}</button></form><div class="composer-hint">${hint}</div></div></div>`;
  }
  function renderPending() {
    const pending=state.pending;
    const label=pending.phase==='composing'?'正在整理回答…':'模型正在思考…';
    const reasoning=`<button class="thinking-expand" data-action="toggle-pending-reasoning" aria-expanded="${pending.reasoningOpen}">${pending.reasoning?'查看思考过程':'思考过程生成中'} ${icon('down')}</button>${pending.reasoningOpen?`<div class="reasoning-content pending-summary">${pending.reasoning?renderRichText(pending.reasoning):'<p>模型尚未返回思考文本。</p>'}</div>`:''}`;
    return `<section class="thinking-panel" aria-live="polite"><div class="thinking-row"><span class="thinking-pulse" aria-hidden="true"><i></i><i></i><i></i></span><strong>${label}</strong><span class="thinking-seconds" id="thinking-seconds">${Math.floor((Date.now()-pending.startedAt)/1000)} 秒</span></div><p>正在结合你的今日记录和目标给出建议。</p>${reasoning}</section>`;
  }
  function renderChat() {
    const response=state.pending?renderPending():state.requestError
      ? `<section class="request-error" role="alert"><strong>这次没有收到模型回复</strong><p>${escapeHtml(state.requestError)}</p><button class="text-button" data-action="retry-live">重试发送</button></section>`
      : state.currentFeedback
        ? `<section class="feedback-panel" aria-live="polite"><div class="feedback-heading"><span class="eyebrow">刚刚的反馈</span><button class="text-button" data-action="dismiss-feedback">收起</button></div>${renderMessage(state.currentFeedback)}</section>`
        : `<section class="welcome-block"><div class="eyebrow">随手记录</div><h2>吃完，告诉我就好。</h2><p>拍一张照、说一句话，或者直接问下一顿怎么吃。</p></section>`;
    return `<div class="page chat-page">${renderTopbar()}<main class="chat-scroll" id="chat-scroll"><div class="content-column">${renderToday()}${response}<div class="suggestions"><button class="suggestion" data-action="example" data-text="刚吃了两个鸡蛋">试试记录：刚吃了两个鸡蛋</button><button class="suggestion" data-action="example" data-text="我晚上还能吃麦当劳吗？">问问：今晚还能吃麦当劳吗？</button><button class="suggestion" data-action="example" data-text="米饭其实只吃了一半">修正：米饭只吃了一半</button></div><button class="history-inline-link" data-action="history-day" data-day="today">查看今天的饮食与交流记录 ${icon('chevron')}</button></div></main>${renderComposer()}</div>`;
  }

  const historyDays = {
    yesterday:{title:'昨天', calories:2040, protein:132, status:'接近目标', summary:'整体节奏不错，热量在建议范围内，蛋白质也基本达到目标。', meals:[['早餐','燕麦酸奶 · 水煮蛋',420,29],['午餐','牛肉饭 · 青菜',760,48],['晚餐','三文鱼 · 米饭 · 沙拉',710,47],['其他','拿铁 · 苹果',150,8]]},
    before:{title:'前天', calories:1930, protein:121, status:'接近目标', summary:'这天热量略低于建议范围，蛋白质接近目标。训练日可以多补一份主食。', meals:[['早餐','全麦三明治',390,25],['午餐','鸡肉沙拉 · 面包',680,44],['晚餐','牛肉面',760,43],['其他','水果',100,9]]},
  };
  function historyFor(day) {
    if (day==='today') {
      const t=totals();return {title:'今天',day:String(new Date().getDate()),month:`${new Date().getMonth()+1}月`,calories:t.calories,protein:t.protein,status:status(),summary:advice(),meals:state.meals.map(m=>[m.type,m.name,m.calories,m.protein]),messages:state.messages};
    }
    const date=day==='yesterday'||day==='before'?new Date():new Date(`${day}T12:00:00`);
    if (day==='yesterday'||day==='before') date.setDate(date.getDate()-(day==='yesterday'?1:2));
    const archived=state.archives?.[dateKey(date)];
    const title=day==='yesterday'?'昨天':day==='before'?'前天':`${date.getMonth()+1}月${date.getDate()}日`;
    if (archived) return {title,day:String(date.getDate()),month:`${date.getMonth()+1}月`,calories:archived.calories,protein:archived.protein,status:archived.status,summary:archived.summary,meals:archived.meals.map(m=>[m.type,m.name,m.calories,m.protein]),messages:archived.messages||[]};
    return {...historyDays[day],title,day:String(date.getDate()),month:`${date.getMonth()+1}月`,messages:[]};
  }
  function renderHistoryDetail() {
    const d=historyFor(state.historyDetail);
    const conversation=d.messages.length
      ? `<section class="history-conversation"><div class="eyebrow">CONVERSATION / 当天交流</div><div class="message-list">${d.messages.map(m=>renderMessage(m,false)).join('')}</div></section>` : '';
    return `<div class="history-detail"><button class="back-button" data-action="history-back">${icon('arrowLeft')} 返回历史</button><h2>${d.title}的饮食</h2><p>${d.status} · ${d.meals.length} 条饮食记录${conversation?` · ${d.messages.length} 条交流`:''}</p><div class="history-summary"><div><strong>${fmt(d.calories)}</strong><span>kcal</span></div><div><strong>${fmt(d.protein)}</strong><span>g 蛋白质</span></div></div><div class="eyebrow">MEALS / 当天餐次</div>${d.meals.map(m=>`<div class="meal-row"><div><strong>${escapeHtml(m[0])} · ${escapeHtml(m[1])}</strong><small>蛋白质约 ${fmt(m[3])}g</small></div><span>约 ${fmt(m[2])} kcal</span></div>`).join('')}<div class="history-ai">${icon('spark')}　${escapeHtml(d.summary)}</div>${conversation}</div>`;
  }
  function renderHistory() {
    const recentDates=['yesterday','before'].map(day=>{const date=new Date();date.setDate(date.getDate()-(day==='yesterday'?1:2));return dateKey(date)});
    const entries=['today','yesterday','before',...Object.keys(state.archives||{}).filter(date=>!recentDates.includes(date)).sort().reverse()];
    return `<div class="page">${renderTopbar()}<main class="section-page"><div class="section-inner"><div class="page-heading"><div class="eyebrow">YOUR DAYS / 饮食历史</div><h1>每天都更了解自己一点。</h1><p>回看每一天吃了什么，也能找到当天的交流记录。</p></div>${state.historyDetail?renderHistoryDetail():`<div class="history-list">${entries.map(day=>{const d=historyFor(day);return `<button class="history-card" data-action="history-day" data-day="${day}"><span class="history-date"><strong>${d.day}</strong><span>${d.month}</span></span><span class="history-info"><strong>${d.title} <span class="status-badge"><span class="status-dot"></span>${d.status}</span></strong><small>${fmt(d.calories)} kcal　·　蛋白质 ${fmt(d.protein)}g　·　${d.meals.length} 餐${d.messages.length?`　·　${d.messages.length} 条交流`:''}</small></span>${icon('chevron')}</button>`}).join('')}</div>`}</div></main></div>`;
  }
  function renderProfile() {
    const p=state.profile;
    return `<div class="page">${renderTopbar()}<main class="section-page"><div class="section-inner"><div class="page-heading"><div class="eyebrow">YOUR PLAN / 我的计划</div><h1>适合你当前状态的饮食节奏。</h1><p>计划可以随身体状态和训练安排调整。</p></div><div class="profile-hero"><div class="eyebrow">CURRENT STRATEGY / 当前策略</div><h2>${escapeHtml(p.strategy)}</h2><p>保持训练表现，同时缓慢降低体脂。你负责告诉我吃了什么，其余的我会帮你估算和整理。</p></div><div class="profile-grid"><div class="profile-card"><h3>每日建议</h3><dl><div><dt>热量范围</dt><dd>${fmt(p.caloriesMin)}–${fmt(p.caloriesMax)} kcal</dd></div><div><dt>蛋白质目标</dt><dd>约 ${fmt(p.proteinTarget)}g</dd></div><div><dt>当前目标</dt><dd>${escapeHtml(p.goal)}</dd></div></dl></div><div class="profile-card"><h3>身体与训练</h3><dl><div><dt>基础信息</dt><dd>${escapeHtml(p.gender)} · ${p.age} 岁</dd></div><div><dt>身高 / 体重</dt><dd>${p.height} cm / ${p.weight} kg</dd></div><div><dt>训练频率</dt><dd>${escapeHtml(p.frequency)}</dd></div><div><dt>训练类型</dt><dd>${escapeHtml(p.training)}</dd></div></dl></div></div><button class="profile-action" data-action="onboarding">更新身体信息与目标</button></div></main></div>`;
  }
  function renderModal() {
    if (!state.modal) return '';
    if (state.modal==='voiceFallback') return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="语音输入演示"><div class="modal-top"><div><div class="eyebrow">VOICE / 语音输入</div><h2>当前浏览器未提供语音识别</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p>你仍可以用一条示例口述体验“说一句话就记下一顿”的交互。</p><div class="modal-bottom"><span></span><button class="primary-button" data-action="voice-example">插入示例口述</button></div></div></div>`;
    if (state.modal!=='onboarding') return '';
    const s=state.onboardStep, p=state.profile;
    const titles=['先了解你的身体','你想达到什么状态？','你的训练节奏','身体照片（可选）'];
    const contents=[
      `<div class="form-grid"><label class="field">性别<select id="ob-gender"><option ${p.gender==='男'?'selected':''}>男</option><option ${p.gender==='女'?'selected':''}>女</option><option ${p.gender==='其他'?'selected':''}>其他</option></select></label><label class="field">年龄<input id="ob-age" type="number" min="16" max="100" value="${p.age}"></label><label class="field">身高（cm）<input id="ob-height" type="number" min="100" max="230" value="${p.height}"></label><label class="field">体重（kg）<input id="ob-weight" type="number" min="30" max="250" value="${p.weight}"></label></div>`,
      `<div class="option-list">${['减一点脂，让线条更明显','保持体型，增加一点肌肉','现在偏瘦，想增加肌肉感','维持目前状态'].map(x=>`<button class="option ${p.goal===x?'selected':''}" data-action="select-goal" data-value="${x}">${x}</button>`).join('')}</div>`,
      `<div class="field" style="margin-bottom:14px">每周训练频率</div><div class="option-list" style="grid-template-columns:1fr 1fr">${['0–1 次','每周 2–3 次','每周 4–5 次','每周 6+ 次'].map(x=>`<button class="option ${p.frequency===x?'selected':''}" data-action="select-frequency" data-value="${x}">${x}</button>`).join('')}</div><div class="field" style="margin:17px 0 10px">主要训练类型</div><div class="option-list">${['力量训练','跑步 / 有氧','综合训练'].map(x=>`<button class="option ${p.training===x?'selected':''}" data-action="select-training" data-value="${x}">${x}</button>`).join('')}</div>`,
      `<p>照片可以辅助理解当前身体状态。这个 Demo 不会上传或分析照片，也不以照片判断精确体脂。</p><div class="onboarding-tip">这一步可以直接跳过。完成后会更新“我的计划”和 Today 状态中的每日目标。</div>`,
    ];
    return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="新用户引导"><div class="modal-top"><div><div class="eyebrow">SET UP YOUR PLAN</div><h2>${titles[s]}</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><p>${s===0?'大约 1 分钟，先建立一个适合你的饮食目标。':s===1?'选择最接近你现在想要的状态。':s===2?'训练安排会影响你的每日建议。':'需要时，未来可以在个人资料里补充。'}</p>${contents[s]}<div class="modal-bottom"><span class="step-indicator">${s+1} / 4</span><div style="display:flex;gap:8px">${s>0?`<button class="secondary-button" data-action="onboard-back">上一步</button>`:''}<button class="primary-button" data-action="onboard-next">${s===3?'完成计划':'继续'}</button></div></div></div></div>`;
  }
  function render() {
    app.innerHTML=`<div class="app-shell">${renderSidebar()}<div class="main">${state.view==='chat'?renderChat():state.view==='history'?renderHistory():renderProfile()}</div></div>${renderMobileNav()}${renderModal()}<div class="toast" id="toast" role="status"></div>`;
    persist();
  }
  function toast(message) {
    const el=document.getElementById('toast'); if (!el) return;
    clearTimeout(toastTimer); el.textContent=message; el.classList.add('visible');
    toastTimer=setTimeout(()=>el.classList.remove('visible'),2500);
  }
  function scrollBottom() { requestAnimationFrame(()=>{const el=document.getElementById('chat-scroll'); if (el) el.scrollTop=el.scrollHeight;}); }
  function updateComposerPhoto() { render(); requestAnimationFrame(()=>document.getElementById('message-input')?.focus()); }
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
  function liveMeal(data, id, text, time) {
    return {
      id:id||uid(), type:data.type, name:data.name, calories:data.calories,
      ...(data.calorie_min!==null&&data.calorie_max!==null?{min:data.calorie_min,max:data.calorie_max}:{}),
      protein:data.protein, carbs:data.carbs, fat:data.fat, fiber:data.fiber,
      time:time||timeNow(), input:text,
    };
  }
  function finishLiveTurn(turn, text, attachment, reasoning) {
    clearInterval(thinkingTimer);
    clearTimeout(reasoningRenderTimer); reasoningRenderTimer=null;
    const elapsedSeconds=Math.max(1,Math.round((Date.now()-state.pending.startedAt)/1000));
    let receipt=null, revised=false, reply=turn.reply;
    if (turn.action==='consumed' && turn.meal) {
      const meal=liveMeal(turn.meal,null,text);
      state.meals.push(meal); receipt={...meal};
    } else if (turn.action==='correction' && turn.meal) {
      const existing=state.meals.find(m=>m.id===turn.target_meal_id);
      if (existing) {
        delete existing.min; delete existing.max;
        Object.assign(existing,liveMeal(turn.meal,existing.id,existing.input,existing.time));
        receipt={...existing}; revised=true;
      } else reply='我还不能确定要改哪一顿。请告诉我餐次或食物名称，我再帮你修正。';
    }
    state.messages.push({id:uid(),role:'user',text:text||'上传了一张食物照片',photoUrl:attachment?.url||null,time:timeNow()});
    const assistantMessage={id:uid(),role:'assistant',text:reply,receipt,revised,time:timeNow(),live:true,reasoningText:reasoning||'',elapsedSeconds};
    state.messages.push(assistantMessage);
    state.currentFeedback=assistantMessage;
    state.pending=null; state.requestError=null; render(); scrollBottom();
  }
  async function sendLiveMessage(rawText, attachment) {
    const text=rawText.trim();
    if (!text&&!attachment) return;
    state.pending={phase:'thinking',reasoning:'',reasoningOpen:false,text,startedAt:Date.now()};
    state.requestError=null;state.currentFeedback=null;state.menuOpen=false;
    state.draft='';state.attachment=null;render();scrollBottom();
    clearInterval(thinkingTimer);
    thinkingTimer=setInterval(()=>{const el=document.getElementById('thinking-seconds');if(el&&state.pending)el.textContent=`${Math.floor((Date.now()-state.pending.startedAt)/1000)} 秒`;},1000);
    try {
      const response=await fetch('/api/chat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,image:attachment?.url||null,date:new Date().toLocaleDateString('sv-SE'),profile:state.profile,today:totals(),meals:state.meals,messages:state.messages}),
      });
      if (!response.ok) {
        const error=await response.json().catch(()=>({}));
        throw new Error(error.error||`服务暂时不可用（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error('浏览器没有收到模型的数据流');
      let result=null,reasoning='';
      for await (const event of readAppEvents(response.body)) {
        if (event.type==='status') {
          state.pending.phase=event.data.phase||'thinking';
          render();
        } else if (event.type==='reasoning') {
          reasoning=event.data.text||'';
          state.pending.reasoning=reasoning;
          scheduleReasoningRender();
        } else if (event.type==='result') {
          result=event.data.result;
          reasoning=event.data.reasoning||reasoning;
        } else if (event.type==='error') throw new Error(event.data.message||'模型生成失败');
      }
      if (!result) throw new Error('模型没有返回完整结果，请重试');
      finishLiveTurn(result,text,attachment,reasoning);
    } catch (error) {
      clearInterval(thinkingTimer);
      clearTimeout(reasoningRenderTimer); reasoningRenderTimer=null;
      state.pending=null;state.requestError=error.message||'连接失败，请重试';
      state.draft=text;state.attachment=attachment||null;render();
    }
  }
  function sendMessage(rawText, attachment=state.attachment) {
    if (ensureCurrentDay()) render();
    if (state.pending) return;
    if (state.connection.mode==='live') return sendLiveMessage(rawText,attachment);
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
  function handleOnboardNext() {
    if (state.onboardStep===0) {
      const age=Number(document.getElementById('ob-age').value), height=Number(document.getElementById('ob-height').value), weight=Number(document.getElementById('ob-weight').value);
      if (!age||!height||!weight) {toast('请先填写年龄、身高和体重');return;}
      Object.assign(state.profile,{gender:document.getElementById('ob-gender').value,age,height,weight});
    }
    if (state.onboardStep<3) { state.onboardStep++; render(); return; }
    const p=state.profile;
    if (p.goal.startsWith('减一点')) Object.assign(p,{caloriesMin:2000,caloriesMax:2200,proteinTarget:135,strategy:'轻度减脂 · 保持肌肉'});
    else if (p.goal.startsWith('现在偏瘦')) Object.assign(p,{caloriesMin:2300,caloriesMax:2500,proteinTarget:140,strategy:'温和增肌 · 保持线条'});
    else if (p.goal.startsWith('保持体型')) Object.assign(p,{caloriesMin:2150,caloriesMax:2350,proteinTarget:140,strategy:'维持体型 · 增加肌肉'});
    else Object.assign(p,{caloriesMin:2100,caloriesMax:2300,proteinTarget:130,strategy:'稳定维持 · 保持状态'});
    state.modal=null; state.view='profile'; render(); toast('计划已更新');
  }
  document.addEventListener('click', e => {
    const button=e.target.closest('[data-action]'); if (!button) return;
    const action=button.dataset.action;
    if (action==='nav') {state.view=button.dataset.view;state.historyDetail=null;state.currentFeedback=null;render();window.scrollTo(0,0);}
    else if (action==='history-day') {state.view='history';state.historyDetail=button.dataset.day;state.currentFeedback=null;render();window.scrollTo(0,0);}
    else if (action==='history-back') {state.historyDetail=null;render();}
    else if (action==='expand-today') {state.expanded=!state.expanded;render();}
    else if (action==='dismiss-feedback') {state.currentFeedback=null;render();}
    else if (action==='toggle-pending-reasoning' && state.pending) {state.pending.reasoningOpen=!state.pending.reasoningOpen;render();}
    else if (action==='retry-live') sendMessage(state.draft,state.attachment);
    else if (action==='toggle-menu') {state.menuOpen=!state.menuOpen;document.getElementById('composer-menu')?.classList.toggle('open',state.menuOpen);button.setAttribute('aria-expanded',String(state.menuOpen));}
    else if (action==='open-photo') {state.menuOpen=false;document.getElementById('composer-menu')?.classList.remove('open');photoInput.click();}
    else if (action==='remove-photo') {state.attachment=null;updateComposerPhoto();}
    else if (action==='example') sendMessage(button.dataset.text);
    else if (action==='correct-meal') {state.correctionTarget=button.dataset.meal;state.draft='米饭其实只吃了一半';const input=document.getElementById('message-input'); if (input) {input.value=state.draft;input.focus();}}
    else if (action==='onboarding') {state.modal='onboarding';state.onboardStep=0;render();}
    else if (action==='close-modal') {state.modal=null;render();}
    else if (action==='onboard-back') {state.onboardStep=Math.max(0,state.onboardStep-1);render();}
    else if (action==='onboard-next') handleOnboardNext();
    else if (action==='select-goal') {state.profile.goal=button.dataset.value;render();}
    else if (action==='select-frequency') {state.profile.frequency=button.dataset.value;render();}
    else if (action==='select-training') {state.profile.training=button.dataset.value;render();}
    else if (action==='voice-demo') startVoice();
    else if (action==='voice-example') {state.modal=null;render();sendMessage('刚刚吃了两个蛋，两片吐司和一杯拿铁');}
    else if (action==='reset') {state=seedState();render();toast('演示已重置');}
  });
  document.addEventListener('submit', e => { if (e.target.id==='chat-form') {e.preventDefault();sendMessage(document.getElementById('message-input').value);} });
  document.addEventListener('input', e => { if (e.target.id==='message-input') state.draft=e.target.value; });
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
  function startVoice() {
    state.menuOpen=false;
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if (!Recognition) {state.modal='voiceFallback';render();return;}
    const recognition=new Recognition(); recognition.lang='zh-CN';recognition.interimResults=false;recognition.maxAlternatives=1;
    recognition.onresult=e=>{const transcript=e.results[0][0].transcript;sendMessage(transcript);};
    recognition.onerror=()=>toast('没有听清，可以再试一次或改用文字');
    recognition.start();toast('正在听，请说出你吃了什么');
  }
  async function checkConnection() {
    if (!/^https?:$/.test(window.location?.protocol||'')) {
      state.connection={mode:'demo',model:'',provider:''};render();return;
    }
    try {
      const response=await fetch('/api/health',{cache:'no-store'});
      if (!response.ok) throw new Error('服务未连接');
      const health=await response.json();
      state.connection=health.configured?{mode:'live',model:health.model||'LLM',provider:health.provider||'DeepSeek'}:{mode:'demo',model:'',provider:''};
    } catch {state.connection={mode:'demo',model:'',provider:''};}
    render();
  }
  window.addEventListener?.('focus',()=>{if (ensureCurrentDay()) render();});
  ensureCurrentDay();
  render();
  checkConnection();
})();
