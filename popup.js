'use strict';

const MODEL_LIMITS = {'claude-opus-4':18,'claude-opus-4-5':18,'claude-opus-3-5':18,'claude-opus-3':18,'claude-sonnet-4':100,'claude-sonnet-4-5':100,'claude-sonnet-3-5':45,'claude-sonnet-3':45,'claude-haiku-3-5':500,'claude-haiku-3':500,'default':45};
const MODEL_WEEKLY = {'claude-opus-4':50,'claude-opus-4-5':50,'claude-opus-3-5':50,'claude-opus-3':50,'claude-sonnet-4':300,'claude-sonnet-4-5':300,'claude-sonnet-3-5':150,'claude-sonnet-3':150,'claude-haiku-3-5':2000,'claude-haiku-3':2000,'default':150};
const MODEL_LABELS = {'claude-opus-4':'Opus 4','claude-opus-4-5':'Opus 4.5','claude-opus-3-5':'Opus 3.5','claude-opus-3':'Opus 3','claude-sonnet-4':'Sonnet 4','claude-sonnet-4-5':'Sonnet 4.5','claude-sonnet-3-5':'Sonnet 3.5','claude-sonnet-3':'Sonnet 3','claude-haiku-3-5':'Haiku 3.5','claude-haiku-3':'Haiku 3','default':'Claude'};

function ipc(type,extra={}) { return new Promise(r=>chrome.runtime.sendMessage({type,...extra},r)); }
function fmtDuration(ms) { if(!ms||ms<=0)return 'now'; const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; }
function fmtWeeklyReset(iso) { if(!iso)return '–'; const d=new Date(iso),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return `${days[d.getDay()]} ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`; }
function colorClass(pct) { return pct>=0.95?'r':pct>=0.75?'y':'g'; }
function fillClass(n) { return n>=95?'crit':n>=75?'warn':''; }
function msgsLeft(pct,model,weekly=false) { const lim=(weekly?MODEL_WEEKLY:MODEL_LIMITS)[model]||(weekly?150:45); return Math.max(0,Math.floor((1-pct)*lim)); }
function fmtAgo(ts) { if(!ts)return '–'; const s=Math.floor((Date.now()-ts)/1000); return s<60?`${s}s ago`:`${Math.floor(s/60)}m ago`; }

