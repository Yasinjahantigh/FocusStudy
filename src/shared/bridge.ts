/**
 * Pure, unit-testable bridge protocol between the FocusStudy browser extension
 * and the native host (FocusStudyBrowserBridge.exe). All helpers here are free
 * of Electron/koffi imports so node:test can exercise them directly.
 */

export const NATIVE_HOST_NAME = 'com.focusstudy.browser_bridge';

export const BRIDGE_STATE_SCHEMA = 1 as const;
export const BRIDGE_FRESH_MS = 3 * 60 * 1000;
export const MAX_FRAME_BYTES = 10 * 1024 * 1024;

export interface BridgeTab {
  tabId: number;
  windowId: number;
  title: string;
  hostname: string;
  active: boolean;
}

export interface BridgeSnapshotMsg {
  type: 'snapshot' | 'tabs_snapshot';
  ts: number;
  focusedWindowId: number | null;
  reason?: string | null;
  tabs: BridgeTab[];
}

export interface BridgeActivationMsg {
  type: 'activation';
  ts: number;
  windowId: number;
  tabId: number;
  title?: string;
  hostname?: string;
}

export interface BridgeFocusMsg {
  type: 'focus';
  ts: number;
  windowId: number;
}

export interface BridgePingMsg {
  type: 'ping';
  ts: number;
}

export type BridgeMessage = BridgeSnapshotMsg | BridgeActivationMsg | BridgeFocusMsg | BridgePingMsg;

export interface BridgeState {
  schema: typeof BRIDGE_STATE_SCHEMA;
  focusedWindowId: number | null;
  activeTab: { windowId: number; tabId: number; title: string; hostname: string } | null;
  tabs: BridgeTab[];
  lastActiveWindowId: number | null;
  updatedAt: number;
  source: 'snapshot' | 'activation' | 'focus' | 'ping' | 'none';
}

export function createEmptyBridgeState(): BridgeState {
  return {
    schema: BRIDGE_STATE_SCHEMA,
    focusedWindowId: null,
    activeTab: null,
    tabs: [],
    lastActiveWindowId: null,
    updatedAt: 0,
    source: 'none',
  };
}

function sanitizeTab(tab: any): BridgeTab | null {
  if (!tab || typeof tab !== 'object') return null;
  const tabId = Number(tab.tabId);
  const windowId = Number(tab.windowId);
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) return null;
  return {
    tabId,
    windowId,
    title: String(tab.title || '').slice(0, 500),
    hostname: String(tab.hostname || '').slice(0, 255).toLowerCase(),
    active: Boolean(tab.active),
  };
}

function pickActiveTab(state: BridgeState): BridgeState['activeTab'] {
  const focused = state.focusedWindowId;
  const flat = state.tabs;
  if (!flat.length) return null;
  if (focused != null) {
    const inFocused = flat.find(t => t.active && t.windowId === focused);
    if (inFocused) return { windowId: inFocused.windowId, tabId: inFocused.tabId, title: inFocused.title, hostname: inFocused.hostname };
  }
  const anyActive = flat.find(t => t.active);
  if (anyActive) return { windowId: anyActive.windowId, tabId: anyActive.tabId, title: anyActive.title, hostname: anyActive.hostname };
  return null;
}

export function applyBridgeMessage(prev: BridgeState, msg: BridgeMessage | null | undefined): BridgeState {
  const state: BridgeState = {
    ...prev,
    tabs: prev.tabs ? [...prev.tabs] : [],
  };
  if (!msg || typeof msg !== 'object') return state;
  const ts = Number((msg as any).ts) || Date.now();

  switch (msg.type) {
    case 'snapshot':
    case 'tabs_snapshot': {
      state.focusedWindowId = Number((msg as BridgeSnapshotMsg).focusedWindowId) || null;
      const tabs: BridgeTab[] = [];
      for (const raw of (msg as BridgeSnapshotMsg).tabs || []) {
        const tab = sanitizeTab(raw);
        if (tab) tabs.push(tab);
      }
      state.tabs = tabs;
      state.activeTab = pickActiveTab(state);
      state.source = 'snapshot';
      state.updatedAt = ts;
      break;
    }
    case 'activation': {
      const act = msg as BridgeActivationMsg;
      const windowId = Number(act.windowId);
      const tabId = Number(act.tabId);
      const found = state.tabs.find(t => t.windowId === windowId && t.tabId === tabId);
      let title = found?.title || '';
      let hostname = found?.hostname || '';
      if (typeof act.title === 'string' && act.title.trim()) title = act.title.slice(0, 500);
      if (typeof act.hostname === 'string' && act.hostname.trim()) hostname = act.hostname.slice(0, 255).toLowerCase();
      state.activeTab = { windowId, tabId, title, hostname };
      state.lastActiveWindowId = windowId;
      state.source = 'activation';
      state.updatedAt = ts;
      break;
    }
    case 'focus': {
      const focus = msg as BridgeFocusMsg;
      state.focusedWindowId = Number(focus.windowId) || null;
      state.activeTab = pickActiveTab(state);
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
  return state;
}

/**
 * Native messaging framing: 4-byte little-endian length prefix + UTF-8 JSON.
 * Returns the decoded message plus the number of bytes consumed, or null when
 * the buffer holds an incomplete (or invalid) frame.
 */
export function decodeNativeFrame(input: Buffer): { message: unknown; consumed: number } | null {
  if (input.length < 4) return null;
  const length = input.readUInt32LE(0);
  if (length <= 0 || length > MAX_FRAME_BYTES) return null;
  if (input.length < 4 + length) return null;
  const raw = input.slice(4, 4 + length).toString('utf8');
  try {
    return { message: JSON.parse(raw), consumed: 4 + length };
  } catch {
    return null;
  }
}

export function encodeNativeMessage(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function buildHostManifest(opts: { hostExecutablePath: string; extensionId: string }): object {
  const id = normalizeExtensionId(opts.extensionId || '');
  return {
    name: NATIVE_HOST_NAME,
    description: 'FocusStudy optional browser metadata bridge (tab title + hostname only)',
    path: opts.hostExecutablePath,
    type: 'stdio',
    allowed_origins: id ? [`chrome-extension://${id}/`] : [],
  };
}

export function normalizeExtensionId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^chrome-extension:\/\//, '')
    .replace(/\/+$/, '')
    .slice(0, 64);
}

export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}

/**
 * Tracker-side merge: when the foreground app is a browser, tab metadata from
 * the bridge replaces the window-title heuristics (hostname is authoritative).
 */
export function mergeTabInfo(
  raw: { appName: string; title: string; domain?: string },
  tab: { title?: string; hostname?: string } | null | undefined
): { title: string; domain?: string } {
  if (!tab || typeof tab !== 'object') {
    return { title: raw.title, domain: raw.domain };
  }
  const hostname = String(tab.hostname || '').trim().toLowerCase();
  if (!hostname) {
    return { title: raw.title, domain: raw.domain };
  }
  const title = String(tab.title || '').trim().slice(0, 500);
  return {
    title: title || raw.title,
    domain: hostname.slice(0, 255),
  };
}

export const HOST_REGISTRY_KEY_CHROME = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
export const HOST_REGISTRY_KEY_EDGE = `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;