/* EdgeStack paper book -- shared logic and the three pages (31 Oct 2026 redesign). No dependencies. Data is AES-GCM encrypted on GitHub and decrypted in the browser with the passphrase. */
const Edge=(()=>{
const REPO='sabeer4031/edgestack-live-dashboard';
const FILES={today:'today.enc.json',overall:'overall.enc.json',trades:'trades.enc.json'};
const TYPES=[
  {id:'buy',label:'Intraday buying',short:'Buying',color:'var(--t-buy)',help:'Long futures or bought calls / puts, flat the same day'},
  {id:'sell',label:'Intraday selling (short futures)',short:'Short futures',color:'var(--t-sell)',help:'Short futures only (no option is ever sold), flat the same day'},
  {id:'both',label:'Intraday futures long + short',short:'Futures long + short',color:'var(--t-both)',help:'Futures bought on some days and shorted on others, flat the same day'},
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
  <nav class="nav" aria-label="Pages">${[['index.html','Today','today'],['overall.html','Overall','overall'],['trades.html','Trades','trades'],['strategies.html','Strategies','strategies']].map(n=>`<a href="${n[0]}" class="${on===n[2]?'on':''}">${n[1]}</a>`).join('')}</nav>
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
  page=p;kind=p==='today'?'today':p==='trades'?'trades':'overall';shell(p);
  render=p==='today'?renderToday:p==='overall'?renderOverall:p==='trades'?renderTrades:renderStrategies;
  load(true);clearInterval(timer);timer=setInterval(()=>{if(pass&&!document.hidden)load(false)},kind==='today'?60000:300000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pass)load(false)});
}

/* ---------- shared components ---------- */
function typeOf(s){return TYPE[s.stype]||TYPE.buy}
/* 28 Nov 2026 (user): MCX (commodity) strategies are never mixed into the NSE tables; they get their own table and totals. */
const isMcx=s=>s.market==='MCX'||!!s._mcx||/ · MCX /.test(s.strategy||'');
const MCXC='var(--t-mcx)';
function mktLine(nse,mcx,f){f=f||(x=>rs(x,1));return `<span class="mkt"><span><i class="sd" style="background:var(--accent)"></i>NSE <b class="${tone(nse)}">${f(nse)}</b></span><span><i class="sd" style="background:${MCXC}"></i>MCX <b class="${tone(mcx)}">${f(mcx)}</b></span></span>`}
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
/* 20 Nov 2026: click a strategy row -> its open positions (live price, entry, live P&L, stop, risk) and today's closed trades (entry, exit, net). */
const slTxt=t=>t.stop==null?'<span class="nosl">No SL for this trade</span>':px2(t.stop)+(t.stop_on==='underlying'?' <span class="faint">on underlying</span>':'');
const px2=x=>x==null||isNaN(x)?'–':NF.format(Math.round(x*100)/100);
const openSet=new Set();
function skipBlock(key,T){const k=(T.skips||{})[String(key).split(' · ')[0].toUpperCase()];if(!k||!k.length)return '';return `<div class="dh">Why it did not trade more <span class="muted">from the engine log</span></div><ul class="sk">${k.map(r=>`<li>${esc(r.msg)}${r.n>1?` <span class="faint">×${r.n}</span>`:''}</li>`).join('')}</ul>`}
function detail(s,T){
  const o=s.open||[],cl=(T.trades||[]).filter(t=>t.strategy===s.strategy);
  const stopTxt=p=>p.stop==null?'<span class="nosl">No SL for this trade</span>':px2(p.stop)+(p.stop_on==='underlying'?' <span class="faint" title="This option is stopped when its underlying reaches this price, not on the option price">on underlying'+(p.under!=null?` · now ${px2(p.under)}`:'')+'</span>':'');
  const priceTag=p=>p.price_state==='last'?` <span class="pill" title="Newest price the engine had; the feed is not live now">last ${esc(p.price_asof||'')}</span>`:p.price_state==='mid'?' <span class="pill" title="Bid/ask middle; no trade yet">mid</span>':p.price_state==='none'?' <span class="pill warn" title="'+esc(p.why_unpriced||'')+'">no price</span>':'';
  let h='<div class="dwrap">';
  h+=o.length?`<div class="dh">Open positions <span class="muted">${o.length}</span></div><div class="tw2"><table class="dt"><thead><tr><th class="l">Instrument</th><th class="l">Side</th><th>Qty</th><th>Entry</th><th>Live price</th><th>Exit</th><th>Live P&amp;L</th><th>Stop (SL)</th><th>Loss if stop hits</th><th>Since</th></tr></thead><tbody>${o.map(p=>`<tr><td class="l">${esc(p.label?p.instrument+' '+p.label:p.instrument||'')}</td><td class="l"><span class="pill ${p.side==='LONG'?'accent':'warn'}">${esc(p.side)}</span></td><td>${NF.format(p.qty||0)}</td><td>${px2(p.entry)}</td><td>${px2(p.now)}${priceTag(p)}</td><td class="faint">open</td><td class="${tone(p.unrealised)}">${p.unrealised==null?'–':rs(p.unrealised,1)}</td><td>${stopTxt(p)}</td><td title="${esc(p.risk_basis||'')}">${p.risk==null?'<span class="faint">'+(p.stop==null?'no SL':'–')+(p.side==='SHORT'?' · not capped':'')+'</span>':rs(p.risk)}${p.risk!=null&&p.risk_basis!=='stop'?' <span class="faint">prem.</span>':''}</td><td>${esc((p.since||'').slice(5))}${p.carried?' <span class="pill">carried</span>':''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="faint dh">No open positions.</div>';
  if(cl.length)h+=`<div class="dh">Closed today <span class="muted">${cl.length}</span></div><div class="tw2"><table class="dt"><thead><tr><th class="l">Instrument</th><th class="l">Side</th><th>In</th><th>Out</th><th>Entry</th><th>Exit</th><th>Stop (SL)</th><th class="l">Why</th><th>Net</th></tr></thead><tbody>${cl.map(t=>`<tr><td class="l">${esc(t.label?t.instrument+' '+t.label:t.instrument||'')}</td><td class="l"><span class="pill ${t.side==='LONG'?'accent':'warn'}">${esc(t.side)}</span></td><td>${esc(t.entry_time)}</td><td>${esc(t.exit_time)}</td><td>${px2(t.entry)}</td><td>${px2(t.exit)}</td><td>${slTxt(t)}</td><td class="l muted">${esc(t.reason||'')}</td><td class="${tone(t.net)}">${rs(t.net,1)}</td></tr>`).join('')}</tbody></table></div>`;
  if((s.notes||[]).length)h+=`<div class="dh">Status <span class="muted">MCX live view</span></div><ul class="sk">${s.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`;
  h+=skipBlock(s.strategy,T);
  return h+'<div class="dn">Live P&amp;L is before exit charges. Prices refresh about every 2 minutes during market hours. A stop on an option is usually on the underlying, so its rupee loss is shown as the premium paid.</div></div>';
}
function riskPanel(S,T){
  const all=S.flatMap(s=>(s.open||[]).map(p=>({...p,strategy:s.strategy})));if(!all.length)return '';
  const stopped=all.filter(p=>p.risk_basis==='stop'),prem=all.filter(p=>p.risk!=null&&p.risk_basis!=='stop'),nostop=all.filter(p=>p.risk==null);
  const sum=a=>a.reduce((x,p)=>x+(p.risk||0),0);
  const fut=all.filter(p=>!p.is_option&&p.notional);const ex={};fut.forEach(p=>{ex[p.instrument]=(ex[p.instrument]||0)+p.notional*(p.side==='LONG'?1:-1)});
  const exl=Object.entries(ex).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,6);
  const bys={};all.forEach(p=>{if(p.risk!=null)bys[p.strategy]=(bys[p.strategy]||0)+p.risk});
  const top=Object.entries(bys).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const longN=fut.filter(p=>p.side==='LONG').reduce((a,p)=>a+p.notional,0),shortN=fut.filter(p=>p.side==='SHORT').reduce((a,p)=>a+p.notional,0);
  return `<h2>Risk right now <span class="aside">${all.length} open positions</span></h2>
  <div class="tiles">${tile('Loss if every stop hits',rs(sum(stopped)),`${stopped.length} positions with a price stop`,'bad')}${tile('Premium at risk',rs(sum(prem)),`${prem.length} bought options (most they can lose)`)}${tile('No stop set',NF.format(nostop.length),nostop.length?'futures held without a stop, and sold options':'every position has a stop or capped risk',nostop.length?'warn':'')}${tile('Futures exposure',rs(longN-shortN,1),`long ${cap(longN)} · short ${cap(shortN)}`)}</div>
  <div class="two"><div class="card pad"><div class="lbl2">Biggest net futures exposure</div>${exl.length?exl.map(([k,v])=>`<div class="rr"><span>${esc(k)}</span><b class="num">${v>0?'long':'short'} ${cap(Math.abs(v))}</b></div>`).join(''):'<span class="muted">none</span>'}</div>
  <div class="card pad"><div class="lbl2">Biggest stop / premium risk by strategy</div>${top.length?top.map(([k,v])=>`<div class="rr"><span>${esc(k)}</span><b class="num bad">${rs(v)}</b></div>`).join(''):'<span class="muted">none</span>'}</div></div>`;
}
function feedBanner(T,S,stale_){
  const ist=new Date(Date.now()+(new Date().getTimezoneOffset()+330)*60000),hm=ist.getHours()*60+ist.getMinutes();
  if(stale_||ist.getDay()%6===0||hm<555||hm>950)return '';   // only while the market feed is expected to be live (09:15-15:50 IST, weekdays)
  const un=S.reduce((a,s)=>a+(s.open||[]).filter(p=>p.price_state==='none').length,0),ls=S.reduce((a,s)=>a+(s.open||[]).filter(p=>p.price_state==='last').length,0);
  const msg=[];if(T.marks_age!=null&&T.marks_age>180)msg.push(`the engine’s price file is ${Math.round(T.marks_age/60)} min old`);if(un)msg.push(`${un} open position${un>1?'s have':' has'} no live price`);if(ls)msg.push(`${ls} shown at last known price`);
  return msg.length?`<div class="banner warn">Feed check: ${esc(msg.join(' · '))}. Unrealised P&amp;L may be off until prices return.</div>`:'';
}
function snapsBlock(T){const sn=T.snaps||{},ks=Object.keys(sn).sort();if(!ks.length)return '';
  return `<h2>Through the day <span class="aside">saved at 09:30, 12:00 and 15:00 IST</span></h2><div class="tw"><table><thead><tr><th class="l">Time</th><th>Closed</th><th>Open</th><th>Booked</th><th>Open P&amp;L</th><th>Day so far</th></tr></thead><tbody>${ks.map(k=>{const v=sn[k];return `<tr class="row"><td class="l">${k} IST</td><td>${v.closed}</td><td>${v.open}</td><td class="${tone(v.net)}">${rs(v.net,1)}</td><td class="${tone(v.unreal)}">${rs(v.unreal,1)}</td><td class="${tone(v.net+v.unreal)}" style="font-weight:650">${rs(v.net+v.unreal,1)}</td></tr>`}).join('')}</tbody></table></div>`}
