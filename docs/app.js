/* EdgeStack paper book -- shared logic and the three pages (31 Oct 2026 redesign). No dependencies. Data is AES-GCM encrypted on GitHub and decrypted in the browser with the passphrase. */
const Edge=(()=>{
const REPO='sabeer4031/edgestack-live-dashboard';
const FILES={today:'today.enc.json',overall:'overall.enc.json'};
const TYPES=[
  {id:'buy',label:'Intraday buying',short:'Buying',color:'var(--t-buy)',help:'Long futures or bought calls / puts, flat the same day'},
  {id:'sell',label:'Intraday selling',short:'Selling',color:'var(--t-sell)',help:'Short futures or sold options, flat the same day'},
  {id:'both',label:'Intraday buying + selling',short:'Both sides',color:'var(--t-both)',help:'Trades long and short, flat the same day'},
  {id:'swing',label:'Swing / multi-day',short:'Swing',color:'var(--t-swing)',help:'Held overnight or for days'}];
const TYPE=Object.fromEntries(TYPES.map(t=>[t.id,t]));
const $=(s,r=document)=>r.querySelector(s);
const NF=new Intl.NumberFormat('en-IN');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rs=(x,sign)=>{if(x==null||isNaN(x))return '–';const a=Math.abs(Math.round(x));return (x<0?'−':(sign?'+':''))+'₹'+NF.format(a)};
const cap=x=>{if(x==null||isNaN(x))return '–';if(x>=1e7)return '₹'+(x/1e7).toFixed(2).replace(/\.?0+$/,'')+' Cr';return '₹'+(x/1e5).toFixed(1).replace(/\.0$/,'')+' L'};
const tone=x=>x>0?'good':x<0?'bad':'';
const pct=(x,d=0)=>x==null||isNaN(x)?'–':Number(x).toFixed(d)+'%';
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
let pass=store.get('edgestack_pass'),kind=null,render=null,lastOk=null,timer=null,asofTxt='',stale=false,page=null;

/* ---------- shell ---------- */
const ICON={sun:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  refresh:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  logo:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-9"/></svg>'};
function shell(on){
  document.body.innerHTML=`<header class="top"><div class="top-in"><a class="brand" href="index.html"><span class="logo">${ICON.logo}</span>EdgeStack <span class="muted" style="font-weight:500">paper book</span></a>
  <nav class="nav" aria-label="Pages">${[['index.html','Today','today'],['overall.html','Overall','overall'],['strategies.html','Strategies','strategies']].map(n=>`<a href="${n[0]}" class="${on===n[2]?'on':''}">${n[1]}</a>`).join('')}</nav>
  <div class="top-r"><span class="chip" id="status"><i class="dot" id="dot"></i><span id="stxt">connecting…</span></span>
  <button class="ibtn" id="rf" title="Refresh now" aria-label="Refresh now">${ICON.refresh}</button><button class="ibtn" id="th" title="Light / dark" aria-label="Toggle theme">${ICON.sun}</button></div></div></header>
  <main id="main"></main>`;
  $('#rf').onclick=()=>load(true);
  $('#th').onclick=()=>{const cur=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');const nx=cur==='dark'?'light':'dark';document.documentElement.dataset.theme=nx;store.set('edge_theme',nx)};
  const t=store.get('edge_theme');if(t)document.documentElement.dataset.theme=t;
  setInterval(tickStatus,1000);
}
function setStatus(txt,cls){const d=$('#dot');if(!d)return;d.className='dot '+(cls||'');$('#stxt').textContent=txt}
function tickStatus(){if(lastOk==null||!$('#dot'))return;const s=Math.round((Date.now()-lastOk)/1000);setStatus((kind==='today'?(stale?'Last session':'Live'):'Updated')+' · '+asofTxt+' · '+(s<90?s+' s':Math.round(s/60)+' min')+' ago',stale||s>(kind==='today'?240:900)?'stale':'live')}

/* ---------- data ---------- */
async function decrypt(box,pw){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(box.salt),iterations:box.iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(box.iv)},key,b64(box.ct))));
}
function gate(msg){
  $('#main').innerHTML=`<div class="gate"><div class="logo" style="margin:0 auto 12px;width:40px;height:40px;border-radius:12px">${ICON.logo}</div><h1 style="font-size:22px">Private dashboard</h1>
  <p class="muted">Enter the passphrase once per device. The data on GitHub is encrypted; it is decrypted only in this browser.</p>
  <form id="gf"><input id="pw" type="password" autocomplete="current-password" placeholder="Passphrase" aria-label="Passphrase" autofocus><button type="submit">Open</button></form><div class="err">${esc(msg||'')}</div></div>`;
  setStatus('locked','');$('#gf').onsubmit=e=>{e.preventDefault();pass=$('#pw').value;load(true)};
}
async function load(force){
  let data=null;
  const dev=store.get('edge_dev_'+kind);
  if(dev){try{data=JSON.parse(dev)}catch(e){}}
  if(!data){
    let box;
    try{const r=await fetch(`https://raw.githubusercontent.com/${REPO}/data/${FILES[kind]}?t=${Math.floor(Date.now()/(force?1000:30000))}`,{cache:'no-store'});if(!r.ok)throw new Error('data not found yet ('+r.status+')');box=await r.json()}
    catch(e){if(!lastOk){$('#main').innerHTML=`<div class="empty">Waiting for data: ${esc(e.message)}</div>`}setStatus('offline','stale');return}
    if(!pass){gate();return}
    try{data=await decrypt(box,pass);store.set('edgestack_pass',pass)}catch(e){pass=null;store.del('edgestack_pass');gate('Wrong passphrase.');return}
  }
  render(data);lastOk=Date.now();tickStatus();
}
function boot(p){
  page=p;kind=p==='today'?'today':'overall';shell(p);
  render=p==='today'?renderToday:p==='overall'?renderOverall:renderStrategies;
  load(true);clearInterval(timer);timer=setInterval(()=>{if(pass&&!document.hidden)load(false)},kind==='today'?60000:300000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pass)load(false)});
}

