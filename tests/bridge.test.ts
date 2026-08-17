import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBridgeMessage,
  buildHostManifest,
  createEmptyBridgeState,
  decodeNativeFrame,
  encodeNativeMessage,
  isValidExtensionId,
  mergeTabInfo,
  normalizeExtensionId,
  NATIVE_HOST_NAME,
} from '../src/shared/bridge.ts';
import type { BridgeMessage } from '../src/shared/bridge.ts';

test('encode/decode native frame round-trip', () => {
  const msg = { type: 'ping', ts: 123 };
  const frame = encodeNativeMessage(msg);
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength(JSON.stringify(msg)));
  const out = decodeNativeFrame(frame);
  assert.deepEqual(out, { message: msg, consumed: frame.length });
});

test('decodeNativeFrame handles partial and multi-frame buffers', () => {
  const msg = { type: 'ping', ts: 1 };
  const frame = encodeNativeMessage(msg);
  // partial header
  assert.equal(decodeNativeFrame(frame.subarray(0, 2)), null);
  // partial body
  assert.equal(decodeNativeFrame(frame.subarray(0, frame.length - 1)), null);
  // two frames back to back: first is consumed, second remains
  const two = Buffer.concat([encodeNativeMessage(msg), encodeNativeMessage({ type: 'focus', ts: 2 })]);
  const first = decodeNativeFrame(two);
  assert.deepEqual(first?.message, { type: 'ping', ts: 1 });
  const second = decodeNativeFrame(two.subarray(first!.consumed));
  assert.deepEqual(second?.message, { type: 'focus', ts: 2 });
});

test('decodeNativeFrame rejects invalid frames', () => {
  const bad = Buffer.alloc(4);
  bad.writeUInt32LE(0, 0); // zero length
  assert.equal(decodeNativeFrame(bad), null);
  const huge = Buffer.alloc(4);
  huge.writeUInt32LE(11 * 1024 * 1024, 0);
  assert.equal(decodeNativeFrame(huge), null);
  const garbage = Buffer.concat([Buffer.from([10, 0, 0, 0]), Buffer.from('not-json', 'utf8')]);
  assert.equal(decodeNativeFrame(garbage), null);
});

test('tabs_snapshot message populates state and picks the focused active tab', () => {
  const state = applyBridgeMessage(createEmptyBridgeState(), {
    type: 'tabs_snapshot',
    reason: 'active',
    ts: 1000,
    focusedWindowId: 2,
    tabs: [
      { tabId: 1, windowId: 1, title: 'YouTube', hostname: 'youtube.com', active: true },
      { tabId: 2, windowId: 2, title: 'Study Notes', hostname: 'docs.google.com', active: true },
    ],
  });
  assert.equal(state.source, 'snapshot');
  assert.equal(state.updatedAt, 1000);
  assert.deepEqual(state.activeTab, { windowId: 2, tabId: 2, title: 'Study Notes', hostname: 'docs.google.com' });
});

test('snapshot sanitizes hostnames to lowercase and truncates fields', () => {
  const state = applyBridgeMessage(createEmptyBridgeState(), {
    type: 'snapshot',
    ts: 1,
    focusedWindowId: 7,
    tabs: [{ tabId: 42, windowId: 7, title: 'A'.repeat(600), hostname: 'ExAmPle.CoM', active: true }],
  });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].hostname, 'example.com');
  assert.equal(state.tabs[0].title.length, 500);
});

test('activation message overrides active tab even without a prior snapshot', () => {
  const state = applyBridgeMessage(createEmptyBridgeState(), {
    type: 'activation',
    ts: 5,
    windowId: 3,
    tabId: 9,
    title: 'Chat window',
    hostname: 'chatgpt.com',
  });
  assert.deepEqual(state.activeTab, { windowId: 3, tabId: 9, title: 'Chat window', hostname: 'chatgpt.com' });
  assert.equal(state.source, 'activation');
});

