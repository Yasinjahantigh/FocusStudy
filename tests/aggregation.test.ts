import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppCategory, AppLog, SessionMode, SessionStatus, StudySession } from '../src/shared/types.ts';
import { buildDailySummary, aggregateRange } from '../src/shared/aggregation.ts';

const categories: AppCategory[] = [
  { id: 'cat_productive', name: 'Productive', type: 'productive', color_hex: '#10B981' },
  { id: 'cat_distracting', name: 'Distracting', type: 'distracting', color_hex: '#EF4444' },
  { id: 'cat_neutral', name: 'Neutral', type: 'neutral', color_hex: '#64748B' },
  { id: 'cat_idle', name: 'Idle', type: 'idle', color_hex: '#94A3B8' },
];

function makeLog(appName: string, categoryId: string, dateKey: string, localHour: number, durationSeconds: number): AppLog {
  const dt = new Date(`${dateKey}T00:00:00Z`);
  dt.setUTCHours(localHour);
  return {
    startTime: dt.toISOString(),
    appName,
    categoryId,
    durationSeconds,
  };
}

function makeSession(
  dateKey: string,
  focusScore: number,
  status: SessionStatus = 'completed',
  subjectTag = 'Math'
): StudySession {
  return {
    id: `s-${dateKey}-${subjectTag}`,
    startTime: `${dateKey}T10:00:00.000Z`,
    endTime: `${dateKey}T11:00:00.000Z`,
    mode: 'pomodoro' as SessionMode,
    status,
    elapsedSeconds: 3600,
    productiveSeconds: 3300,
    distractingSeconds: 300,
    idleSeconds: 0,
    focusScore,
    subjectTag,
    durationMinutes: 60,
    targetDurationSeconds: 3600,
    actualDurationSeconds: 3600,
  };
}

test('buildDailySummary totals and aggregates logs into hours and apps', () => {
  const codeLog = makeLog('Code.exe', 'cat_productive', '2026-08-13', 10, 1200);
  const discordLog = makeLog('Discord.exe', 'cat_distracting', '2026-08-13', 11, 600);
  const sessions = [
    makeSession('2026-08-13', 90, 'completed', 'Math'),
    makeSession('2026-08-13', 0, 'running', 'Math'),
  ];

  const summary = buildDailySummary('2026-08-13', [codeLog, discordLog], sessions, categories);

  assert.equal(summary.totalStudySeconds, 1800);
  assert.equal(summary.productiveSeconds, 1200);
  assert.equal(summary.distractingSeconds, 600);
  assert.equal(summary.neutralSeconds, 0);
  assert.equal(summary.idleSeconds, 0);
  assert.equal(summary.completedSessionsCount, 1);
  assert.equal(summary.averageFocusScore, 90);
  assert.deepEqual(summary.appBreakdown.map(a => a.appName), ['Code.exe', 'Discord.exe']);

  const codeHour = new Date(codeLog.startTime).getHours();
  const discordHour = new Date(discordLog.startTime).getHours();
  assert.equal(summary.hourlyActivity[codeHour].productive, 1200);
  assert.equal(summary.hourlyActivity[discordHour].distracting, 600);
});

test('aggregateRange builds per-day summaries and range totals', () => {
  const logs = [
    makeLog('Code.exe', 'cat_productive', '2026-08-12', 9, 1000),
    makeLog('YouTube.exe', 'cat_distracting', '2026-08-13', 15, 500),
    makeLog('Notion.exe', 'cat_productive', '2026-08-13', 14, 2000),
  ];
  const sessions = [
    makeSession('2026-08-12', 80, 'completed', 'Programming'),
    makeSession('2026-08-13', 60, 'completed', 'Math'),
    makeSession('2026-08-13', 0, 'running', 'Math'),
  ];

  const result = aggregateRange('2026-08-12', '2026-08-14', logs, sessions, categories);

  assert.equal(result.summaries.length, 3);
  assert.deepEqual(result.summaries.map(s => s.date), ['2026-08-12', '2026-08-13', '2026-08-14']);
  assert.equal(result.summaries[2].totalStudySeconds, 0);

  assert.equal(result.totals.productiveSeconds, 3000);
  assert.equal(result.totals.distractingSeconds, 500);
  assert.equal(result.totals.totalStudySeconds, 3500);
  assert.equal(result.totals.completedSessionsCount, 2);
  assert.equal(result.totals.activeDaysCount, 2);

  assert.deepEqual(result.topApps.map(a => a.appName), ['Notion.exe', 'Code.exe', 'YouTube.exe']);
  assert.equal(result.topApps[0].durationSeconds, 2000);

  // Math appears twice (completed + running session), Programming once.
  assert.deepEqual(result.subjectDistribution, [
    { subject: 'Math', durationSeconds: 7200 },
    { subject: 'Programming', durationSeconds: 3600 },
  ]);

  assert.equal(result.overallFocusScore, 70);
});

test('aggregateRange with no data returns empty summaries with zeros', () => {
  const result = aggregateRange('2026-08-13', '2026-08-13', [], [], categories);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.totals.totalStudySeconds, 0);
  assert.equal(result.totals.activeDaysCount, 0);
  assert.deepEqual(result.topApps, []);
  assert.deepEqual(result.subjectDistribution, []);
  assert.equal(result.overallFocusScore, 0);
});