// background.js — Claude Usage Meter Service Worker
// Polls every 30 seconds. NO Claude API tokens used.

const STORAGE_USAGE   = 'cum_usage';
const STORAGE_HISTORY = 'cum_history';
const STORAGE_HANDOFF = 'cum_handoff_context';
const ALARM_POLL      = 'cum_poll';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: 0.5 });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_POLL, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_POLL) broadcastRefresh();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'SAVE_USAGE':
      chrome.storage.local.set({ [STORAGE_USAGE]: { ...msg.data, savedAt: Date.now() } })
        .then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_USAGE':
      chrome.storage.local.get(STORAGE_USAGE)
        .then(r => sendResponse({ data: r[STORAGE_USAGE] || null }));
      return true;

    case 'SAVE_HISTORY_POINT':
      chrome.storage.local.get(STORAGE_HISTORY).then(r => {
        const arr = r[STORAGE_HISTORY] || [];
        arr.push({ ...msg.data, ts: Date.now() });
        return chrome.storage.local.set({ [STORAGE_HISTORY]: arr.slice(-300) });
      }).then(() => sendResponse({ ok: true }));
      return true;

    case 'GET_HISTORY':
      chrome.storage.local.get(STORAGE_HISTORY)
        .then(r => sendResponse({ data: r[STORAGE_HISTORY] || [] }));
      return true;

    case 'OPEN_HANDOFF_TAB':
      chrome.storage.local.set({ [STORAGE_HANDOFF]: msg.context }).then(() => {
        const urls = {
          chatgpt: 'https://chatgpt.com/',
          gemini:  'https://gemini.google.com/app',
          grok:    'https://grok.x.com/',
        };
        return chrome.tabs.create({ url: urls[msg.target] });
      }).then(tab => sendResponse({ tabId: tab.id }));
      return true;

    case 'GET_HANDOFF':
      chrome.storage.local.get(STORAGE_HANDOFF).then(r => {
        sendResponse({ context: r[STORAGE_HANDOFF] || null });
        chrome.storage.local.remove(STORAGE_HANDOFF);
      });
      return true;

    case 'CLEAR_DATA':
      chrome.storage.local.remove([STORAGE_USAGE, STORAGE_HISTORY])
        .then(() => sendResponse({ ok: true }));
      return true;
  }
});

function broadcastRefresh() {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'ALARM_REFRESH' }).catch(() => {});
    }
  });
}