function drawChart(canvas, history) {
  const W=canvas.offsetWidth||298, H=44;
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(0,0,W,H);
  if (!history||history.length<2) {
    ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.font='11px -apple-system'; ctx.textAlign='center';
    ctx.fillText('History appears after a few polls',W/2,H/2+4); return;
  }
  const pts=history.slice(-50), bw=Math.max(2,(W/pts.length)-1);
  pts.forEach((p,i)=>{
    const pct=p.sessionPct||p.pct||0, bh=Math.max(2,pct*(H-8)), x=i*(bw+1), y=H-bh-2;
    ctx.fillStyle=pct>=0.95?'#ff453a':pct>=0.75?'#ffd60a':'#30d158';
    ctx.globalAlpha=i===pts.length-1?1:0.55;
    ctx.beginPath(); ctx.roundRect(x,y,bw,bh,2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

async function getClaudeTab() {
  return new Promise(r=>chrome.tabs.query({url:'https://claude.ai/*',active:true,currentWindow:true},r));
}

async function render() {
  const [uResp, hResp] = await Promise.all([ipc('GET_USAGE'), ipc('GET_HISTORY')]);
  const data=uResp?.data||null, history=hResp?.data||[];

  let liveState=null;
  try {
    const tabs=await getClaudeTab();
    if (tabs.length) liveState=(await new Promise(r=>chrome.tabs.sendMessage(tabs[0].id,{type:'GET_STATE'},r)))?.state||null;
  } catch(_) {}

  const app=document.getElementById('app');
  if (!data&&!liveState) {
    app.innerHTML=`<div style="padding:14px 16px"><div style="background:rgba(255,69,58,0.1);border:1px solid rgba(255,69,58,0.3);border-radius:10px;padding:14px;color:#ff453a;font-size:12px;text-align:center">No data yet.<br>Open <strong>claude.ai</strong> first.</div></div><div class="ftr"><button class="ftr-link" id="btn-open-claude">Open claude.ai &rarr;</button></div>`;
    document.getElementById('btn-open-claude').addEventListener('click', openClaude);
    return;
  }

  const session=liveState?.session||data?.session||{pct:data?.percentUsed||0,resetAt:data?.resetAt};
  const weekly=liveState?.weekly||data?.weekly||{pct:0,resetAt:null};
  const model=liveState?.model||data?.model||'default';
  const label=MODEL_LABELS[model]||'Claude';
  const sPct=session.pct||0, sPctN=Math.round(sPct*100);
  const wPct=weekly.pct||0,  wPctN=Math.round(wPct*100);
  const sMsgs=msgsLeft(sPct,model), wMsgs=msgsLeft(wPct,model,true);
  const sResetMs=session.resetAt?new Date(session.resetAt).getTime()-Date.now():null;
  const sReset=sResetMs!=null?fmtDuration(sResetMs):'estimating…';
  const wReset=fmtWeeklyReset(weekly.resetAt);

  let convTitle='Current Conversation';
  try { const tabs=await getClaudeTab(); if(tabs.length) convTitle=(tabs[0].title||'').replace(' - Claude','').trim()||'Conversation'; } catch(_) {}

  app.innerHTML=`
<div class="hdr">
  <div class="hdr-dot"></div>
  <span class="hdr-title">Claude Usage Meter</span>
  <span class="hdr-model">${label}</span>
</div>
<div class="section">
  <div class="sec-label">Your Usage Limits</div>
  <div class="usage-row">
    <div class="usage-meta"><span class="usage-label">Current session</span><span class="usage-right">Resets in ${sReset}</span></div>
    <div class="track"><div class="fill ${fillClass(sPctN)}" style="width:${sPctN}%"></div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="card-val ${colorClass(sPct)}">${sPctN}%</div><div class="card-lbl">used</div></div>
    <div class="card"><div class="card-val ${colorClass(sPct)}">${sMsgs}</div><div class="card-lbl">${label.toLowerCase()} msgs left</div></div>
    <div class="card"><div class="card-val">${sReset}</div><div class="card-lbl">reset in</div></div>
  </div>
</div>
<div class="section">
  <div class="sec-label">Weekly Limits</div>
  <div class="usage-row">
    <div class="usage-meta"><span class="usage-label">All models</span><span class="usage-right">${wPctN>0?'Resets '+wReset:'–'}</span></div>
    <div class="track"><div class="fill ${fillClass(wPctN)}" style="width:${wPctN}%"></div></div>
  </div>
  <div class="cards">
    <div class="card"><div class="card-val ${colorClass(wPct)}">${wPctN}%</div><div class="card-lbl">used</div></div>
    <div class="card"><div class="card-val ${colorClass(wPct)}">${wMsgs}</div><div class="card-lbl">msgs left</div></div>
    <div class="card"><div class="card-val">${wReset}</div><div class="card-lbl">resets</div></div>
  </div>
</div>
<div class="section">
  <div class="sec-label">Session history</div>
  <canvas id="hchart"></canvas>
</div>
<div class="section">
  <div class="sec-label">Continue this chat in</div>
  <div class="chat-title" title="${convTitle}">${convTitle.slice(0,52)}</div>
  <div class="hbtn-grid">
    <button class="hbtn" data-target="chatgpt"><span class="ico">&#x1F916;</span>ChatGPT</button>
    <button class="hbtn" data-target="gemini"><span class="ico">&#x2728;</span>Gemini</button>
    <button class="hbtn" data-target="grok"><span class="ico">&#x1D54F;</span>Grok</button>
  </div>
  <div class="hbtn-row">
    <button class="hbtn hbtn-sm" data-action="copy">&#9138; Copy</button>
    <button class="hbtn hbtn-sm" data-action="download">&#8595; Download</button>
  </div>
</div>
<div class="ftr">
  <div class="ftr-left">
    <span class="ftr-link" style="color:var(--muted)">updated ${fmtAgo(data?.savedAt)}</span>
    <span class="ftr-sep">&middot;</span>
    <button class="ftr-link" id="btn-settings">Claude settings &rarr;</button>
  </div>
  <button class="refresh-btn" id="btn-refresh">&#8635;</button>
</div>`;

  const canvas=document.getElementById('hchart');
  if (canvas) setTimeout(()=>drawChart(canvas,history),30);

  document.querySelectorAll('[data-target]').forEach(b=>b.addEventListener('click',()=>doHandoff(b.dataset.target)));
  document.querySelector('[data-action="copy"]')?.addEventListener('click',()=>doAction('COPY','Copied!'));
  document.querySelector('[data-action="download"]')?.addEventListener('click',()=>doAction('DOWNLOAD','Downloading…'));
  document.getElementById('btn-settings')?.addEventListener('click',()=>chrome.tabs.create({url:'https://claude.ai/settings/usage'}));
  document.getElementById('btn-refresh')?.addEventListener('click',async()=>{
    const tabs=await getClaudeTab();
    if (tabs.length) { chrome.tabs.sendMessage(tabs[0].id,{type:'ALARM_REFRESH'}); setTimeout(render,2500); }
  });
}

async function doHandoff(target) {
  const tabs=await getClaudeTab();
  if (!tabs.length) { toast('Open claude.ai first'); return; }
  chrome.tabs.sendMessage(tabs[0].id,{type:'HANDOFF',target});
  toast('Opening '+target+'…');
}

async function doAction(type, msg) {
  const tabs=await getClaudeTab();
  if (!tabs.length) { toast('Open claude.ai first'); return; }
  chrome.tabs.sendMessage(tabs[0].id,{type});
  toast(msg);
}

function openClaude() { chrome.tabs.create({url:'https://claude.ai'}); }

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

render();
