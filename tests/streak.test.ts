import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreaks } from '../src/shared/streak.ts';

const TODAY = '2026-08-13';

function completedSession(dateKey: string) {
  return { startTime: `${dateKey}T10:00:00`, status: 'completed' };
}

test('current streak counts consecutive days ending today', () => {
  const streaks = computeStreaks(
    [completedSession('2026-08-11'), completedSession('2026-08-12'), completedSession('2026-08-13')],
    TODAY
  );
  assert.equal(streaks.current, 3);
  assert.equal(streaks.best, 3);
  assert.equal(streaks.lastActiveDate, '2026-08-13');
});

test('streak with a gap: current and best only cover the run since the gap', () => {
  const streaks = computeStreaks(
    [completedSession('2026-08-10'), completedSession('2026-08-12'), completedSession('2026-08-13')],
    TODAY
  );
  assert.equal(streaks.current, 2);
  assert.equal(streaks.best, 2);
});

test('best streak is tracked across history even after the current run resets', () => {
  const streaks = computeStreaks(
    [
      completedSession('2026-08-08'),
      completedSession('2026-08-09'),
      completedSession('2026-08-10'),
      completedSession('2026-08-12'),
      completedSession('2026-08-13'),
    ],
    TODAY
  );
  assert.equal(streaks.current, 2);
  assert.equal(streaks.best, 3);
});

test('yesterday counts as the current streak while today has no session yet', () => {
  const streaks = computeStreaks([completedSession('2026-08-12')], TODAY);
  assert.equal(streaks.current, 1);
});

test('no streak when neither today nor yesterday has activity', () => {
  const streaks = computeStreaks([completedSession('2026-08-10')], TODAY);
  assert.equal(streaks.current, 0);
  assert.equal(streaks.best, 1);
});

test('non-completed sessions never contribute to streaks', () => {
  const streaks = computeStreaks(
    [
      { startTime: '2026-08-13T10:00:00', status: 'running' },
      { startTime: '2026-08-12T10:00:00', status: 'abandoned' },
    ],
    TODAY
  );
  assert.equal(streaks.current, 0);
  assert.equal(streaks.best, 0);
  assert.equal(streaks.lastActiveDate, null);
});

test('empty history yields a zero streak', () => {
  const streaks = computeStreaks([], TODAY);
  assert.equal(streaks.current, 0);
  assert.equal(streaks.best, 0);
  assert.equal(streaks.lastActiveDate, null);
});