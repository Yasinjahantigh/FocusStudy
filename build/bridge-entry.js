// FocusStudyBrowserBridge relay script (ELECTRON_RUN_AS_NODE=1).
//
// Chromium's native-messaging host speaks via stdin/stdout, but an Electron
// GUI process on Windows receives stdin 'end' before any data arrives (the
// GUI runtime closes the stream). So the GUI launcher (see
// src/main/services/nativeHost.ts) re-spawns this same executable with
// ELECTRON_RUN_AS_NODE=1 and inherits the browser's pipes into THIS process.
//
// Keep the frame/state logic in sync with src/shared/bridge.ts (covered by
// tests/bridge.test.ts). Must not import Electron or koffi.
'use strict';

// The native-messaging transport is sacred: Chrome/Edge parse stdout as
// 4-byte-LE-length frames, so even a single stray byte (e.g. a "\r\n" or a
// console.log from the Electron GUI launcher that respawned us) corrupts the
// stream and the browser kills the host. Route ALL console output of this
// process to stderr and make stdout.write usable only for frames — any
// accidental non-Buffer write is dropped with a breadcrumb on stderr.
const rawStdoutWrite = process.stdout.write.bind(process.stdout);
['log', 'info', 'warn', 'error', 'debug'].forEach((m) => {
  console[m] = function (...args) {
    try {
      process.stderr.write(args.map(String).join(' ') + '\n');
    } catch { /* stderr unavailable too — swallow */ }
  };
});
process.stdout.write = (chunk, ...rest) => {
  if (!Buffer.isBuffer(chunk)) {
    try { process.stderr.write('[bridge-entry] non-frame stdout write suppressed: ' + String(chunk).slice(0, 80) + '\n'); } catch {}
    return true;
  }
  return rawStdoutWrite(chunk, ...rest);
};


const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_FILE = path.join(process.env.TEMP || os.tmpdir(), 'focusstudy-bridge.log');
function blog(line) {
  try {
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + line + '\n');
  } catch {
    // diagnostics must never crash the host
  }
}

// The launcher hands us the main app's userData dir (app.getPath('userData')
// resolves the same way). Fallback matches app.getName() === 'focus-study'.
function stateFilePath() {
  const dir = process.env.FOCUSSTUDY_USERDATA_DIR ||
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'focus-study');
  return path.join(dir, 'bridge-state.json');
}

let state = {
  schema: 1,
  focusedWindowId: null,
  activeTab: null,
  tabs: [],
  lastActiveWindowId: null,
  updatedAt: 0,
  source: 'none',
};

function writeStateFile() {
  try {
    const file = stateFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (err) {
    blog('writeStateFile failed: ' + (err && err.message));
  }
}

function sanitizeTab(tab) {
  if (!tab || typeof tab !== 'object') return null;
  const tabId = Number(tab.tabId);
  const windowId = Number(tab.windowId);
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) return null;
  return {
    tabId: tabId,
    windowId: windowId,
    title: String(tab.title || '').slice(0, 500),
    hostname: String(tab.hostname || '').slice(0, 255).toLowerCase(),
    active: Boolean(tab.active),
  };
}

function pickActiveTab(tabs, focusedWindowId) {
  if (!tabs.length) return null;
  if (focusedWindowId != null) {
    const inFocused = tabs.find((t) => t.active && t.windowId === focusedWindowId);
    if (inFocused) {
      return { windowId: inFocused.windowId, tabId: inFocused.tabId, title: inFocused.title, hostname: inFocused.hostname };
    }
  }
  const anyActive = tabs.find((t) => t.active);
  if (anyActive) {
    return { windowId: anyActive.windowId, tabId: anyActive.tabId, title: anyActive.title, hostname: anyActive.hostname };
  }
  return null;
}

function applyMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const ts = Number(msg.ts) || Date.now();
  switch (msg.type) {
    case 'snapshot':
    case 'tabs_snapshot': {
      const focused = Number(msg.focusedWindowId);
      state.focusedWindowId = Number.isInteger(focused) ? focused : null;
      const tabs = [];
      for (const raw of msg.tabs || []) {
        const tab = sanitizeTab(raw);
        if (tab) tabs.push(tab);
      }
      state.tabs = tabs;
      state.activeTab = pickActiveTab(tabs, state.focusedWindowId);
      state.source = 'snapshot';
      state.updatedAt = ts;
      break;
    }
    case 'activation': {
      const windowId = Number(msg.windowId);
      const tabId = Number(msg.tabId);
      const found = state.tabs.find((t) => t.windowId === windowId && t.tabId === tabId);
      let title = (found && found.title) || '';
      let hostname = (found && found.hostname) || '';
      if (typeof msg.title === 'string' && msg.title.trim()) title = msg.title.slice(0, 500);
      if (typeof msg.hostname === 'string' && msg.hostname.trim()) hostname = msg.hostname.slice(0, 255).toLowerCase();
      state.activeTab = { windowId: windowId, tabId: tabId, title: title, hostname: hostname };
      state.lastActiveWindowId = windowId;
      state.source = 'activation';
      state.updatedAt = ts;
      break;
    }
    case 'focus': {
      const focused = Number(msg.windowId);
      state.focusedWindowId = Number.isInteger(focused) ? focused : null;
      state.activeTab = pickActiveTab(state.tabs, state.focusedWindowId);
      state.source = 'focus';
      state.updatedAt = ts;
      break;
    }
    case 'ping': {
      state.source = 'ping';
      state.updatedAt = ts;
      break;
    }
  }
}

// Native messaging framing: 4-byte little-endian length prefix + UTF-8 JSON.
function decodeFrame(buf) {
  if (buf.length < 4) return null;
  const length = buf.readUInt32LE(0);
  if (!length || length > 10 * 1024 * 1024) return null;
  if (buf.length < 4 + length) return null;
  const raw = buf.slice(4, 4 + length).toString('utf8');
  try {
    return { message: JSON.parse(raw), consumed: 4 + length };
  } catch {
    return null;
  }
}

function encodeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

blog('relay boot argv=' + process.argv.join(' ') + ' RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || ''));

writeStateFile();

let pending = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  blog('stdin data: ' + chunk.length + ' bytes');
  pending = Buffer.concat([pending, chunk]);
  for (;;) {
    const frame = decodeFrame(pending);
    if (!frame) break;
    pending = pending.subarray(frame.consumed);
    const msg = frame.message;
    if (msg && typeof msg === 'object') {
      try {
        applyMessage(msg);
        writeStateFile();
      } catch (err) {
        blog('message handling failed: ' + (err && err.message));
      }
      const reply = { ok: true, echo: msg.type || 'message', ts: Date.now() };
      try {
        process.stdout.write(encodeMessage(reply));
        blog('replied echo=' + reply.echo);
      } catch {
        // stdout closed — the browser is gone; the process will be killed by it.
      }
    }
  }
  if (pending.length > 10 * 1024 * 1024) pending = Buffer.alloc(0);
});

// stdin 'end' only means the current browser pipe closed. The browser owns the
// native host's lifetime (it kills the process), so never self-exit here — a
// short-lived pipe must not race away the bootstrap state write.
process.stdin.on('end', () => blog('stdin end — staying alive'));
process.stdin.on('error', (err) => blog('stdin error: ' + (err && err.message)));
process.stdout.on('error', () => {}); // EPIPE is expected when the browser leaves

// Watchdog: the GUI launcher that respawned us is our owner. Chrome kills the
// launcher when the browser disconnects from the host, so if the launcher PID
// disappears we exit too (no orphan processes).
const launcherPid = Number(process.env.FOCUSSTUDY_LAUNCHER_PID || 0);
if (launcherPid > 0) {
  setInterval(() => {
    try {
      process.kill(launcherPid, 0); // signal 0 = existence probe (no kill)
    } catch {
      blog('launcher pid ' + launcherPid + ' gone — exiting');
      process.exit(0);
    }
  }, 2000);
}

// Keep the event loop alive between messages. Deliberately NOT unref'd:
// after stdin 'end' (which Windows fires the moment the current pipe closes)
// this is the only thing keeping the host process alive for the next
// reconnection. Chrome owns the host's lifetime and kills it on disconnect.
setInterval(() => {}, 60000);
