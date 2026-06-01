'use strict';

let current = 1;

function goTo(n) {
  document.getElementById('step-' + current).classList.remove('active');
  document.getElementById('step-' + n).classList.add('active');
  document.getElementById('step-indicator').textContent = n + ' / 3';
  current = n;
}

// Wire up navigation buttons
document.getElementById('btn-1-next').addEventListener('click', function() { goTo(2); });
document.getElementById('btn-2-back').addEventListener('click', function() { goTo(1); });
document.getElementById('btn-2-next').addEventListener('click', function() { goTo(3); });
document.getElementById('btn-3-back').addEventListener('click', function() { goTo(2); });
document.getElementById('btn-3-open').addEventListener('click', function() {
  chrome.tabs.create({ url: 'https://claude.ai' });
  window.close();
});

// Animate the demo strip on step 1
var pct = 31;
setInterval(function() {
  pct = pct >= 99 ? 5 : pct + 1;
  var remaining = Math.max(0, Math.round((1 - pct / 100) * 12));
  var totalSec = Math.round(5 * 3600 * (1 - pct / 100));
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var pctEl = document.getElementById('demo-pct');
  var metaEl = document.getElementById('demo-meta');
  if (pctEl) pctEl.innerHTML = pct + '<span>%</span>';
  if (metaEl) metaEl.textContent = 'session · resets in ' + h + 'h ' + m + 'm · ≈' + remaining + ' sonnet msgs';
}, 800);