/* ---------- shared components ---------- */
function typeOf(s){return TYPE[s.stype]||TYPE.buy}
function tpill(s){const t=typeOf(s);return `<span class="pill tpill" style="--tc:${t.color}">${esc(t.short)}</span>`}
function seg(el,opts,cur,cb){el.innerHTML=opts.map(o=>`<button data-v="${esc(o.v)}" class="${o.v===cur?'on':''}">${esc(o.t)}</button>`).join('');el.querySelectorAll('button').forEach(b=>b.onclick=()=>{cb(b.dataset.v);el.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))})}
function tile(k,v,s,cls){return `<div class="tile"><div class="k">${k}</div><div class="v ${cls||''}">${v}</div><div class="s">${s||''}</div></div>`}
let curType=store.get('edge_type')||'all';
function typeOpts(counts){return [{v:'all',t:'All'+(counts?` · ${counts.all}`:'')},...TYPES.filter(t=>!counts||counts[t.id]).map(t=>({v:t.id,t:t.short+(counts?` · ${counts[t.id]}`:'')}))]}
function setType(v,again){curType=v;store.set('edge_type',v);again()}

function chart(series,opt={}){   // series: [[date,day,cum]]
  if(!series||series.length<2)return '<div class="empty">Not enough sessions yet for a chart.</div>';
  const W=1000,H=opt.h||240,pl=8,pr=8,pt=12,pb=22,v=series.map(x=>x[2]),lo=Math.min(0,...v),hi=Math.max(0,...v),r=(hi-lo)||1;
  const X=i=>pl+i*(W-pl-pr)/(series.length-1),Y=y=>pt+(1-(y-lo)/r)*(H-pt-pb);
  const pts=series.map((x,i)=>[X(i),Y(x[2])]);const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area=line+` L${X(series.length-1).toFixed(1)} ${Y(0).toFixed(1)} L${X(0).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const up=v[v.length-1]>=0,col=up?'var(--good)':'var(--bad)';const id='g'+Math.random().toString(36).slice(2,7);
  const ticks=[0,Math.floor(series.length/3),Math.floor(2*series.length/3),series.length-1].filter((x,i,a)=>a.indexOf(x)===i);
  return `<div class="card chart" style="position:relative"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label||'Cumulative net P&L')}" data-chart>
   <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
   <line x1="${pl}" x2="${W-pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="4 4"/>
   <path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
   ${ticks.map(i=>`<text x="${X(i)}" y="${H-5}" font-size="11" fill="var(--faint)" text-anchor="${i===0?'start':i===series.length-1?'end':'middle'}">${esc(series[i][0].slice(5))}</text>`).join('')}
   <text x="${W-pr}" y="${Math.max(pt+8,Y(hi)-4)}" font-size="11" fill="var(--faint)" text-anchor="end">${rs(hi)}</text>
   <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="4" fill="${col}"/><line data-cur x1="0" x2="0" y1="${pt}" y2="${H-pb}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/></svg><div class="tip" hidden></div></div>`;
}
function wireChart(root,series){
  const c=root.querySelector('[data-chart]');if(!c||!series)return;const tip=root.querySelector('.tip'),cur=c.querySelector('[data-cur]');
  const W=1000,pl=8,pr=8;
  c.onpointermove=e=>{const b=c.getBoundingClientRect(),x=(e.clientX-b.left)/b.width*W,i=Math.max(0,Math.min(series.length-1,Math.round((x-pl)/(W-pl-pr)*(series.length-1))));
    const px=pl+i*(W-pl-pr)/(series.length-1);cur.setAttribute('x1',px);cur.setAttribute('x2',px);cur.setAttribute('visibility','visible');
    tip.hidden=false;tip.innerHTML=`<b>${esc(series[i][0])}</b><br>Day ${rs(series[i][1],1)} · Total ${rs(series[i][2],1)}`;tip.style.left=(px/W*b.width+14)+'px';tip.style.top='34px'};
  c.onpointerleave=()=>{tip.hidden=true;cur.setAttribute('visibility','hidden')};
}
function monthBars(series){
  const m={};series.forEach(x=>{const k=x[0].slice(0,7);m[k]=(m[k]||0)+x[1]});const ks=Object.keys(m).sort();if(!ks.length)return '';
  const mx=Math.max(...ks.map(k=>Math.abs(m[k])))||1;
  return `<div class="card pad"><div style="display:grid;gap:7px">${ks.map(k=>`<div style="display:grid;grid-template-columns:64px 1fr 96px;gap:10px;align-items:center;font-size:12.5px"><span class="muted">${k}</span><span style="display:flex;${m[k]<0?'justify-content:flex-end;':''}"><i style="display:block;height:10px;border-radius:5px;width:${Math.max(2,Math.abs(m[k])/mx*100)}%;background:var(--${m[k]>=0?'good':'bad'});opacity:.85"></i></span><b class="num ${tone(m[k])}" style="text-align:right">${rs(m[k],1)}</b></div>`).join('')}</div></div>`;
}

