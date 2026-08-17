// FocusStudy Browser Bridge — sends ONLY tab titles + hostnames to the
// FocusStudy native host (FocusStudyBrowserBridge.exe). Full URLs, page
// content, cookies and credentials are never read or transmitted.
const HOST = 'com.focusstudy.browser_bridge';

const MAX_TABS = 80;
const MAX_TITLE = 500;
const MAX_DOMAIN = 255;

let pendingTimer = null;
let lastFailureAt = 0;
let lastError = '';
const RETRY_MIN_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
// The native host binary is an Electron executable; its first launch on
// Windows can take a couple of seconds, so allow generous time before
// giving up on the connection handshake.
const CONNECT_TIMEOUT_MS = 3000;

function safeTab(tab) {
  let hostname = '';
  if (tab.url) {
    try {
      hostname = new URL(tab.url).hostname;
    } catch { /* restricted or invalid URL — leave empty */ }
  }
  return {
    title: String(tab.title || '').slice(0, MAX_TITLE),
    hostname: hostname.slice(0, MAX_DOMAIN),
    windowId: tab.windowId,
    tabId: tab.id,
    active: !!tab.active,
  };
}

function backoffDelay() {
  if (!lastFailureAt) return 0;
  const elapsed = Date.now() - lastFailureAt;
  if (elapsed >= RETRY_MAX_DELAY_MS) return 0;
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_MIN_DELAY_MS * Math.pow(2, Math.floor(elapsed / 5000)));
  return Math.max(0, base - elapsed);
}

function failure(msg) {
  lastFailureAt = Date.now();
  lastError = msg;
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    let port = null;
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try { port?.disconnect(); } catch { /* ignore */ }
      resolve({ ok, error });
    };
    try {
      port = chrome.runtime.connectNative(HOST);
      if (chrome.runtime.lastError) {
        finish(false, chrome.runtime.lastError.message || 'connectNative failed');
        return;
      }
      port.onMessage.addListener(() => finish(true));
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
        finish(false, err || 'disconnected before reply');
      });
      port.postMessage(msg);
      setTimeout(() => finish(false, 'timeout waiting for the native host'), CONNECT_TIMEOUT_MS);
    } catch (err) {
      finish(false, String(err && err.message ? err.message : err));
    }
  });
}

async function sendSnapshot(reason) {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const delay = backoffDelay();
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    if (!('runtime' in chrome && chrome.runtime?.id)) return;
    try {
      const [tabs, focused] = await Promise.all([
        chrome.tabs.query({}),
        chrome.windows.getLastFocused(),
      ]);
      const res = await sendMessage({
        type: 'tabs_snapshot',
        reason,
        ts: Date.now(),
        focusedWindowId: focused && focused.id != null ? focused.id : null,
        tabs: (tabs || []).map(safeTab).slice(0, MAX_TABS),
      });
      if (!res.ok) failure(res.error || 'unknown error');
      else lastFailureAt = 0;
    } catch (err) {
      failure(String(err && err.message ? err.message : err));
    }
  }, delay);
}

chrome.tabs.onActivated.addListener(() => sendSnapshot('active'));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.url) sendSnapshot('updated');
});
// windows.onFocusChanged is intentionally NOT registered: MV3 service
// workers filter it out; tab activation/update events already cover focus
// switches that matter for the FocusStudy tracker.
chrome.runtime.onStartup.addListener(() => sendSnapshot('startup'));
chrome.runtime.onInstalled.addListener(() => sendSnapshot('installed'));

// Popup heartbeat: report whether the native host is reachable.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ping') return false;
  sendMessage({ type: 'ping', ts: Date.now() })
    .then((res) => sendResponse({ ok: res.ok, error: res.error || lastError, extensionId: chrome.runtime.id }))
    .catch(() => sendResponse({ ok: false, error: lastError, extensionId: chrome.runtime.id }));
  return true;
});
