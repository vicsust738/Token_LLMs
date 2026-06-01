// content.js — Claude Usage Meter v2
// Reads session + weekly usage from claude.ai own API. Zero Claude tokens used.
// Polls every 30s. Shows inline bar + sidebar. Handoff to ChatGPT/Gemini/Grok with auto-paste.
'use strict';

const MODEL_LIMITS = {
  'claude-opus-4':18,'claude-opus-4-5':18,'claude-opus-3-5':18,'claude-opus-3':18,
  'claude-sonnet-4':100,'claude-sonnet-4-5':100,'claude-sonnet-3-5':45,'claude-sonnet-3':45,
  'claude-haiku-3-5':500,'claude-haiku-3':500,'default':45,
};
const MODEL_WEEKLY = {
  'claude-opus-4':50,'claude-opus-4-5':50,'claude-opus-3-5':50,'claude-opus-3':50,
  'claude-sonnet-4':300,'claude-sonnet-4-5':300,'claude-sonnet-3-5':150,'claude-sonnet-3':150,
  'claude-haiku-3-5':2000,'claude-haiku-3':2000,'default':150,
};
const POLL_MS = 30000;

let state = {
  session: { pct: 0, resetAt: null },
  weekly:  { pct: 0, resetAt: null },
  model: 'default', orgId: null,
};
let uiInjected = false, pollTimer = null, countdownTimer = null;

// Inject page-context fetch interceptor
(function injectPageScript() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// Listen for usage data from inject.js
window.addEventListener('message', (evt) => {
  if (evt.source !== window) return;
  if (evt.data?.type !== 'CUM_USAGE') return;
  const d = evt.data;
  if (d.session) state.session = d.session;
  if (d.weekly)  state.weekly  = d.weekly;
  if (d.model)   state.model   = normaliseModel(d.model);
  saveUsage();
  updateUI();
});

function normaliseModel(raw) {
  if (!raw) return state.model || 'default';
  const r = raw.toLowerCase();
  if (r.includes('opus-4-5')||r.includes('opus4-5')) return 'claude-opus-4-5';
  if (r.includes('opus-4')||r.includes('opus4'))     return 'claude-opus-4';
  if (r.includes('opus-3-5')||r.includes('opus3-5')) return 'claude-opus-3-5';
  if (r.includes('opus'))   return 'claude-opus-4';
  if (r.includes('sonnet-4-5')||r.includes('sonnet4-5')) return 'claude-sonnet-4-5';
  if (r.includes('sonnet-4')||r.includes('sonnet4'))     return 'claude-sonnet-4';
  if (r.includes('sonnet-3-5')||r.includes('sonnet3-5')) return 'claude-sonnet-3-5';
  if (r.includes('sonnet')) return 'claude-sonnet-4';
  if (r.includes('haiku-3-5')||r.includes('haiku3-5')) return 'claude-haiku-3-5';
  if (r.includes('haiku'))  return 'claude-haiku-3-5';
  return 'default';
}

function saveUsage() {
  chrome.runtime.sendMessage({ type:'SAVE_USAGE', data:{ session:state.session, weekly:state.weekly, model:state.model } }).catch(()=>{});
  chrome.runtime.sendMessage({ type:'SAVE_HISTORY_POINT', data:{ sessionPct:state.session.pct, weeklyPct:state.weekly.pct, model:state.model } }).catch(()=>{});
}

init();

async function init() {
  waitForInputAndInject();
  startPollTimer();
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'ALARM_REFRESH')  refreshUsage();
    if (msg.type === 'HANDOFF')        { handoffToLLM(msg.target); sendResponse({ ok: true }); }
    if (msg.type === 'GET_STATE')      sendResponse({ state });
    if (msg.type === 'DOWNLOAD')       downloadConversation();
    if (msg.type === 'COPY')           copyConversation();
  });
  observeNavigation();
}


function refreshUsage() {
  // Tell inject.js to re-poll (it runs in page context with real fetch access)
  window.postMessage({ type: 'CUM_POLL' }, '*');
  state.model = detectModel() || state.model;
  updateUI();
}


function detectModel() {
  const sels = ['[data-testid="model-selector"] button','[aria-label*="model" i]','button[class*="model"]','[data-model]'];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const t = (el.textContent||el.getAttribute('data-model')||'').toLowerCase();
    if (t.includes('opus'))   return 'claude-opus-4';
    if (t.includes('sonnet')) return 'claude-sonnet-4';
    if (t.includes('haiku'))  return 'claude-haiku-3-5';
  }
  return state.model||'default';
}

function countTurns() {
  for (const sel of ['[data-testid="human-turn"]','[class*="human-turn"]','[data-testid="user-message"]']) {
    const els = document.querySelectorAll(sel);
    if (els.length) return els.length;
  }
  return Math.floor(document.querySelectorAll('article,[data-testid*="message"]').length / 2);
}

