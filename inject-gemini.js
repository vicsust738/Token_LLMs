/**
 * inject-gemini.js
 * Runs on gemini.google.com. Reads handoff context and pastes into Gemini input.
 */
'use strict';

(async function () {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HANDOFF' });
  if (!resp?.context) return;

  const text = resp.context;

  // Gemini uses a rich-text contenteditable
  const input = await waitFor(
    () => document.querySelector(
      'rich-textarea .ql-editor, [contenteditable="true"][aria-label*="message" i], div[contenteditable="true"]'
    ),
    8000
  );
  if (!input) return;

  input.focus();

  // Clear existing content
  input.innerHTML = '';

  // Insert text
  if (document.execCommand) {
    document.execCommand('insertText', false, text);
  } else {
    // Modern fallback
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    }));
  }

  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
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
