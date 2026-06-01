/**
 * inject-grok.js
 * Runs on grok.x.com. Reads handoff context and pastes into Grok input.
 */
'use strict';

(async function () {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HANDOFF' });
  if (!resp?.context) return;

  const text = resp.context;

  const input = await waitFor(
    () => document.querySelector(
      'textarea[placeholder*="message" i], textarea[placeholder*="Ask" i], ' +
      'div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
    ),
    8000
  );
  if (!input) return;

  input.focus();

  if (input.tagName === 'TEXTAREA') {
    // React textarea — use native setter trick
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    );
    nativeSetter.set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // contenteditable
    input.innerHTML = '';
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
})();

function waitFor(fn, timeoutMs = 5000, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      const r = fn();
      if (r) { clearInterval(id); resolve(r); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(id); resolve(null); }
    }, intervalMs);
  });
}
