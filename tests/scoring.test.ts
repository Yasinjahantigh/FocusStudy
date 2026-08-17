import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFocusScore, bucketSecond } from '../src/shared/scoring.ts';

test('computeFocusScore returns 100 for a fully productive session', () => {
  const score = computeFocusScore({
    productiveSeconds: 1500,
    distractingSeconds: 0,
    idleSeconds: 0,
    elapsedSeconds: 1500,
    targetSeconds: 1500,
  });
  assert.equal(score, 100);
});

test('computeFocusScore clamps heavy distraction leaving only progress reward', () => {
  const score = computeFocusScore({
    productiveSeconds: 0,
    distractingSeconds: 1500,
    idleSeconds: 0,
    elapsedSeconds: 1500,
    targetSeconds: 1500,
  });
  // productivity ratio clamps to 0; progress ratio = 1 -> 30
  assert.equal(score, 30);
});

test('computeFocusScore rewards progress halfway through target', () => {
  const score = computeFocusScore({
    productiveSeconds: 750,
    distractingSeconds: 0,
    idleSeconds: 0,
    elapsedSeconds: 750,
    targetSeconds: 1500,
  });
  // 1.0 * 70 + 0.5 * 30 = 85
  assert.equal(score, 85);
});

test('computeFocusScore ignores idle seconds', () => {
  const score = computeFocusScore({
    productiveSeconds: 900,
    distractingSeconds: 0,
    idleSeconds: 3600,
    elapsedSeconds: 4500,
    targetSeconds: 4500,
  });
  assert.equal(score, 100);
});

test('computeFocusScore blends distraction penalty with progress', () => {
  const score = computeFocusScore({
    productiveSeconds: 100,
    distractingSeconds: 40,
    idleSeconds: 0,
    elapsedSeconds: 1000,
    targetSeconds: 1000,
  });
  // (100 - 60) / 1000 = 0.04 -> 2.8 + 30 = 32.8 -> 33
  assert.equal(score, 33);
});

test('bucketSecond routes seconds to the matching category only', () => {
  assert.deepEqual(bucketSecond('productive', 42), { productive: 42, distracting: 0, idle: 0, neutral: 0 });
  assert.deepEqual(bucketSecond('distracting', 42), { productive: 0, distracting: 42, idle: 0, neutral: 0 });
  assert.deepEqual(bucketSecond('idle', 42), { productive: 0, distracting: 0, idle: 42, neutral: 0 });
  assert.deepEqual(bucketSecond('neutral', 42), { productive: 0, distracting: 0, idle: 0, neutral: 42 });
});