function noTrade(T,S){const have=new Set(S.map(s=>s.strategy.split(' · ')[0].toUpperCase()));const ks=Object.keys(T.skips||{}).filter(k=>!have.has(k));if(!ks.length)return '';
  return `<h2>Why no trade <span class="aside">strategies that logged a skip and have no position today</span></h2><div class="card pad">${ks.map(k=>`<div class="dh">${esc(k)}</div><ul class="sk">${T.skips[k].map(r=>`<li>${esc(r.msg)}${r.n>1?` <span class="faint">×${r.n}</span>`:''}</li>`).join('')}</ul>`).join('')}<div class="dn" style="margin-top:8px">Only engines that print a skip line to their log appear here; a strategy that is silent simply had no signal.</div></div>`}
function renderToday(T){
  const SA=(T.strategies||[]).map(s=>({...s,day:s.net+(s.marked?s.unreal:0)})),S=SA.filter(s=>!isMcx(s)),SM=SA.filter(isMcx);
  const mcxSet=new Set(SM.map(s=>s.strategy)),trIsMcx=t=>t.market==='MCX'||mcxSet.has(t.strategy);
  const nseDay=S.reduce((a,s)=>a+s.day,0),mcxDay=SM.reduce((a,s)=>a+s.day,0);
  const IST=new Date(Date.now()+ (new Date().getTimezoneOffset()+330)*60000),todayIso=IST.toISOString().slice(0,10);
  stale=T.date!==todayIso;asofTxt=`${T.date.slice(5)} ${T.asof.slice(0,5)} IST`;
  const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  const dayTot=T.net+(T.marked?T.unreal:0),dt=new Date(T.date+'T00:00:00');
  const groups=TYPES.map(t=>{const rows=S.filter(s=>s.stype===t.id);return {t,rows,day:rows.reduce((a,s)=>a+s.day,0),cap:rows.reduce((a,s)=>a+(s.capital||0),0),n:rows.length,closed:rows.reduce((a,s)=>a+s.closed,0),open:rows.reduce((a,s)=>a+(s.open||[]).length,0)}}).filter(g=>g.n);
  $('#main').innerHTML=`${feedBanner(T,S,stale)}
  <div class="hero"><div><div class="lbl">${esc(dt.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${stale?' · last session':''}</div><div class="big ${tone(dayTot)}">${rs(dayTot,1)}</div><div class="muted" style="margin-top:4px">Day so far: booked + open positions at live prices</div>${mktLine(nseDay,mcxDay)}</div>
   <div class="side"><div><span class="lbl">Booked</span><b class="${tone(T.net)}">${rs(T.net,1)}</b></div><div><span class="lbl">Open, priced</span><b class="${tone(T.unreal)}">${T.marked?rs(T.unreal,1):'n/a'}</b></div><div><span class="lbl">Charges</span><b>${rs(T.costs)}</b></div></div></div>
  <div class="tiles">${tile('Closed positions',NF.format(T.closed),`${SA.filter(s=>s.closed).length} strategies traded (NSE + MCX)`)}${tile('Open positions',NF.format(T.open_total),T.open_total?`${T.marked} of ${T.open_total} priced${S.reduce((a,s)=>a+(s.open||[]).filter(p=>p.price_state==='last').length,0)?' · some at last price':''}`:'none open')}${tile('Capital behind today',cap(T.capital_total),'sum of each strategy’s own need; they rarely peak together')}${tile('Strategies active',NF.format(SA.length),groups.map(g=>g.t.short+' '+g.n).join(' · ')+(SM.length?' · MCX '+SM.length:''))}</div>
  ${riskPanel(SA,T)}
  ${snapsBlock(T)}
  <h2>By strategy type <span class="aside">click a card to filter</span></h2>
  <div class="types">${groups.map(g=>`<button class="tcard ${curType===g.t.id?'on':''}" data-t="${g.t.id}" style="--tc:${g.t.color}"><div class="n">${esc(g.t.label)}<small>${g.n} strateg${g.n>1?'ies':'y'}</small></div><div class="pl ${tone(g.day)}">${rs(g.day,1)}</div><div class="meta">${g.closed} closed · ${g.open} open · capital ${cap(g.cap)}</div></button>`).join('')}</div>
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy…" aria-label="Search strategy"><span class="grow"></span><span class="muted" style="font-size:12px">click a row for its positions</span></div>
  <div class="tw"><table id="tbl"></table></div>
  <h2>Trades today <span class="aside">NSE · ${(T.trades||[]).filter(t=>!trIsMcx(t)).length} closed</span></h2><div class="tw" id="trades"></div>
  ${noTrade(T,SA)}
  <h2 class="mcxh"><span class="sd" style="width:10px;height:10px;border-radius:3px;background:${MCXC};display:inline-block"></span>MCX (commodity) strategies <span class="aside">own table, not in the NSE totals above · click a row for its positions</span></h2>
  <div class="tw"><table id="mtbl"></table></div>
  <h3 class="sub3">MCX trades today <span class="aside">${(T.trades||[]).filter(trIsMcx).length} closed</span></h3><div class="tw" id="mtrades"></div>
  ${(T.mcx_notes||[]).length?`<p class="note"><b>MCX:</b> live only from 15:46 IST (the MCX price feed starts 15:45). ${T.mcx_notes.map(esc).join(' ')}</p>`:''}
  <p class="note">${esc(T.note||'')} Strategy type is worked out from the ledger: <b>swing</b> = held past the day it opened; <b>selling</b> = short futures only (no strategy sells options); <b>buying</b> = long futures or bought calls / puts; <b>futures long + short</b> = futures on both sides. Each variation (index, futures leg, options leg) is its own row. Capital = margin estimate plus a safety cushion (“est.” = from the backtest because the strategy has no paper trades yet).</p>`;
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');
    const rows=S.filter(s=>(curType==='all'||s.stype===curType)&&(!q||s.strategy.toLowerCase().replace(/_/g,' ').includes(q)));
    const mx=Math.max(1,...rows.map(s=>Math.abs(s.day)));let h='';
    TYPES.forEach(t=>{const rs_=rows.filter(s=>s.stype===t.id).sort((a,b)=>b.day-a.day);if(!rs_.length)return;
      const sub=rs_.reduce((a,s)=>a+s.day,0);
      h+=`<tr class="grp"><td class="l" colspan="2"><span class="gl"><span class="sd" style="width:9px;height:9px;border-radius:3px;background:${t.color}"></span>${esc(t.label)} <span class="muted" style="font-weight:450">${rs_.length}</span></span></td><td></td><td></td><td></td><td></td><td class="${tone(sub)}">${rs(sub,1)}</td></tr>`;
      rs_.forEach(s=>{h+=tRow(s,t.color,mx)})});
    const tot=rows.reduce((a,s)=>a+s.day,0);
    $('#tbl').innerHTML=THEAD+`<tbody>${h||'<tr><td class="l" colspan="7"><div class="empty">No strategies match.</div></td></tr>'}</tbody>`+(rows.length?`<tfoot><tr class="tot"><td class="l">NSE total</td><td></td><td>${rows.reduce((a,s)=>a+s.closed,0)}</td><td class="${tone(rows.reduce((a,s)=>a+s.net,0))}">${rs(rows.reduce((a,s)=>a+s.net,0),1)}</td><td>${rows.reduce((a,s)=>a+(s.open||[]).length,0)}</td><td></td><td class="${tone(tot)}">${rs(tot,1)}</td></tr></tfoot>`:'');
    const mm=SM.slice().sort((a,b)=>b.day-a.day),mmx=Math.max(1,...mm.map(s=>Math.abs(s.day)));
    $('#mtbl').innerHTML=THEAD+`<tbody>${mm.map(s=>tRow(s,MCXC,mmx)).join('')||'<tr><td class="l" colspan="7"><div class="empty">No MCX positions or trades today.</div></td></tr>'}</tbody><tfoot><tr class="tot"><td class="l">MCX total</td><td></td><td>${mm.reduce((a,s)=>a+s.closed,0)}</td><td class="${tone(mm.reduce((a,s)=>a+s.net,0))}">${rs(mm.reduce((a,s)=>a+s.net,0),1)}</td><td>${mm.reduce((a,s)=>a+(s.open||[]).length,0)}</td><td></td><td class="${tone(mcxDay)}">${rs(mcxDay,1)}</td></tr></tfoot>`;
    document.querySelectorAll('#tbl tr.xrow,#mtbl tr.xrow').forEach(r=>r.onclick=()=>{const k=r.dataset.s;openSet.has(k)?openSet.delete(k):openSet.add(k);draw()})};
  const THEAD='<thead><tr><th class="l">Strategy</th><th>Capital</th><th>Closed</th><th>Booked</th><th>Open</th><th>Open P&amp;L</th><th>Day so far</th></tr></thead>';
  const tRow=(s,col,mx)=>{const o=(s.open||[]).length,isOpen=openSet.has(s.strategy),hasD=o||s.closed||(s.notes||[]).length;return `<tr class="row ${hasD?'xrow':''} ${isOpen?'isopen':''}" data-s="${esc(s.strategy)}"><td class="l"><div class="sname" style="--tc:${col}"><span class="caret">${hasD?(isOpen?'▾':'▸'):''}</span><span class="sd"></span><span>${esc(s.strategy)}</span></div></td>
       <td>${s.capital?cap(s.capital)+(s.capital_basis==='estimate'?' <span class="faint">est.</span>':''):'–'}</td><td>${s.closed||'–'}</td><td class="${tone(s.net)}">${s.closed?rs(s.net,1):'–'}</td>
       <td>${o||'–'}</td><td>${openPnl(s)}</td>
       <td class="${tone(s.day)}" style="font-weight:650">${(s.closed||s.marked)?rs(s.day,1):'–'}<i class="bar" style="width:${Math.abs(s.day)/mx*70}px;background:var(--${s.day>=0?'good':'bad'});opacity:.7"></i></td></tr>`+(isOpen&&hasD?`<tr class="det"><td colspan="7" class="l">${detail(s,T)}</td></tr>`:'')};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw();document.querySelectorAll('.tcard').forEach(c=>c.classList.toggle('on',c.dataset.t===v))});
  document.querySelectorAll('.tcard').forEach(c=>c.onclick=()=>{const v=curType===c.dataset.t?'all':c.dataset.t;curType=v;store.set('edge_type',v);document.querySelectorAll('.tcard').forEach(x=>x.classList.toggle('on',x.dataset.t===v));seg($('#seg'),typeOpts(counts),v,x=>{curType=x;store.set('edge_type',x);draw();document.querySelectorAll('.tcard').forEach(y=>y.classList.toggle('on',y.dataset.t===x))});draw()});
  $('#q').oninput=draw;draw();
  const tm=Object.fromEntries(SA.map(s=>[s.strategy,s]));
  const trT=(tr,col)=>tr.length?`<table><thead><tr><th class="l">Strategy</th><th class="l">Instrument</th><th class="l">Side</th><th>In</th><th>Out</th><th>Entry → exit</th><th>Stop (SL)</th><th class="l">Why</th><th>Net</th></tr></thead><tbody>${tr.map(t=>`<tr class="row"><td class="l"><div class="sname" style="--tc:${col||(tm[t.strategy]?typeOf(tm[t.strategy]):TYPE.buy).color}"><span class="sd"></span>${esc(t.strategy)}</div></td><td class="l">${esc(t.label&&t.label!=='MCX future'?t.label:(t.instrument||'')+(t.label==='MCX future'?' future':''))}</td><td class="l"><span class="pill ${t.side==='LONG'?'accent':'warn'}">${esc(t.side)}</span></td><td>${esc(t.entry_time)}</td><td>${esc(t.exit_time)}</td><td>${t.entry==null?'–':NF.format(Math.round(t.entry*100)/100)} → ${t.exit==null?'–':NF.format(Math.round(t.exit*100)/100)}</td><td>${slTxt(t)}</td><td class="l muted">${esc(t.reason||'')}</td><td class="${tone(t.net)}">${rs(t.net,1)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No closed trades yet.</div>';
  $('#trades').innerHTML=trT((T.trades||[]).filter(t=>!trIsMcx(t)));$('#mtrades').innerHTML=trT((T.trades||[]).filter(trIsMcx),MCXC);
}

