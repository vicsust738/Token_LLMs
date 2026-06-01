// inject.js — page-context fetch interceptor for Claude Usage Meter
(function() {
  'use strict';
  if (window.__cumInjected) return;
  window.__cumInjected = true;

  const _fetch = window.fetch;

  function extractUsage(obj, url) {
    if (!obj || typeof obj !== 'object') return null;

    // Claude's actual format: { five_hour: { utilization: 100, resets_at: "..." }, seven_day: { utilization: 22, resets_at: "..." } }
    if (obj.five_hour && typeof obj.five_hour.utilization === 'number') {
      const result = {
        session: {
          pct: obj.five_hour.utilization / 100,
          resetAt: obj.five_hour.resets_at || null
        }
      };
      if (obj.seven_day && typeof obj.seven_day.utilization === 'number') {
        result.weekly = {
          pct: obj.seven_day.utilization / 100,
          resetAt: obj.seven_day.resets_at || null
        };
      }
      return result;
    }

    // Fallback patterns
    if (typeof obj.percent_used === 'number') {
      const r = { session: { pct: obj.percent_used, resetAt: obj.reset_at||null } };
      if (typeof obj.weekly_percent_used === 'number')
        r.weekly = { pct: obj.weekly_percent_used, resetAt: obj.weekly_reset_at||null };
      return r;
    }
    if (Array.isArray(obj) && obj.length && typeof obj[0].requests_limit !== 'undefined') {
      const sorted = [...obj].sort((a,b)=>(a.window_duration_seconds||0)-(b.window_duration_seconds||0));
      const s = sorted[0];
      if (s && s.requests_limit > 0) {
        const result = { session: { pct: s.requests_used/s.requests_limit, resetAt: s.reset_at||null } };
        if (sorted.length > 1) {
          const w = sorted[sorted.length-1];
          if (w && w.requests_limit > 0)
            result.weekly = { pct: w.requests_used/w.requests_limit, resetAt: w.reset_at||null };
        }
        return result;
      }
    }
    return null;
  }

  function extractModel(obj) {
    if (!obj || typeof obj !== 'object') return null;
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 5) return null;
      if (o.model && typeof o.model === 'string') return o.model;
      if (o.default_model && typeof o.default_model === 'string') return o.default_model;
      for (const v of Object.values(o)) { const r = walk(v, depth+1); if (r) return r; }
      return null;
    }
    return walk(obj, 0);
  }

  function broadcast(result, model) {
    if (!result || !result.session) return;
    const msg = { type: 'CUM_USAGE', session: result.session };
    if (result.weekly) msg.weekly = result.weekly;
    if (model) msg.model = model;
    window.postMessage(msg, '*');
  }

  // Intercept all fetch calls
  window.fetch = async function(...args) {
    const response = await _fetch.apply(this, args);
    const url = (typeof args[0]==='string' ? args[0] : args[0]?.url) || '';
    try {
      if ((response.headers.get('content-type')||'').includes('application/json')) {
        response.clone().json().then(data => {
          const result = extractUsage(data, url);
          if (result) broadcast(result, extractModel(data));
        }).catch(()=>{});
      }
    } catch(_) {}
    return response;
  };

  function doPoll() {
    _fetch.call(window, '/api/bootstrap', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const orgs = data?.account?.memberships || data?.memberships || [];
        const orgId = orgs[0]?.organization?.uuid || orgs[0]?.organization?.id;
        if (!orgId) return;
        _fetch.call(window, `/api/organizations/${orgId}/usage`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) { const r = extractUsage(d, 'usage'); if (r) broadcast(r, extractModel(d)); } })
          .catch(()=>{});
      }).catch(()=>{});
  }

  window.addEventListener('message', (evt) => {
    if (evt.source !== window || evt.data?.type !== 'CUM_POLL') return;
    doPoll();
  });

  doPoll();
  setTimeout(doPoll, 2000);
})();
