import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppCategory, CategorizationRule } from '../src/shared/types.ts';
import { classifyApp, assessApp, domainMatches, isAIAssistant, matchesDistractingKeyword, isBrowserExecutable, type RawAppInfo } from '../src/shared/classification.ts';

const categories: AppCategory[] = [
  { id: 'cat_productive', name: 'Productive', type: 'productive', color_hex: '#10B981' },
  { id: 'cat_distracting', name: 'Distracting', type: 'distracting', color_hex: '#EF4444' },
  { id: 'cat_neutral', name: 'Neutral', type: 'neutral', color_hex: '#64748B' },
  { id: 'cat_idle', name: 'Away / Idle', type: 'idle', color_hex: '#94A3B8' },
];

function raw(partial: Partial<RawAppInfo>): RawAppInfo {
  return {
    execPath: 'C:\\Apps\\app.exe',
    appName: 'App.exe',
    title: 'App window title',
    isIdle: false,
    ...partial,
  };
}

test('idle state always maps to the idle category', () => {
  const result = classifyApp(categories, [], raw({ isIdle: true, appName: 'Discord.exe' }));
  assert.equal(result.id, 'cat_idle');
});

test('built-in heuristic: known distracting executable', () => {
  const result = classifyApp(categories, [], raw({ appName: 'discord.exe', title: 'Home' }));
  assert.equal(result.id, 'cat_distracting');
});

test('built-in heuristic: known productive executable', () => {
  const result = classifyApp(categories, [], raw({ appName: 'Code.exe', title: 'main.ts - FocusStudy' }));
  assert.equal(result.id, 'cat_productive');
});

test('built-in heuristic: distracting keywords in domain', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', domain: 'youtube.com', title: 'Study' }));
  assert.equal(result.id, 'cat_distracting');
});

test('unknown app falls back to distracting (conservative default)', () => {
  const result = classifyApp(categories, [], raw({ appName: 'RandomApp.exe', title: 'Hello', domain: 'example.com' }));
  assert.equal(result.id, 'cat_distracting');
});

test('user rule with executable pattern overrides built-in heuristics', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'executable', pattern_value: 'discord.exe', category_id: 'cat_productive', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'Discord.exe' }));
  assert.equal(result.id, 'cat_productive');
});

test('executable rule matching is case-insensitive', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'executable', pattern_value: 'CODE.EXE', category_id: 'cat_distracting', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'code.exe' }));
  assert.equal(result.id, 'cat_distracting');
});

test('domain rule matches via substring', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'domain', pattern_value: 'youtube', category_id: 'cat_productive', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'chrome.exe', domain: 'www.youtube.com' }));
  assert.equal(result.id, 'cat_productive');
});

test('title regex rule applies to window titles', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'title_regex', pattern_value: '^leetcode', category_id: 'cat_productive', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'chrome.exe', title: 'LeetCode - Problems' }));
  assert.equal(result.id, 'cat_productive');
});

test('invalid regex rules are skipped instead of crashing', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'title_regex', pattern_value: '[invalid', category_id: 'cat_productive', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'UnknownApp.exe', title: 'anything' }));
  assert.equal(result.id, 'cat_distracting');
});

test('highest priority rule wins regardless of array order', () => {
  const rules: CategorizationRule[] = [
    { id: 'low', pattern_type: 'executable', pattern_value: 'App.exe', category_id: 'cat_distracting', priority: 10 },
    { id: 'high', pattern_type: 'executable', pattern_value: 'app.exe', category_id: 'cat_productive', priority: 200 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'App.exe' }));
  assert.equal(result.id, 'cat_productive');
});

test('rules with unknown category ids are ignored', () => {
  const rules: CategorizationRule[] = [
    { id: 'r1', pattern_type: 'executable', pattern_value: 'discord.exe', category_id: 'cat_missing', priority: 100 },
  ];
  const result = classifyApp(categories, rules, raw({ appName: 'Discord.exe' }));
  assert.equal(result.id, 'cat_distracting');
});

test('AI assistants are not flagged by the "chat" keyword (ChatGPT window)', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', title: 'ChatGPT - Ask anything' }));
  assert.equal(result.id, 'cat_productive');
});

test('AI assistant app name (chatgpt.exe) maps to productive', () => {
  const result = classifyApp(categories, [], raw({ appName: 'ChatGPT.exe', title: 'Chat' }));
  assert.equal(result.id, 'cat_productive');
});

test('AI assistant domain (chatgpt.com) is not flagged', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', title: 'Geometry question', domain: 'chatgpt.com' }));
  assert.equal(result.id, 'cat_productive');
});

test('isAIAssistant detects assistants across name/title/domain', () => {
  assert.equal(isAIAssistant('chrome.exe', 'ChatGPT - Homework help', ''), true);
  assert.equal(isAIAssistant('', '', ''), false);
});

// --- T4: exact (not substring) executable matching ---