/* ---------- TODAY ---------- */
function openPnl(s){            // value of the Open P&L cell plus a tag that says why a position has no live price (31 Oct 2026)
  const o=s.open||[];if(!o.length)return '–';
  const n={live:0,mid:0,last:0,none:0};o.forEach(p=>n[p.price_state||'none']++);
  const why=(o.find(p=>p.why_unpriced)||{}).why_unpriced||'no quote';
  const lastT=(o.find(p=>p.price_state==='last')||{}).price_asof;
  let v=s.marked?`<span class="${tone(s.unreal)}">${rs(s.unreal,1)}</span>`:'';
  if(n.none)v+=(v?' ':'')+`<span class="pill warn" title="${esc(why)}">${n.none===o.length?'no price':n.none+' no price'}</span>`;
  if(n.last)v+=` <span class="pill" title="Newest price the engine had (${esc(lastT||'')} IST); the feed is not live now">last ${esc(lastT||'')}</span>`;
  if(n.mid)v+=` <span class="pill" title="This option has a bid and ask but has not traded yet; valued at the middle of the two">mid</span>`;
  return v||'–';
}
function renderToday(T){
  const S=(T.strategies||[]).map(s=>({...s,day:s.net+(s.marked?s.unreal:0)}));
  const IST=new Date(Date.now()+ (new Date().getTimezoneOffset()+330)*60000),todayIso=IST.toISOString().slice(0,10);
  stale=T.date!==todayIso;asofTxt=`${T.date.slice(5)} ${T.asof.slice(0,5)} IST`;
  const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  const dayTot=T.net+(T.marked?T.unreal:0),dt=new Date(T.date+'T00:00:00');
  const groups=TYPES.map(t=>{const rows=S.filter(s=>s.stype===t.id);return {t,rows,day:rows.reduce((a,s)=>a+s.day,0),cap:rows.reduce((a,s)=>a+(s.capital||0),0),n:rows.length,closed:rows.reduce((a,s)=>a+s.closed,0),open:rows.reduce((a,s)=>a+(s.open||[]).length,0)}}).filter(g=>g.n);
  $('#main').innerHTML=`
  <div class="hero"><div><div class="lbl">${esc(dt.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${stale?' · last session':''}</div><div class="big ${tone(dayTot)}">${rs(dayTot,1)}</div><div class="muted" style="margin-top:4px">Day so far: booked + open positions at live prices</div></div>
   <div class="side"><div><span class="lbl">Booked</span><b class="${tone(T.net)}">${rs(T.net,1)}</b></div><div><span class="lbl">Open, priced</span><b class="${tone(T.unreal)}">${T.marked?rs(T.unreal,1):'n/a'}</b></div><div><span class="lbl">Charges</span><b>${rs(T.costs)}</b></div></div></div>
  <div class="tiles">${tile('Closed positions',NF.format(T.closed),`${S.filter(s=>s.closed).length} strategies traded`)}${tile('Open positions',NF.format(T.open_total),T.open_total?`${T.marked} of ${T.open_total} priced${S.reduce((a,s)=>a+(s.open||[]).filter(p=>p.price_state==='last').length,0)?' · some at last price':''}`:'none open')}${tile('Capital behind today',cap(T.capital_total),'sum of each strategy’s own need; they rarely peak together')}${tile('Strategies active',NF.format(S.length),groups.map(g=>g.t.short+' '+g.n).join(' · '))}</div>
  <h2>By strategy type <span class="aside">click a card to filter</span></h2>
  <div class="types">${groups.map(g=>`<button class="tcard ${curType===g.t.id?'on':''}" data-t="${g.t.id}" style="--tc:${g.t.color}"><div class="n">${esc(g.t.label)}<small>${g.n} strateg${g.n>1?'ies':'y'}</small></div><div class="pl ${tone(g.day)}">${rs(g.day,1)}</div><div class="meta">${g.closed} closed · ${g.open} open · capital ${cap(g.cap)}</div></button>`).join('')}</div>
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy…" aria-label="Search strategy"><span class="grow"></span></div>
  <div class="tw"><table id="tbl"></table></div>
  <h2>Trades today <span class="aside">${(T.trades||[]).length} closed</span></h2><div class="tw" id="trades"></div>
  <p class="note">${esc(T.note||'')} Strategy type is worked out from the ledger: <b>swing</b> = held past the day it opened; <b>selling</b> = only short positions (short futures, sold options); <b>buying</b> = only long positions (long futures, bought calls and puts). Capital = margin estimate plus a safety cushion (“est.” = from the backtest because the strategy has no paper trades yet).</p>`;
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');
    const rows=S.filter(s=>(curType==='all'||s.stype===curType)&&(!q||s.strategy.toLowerCase().replace(/_/g,' ').includes(q)));
    const mx=Math.max(1,...rows.map(s=>Math.abs(s.day)));let h='';
    TYPES.forEach(t=>{const rs_=rows.filter(s=>s.stype===t.id).sort((a,b)=>b.day-a.day);if(!rs_.length)return;
      const sub=rs_.reduce((a,s)=>a+s.day,0);
      h+=`<tr class="grp"><td class="l" colspan="2"><span class="gl"><span class="sd" style="width:9px;height:9px;border-radius:3px;background:${t.color}"></span>${esc(t.label)} <span class="muted" style="font-weight:450">${rs_.length}</span></span></td><td></td><td></td><td></td><td></td><td class="${tone(sub)}">${rs(sub,1)}</td></tr>`;
      rs_.forEach(s=>{const o=(s.open||[]).length;h+=`<tr class="row"><td class="l"><div class="sname" style="--tc:${t.color}"><span class="sd"></span><span>${esc(s.strategy)}</span></div></td>
       <td>${s.capital?cap(s.capital)+(s.capital_basis==='estimate'?' <span class="faint">est.</span>':''):'–'}</td><td>${s.closed||'–'}</td><td class="${tone(s.net)}">${s.closed?rs(s.net,1):'–'}</td>
       <td>${o||'–'}</td><td>${openPnl(s)}</td>
       <td class="${tone(s.day)}" style="font-weight:650">${(s.closed||s.marked)?rs(s.day,1):'–'}<i class="bar" style="width:${Math.abs(s.day)/mx*70}px;background:var(--${s.day>=0?'good':'bad'});opacity:.7"></i></td></tr>`})});
    $('#tbl').innerHTML=`<thead><tr><th class="l">Strategy</th><th>Capital</th><th>Closed</th><th>Booked</th><th>Open</th><th>Open P&amp;L</th><th>Day so far</th></tr></thead><tbody>${h||'<tr><td class="l" colspan="7"><div class="empty">No strategies match.</div></td></tr>'}</tbody>`};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw();document.querySelectorAll('.tcard').forEach(c=>c.classList.toggle('on',c.dataset.t===v))});
  document.querySelectorAll('.tcard').forEach(c=>c.onclick=()=>{const v=curType===c.dataset.t?'all':c.dataset.t;curType=v;store.set('edge_type',v);document.querySelectorAll('.tcard').forEach(x=>x.classList.toggle('on',x.dataset.t===v));seg($('#seg'),typeOpts(counts),v,x=>{curType=x;store.set('edge_type',x);draw();document.querySelectorAll('.tcard').forEach(y=>y.classList.toggle('on',y.dataset.t===x))});draw()});
  $('#q').oninput=draw;draw();
  const tr=T.trades||[],tm=Object.fromEntries(S.map(s=>[s.strategy,s]));
  $('#trades').innerHTML=tr.length?`<table><thead><tr><th class="l">Strategy</th><th class="l">Instrument</th><th class="l">Side</th><th>In</th><th>Out</th><th>Entry → exit</th><th class="l">Why</th><th>Net</th></tr></thead><tbody>${tr.map(t=>`<tr class="row"><td class="l"><div class="sname" style="--tc:${(tm[t.strategy]?typeOf(tm[t.strategy]):TYPE.buy).color}"><span class="sd"></span>${esc(t.strategy)}</div></td><td class="l">${esc(t.label||t.instrument||'')}</td><td class="l"><span class="pill ${t.side==='LONG'?'accent':'warn'}">${esc(t.side)}</span></td><td>${esc(t.entry_time)}</td><td>${esc(t.exit_time)}</td><td>${t.entry==null?'–':NF.format(Math.round(t.entry*100)/100)} → ${t.exit==null?'–':NF.format(Math.round(t.exit*100)/100)}</td><td class="l muted">${esc(t.reason||'')}</td><td class="${tone(t.net)}">${rs(t.net,1)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No closed trades yet.</div>';
}

