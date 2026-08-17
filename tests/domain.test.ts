import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDomainFromTitle } from '../src/shared/classification.ts';

test('non-browser app never yields a domain', () => {
  assert.equal(extractDomainFromTitle('main.ts - FocusStudy', 'Code.exe'), undefined);
  assert.equal(extractDomainFromTitle('a.b', 'explorer.exe'), undefined);
});

test('browser: explicit https URL in title extracts the host', () => {
  assert.equal(extractDomainFromTitle('GitHub - https://github.com/foo/bar', 'chrome.exe'), 'github.com');
});

test('browser: host.tld token in common browser title format extracts domain', () => {
  // The keyword fallback resolves "youtube" mentioned by name even without a TLD.
  assert.equal(extractDomainFromTitle('youtube - watch later', 'msedge.exe'), 'youtube.com');
  // "youtube.com" as an explicit token resolves to the dotted form.
  assert.equal(extractDomainFromTitle('youtube.com - My Video', 'msedge.exe'), 'youtube.com');
});

test('file extensions are not mistaken for domains', () => {
  assert.equal(extractDomainFromTitle('main.ts - Visual Studio Code', 'chrome.exe'), undefined);
  assert.equal(extractDomainFromTitle('index.html - Google Chrome', 'chrome.exe'), undefined);
  assert.equal(extractDomainFromTitle('report.pdf - Edge', 'msedge.exe'), undefined);
});

test('dates / numeric tokens are not mistaken for domains', () => {
  assert.equal(extractDomainFromTitle('08.2026 summary', 'chrome.exe'), undefined);
  assert.equal(extractDomainFromTitle('v1.2.3 release notes', 'chrome.exe'), undefined);
});

test('known platform name fallback resolves when no URL present', () => {
  assert.equal(extractDomainFromTitle('Reddit - dive into anything', 'firefox.exe'), 'reddit.com');
  assert.equal(extractDomainFromTitle('ChatGPT - ask anything', 'chrome.exe'), 'chatgpt.com');
});

test('rejects a numeric-only TLD', () => {
  // "file.123" should not be a domain (TLD numeric).
  assert.equal(extractDomainFromTitle('document.123 preview', 'chrome.exe'), undefined);
});

test('real domain still extracted from a tab with a path', () => {
  assert.equal(extractDomainFromTitle('github.com/user/repo · Pull request', 'chrome.exe'), 'github.com');
});