test('focus message recomputes active tab from the focused window', () => {
  let state = applyBridgeMessage(createEmptyBridgeState(), {
    type: 'snapshot',
    ts: 1,
    focusedWindowId: 1,
    tabs: [
      { tabId: 1, windowId: 1, title: 'A', hostname: 'a.com', active: true },
      { tabId: 2, windowId: 2, title: 'B', hostname: 'b.com', active: true },
    ],
  });
  assert.equal(state.activeTab?.hostname, 'a.com');
  state = applyBridgeMessage(state, { type: 'focus', ts: 2, windowId: 2 });
  assert.equal(state.activeTab?.hostname, 'b.com');
});

test('ping keeps state and marks source', () => {
  let state = createEmptyBridgeState();
  state.updatedAt = 1;
  state = applyBridgeMessage(state, { type: 'ping', ts: 9 });
  assert.equal(state.updatedAt, 9);
  assert.equal(state.source, 'ping');
});

test('invalid messages are ignored without throwing', () => {
  const state = applyBridgeMessage(createEmptyBridgeState(), null as unknown as BridgeMessage);
  assert.equal(state.source, 'none');
  const state2 = applyBridgeMessage(createEmptyBridgeState(), { type: 'unknown', ts: 1 } as unknown as BridgeMessage);
  assert.equal(state2.source, 'none');
  const state3 = applyBridgeMessage(createEmptyBridgeState(), 'garbage' as unknown as BridgeMessage);
  assert.equal(state3.source, 'none');
});

test('mergeTabInfo prefers the bridge hostname over title heuristics', () => {
  assert.deepEqual(mergeTabInfo({ appName: 'msedge.exe', title: 'Window title', domain: 'hint.com' }, null), {
    title: 'Window title',
    domain: 'hint.com',
  });
  assert.deepEqual(
    mergeTabInfo({ appName: 'msedge.exe', title: 'Window title', domain: 'hint.com' }, { title: 'Real Tab', hostname: 'Youtube.CoM' }),
    { title: 'Real Tab', domain: 'youtube.com' }
  );
  // hostname empty → keep heuristics
  assert.deepEqual(mergeTabInfo({ appName: 'chrome.exe', title: 'T', domain: 'd.net' }, { title: '', hostname: '' }), {
    title: 'T',
    domain: 'd.net',
  });
});

test('extension id validation and normalization', () => {
  // Chrome extension IDs are 32 chars from [a-p] only (base-16).
  const VALID = 'abcdefghijklmnabcdefghijklmnabcd';
  assert.equal(isValidExtensionId(VALID), true);
  assert.equal(isValidExtensionId(VALID.toUpperCase()), false); // uppercase
  assert.equal(isValidExtensionId(VALID.slice(0, 3)), false); // too short
  assert.equal(isValidExtensionId(VALID + 'ab'), false); // too long
  assert.equal(isValidExtensionId('abcdefghijklmnopqrstuvwxyzabcdef'), false); // q-z not allowed
  assert.equal(normalizeExtensionId(`  chrome-extension://${VALID.toUpperCase()}  `), VALID);
});

test('host manifest uses the native host name and pinned origins', () => {
  const manifest = buildHostManifest({ hostExecutablePath: 'C:\\FocusStudy\\FocusStudyBrowserBridge.exe', extensionId: 'abcdefghijklmnopqrstuvwxyzabcdef' }) as {
    name: string;
    path: string;
    type: string;
    allowed_origins: string[];
  };
  assert.equal(manifest.name, NATIVE_HOST_NAME);
  assert.equal(manifest.type, 'stdio');
  assert.equal(manifest.allowed_origins[0], 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/');
  // invalid id → no pinned origins (host will refuse anyway)
  const empty = buildHostManifest({ hostExecutablePath: 'x', extensionId: '' }) as { allowed_origins: string[] };
  assert.deepEqual(empty.allowed_origins, []);
});