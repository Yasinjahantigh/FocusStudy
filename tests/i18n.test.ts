import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

function loadLocale(file: string) {
  const content = fs.readFileSync(file, 'utf-8');
  return JSON.parse(content);
}

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

test('en.json and fa.json have identical key sets', () => {
  const enPath = path.resolve('src/renderer/i18n/locales/en.json');
  const faPath = path.resolve('src/renderer/i18n/locales/fa.json');

  const en = loadLocale(enPath);
  const fa = loadLocale(faPath);

  const enKeys = getAllKeys(en);
  const faKeys = getAllKeys(fa);

  assert.deepStrictEqual(enKeys, faKeys, 'Locale keys must match exactly');
});

/**
 * JSON.parse silently lets later duplicate keys overwrite earlier ones at the
 * same object level, so a file with two "common" blocks still parses "fine"
 * while losing keys from the first block. Detect duplicates on the RAW text.
 */
function collectRawKeys(raw: string, keys: string[], pathStack: string[] = []): void {
  let i = 0;

  function skipWs() {
    while (i < raw.length && /\s/.test(raw[i])) i++;
  }

  function readString(): string {
    if (raw[i] !== '"') throw new Error(`Expected " at ${i}`);
    i++;
    let out = '';
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '\\') {
        out += raw[i + 1] === 'u' ? String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)) : raw[i + 1];
        i += raw[i + 1] === 'u' ? 6 : 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return out;
      }
      out += ch;
      i++;
    }
    throw new Error('Unterminated string');
  }

  function skipValue() {
    skipWs();
    const ch = raw[i];
    if (ch === '{') parseObject(pathStack);
    else if (ch === '[') parseArray(pathStack);
    else if (ch === '"') readString();
    else {
      while (i < raw.length && !/[\s,\]}]/.test(raw[i])) i++;
    }
  }

  function parseObject(stack: string[]): void {
    i++; // consume {
    skipWs();
    const seen = new Set<string>();
    if (raw[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      skipWs();
      const key = readString();
      if (seen.has(key)) {
        throw new Error(`Duplicate key "${key}" in object "${stack.join('.')}"`);
      }
      seen.add(key);
      skipWs();
      if (raw[i] !== ':') throw new Error(`Expected : at ${i}`);
      i++;
      skipWs();
      if (raw[i] === '{' || raw[i] === '[') {
        if (raw[i] === '{') parseObject([...stack, key]);
        else parseArray([...stack, key]);
      } else {
        keys.push([...stack, key].join('.'));
        skipValue();
      }
      skipWs();
      if (raw[i] === ',') {
        i++;
        continue;
      }
      if (raw[i] === '}') {
        i++;
        return;
      }
      throw new Error(`Expected , or } at ${i}`);
    }
  }

  function parseArray(stack: string[]): void {
    i++; // consume [
    skipWs();
    if (raw[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      skipValue();
      skipWs();
      if (raw[i] === ',') {
        i++;
        continue;
      }
      if (raw[i] === ']') {
        i++;
        return;
      }
      throw new Error(`Expected , or ] at ${i}`);
    }
  }

  parseObject(pathStack);
}

test('en.json and fa.json contain no duplicate keys in the raw text', () => {
  const enRaw = fs.readFileSync(path.resolve('src/renderer/i18n/locales/en.json'), 'utf-8');
  const faRaw = fs.readFileSync(path.resolve('src/renderer/i18n/locales/fa.json'), 'utf-8');

  const enKeys: string[] = [];
  const faKeys: string[] = [];
  assert.doesNotThrow(() => collectRawKeys(enRaw, enKeys), 'en.json must not contain duplicate keys');
  assert.doesNotThrow(() => collectRawKeys(faRaw, faKeys), 'fa.json must not contain duplicate keys');

  // The raw key set must equal the parsed key set — otherwise JSON.parse
  // collapsed something and translations are being lost.
  const parsedEnKeys = getAllKeys(JSON.parse(enRaw));
  const parsedFaKeys = getAllKeys(JSON.parse(faRaw));
  assert.deepStrictEqual(enKeys.sort(), parsedEnKeys, 'parse collapsed keys in en.json');
  assert.deepStrictEqual(faKeys.sort(), parsedFaKeys, 'parse collapsed keys in fa.json');
});

test('en.json and fa.json parse as valid JSON', () => {
  const enPath = path.resolve('src/renderer/i18n/locales/en.json');
  const faPath = path.resolve('src/renderer/i18n/locales/fa.json');

  const en = loadLocale(enPath);
  const fa = loadLocale(faPath);

  assert.ok(en, 'en.json parsed');
  assert.ok(fa, 'fa.json parsed');
});