function getConvTitle() {
  const el = document.querySelector('h1,[data-testid="conversation-title"],nav [aria-current] span');
  if (el?.textContent?.trim()) return el.textContent.trim().slice(0,60);
  return document.title.replace(' - Claude','').trim().slice(0,60)||'Conversation';
}

function msgsLeft(pct, model, weekly=false) {
  const lim = (weekly?MODEL_WEEKLY:MODEL_LIMITS)[model]||(weekly?150:45);
  return Math.max(0, Math.floor((1-pct)*lim));
}

function modelLabel(m) {
  const map = {'claude-opus-4':'opus 4','claude-opus-4-5':'opus 4.5','claude-opus-3-5':'opus 3.5','claude-opus-3':'opus 3','claude-sonnet-4':'sonnet 4','claude-sonnet-4-5':'sonnet 4.5','claude-sonnet-3-5':'sonnet 3.5','claude-sonnet-3':'sonnet 3','claude-haiku-3-5':'haiku 3.5','claude-haiku-3':'haiku 3','default':'claude'};
  return map[m]||'claude';
}

function fmtDuration(ms) {
  if (ms<=0) return 'now';
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if (h>0) return `${h}h ${m}m`;
  if (m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtWeeklyReset(iso) {
  if (!iso) return '';
  const d=new Date(iso), days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${days[d.getDay()]} ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
}

function startPollTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshUsage, POLL_MS);
}

function waitForInputAndInject() {
  let tries=0;
  const iv = setInterval(()=>{ if(tryInjectUI()||++tries>60) clearInterval(iv); }, 500);
}

function findInput() {
  for (const sel of ['div[contenteditable="true"].ProseMirror','[contenteditable="true"][data-testid*="input"]','div[contenteditable="true"]','textarea[placeholder*="message" i]']) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function tryInjectUI() {
  const inp = findInput();
  if (!inp) return false;
  const container = inp.closest('form')||inp.parentElement?.parentElement||inp.parentElement;
  if (!container) return false;
  if (!document.getElementById('cum-inline-bar')) injectInlineBar(container);
  if (!document.getElementById('cum-sidebar-card')) injectSidebarCard();
  uiInjected = true;
  updateUI();
  startCountdown();
  return true;
}

function injectInlineBar(container) {
  const bar = document.createElement('div');
  bar.id = 'cum-inline-bar';
  bar.innerHTML = `
    <div class="cum-track"><div class="cum-fill" id="cum-session-fill"></div></div>
    <div class="cum-labels">
      <span id="cum-session-text">Loading…</span>
      <span id="cum-weekly-text" class="cum-weekly-text" style="display:none"></span>
    </div>
    <div class="cum-actions" id="cum-actions" style="display:none">
      <span class="cum-actions-label">Continue in:</span>
      <button class="cum-btn" data-action="chatgpt">&#8599; ChatGPT</button>
      <button class="cum-btn" data-action="gemini">&#8599; Gemini</button>
      <button class="cum-btn" data-action="grok">&#8599; Grok</button>
      <button class="cum-btn cum-btn--icon" data-action="copy" title="Copy conversation">&#9138;</button>
      <button class="cum-btn cum-btn--icon" data-action="download" title="Download .md">&#8595;</button>
    </div>`;
  container.insertAdjacentElement('afterend', bar);
  bar.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a==='copy') copyConversation();
      else if (a==='download') downloadConversation();
      else handoffToLLM(a);
    });
  });
}

function injectSidebarCard() {
  const nav = document.querySelector('nav, aside, [data-testid="sidebar"]');
  if (!nav) return;
  const card = document.createElement('div');
  card.id = 'cum-sidebar-card';
  card.innerHTML = `
    <div class="cum-sidebar-hdr"><span>&#9889;</span><span>Usage</span></div>
    <div class="cum-sidebar-body">
      <div class="cum-sidebar-row-label">Session</div>
      <div class="cum-track cum-track--sm"><div class="cum-fill" id="cum-sb-session-fill"></div></div>
      <div class="cum-sidebar-stat-row">
        <span id="cum-sb-session-msgs">–</span>
        <span id="cum-sb-session-reset" class="cum-muted">–</span>
      </div>
      <div class="cum-sidebar-row-label" style="margin-top:6px">Weekly</div>
      <div class="cum-track cum-track--sm"><div class="cum-fill cum-fill--weekly" id="cum-sb-weekly-fill"></div></div>
      <div class="cum-sidebar-stat-row">
        <span id="cum-sb-weekly-msgs">–</span>
        <span id="cum-sb-weekly-reset" class="cum-muted">–</span>
      </div>
    </div>`;
  nav.appendChild(card);
}

