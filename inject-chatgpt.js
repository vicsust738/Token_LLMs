/**
 * inject-chatgpt.js
 * Runs on chatgpt.com. Reads handoff context from storage and pastes it
 * into the ChatGPT input box automatically.
 */
'use strict';

(async function () {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_HANDOFF' });
  if (!resp?.context) return;

  const text = resp.context;

  // Wait for the ChatGPT input to appear (it's a ProseMirror contenteditable)
  const input = await waitFor(
    () => document.querySelector(
      '#prompt-textarea, [contenteditable="true"][data-id], div[contenteditable="true"]'
    ),
    8000
  );
  if (!input) return;

  pasteIntoElement(input, text);
})();

function pasteIntoElement(el, text) {
  el.focus();

  // ChatGPT uses a React-controlled contenteditable
  // Simulate input event to trigger React's state update
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLElement.prototype, 'innerHTML'
  );

  // Use execCommand for contenteditable
  if (el.contentEditable === 'true') {
    el.innerHTML = '';
    document.execCommand('insertText', false, text);
    // Fire input event so React picks up the change
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  } else {
    // textarea fallback
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    setter.set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function waitFor(fn, timeoutMs = 5000, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      const result = fn();
      if (result) { clearInterval(check); resolve(result); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(check); resolve(null); }
    }, intervalMs);
  });
}