/* ---------- OVERALL ---------- */
let sortK='net',sortD=-1;
function renderOverall(O){
  stale=false;asofTxt='through '+O.data_through;
  const S=(O.strategies||[]).filter(s=>s.positions||s.open);
  const wins=S.reduce((a,s)=>a+(s.win_pct||0)*s.positions/100,0),pos=S.reduce((a,s)=>a+s.positions,0);
  const gw=S.reduce((a,s)=>a+(s.win_pct||0)/100*s.positions*(s.avg_win||0),0),gl=S.reduce((a,s)=>a+(1-(s.win_pct||0)/100)*s.positions*Math.abs(s.avg_loss||0),0);
  const ser=O.series||[];let peak=0,mdd=0;ser.forEach(x=>{peak=Math.max(peak,x[2]);mdd=Math.min(mdd,x[2]-peak)});
  const days=ser.map(x=>x[1]),bestD=days.length?Math.max(...days):null,worstD=days.length?Math.min(...days):null,posD=days.filter(x=>x>0).length;
  const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  const groups=TYPES.map(t=>{const rows=S.filter(s=>s.stype===t.id);return {t,rows,net:rows.reduce((a,s)=>a+s.net,0),cap:rows.reduce((a,s)=>a+(s.capital||0),0),pos:rows.reduce((a,s)=>a+s.positions,0)}}).filter(g=>g.rows.length);
  $('#main').innerHTML=`
  <div class="hero"><div><div class="lbl">Net P&amp;L since the forward tests began</div><div class="big ${tone(O.net)}">${rs(O.net,1)}</div><div class="muted" style="margin-top:4px">${NF.format(pos)} closed positions over ${O.days} sessions · after brokerage, STT and all charges</div></div>
   <div class="side"><div><span class="lbl">Gross</span><b class="${tone(O.gross)}">${rs(O.gross,1)}</b></div><div><span class="lbl">Charges</span><b>${rs(O.costs)}</b></div><div><span class="lbl">Open, unrealised</span><b class="${tone(O.unreal)}">${O.unreal?rs(O.unreal,1):'–'}</b></div></div></div>
  <div class="tiles">${tile('Win rate',pct(pos?100*wins/pos:null,1),`${NF.format(Math.round(wins))} of ${NF.format(pos)} positions`)}${tile('Profit factor',gl>0?(gw/gl).toFixed(2):'–','gross wins ÷ gross losses, after charges')}${tile('Max drawdown',rs(mdd),'largest fall from a peak in cumulative P&L','bad')}${tile('Winning sessions',pct(ser.length?100*posD/ser.length:null,0),`${posD} of ${ser.length} · best ${rs(bestD,1)} · worst ${rs(worstD,1)}`)}</div>
  <h2>Cumulative P&amp;L <span class="aside">hover for the day</span></h2><div id="ch">${chart(ser)}</div>
  <div class="types" style="margin-top:14px">${groups.map(g=>`<div class="tcard" style="--tc:${g.t.color}"><div class="n">${esc(g.t.label)}<small>${g.rows.length} strateg${g.rows.length>1?'ies':'y'}</small></div><div class="pl ${tone(g.net)}">${rs(g.net,1)}</div><div class="meta">${NF.format(g.pos)} positions · capital ${cap(g.cap)}</div></div>`).join('')}</div>
  <h2>By month</h2>${monthBars(ser)}
  <h2>Strategy league table <span class="aside">click a column to sort</span></h2>
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy…" aria-label="Search strategy"></div>
  <div class="tw"><table id="tbl"></table></div>
  <p class="note">${esc(O.note||'')} Return on capital = net P&amp;L ÷ the strategy’s capital need (margin estimate plus cushion). With a few sessions these numbers are small samples: they show execution and costs, not a ranking to trade on.</p>`;
  wireChart($('#ch'),ser);
  const COLS=[['strategy','Strategy','l'],['stype','Type','l'],['capital','Capital'],['positions','Positions'],['win_pct','Win %'],['pf','PF'],['net','Net P&L'],['roc','Return on capital'],['costs','Charges'],['days','Sessions'],['best_day','Best day'],['worst_day','Worst day']];
  const val=(s,k)=>k==='roc'?(s.capital?s.net/s.capital*100:null):k==='stype'?(TYPE[s.stype]||{}).short:s[k];
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');
    const rows=S.filter(s=>(curType==='all'||s.stype===curType)&&(!q||s.strategy.toLowerCase().replace(/_/g,' ').includes(q))).sort((a,b)=>{const x=val(a,sortK),y=val(b,sortK);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:x>y?1:0)*sortD});
    $('#tbl').innerHTML=`<thead><tr>${COLS.map(c=>`<th class="sortable ${c[2]||''}" data-k="${c[0]}">${c[1]}${sortK===c[0]?(sortD<0?' ▾':' ▴'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(s=>{const t=typeOf(s),roc=val(s,'roc');return `<tr class="row"><td class="l"><div class="sname" style="--tc:${t.color}"><span class="sd"></span><span>${esc(s.strategy)}${s.status&&s.status!=='running'?`<small>${esc(s.status)}</small>`:''}</span></div></td><td class="l">${tpill(s)}</td>
      <td>${s.capital?cap(s.capital)+(s.capital_basis==='estimate'?' <span class="faint">est.</span>':''):'–'}</td><td>${s.positions}</td><td>${s.win_pct==null?'–':pct(s.win_pct,0)}</td><td>${s.pf==null?'–':s.pf}</td><td class="${tone(s.net)}" style="font-weight:650">${rs(s.net,1)}</td><td class="${tone(roc)}">${roc==null?'–':(roc>0?'+':'')+roc.toFixed(1)+'%'}</td><td>${rs(s.costs)}</td><td>${s.days} <span class="faint">(${s.pos_days}+)</span></td><td class="good">${rs(s.best_day)}</td><td class="bad">${rs(s.worst_day)}</td></tr>`}).join('')||'<tr><td class="l" colspan="12"><div class="empty">No strategies match.</div></td></tr>'}</tbody>`;
    $('#tbl').querySelectorAll('th.sortable').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(sortK===k)sortD=-sortD;else{sortK=k;sortD=(k==='strategy'||k==='stype')?1:-1}draw()})};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw()});$('#q').oninput=draw;draw();
}

/* ---------- STRATEGIES (catalogue) ---------- */
function renderStrategies(O){
  stale=false;asofTxt='through '+O.data_through;
  const S=O.strategies||[];const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  $('#main').innerHTML=`<h1>Strategies</h1><p class="sub">${S.length} paper-book strategies in ${TYPES.filter(t=>counts[t.id]).length} groups. Each is a separate engine with its own ledger; all are experimental forward tests.</p>
  <div class="types">${TYPES.filter(t=>counts[t.id]).map(t=>`<div class="tcard" style="--tc:${t.color}"><div class="n">${esc(t.label)}<small>${counts[t.id]}</small></div><div class="meta" style="margin-top:6px">${esc(t.help)}</div></div>`).join('')}</div>
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy…" aria-label="Search strategy"></div><div id="cards"></div>`;
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');let h='';
    TYPES.forEach(t=>{const rows=S.filter(s=>s.stype===t.id&&(curType==='all'||curType===t.id)&&(!q||(s.strategy+' '+(s.one_line||'')).toLowerCase().replace(/_/g,' ').includes(q))).sort((a,b)=>b.net-a.net);if(!rows.length)return;
      h+=`<h2><span class="sd" style="width:10px;height:10px;border-radius:3px;background:${t.color};display:inline-block"></span>${esc(t.label)} <span class="aside">${rows.length}</span></h2><div class="cards">${rows.map(s=>{const run=s.status==='running',wait=/waiting|no trades/.test(s.status||'');
        return `<div class="scard" style="--tc:${t.color}"><h3><span>${esc(s.strategy)}</span><span class="pill ${run?'good':wait?'warn':''}">${esc(run?'running':wait?(s.status.replace(/^waiting: /,'')||'waiting'):s.status)}</span></h3><p>${esc(s.one_line||'No description card yet.')}</p>
        <div class="kv"><div><span>Capital</span><b>${s.capital?cap(s.capital):'–'}${s.capital_basis==='estimate'?' <small class="faint">est.</small>':''}</b></div><div><span>Net so far</span><b class="${tone(s.net)}">${s.positions?rs(s.net,1):'–'}</b></div><div><span>Positions</span><b>${s.positions||0}</b></div></div></div>`}).join('')}</div>`});
    $('#cards').innerHTML=h||'<div class="empty">No strategies match.</div>'};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw()});$('#q').oninput=draw;draw();
}
return {boot};
})();