function updateUI() {
  if (!uiInjected) return;
  const sPct=state.session.pct, wPct=state.weekly.pct, model=state.model;
  const label=modelLabel(model);
  const sMsgs=msgsLeft(sPct,model), wMsgs=msgsLeft(wPct,model,true);
  const sPctN=Math.round(sPct*100), wPctN=Math.round(wPct*100);
  const sReset=state.session.resetAt?fmtDuration(new Date(state.session.resetAt).getTime()-Date.now()):'estimating…';
  const wReset=fmtWeeklyReset(state.weekly.resetAt);

  const fill=document.getElementById('cum-session-fill');
  if (fill) { fill.style.width=`${sPctN}%`; fill.className=`cum-fill${sPctN>=95?' cum-fill--crit':sPctN>=75?' cum-fill--warn':''}`; }

  const st=document.getElementById('cum-session-text');
  if (st) st.textContent=`SESSION ${sPctN}% · resets in ${sReset} · ≈${sMsgs} ${label} msgs`;

  const wt=document.getElementById('cum-weekly-text');
  if (wt&&wPct>0) { wt.textContent=`wk ${wPctN}%${wReset?' · '+wReset:''}`; wt.style.display='inline'; }

  const actions=document.getElementById('cum-actions');
  if (actions) actions.style.display=sPct>=0.7?'flex':'none';

  const setW=(id,p)=>{ const e=document.getElementById(id); if(e) e.style.width=`${Math.round(p*100)}%`; };
  const setSB=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
  setW('cum-sb-session-fill',sPct); setSB('cum-sb-session-msgs',`${sMsgs} msgs left`); setSB('cum-sb-session-reset',`resets ${sReset}`);
  setW('cum-sb-weekly-fill',wPct);  setSB('cum-sb-weekly-msgs',`${wMsgs} msgs left`);  setSB('cum-sb-weekly-reset',wReset?`resets ${wReset}`:'–');
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(()=>{
    const el=document.getElementById('cum-session-text');
    if (!el) return;
    const sPct=state.session.pct, sPctN=Math.round(sPct*100), label=modelLabel(state.model), sMsgs=msgsLeft(sPct,state.model);
    let sReset='estimating…';
    if (state.session.resetAt) {
      const ms=new Date(state.session.resetAt).getTime()-Date.now();
      sReset=ms>0?fmtDuration(ms):'now';
      if (ms<=0) refreshUsage();
    }
    el.textContent=`SESSION ${sPctN}% · resets in ${sReset} · ≈${sMsgs} ${label} msgs`;
  }, 1000);
}

function observeNavigation() {
  let last=location.href;
  new MutationObserver(()=>{
    if (location.href!==last) { last=location.href; uiInjected=false; setTimeout(()=>{ waitForInputAndInject(); refreshUsage(); },800); }
  }).observe(document.body,{childList:true,subtree:true});
}

async function handoffToLLM(target) {
  const text=buildHandoffText();
  chrome.runtime.sendMessage({ type:'OPEN_HANDOFF_TAB', target, context:text });
  showToast(`Opening ${target}… context copied`);
}

async function copyConversation() {
  const text=buildHandoffText();
  try { await navigator.clipboard.writeText(text); showToast('Copied to clipboard'); }
  catch(_) { showToast('Copy failed — check permissions'); }
}

function downloadConversation() {
  const text=buildHandoffText();
  const name=getConvTitle().replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));
  a.download=`claude-${name}-${Date.now()}.md`;
  a.click();
  showToast('Downloading…');
}

function buildHandoffText() {
  const title=getConvTitle(), turns=countTurns(), label=modelLabel(state.model);
  const lines=[`# ${title}`,`*From Claude (${label}) · ${turns} turns · ${new Date().toLocaleString()}*`,'','---',''];
  for (const {role,text} of getTurns()) lines.push(`**${role}:** ${text}`,'');
  const arts=[];
  document.querySelectorAll('pre code').forEach(el=>{ const t=el.innerText?.trim(); if(t?.length>30) arts.push(t); });
  if (arts.length) {
    lines.push('---','## Artifacts / Files','');
    arts.forEach((a,i)=>lines.push(`### Artifact ${i+1}`,'```',a,'```',''));
  }
  lines.push('---','*(Please continue this conversation)*');
  return lines.join('\n');
}

function getTurns() {
  const res=[];
  const structured=[
    {sel:'[data-testid="human-turn"]',role:'Human'},
    {sel:'[data-testid="assistant-turn"]',role:'Assistant'},
    {sel:'[class*="human-turn"]',role:'Human'},
    {sel:'[class*="assistant-turn"]',role:'Assistant'},
  ];
  for (const {sel,role} of structured) document.querySelectorAll(sel).forEach(el=>{ const t=el.innerText?.trim(); if(t) res.push({role,text:t}); });
  if (res.length) return res;
  document.querySelectorAll('article,[data-testid*="message"]').forEach((el,i)=>{ const t=el.innerText?.trim(); if(t) res.push({role:i%2===0?'Human':'Assistant',text:t}); });
  return res;
}

function showToast(msg) {
  document.getElementById('cum-toast')?.remove();
  const t=document.createElement('div');
  t.id='cum-toast'; t.innerHTML=`<span>&#10003;</span> ${msg}`;
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),500); },3000);
}