/* ---------- OVERALL ---------- */
/* 20 Nov 2026: per-strategy curve, drawdown, graduation progress and futures-vs-option twins (all from the existing overall payload) */
function cumOf(s){let c=0;return (s.daily||[]).map(d=>c+=d[1])}
function ddOf(s){let pk=0,mdd=0;cumOf(s).forEach(c=>{pk=Math.max(pk,c);mdd=Math.min(mdd,c-pk)});return mdd}
function spark(s){const c=cumOf(s);if(c.length<2)return '<span class="faint">–</span>';const W=70,H=22,lo=Math.min(0,...c),hi=Math.max(0,...c),r=(hi-lo)||1;
  const pts=c.map((v,i)=>(i*(W-2)/(c.length-1)+1).toFixed(1)+','+(H-2-(v-lo)/r*(H-4)).toFixed(1)).join(' ');
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${(H-2-(0-lo)/r*(H-4)).toFixed(1)}" y2="${(H-2-(0-lo)/r*(H-4)).toFixed(1)}" stroke="var(--line)"/><polyline points="${pts}" fill="none" stroke="var(--${c[c.length-1]>=0?'good':'bad'})" stroke-width="1.6"/></svg>`}
function grad(s){const a=Math.min(1,(s.positions||0)/60),b=Math.min(1,(s.days||0)/20),pf=s.pf,ok=a>=1&&b>=1&&pf!=null&&pf>=1.2;
  const bar=(f,l,t)=>`<span title="${t}"><span class="prog"><i style="width:${Math.round(f*100)}%"></i></span>${l}</span>`;
  return `<span class="grad">${bar(a,(s.positions||0)+'/60','positions')} ${bar(b,(s.days||0)+'/20','sessions')} <span class="pill ${ok?'good':pf!=null&&pf<1?'bad':''}" title="profit factor, bar is 1.2">PF ${pf==null?'–':pf}</span></span>`}
const twinKey=n=>n.replace(/_(OPTIONS|CALLS|OPT)(?=( ·|$))/,'').replace(/ (futures|options)$/,'');
const isOptName=n=>/_(OPTIONS|CALLS|OPT)( ·|$)/.test(n)||/ options$/.test(n);
function twins(S){const m={};S.forEach(s=>{(m[twinKey(s.strategy)]=m[twinKey(s.strategy)]||{})[isOptName(s.strategy)?'o':'f']=s});
  const P=Object.entries(m).filter(([k,v])=>v.f&&v.o&&(v.f.positions||v.o.positions));if(!P.length)return '';
  const cell=s=>`<td>${s.positions}</td><td>${s.win_pct==null?'–':pct(s.win_pct,0)}</td><td>${s.pf==null?'–':s.pf}</td><td class="${tone(s.net)}">${rs(s.net,1)}</td><td>${rs(ddOf(s))}</td><td>${rs(s.costs)}</td>`;
  return `<h2>Futures vs option twins <span class="aside">same signal, traded two ways</span></h2><div class="tw"><table><thead><tr><th class="l">Signal</th><th colspan="6" style="text-align:center;border-left:1px solid var(--line)">Futures</th><th colspan="6" style="text-align:center;border-left:1px solid var(--line)">Bought option</th><th>Option ÷ futures net</th></tr><tr><th class="l"></th>${'<th>Pos</th><th>Win</th><th>PF</th><th>Net</th><th>Max DD</th><th>Charges</th>'.repeat(2)}<th></th></tr></thead><tbody>${P.map(([k,v])=>`<tr class="row"><td class="l"><b>${esc(k)}</b></td>${cell(v.f)}${cell(v.o)}<td>${v.f.net>0?Math.round(100*v.o.net/v.f.net)+'%':'–'}</td></tr>`).join('')}</tbody></table></div>`}
/* 21 Nov 2026: ALL TRADES table (every closed paper trade; loaded and decrypted only when the section is opened) */
let TR=null;const trF={s:'',m:'all',from:'',to:'',res:'all',q:'',k:'day',d:-1,pg:0},TRPAGE=100;
async function loadTrades(){
  if(TR)return TR;
  const dev=store.get('edge_dev_trades');if(dev){TR=JSON.parse(dev);return TR}
  const r=await fetch(`https://raw.githubusercontent.com/${REPO}/data/${FILES.trades}?t=${Math.floor(Date.now()/30000)}`,{cache:'no-store'});if(!r.ok)throw new Error('trades file not found yet ('+r.status+')');
  TR=await decrypt(await r.json(),pass);return TR;
}
function trTable(host){
  const P=TR,ix=Object.fromEntries(P.cols.map((c,i)=>[c,i])),all=P.rows;
  const strats=[...new Set(all.map(r=>r[ix.strategy]))].sort();
  const days=all.map(r=>r[ix.day]);const mn=days[0],mx=days[days.length-1];
  const mkt=r=>ix.market!=null&&r[ix.market]?r[ix.market]:(/ · MCX /.test(r[ix.strategy])?'MCX':'NSE');
  const filt=()=>{const q=trF.q.toLowerCase();return all.filter(r=>(trF.m==='all'||mkt(r)===trF.m)&&(!trF.s||r[ix.strategy]===trF.s)&&(!trF.from||r[ix.day]>=trF.from)&&(!trF.to||r[ix.day]<=trF.to)&&(trF.res==='all'||(trF.res==='win'?r[ix.net]>0:r[ix.net]<=0))&&(!q||(r[ix.strategy]+' '+r[ix.instrument]+' '+(r[ix.label]||'')+' '+(r[ix.reason]||'')).toLowerCase().includes(q)))};
  const COLS=[['strategy','Strategy','l'],['day','Date','l'],['instrument','Instrument','l'],['side','Side','l'],['t_in','In'],['t_out','Out'],['entry','Entry'],['exit','Exit'],['stop','Stop (SL)'],['reason','Why','l'],['charges','Charges'],['net','Net']];
  const draw=()=>{
    const rows=filt().sort((a,b)=>{const x=a[ix[trF.k]],y=b[ix[trF.k]];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;const c=x<y?-1:x>y?1:0;return (c||(a[ix.t_out]<b[ix.t_out]?-1:1))*trF.d});
    const n=rows.length,pages=Math.max(1,Math.ceil(n/TRPAGE));trF.pg=Math.min(trF.pg,pages-1);
    const net=rows.reduce((a,r)=>a+r[ix.net],0),ch=rows.reduce((a,r)=>a+r[ix.charges],0),w=rows.filter(r=>r[ix.net]>0),gw=w.reduce((a,r)=>a+r[ix.net],0),gl=rows.filter(r=>r[ix.net]<=0).reduce((a,r)=>a-r[ix.net],0);
    host.querySelector('#trcost').innerHTML=costSplit(P,trF.s);
    host.querySelector('#trsum').innerHTML=`<b>${NF.format(n)}</b> trades · net <b class="${tone(net)}">${rs(net,1)}</b> · charges ${rs(ch)} · win ${n?Math.round(100*w.length/n):0}% · PF ${gl>0?(gw/gl).toFixed(2):'–'}`;
    const pg=rows.slice(trF.pg*TRPAGE,(trF.pg+1)*TRPAGE);
    host.querySelector('#trtbl').innerHTML=`<thead><tr>${COLS.map(c=>`<th class="sortable ${c[2]||''}" data-k="${c[0]}">${c[1]}${trF.k===c[0]?(trF.d<0?' ▾':' ▴'):''}</th>`).join('')}</tr></thead><tbody>${pg.map(r=>`<tr class="row"><td class="l"><b>${esc(r[ix.strategy])}</b>${mkt(r)==='MCX'?' <span class="pill mcxp">MCX</span>':''}</td><td class="l">${esc(r[ix.day])}</td><td class="l">${esc(r[ix.label]?r[ix.instrument]+' '+r[ix.label]:r[ix.instrument]||'')}</td><td class="l"><span class="pill ${r[ix.side]==='LONG'?'accent':'warn'}">${esc(r[ix.side])}</span></td><td>${esc(r[ix.t_in])}${r[ix.d_in]&&r[ix.d_in]!==r[ix.day]?' <span class="faint">'+esc(r[ix.d_in].slice(5))+'</span>':''}</td><td>${esc(r[ix.t_out])}</td><td>${px2(r[ix.entry])}</td><td>${px2(r[ix.exit])}</td><td>${slTxt({stop:r[ix.stop],stop_on:r[ix.stop_on]})}</td><td class="l muted">${esc(r[ix.reason]||'')}</td><td>${rs(r[ix.charges])}</td><td class="${tone(r[ix.net])}">${rs(r[ix.net],1)}</td></tr>`).join('')||'<tr><td class="l" colspan="12"><div class="empty">No trades match.</div></td></tr>'}</tbody>`;
    host.querySelector('#trpg').innerHTML=`<button ${trF.pg?'':'disabled'} id="trp">‹ Prev</button><span class="muted">page ${trF.pg+1} of ${pages}</span><button ${trF.pg<pages-1?'':'disabled'} id="trn">Next ›</button>`;
    host.querySelector('#trp').onclick=()=>{trF.pg--;draw()};host.querySelector('#trn').onclick=()=>{trF.pg++;draw()};
    host.querySelectorAll('#trtbl th.sortable').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(trF.k===k)trF.d=-trF.d;else{trF.k=k;trF.d=(k==='day'||k==='net'||k==='charges')?-1:1}trF.pg=0;draw()});
    host.querySelector('#trcsv').onclick=()=>{const q=v=>v==null?'':'"'+String(v).replace(/"/g,'""')+'"';const csv=[P.cols.join(',')].concat(rows.map(r=>r.map(q).join(','))).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='edgestack_trades.csv';document.body.appendChild(a);a.click();a.remove()};
  };
  const nM=all.filter(r=>mkt(r)==='MCX').length;
  host.innerHTML=`<div class="tools"><select id="trm" aria-label="Market"><option value="all">NSE + MCX</option><option value="NSE">NSE only · ${NF.format(all.length-nM)}</option><option value="MCX">MCX (commodity) only · ${NF.format(nM)}</option></select><select id="trs"><option value="">All strategies</option>${strats.map(s=>`<option>${esc(s)}</option>`).join('')}</select><input id="trf" type="date" min="${mn}" max="${mx}" aria-label="From"><input id="trt" type="date" min="${mn}" max="${mx}" aria-label="To"><select id="trr"><option value="all">All results</option><option value="win">Winners</option><option value="loss">Losers</option></select><input id="trq" type="search" placeholder="Search instrument / reason…"><button class="ibtn wide" id="trcsv">Download CSV</button></div><div class="muted" id="trsum" style="margin:6px 2px"></div><div id="trcost" style="margin:0 2px 8px"></div><div class="tw"><table id="trtbl"></table></div><div class="pager" id="trpg"></div><p class="note" style="margin-top:0">Raw ledger rows: a strategy that adds in lots shows one row per lot, so counts can exceed the league table’s positions, and a few swing strategies differ from the league table (TOM_NIFTY, GAP_DOWN_LOWDELIVERY_BTST) because the league table settles swing positions its own way. Stopped / archived strategies are not listed. Net is after charges.</p>`;
  const bind=(id,k,ev='input')=>host.querySelector(id)[ev==='change'?'onchange':'oninput']=e=>{trF[k]=e.target.value;trF.pg=0;draw()};
  bind('#trm','m','change');bind('#trs','s','change');bind('#trf','from','change');bind('#trt','to','change');bind('#trr','res','change');bind('#trq','q');
  host.querySelector('#trm').value=trF.m;host.querySelector('#trs').value=trF.s;host.querySelector('#trr').value=trF.res;draw();
}
/* 21 Nov 2026: P&L calendar, charge split, per-strategy detail */
/* 27 Nov 2026 (user): cells stay colour-only; click / tap a day -> a detail box inside the calendar panel with that day's net, gross, charges, positions and the per-strategy breakdown. */
function calendar(ser){if(!ser.length)return '';const m={};ser.forEach(x=>m[x[0]]=x[1]);const mx=Math.max(...ser.map(x=>Math.abs(x[1])))||1;
  const months=[...new Set(ser.map(x=>x[0].slice(0,7)))];
  return `<div class="card pad calp"><div class="cal">${months.map(mo=>{const [y,mm]=mo.split('-').map(Number),first=new Date(y,mm-1,1),nd=new Date(y,mm,0).getDate(),off=(first.getDay()+6)%7;let cells='';
    for(let i=0;i<off;i++)cells+='<i class="cd e"></i>';
    for(let d=1;d<=nd;d++){const k=`${mo}-${String(d).padStart(2,'0')}`,v=m[k];const wk=(off+d-1)%7>4;
      cells+=v==null?`<i class="cd ${wk?'wk':'e'}" title="${k}"></i>`:`<button type="button" class="cd ${v>=0?'g':'r'}" data-d="${k}" style="--a:${(0.18+0.82*Math.abs(v)/mx).toFixed(2)}" title="${k}: ${rs(v,1)}" aria-label="${k}: ${rs(v,1)}"></button>`}
    const tot=ser.filter(x=>x[0].startsWith(mo)).reduce((a,x)=>a+x[1],0);
    return `<div class="cm"><div class="ct">${new Date(y,mm-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'})} <b class="${tone(tot)}">${rs(tot,1)}</b></div><div class="cg">${cells}</div></div>`}).join('')}</div>
   <div class="cdet" id="cdet"><span class="faint">Click or tap a coloured day to see its P&amp;L.</span></div></div>`}
function wireCal(root,S,ser){if(!root)return;const by={};
  (S||[]).forEach(s=>{const x=Object.fromEntries((s.daily_x||[]).map(r=>[r[0],r]));(s.daily||[]).forEach(([d,v])=>{const r=x[d]||[];(by[d]=by[d]||[]).push({k:s.strategy,m:isMcx(s),net:v,g:r[1],c:r[2],n:r[3]})})});
  const tot=Object.fromEntries((ser||[]).map(x=>[x[0],x[1]]));
  const show=b=>{root.querySelectorAll('.cd.sel').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');const d=b.dataset.d,L=(by[d]||[]).sort((a,c)=>c.net-a.net);
    const sum=f=>L.some(r=>r[f]!=null)?L.reduce((a,r)=>a+(r[f]||0),0):null,net=tot[d]!=null?tot[d]:sum('net'),g=sum('g'),c=sum('c'),n=sum('n');
    root.querySelector('#cdet').innerHTML=`<div class="cdh"><b>${esc(new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</b><button type="button" class="ibtn" id="cdx" aria-label="Close" title="Close">×</button></div>
     <div class="tiles cdt">${tile('Net P&amp;L',rs(net,1),'after all charges',tone(net))}${tile('Gross',g==null?'–':rs(g,1),'before charges',tone(g))}${tile('Charges',c==null?'–':rs(c),'brokerage, STT, fees')}${tile('Positions closed',n==null?'–':NF.format(n),`${L.length} strateg${L.length===1?'y':'ies'}`)}</div>
     <div class="cdm">${mktLine(L.filter(r=>!r.m).reduce((a,r)=>a+r.net,0),L.filter(r=>r.m).reduce((a,r)=>a+r.net,0))}</div>
     ${[['NSE strategies',L.filter(r=>!r.m)],['MCX (commodity) strategies',L.filter(r=>r.m)]].filter(([,X])=>X.length).map(([h,X])=>{const sm=f=>X.some(r=>r[f]!=null)?X.reduce((a,r)=>a+(r[f]||0),0):null,xn=sm('net'),xg=sm('g'),xc=sm('c'),xp=sm('n');
       return `<div class="dh">${h} <span class="muted">${X.length}</span></div><div class="tw2"><table class="dt"><thead><tr><th class="l">Strategy</th><th>Positions</th><th>Gross</th><th>Charges</th><th>Net</th></tr></thead><tbody>${X.map(r=>`<tr><td class="l">${esc(r.k)}</td><td>${r.n==null?'–':r.n}</td><td class="${tone(r.g)}">${r.g==null?'–':rs(r.g,1)}</td><td>${r.c==null?'–':rs(r.c)}</td><td class="${tone(r.net)}" style="font-weight:650">${rs(r.net,1)}</td></tr>`).join('')}</tbody><tfoot><tr class="tot"><td class="l">${h.split(' ')[0]} total</td><td>${xp==null?'–':xp}</td><td class="${tone(xg)}">${xg==null?'–':rs(xg,1)}</td><td>${xc==null?'–':rs(xc)}</td><td class="${tone(xn)}">${rs(xn,1)}</td></tr></tfoot></table></div>`}).join('')||'<div class="faint">No strategy detail for this day.</div>'}`;
    root.querySelector('#cdx').onclick=()=>{b.classList.remove('sel');root.querySelector('#cdet').innerHTML='<span class="faint">Click or tap a coloured day to see its P&amp;L.</span>'};
    if(matchMedia('(max-width:640px)').matches)root.querySelector('#cdet').scrollIntoView({behavior:'smooth',block:'nearest'})};
  root.querySelectorAll('button.cd').forEach(b=>b.addEventListener('click',()=>show(b)));
}
function costSplit(P,strat){const cs=P.cost_split||{};const v=[0,0,0,0];Object.entries(cs).forEach(([k,a])=>{if(!strat||k===strat)a.forEach((x,i)=>v[i]+=x)});const tot=v.reduce((a,b)=>a+b,0)||1;
  const L=['Brokerage','STT','Exchange','SEBI, stamp, GST'];return `<div class="cs">${v.map((x,i)=>`<span class="pill" title="${L[i]}">${L[i]} ${rs(x)} · ${Math.round(100*x/tot)}%</span>`).join(' ')}</div>`}
const openS=new Set();
function stratDetail(s){const ser=[];let c=0;(s.daily||[]).forEach(d=>{c+=d[1];ser.push([d[0],d[1],c])});
  const tr=TR?TR.rows.filter(r=>r[TR.cols.indexOf('strategy')]===s.strategy).slice(-15).reverse():null;const ix=TR?Object.fromEntries(TR.cols.map((x,i)=>[x,i])):null;
  return `<div class="dwrap"><div class="dh">${esc(s.strategy)} · ${s.positions} positions · ${s.days} sessions</div>${chart(ser,{h:170})}${ser.length>1?monthBars(ser):''}
  ${TR?`<div class="dh">Where the charges went</div>${costSplit(TR,s.strategy)}<div class="dh">Latest trades</div><div class="tw2"><table class="dt"><thead><tr><th class="l">Date</th><th class="l">Instrument</th><th class="l">Side</th><th>Entry</th><th>Exit</th><th>Stop (SL)</th><th class="l">Why</th><th>Net</th></tr></thead><tbody>${tr.map(r=>`<tr><td class="l">${esc(r[ix.day])}</td><td class="l">${esc(r[ix.label]?r[ix.instrument]+' '+r[ix.label]:r[ix.instrument]||'')}</td><td class="l">${esc(r[ix.side])}</td><td>${px2(r[ix.entry])}</td><td>${px2(r[ix.exit])}</td><td>${slTxt({stop:r[ix.stop],stop_on:r[ix.stop_on]})}</td><td class="l muted">${esc(r[ix.reason]||'')}</td><td class="${tone(r[ix.net])}">${rs(r[ix.net],1)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="dn">Open “All trades” below once to see this strategy’s charges and latest trades here.</div>'}</div>`}
function renderTrades(P){
  TR=P;stale=false;asofTxt='through '+P.through;
  $('#main').innerHTML=`<h1>All trades</h1><p class="sub">Every closed paper trade, ${NF.format(P.n)} rows through ${esc(P.through)}. Filter, sort (click a column) and download.</p><div id="trbox"></div>`;
  trTable($('#trbox'));
}
let sortK='net',sortD=-1;
function renderOverall(O){
  stale=false;asofTxt='through '+O.data_through;
  const SA=(O.strategies||[]).filter(s=>s.positions||s.open),S=SA.filter(s=>!isMcx(s)),SM=SA.filter(isMcx);
  const mTot=L=>{const p=L.reduce((a,s)=>a+(s.positions||0),0),w=L.reduce((a,s)=>a+(s.win_pct||0)*(s.positions||0)/100,0);return {n:L.length,pos:p,net:L.reduce((a,s)=>a+(s.net||0),0),gross:L.reduce((a,s)=>a+(s.gross||0),0),costs:L.reduce((a,s)=>a+(s.costs||0),0),win:p?100*w/p:null}};
  const TN=mTot(S),TM=mTot(SM);
  const totLine=(x,lbl)=>`<div class="totl"><b>${lbl}</b> · ${x.n} strateg${x.n===1?'y':'ies'} · ${NF.format(x.pos)} trades · net <b class="${tone(x.net)}">${rs(x.net,1)}</b> · win rate ${pct(x.win,1)} · charges ${rs(x.costs)}</div>`;
  const wins=SA.reduce((a,s)=>a+(s.win_pct||0)*s.positions/100,0),pos=SA.reduce((a,s)=>a+s.positions,0);
  const gw=SA.reduce((a,s)=>a+(s.win_pct||0)/100*s.positions*(s.avg_win||0),0),gl=SA.reduce((a,s)=>a+(1-(s.win_pct||0)/100)*s.positions*Math.abs(s.avg_loss||0),0);
  const ser=O.series||[];let peak=0,mdd=0;ser.forEach(x=>{peak=Math.max(peak,x[2]);mdd=Math.min(mdd,x[2]-peak)});
  const days=ser.map(x=>x[1]),bestD=days.length?Math.max(...days):null,worstD=days.length?Math.min(...days):null,posD=days.filter(x=>x>0).length;
  const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  const groups=TYPES.map(t=>{const rows=S.filter(s=>s.stype===t.id);return {t,rows,net:rows.reduce((a,s)=>a+s.net,0),cap:rows.reduce((a,s)=>a+(s.capital||0),0),pos:rows.reduce((a,s)=>a+s.positions,0)}}).filter(g=>g.rows.length);
  $('#main').innerHTML=`
  <div class="hero"><div><div class="lbl">Net P&amp;L since the forward tests began</div><div class="big ${tone(O.net)}">${rs(O.net,1)}</div><div class="muted" style="margin-top:4px">${NF.format(pos)} closed positions over ${O.days} sessions · after brokerage, STT and all charges · NSE + MCX combined</div>${mktLine(TN.net,TM.net)}</div>
   <div class="side"><div><span class="lbl">Gross</span><b class="${tone(O.gross)}">${rs(O.gross,1)}</b></div><div><span class="lbl">Charges</span><b>${rs(O.costs)}</b></div><div><span class="lbl">Open, unrealised</span><b class="${tone(O.unreal)}">${O.unreal?rs(O.unreal,1):'–'}</b></div></div></div>
  <div class="tiles">${tile('NSE net',rs(TN.net,1),`${NF.format(TN.pos)} trades · win ${pct(TN.win,1)} · ${TN.n} strategies`,tone(TN.net))}${tile('MCX (commodity) net',rs(TM.net,1),`${NF.format(TM.pos)} trades · win ${pct(TM.win,1)} · ${TM.n} strategies`,tone(TM.net))}${tile('Combined net',rs(TN.net+TM.net,1),'NSE + MCX',tone(TN.net+TM.net))}${tile('Win rate',pct(pos?100*wins/pos:null,1),`${NF.format(Math.round(wins))} of ${NF.format(pos)} positions`)}${tile('Profit factor',gl>0?(gw/gl).toFixed(2):'–','gross wins ÷ gross losses, after charges')}${tile('Max drawdown',rs(mdd),'largest fall from a peak in cumulative P&L','bad')}${tile('Winning sessions',pct(ser.length?100*posD/ser.length:null,0),`${posD} of ${ser.length} · best ${rs(bestD,1)} · worst ${rs(worstD,1)}`)}</div>
  <h2>Cumulative P&amp;L <span class="aside">hover for the day</span></h2><div id="ch">${chart(ser)}</div>
  <div class="types" style="margin-top:14px">${groups.map(g=>`<div class="tcard" style="--tc:${g.t.color}"><div class="n">${esc(g.t.label)}<small>${g.rows.length} strateg${g.rows.length>1?'ies':'y'}</small></div><div class="pl ${tone(g.net)}">${rs(g.net,1)}</div><div class="meta">${NF.format(g.pos)} positions · capital ${cap(g.cap)}</div></div>`).join('')}${SM.length?`<div class="tcard" style="--tc:${MCXC}"><div class="n">MCX (commodity)<small>${SM.length} strateg${SM.length>1?'ies':'y'}</small></div><div class="pl ${tone(TM.net)}">${rs(TM.net,1)}</div><div class="meta">${NF.format(TM.pos)} positions · crude / natural gas</div></div>`:''}</div>
  <h2>By month</h2>${monthBars(ser)}
  <h2>Daily P&amp;L calendar <span class="aside">green = profit, red = loss · click or tap a day for its P&amp;L</span></h2><div id="calw">${calendar(ser)}</div>
  ${twins(SA)}
  <h2>NSE strategy league table <span class="aside">click a column to sort, click a row for its curve, months and trades</span></h2>
  ${totLine(TN,'NSE')}
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy…" aria-label="Search strategy"></div>
  <div class="tw"><table id="tbl"></table></div>
  <h2 class="mcxh"><span class="sd" style="width:10px;height:10px;border-radius:3px;background:${MCXC};display:inline-block"></span>MCX (commodity) strategies <span class="aside">own table, not in the NSE total</span></h2>
  ${totLine(TM,'MCX')}
  <div class="tw"><table id="mtbl"></table></div>
  <h2>All trades <span class="aside">every closed paper trade, filter and download</span></h2><div id="trbox"><a class="ibtn wide" href="trades.html" style="text-decoration:none">Open the All trades page →</a> <button class="ibtn wide" id="trload">Or load it here</button></div>
  <p class="note">${esc(O.note||'')} Return on capital = net P&amp;L ÷ the strategy’s capital need (margin estimate plus cushion). With a few sessions these numbers are small samples: they show execution and costs, not a ranking to trade on.</p>`;
  wireChart($('#ch'),ser);wireCal($('#calw'),SA,ser);
  const COLS=[['strategy','Strategy','l'],['stype','Type','l'],['capital','Capital'],['positions','Positions'],['win_pct','Win %'],['pf','PF'],['net','Net P&L'],['curve','Curve'],['dd','Max drawdown'],['roc','Return on capital'],['costs','Charges'],['days','Sessions'],['best_day','Best day'],['worst_day','Worst day'],['grad','Graduation (60 pos · 20 sessions · PF 1.2)']];
  const val=(s,k)=>k==='dd'?ddOf(s):k==='curve'?cumOf(s).length:k==='grad'?Math.min(1,(s.positions||0)/60)+Math.min(1,(s.days||0)/20):k==='roc'?(s.capital?s.net/s.capital*100:null):k==='stype'?(TYPE[s.stype]||{}).short:s[k];
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');
    const srt=(a,b)=>{const x=val(a,sortK),y=val(b,sortK);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:x>y?1:0)*sortD};
    const rows=S.filter(s=>(curType==='all'||s.stype===curType)&&(!q||s.strategy.toLowerCase().replace(/_/g,' ').includes(q))).sort(srt);
    const lg=(rows,mcx)=>`<thead><tr>${COLS.map(c=>`<th class="sortable ${c[2]||''}" data-k="${c[0]}">${c[1]}${sortK===c[0]?(sortD<0?' ▾':' ▴'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(s=>{const t=mcx?{color:MCXC}:typeOf(s),roc=val(s,'roc');return `<tr class="row xrow ${openS.has(s.strategy)?'isopen':''}" data-s="${esc(s.strategy)}"><td class="l"><div class="sname" style="--tc:${t.color}"><span class="caret">${openS.has(s.strategy)?'▾':'▸'}</span><span class="sd"></span><span>${esc(s.strategy)}${s.status&&!/^running/.test(s.status)?`<small>${esc(s.status)}</small>`:''}</span></div></td><td class="l">${tpill(s)}</td>
      <td>${s.capital?cap(s.capital)+(s.capital_basis==='estimate'?' <span class="faint">est.</span>':''):'–'}</td><td>${s.positions}</td><td>${s.win_pct==null?'–':pct(s.win_pct,0)}</td><td>${s.pf==null?'–':s.pf}</td><td class="${tone(s.net)}" style="font-weight:650">${rs(s.net,1)}</td><td>${spark(s)}</td><td class="bad">${rs(ddOf(s))}</td><td class="${tone(roc)}">${roc==null?'–':(roc>0?'+':'')+roc.toFixed(1)+'%'}</td><td>${rs(s.costs)}</td><td>${s.days} <span class="faint">(${s.pos_days}+)</span></td><td class="good">${rs(s.best_day)}</td><td class="bad">${rs(s.worst_day)}</td><td>${grad(s)}</td></tr>`+(openS.has(s.strategy)?`<tr class="det"><td colspan="15" class="l" data-det="${esc(s.strategy)}">${stratDetail(s)}</td></tr>`:'')}).join('')||`<tr><td class="l" colspan="15"><div class="empty">${mcx?'No MCX trades yet.':'No strategies match.'}</div></td></tr>`}</tbody>`;
    $('#tbl').innerHTML=lg(rows,0);$('#mtbl').innerHTML=lg(SM.slice().sort(srt),1);
    document.querySelectorAll('#tbl th.sortable,#mtbl th.sortable').forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(sortK===k)sortD=-sortD;else{sortK=k;sortD=(k==='strategy'||k==='stype')?1:-1}draw()});
    document.querySelectorAll('#tbl tr.xrow,#mtbl tr.xrow').forEach(r=>r.onclick=()=>{const k=r.dataset.s;openS.has(k)?openS.delete(k):openS.add(k);draw()});
    document.querySelectorAll('#tbl td[data-det],#mtbl td[data-det]').forEach(td=>{const s=SA.find(x=>x.strategy===td.dataset.det),ser=[];let c=0;(s.daily||[]).forEach(d=>{c+=d[1];ser.push([d[0],d[1],c])});wireChart(td,ser)})};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw()});$('#q').oninput=draw;draw();
  const tb=$('#trbox'),go=async()=>{tb.innerHTML='<div class="empty">Loading trades…</div>';try{await loadTrades();trTable(tb)}catch(e){tb.innerHTML='<div class="empty">Could not load trades: '+esc(e.message)+' <button class="ibtn wide" id="trload">Retry</button></div>';$('#trload').onclick=go}};
  if(TR)trTable(tb);else $('#trload').onclick=go;
}

/* ---------- STRATEGIES (catalogue) ---------- */
/* 27 Nov 2026: click a card -> full rules (what, entry, exit, trailing, instruments + lots, holding, status) from the plain cards (plain/live_<KEY>.json). */
const openK=new Set();
function xtag(t){const raw=t.toLowerCase(),l=raw.replace(/(and )?no (profit )?target|(and )?no trail\w*( stop)?|no stop-loss/g,'');
  if(/^time exit/.test(l))return ['tm','Time'];if(/^(target|profit exit)/.test(l))return ['t','Target'];if(/^(safety|stop|emergency)/.test(l))return ['s','Stop'];
  if(/trail/.test(l))return ['tr','Trail'];if(/\btarget\b/.test(l))return ['t','Target'];if(/stop|safety/.test(l))return ['s','Stop'];
  if(/\d{1,2}[:.]\d{2}|\bpm\b|minutes|square|close[ds]? at/.test(l))return ['tm','Time'];return null}
function rulesPanel(s){const c=s.card||{};const lst=(a,ol)=>a&&a.length?`<${ol?'ol':'ul'}>${a.map(x=>`<li>${esc(x)}</li>`).join('')}</${ol?'ol':'ul'}>`:'<p class="faint">Not written yet.</p>';
  const trail=[...(c.exit||[]),...(c.entry||[])].filter(x=>/trail/i.test(x)&&!/no trail|no target, no trail|and no trailing/i.test(x));
  const st=s.archived?`Archived: stopped ${esc(s.stopped||'')}. Its P&amp;L is not in any total.`:s.status==='running'?'Running · experimental paper forward test (no real orders).':esc((s.status||'').replace(/^waiting: /,'Waiting: '))+' · experimental paper forward test.';
  const B=(t,body,full)=>`<div class="rb${full?' full':''}"><h4><i></i>${t}</h4>${body}</div>`;
  return `<div class="rules" data-stop>
   ${c.rules_changed?B('Rule change',`<div class="chg">${esc(c.rules_changed)}</div>`,1):''}
   ${B('What it is',`<p>${esc(s.one_line||'')}</p>${c.why?`<p class="muted" style="margin-top:6px">${esc(c.why)}</p>`:''}`,1)}
   ${B('Entry rules',lst(c.entry,1))}
   ${B('Exit rules',c.exit&&c.exit.length?`<ul>${c.exit.map(x=>{const g=xtag(x);return `<li>${g?`<span class="tag ${g[0]}">${g[1]}</span>`:''}${esc(x)}</li>`}).join('')}</ul>`:'<p class="faint">Not written yet.</p>')}
   ${B('Trailing stop',trail.length?lst(trail):'<p>No trailing stop: the stop stays where it was set at entry.</p>')}
   ${B('Instruments and lots',`<p>${esc(c.what||'Not written yet.')}</p>`)}
   ${B('Holding time',`<p>${esc(c.holding||s.holding||'–')}</p>`)}
   ${c.money?B('Capital',`<p>${esc(c.money)}</p>`):''}
   ${B('Status',`<p>${st}</p>${c.verdict_plain?`<p class="muted" style="margin-top:6px">${esc(c.verdict_plain)}</p>`:''}${s.claim?`<p class="muted" style="margin-top:6px">${esc(s.claim)}</p>`:''}${s.why_stopped?`<p class="muted" style="margin-top:6px">${esc(s.why_stopped)}</p>`:''}`,1)}
  </div>`}
function scard(s,t){const run=/^running/.test(s.status||''),wait=/waiting|no trades/.test(s.status||''),op=openK.has(s.strategy);
  const pill=s.archived?`<span class="pill">archived ${esc((s.stopped||'').slice(0,10))}</span>`:`<span class="pill ${run?'good':wait?'warn':''}" title="${esc(s.status||'')}">${esc(run?'running':wait?(/^no trades/.test(s.status)?'no trades yet':'waiting'):s.status)}</span>`;
  return `<div class="scard x ${op?'open':''}" data-k="${esc(s.strategy)}" style="--tc:${t.color}" role="button" tabindex="0" aria-expanded="${op}"><h3><span>${esc(s.strategy)}</span>${pill}</h3><p>${esc(s.one_line||'No description card yet.')}</p>
   <div class="kv"><div><span>${s.archived?'Net (not counted)':'Net so far'}</span><b class="${tone(s.net)}">${s.positions?rs(s.net,1):'–'}</b></div><div><span>Positions</span><b>${s.positions||0}</b></div><div><span>Capital</span><b>${s.capital?cap(s.capital):'–'}${s.capital_basis==='estimate'?' <small class="faint">est.</small>':''}</b></div></div>
   <span class="more">${op?'▾ Hide rules':'▸ Entry, exit, trailing, lots'}</span>${op?rulesPanel(s):''}</div>`}
function renderStrategies(O){
  stale=false;asofTxt='through '+O.data_through;
  const SM=(O.strategies||[]).filter(isMcx),S=(O.strategies||[]).filter(s=>!isMcx(s));const A=(O.archived||[]).map(a=>({...a,archived:true,why_stopped:a.why}));const counts={all:S.length};TYPES.forEach(t=>counts[t.id]=S.filter(s=>s.stype===t.id).length);
  if(curType!=='all'&&!counts[curType])curType='all';
  $('#main').innerHTML=`<h1>Strategies</h1><p class="sub">${S.length} NSE paper-book strategies in ${TYPES.filter(t=>counts[t.id]).length} groups${SM.length?`, ${SM.length} MCX (commodity) strategies in their own section`:''}${A.length?`, plus ${A.length} archived`:''}. Each is a separate engine with its own ledger; all are experimental forward tests. Click a card for its entry, exit and trailing rules.</p>
  <div class="types">${TYPES.filter(t=>counts[t.id]).map(t=>`<div class="tcard" style="--tc:${t.color}"><div class="n">${esc(t.label)}<small>${counts[t.id]}</small></div><div class="meta" style="margin-top:6px">${esc(t.help)}</div></div>`).join('')}</div>
  <div class="tools"><div class="seg" id="seg"></div><input id="q" type="search" placeholder="Search strategy or rule…" aria-label="Search strategy"><button class="ibtn wide" id="xall" type="button">Expand all</button></div><div id="cards"></div>`;
  const hit=(s,q)=>!q||(s.strategy+' '+(s.one_line||'')+' '+JSON.stringify(s.card||{})).toLowerCase().replace(/_/g,' ').includes(q);
  const draw=()=>{const q=($('#q').value||'').toLowerCase().replace(/[_\s]+/g,' ');let h='';
    TYPES.forEach(t=>{const rows=S.filter(s=>s.stype===t.id&&(curType==='all'||curType===t.id)&&hit(s,q)).sort((a,b)=>b.net-a.net);if(!rows.length)return;
      h+=`<h2><span class="sd" style="width:10px;height:10px;border-radius:3px;background:${t.color};display:inline-block"></span>${esc(t.label)} <span class="aside">${rows.length}</span></h2><div class="cards">${rows.map(s=>scard(s,t)).join('')}</div>`});
    const mr=SM.filter(s=>curType==='all'&&hit(s,q)).sort((a,b)=>b.net-a.net);
    if(mr.length)h+=`<h2 class="mcxh"><span class="sd" style="width:10px;height:10px;border-radius:3px;background:${MCXC};display:inline-block"></span>MCX (commodity) strategies <span class="aside">${mr.length} · net ${rs(mr.reduce((a,s)=>a+(s.net||0),0),1)} · not in the NSE totals</span></h2><div class="cards">${mr.map(s=>scard(s,{color:MCXC})).join('')}</div>`;
    const ar=A.filter(s=>curType==='all'&&hit(s,q));
    if(ar.length)h+=`<h2>Archived (stopped) <span class="aside">${ar.length} · kept for reference, not in any P&amp;L total</span></h2><div class="cards arch">${ar.map(s=>scard(s,{color:'var(--faint)'})).join('')}</div>`;
    $('#cards').innerHTML=h||'<div class="empty">No strategies match.</div>';
    $('#cards').querySelectorAll('.scard.x').forEach(c=>{const tg=()=>{const k=c.dataset.k;openK.has(k)?openK.delete(k):openK.add(k);draw()};
      c.onclick=e=>{if(e.target.closest('[data-stop]'))return;tg()};c.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===c){e.preventDefault();tg()}}})};
  $('#xall').onclick=()=>{const all=[...S,...SM,...A].map(s=>s.strategy);const anyClosed=all.some(k=>!openK.has(k));all.forEach(k=>anyClosed?openK.add(k):openK.delete(k));$('#xall').textContent=anyClosed?'Collapse all':'Expand all';draw()};
  seg($('#seg'),typeOpts(counts),curType,v=>{curType=v;store.set('edge_type',v);draw()});$('#q').oninput=draw;draw();
}
return {boot};
})();