test('unknown fabricated exe falls to the conservative distracting default', () => {
  const result = classifyApp(categories, [], raw({ appName: 'mygamebar.exe', title: 'notes' }));
  assert.equal(result.id, 'cat_distracting');
});

test('exact distracting exe match still applies', () => {
  const result = classifyApp(categories, [], raw({ appName: 'spotify.exe', title: 'Spotify' }));
  assert.equal(result.id, 'cat_distracting');
});

// --- T5: domain precedence + browser unknown -> neutral ---

test('browser on an unknown domain defaults to neutral, not productive', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', title: 'Some shop', domain: 'randomshop.xyz' }));
  assert.equal(result.id, 'cat_neutral');
});

test('browser with no extracted domain defaults to neutral', () => {
  const result = classifyApp(categories, [], raw({ appName: 'msedge.exe', title: 'Untitled page' }));
  assert.equal(result.id, 'cat_neutral');
});

test('domain verdict takes precedence over the (now non-productive) browser binary', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', domain: 'reddit.com', title: 'r/learnprogramming' }));
  assert.equal(result.id, 'cat_distracting');
});

// --- System Whitelist Tests ---

test('system tray app (systemsettings.exe) stays neutral with unknown title', () => {
  const result = classifyApp(categories, [], raw({ appName: 'systemsettings.exe', title: 'Settings' }));
  assert.equal(result.id, 'cat_neutral');
});

test('VPN app (nordvpn.exe) stays neutral (system whitelist)', () => {
  const result = classifyApp(categories, [], raw({ appName: 'nordvpn.exe', title: 'Quick Connect' }));
  assert.equal(result.id, 'cat_neutral');
});

test('system whitelist does not shadow a distracting app with a similar name', () => {
  // "explorer.exe" is whitelisted by exact match, but a non-whitelisted app
  // that merely contains "explorer" as a substring is NOT shadowed — a
  // distracting title keyword still wins.
  const result = classifyApp(categories, [], raw({ appName: 'myexplorer.exe', title: 'best game' }));
  assert.equal(result.id, 'cat_distracting');
});

test('known distracting domain soundcloud.com is flagged even without a keyword match', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', domain: 'soundcloud.com', title: 'track' }));
  assert.equal(result.id, 'cat_distracting');
});

test('subdomain of a known distracting domain is flagged', () => {
  const result = classifyApp(categories, [], raw({ appName: 'chrome.exe', domain: 'm.soundcloud.com', title: 'x' }));
  assert.equal(result.id, 'cat_distracting');
});

// --- T7: whole-word keyword matching (no false positives) ---

test('whole-word keyword match: "game loop architecture" on Code.exe is productive (exe wins over weak title keyword)', () => {
  const result = classifyApp(categories, [], raw({ appName: 'Code.exe', title: 'Game loop architecture · articles' }));
  assert.equal(result.id, 'cat_productive');
});

test('whole-word keyword match: standalone "game" in an unknown title is distracting', () => {
  const result = classifyApp(categories, [], raw({ appName: 'randombrowser.exe', title: 'best game of the year' }));
  assert.equal(result.id, 'cat_distracting');
});

test('music theory docs (Code.exe) is NOT flagged by the "music" keyword', () => {
  const result = classifyApp(categories, [], raw({ appName: 'Code.exe', title: 'music theory - notes' }));
  assert.equal(result.id, 'cat_productive');
});

test('matchesDistractingKeyword uses whole words for ASCII tokens', () => {
  // "game" as a standalone word matches; "gameplay" (game as substring) does not.
  assert.equal(matchesDistractingKeyword('game of the year'), true);
  assert.equal(matchesDistractingKeyword('game loop architecture'), true);
  assert.equal(matchesDistractingKeyword('gameplay architecture'), false);
  assert.equal(matchesDistractingKeyword('endgame review'), false);
  assert.equal(matchesDistractingKeyword(''), false);
});

test('isBrowserExecutable recognizes browsers', () => {
  assert.equal(isBrowserExecutable('Chrome.exe'), true);
  assert.equal(isBrowserExecutable('msedge.exe'), true);
  assert.equal(isBrowserExecutable('Code.exe'), false);
});

test('detailed assessment separates unknown apps from confidently distracting apps', () => {
  const unknown = assessApp(categories, [], raw({ appName: 'UnknownStudyTool.exe', title: 'Untitled' }));
  assert.equal(unknown.known, false);
  assert.equal(unknown.category.id, 'cat_neutral');
  const known = assessApp(categories, [], raw({ appName: 'discord.exe', title: 'Home' }));
  assert.equal(known.known, true);
  assert.equal(known.category.id, 'cat_distracting');
});

test('domain matching rejects substring collisions but allows labels and subdomains', () => {
  assert.equal(domainMatches('www.youtube.com', 'youtube.com'), true);
  assert.equal(domainMatches('m.youtube.com', 'youtube'), true);
  assert.equal(domainMatches('myyoutube.com', 'youtube.com'), false);
});
