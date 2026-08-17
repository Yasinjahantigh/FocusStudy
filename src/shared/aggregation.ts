import type { AppCategory, AppLog, CategoryType, DailySummaryDTO, StudySession } from './types';

export interface HourlyBucket {
  hour: number;
  productive: number;
  distracting: number;
  neutral: number;
  idle: number;
}

function emptyHourlyBuckets(): HourlyBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    productive: 0,
    distracting: 0,
    neutral: 0,
    idle: 0,
  }));
}

function categoryOf(categories: AppCategory[], categoryId: string): { type: CategoryType; color_hex: string } {
  const cat = categories.find(c => c.id === categoryId);
  return { type: cat?.type || 'neutral', color_hex: cat?.color_hex || '#64748B' };
}

/**
 * Builds a single-day summary from app logs and sessions for the given date.
 * Logs are assumed to be already filtered to the target date by the caller.
 */
export function buildDailySummary(
  date: string,
  logs: AppLog[],
  sessions: StudySession[],
  categories: AppCategory[]
): DailySummaryDTO {
  const appMap = new Map<string, { appName: string; durationSeconds: number; type: CategoryType; color: string }>();
  const hourly = emptyHourlyBuckets();

  let productive = 0;
  let distracting = 0;
  let neutral = 0;
  let idle = 0;

  for (const log of logs) {
    const cat = categoryOf(categories, log.categoryId);
    const existing = appMap.get(log.appName) || {
      appName: log.appName,
      durationSeconds: 0,
      type: cat.type,
      color: cat.color_hex,
    };
    existing.durationSeconds += log.durationSeconds;
    appMap.set(log.appName, existing);

    const hour = new Date(log.startTime).getHours();
    const bucket = hourly[hour] || hourly[0];
    const seconds = Math.max(0, log.durationSeconds);

    if (cat.type === 'productive') {
      productive += seconds;
      bucket.productive += seconds;
    } else if (cat.type === 'distracting') {
      distracting += seconds;
      bucket.distracting += seconds;
    } else if (cat.type === 'idle') {
      idle += seconds;
      bucket.idle += seconds;
    } else {
      neutral += seconds;
      bucket.neutral += seconds;
    }
  }

  const daySessions = sessions.filter(s => s.startTime.slice(0, 10) === date);
  const scoredSessions = daySessions.filter(s => s.status === 'completed' && typeof s.focusScore === 'number');
  const averageFocusScore = scoredSessions.length > 0
    ? Math.round(scoredSessions.reduce((acc, s) => acc + s.focusScore, 0) / scoredSessions.length)
    : 0;

  return {
    date,
    totalStudySeconds: productive + distracting + neutral,
    productiveSeconds: productive,
    distractingSeconds: distracting,
    neutralSeconds: neutral,
    idleSeconds: idle,
    completedSessionsCount: daySessions.filter(s => s.status === 'completed').length,
    averageFocusScore,
    appBreakdown: Array.from(appMap.values())
      .sort((a, b) => b.durationSeconds - a.durationSeconds)
      .slice(0, 8),
    hourlyActivity: hourly,
  };
}

export interface RangeAnalyticsTotals {
  totalStudySeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  neutralSeconds: number;
  idleSeconds: number;
  completedSessionsCount: number;
  activeDaysCount: number;
}

/**
 * Aggregates logs across a date range (inclusive) into per-day summaries plus
 * range-wide totals, top apps and subject distribution.
 */
export function aggregateRange(
  startDate: string,
  endDate: string,
  logs: AppLog[],
  sessions: StudySession[],
  categories: AppCategory[]
): {
  summaries: DailySummaryDTO[];
  totals: RangeAnalyticsTotals;
  topApps: { appName: string; durationSeconds: number; type: string }[];
  subjectDistribution: { subject: string; durationSeconds: number }[];
  overallFocusScore: number;
} {
  const summaries: DailySummaryDTO[] = [];
  const totals: RangeAnalyticsTotals = {
    totalStudySeconds: 0,
    productiveSeconds: 0,
    distractingSeconds: 0,
    neutralSeconds: 0,
    idleSeconds: 0,
    completedSessionsCount: 0,
    activeDaysCount: 0,
  };

  const logsByDay = new Map<string, AppLog[]>();
  for (const log of logs) {
    const day = log.startTime.slice(0, 10);
    const list = logsByDay.get(day) || [];
    list.push(log);
    logsByDay.set(day, list);
  }

  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    const dayLogs = logsByDay.get(day) || [];
    const summary = buildDailySummary(day, dayLogs, sessions, categories);
    summaries.push(summary);

    totals.productiveSeconds += summary.productiveSeconds;
    totals.distractingSeconds += summary.distractingSeconds;
    totals.neutralSeconds += summary.neutralSeconds;
    totals.idleSeconds += summary.idleSeconds;
    totals.totalStudySeconds += summary.totalStudySeconds;
    totals.completedSessionsCount += summary.completedSessionsCount;
    if (summary.totalStudySeconds > 0) totals.activeDaysCount++;

    cursor.setDate(cursor.getDate() + 1);
  }

  const appMap = new Map<string, { appName: string; durationSeconds: number; type: string }>();
  for (const log of logs) {
    const cat = categoryOf(categories, log.categoryId);
    const existing = appMap.get(log.appName) || { appName: log.appName, durationSeconds: 0, type: cat.type };
    existing.durationSeconds += log.durationSeconds;
    appMap.set(log.appName, existing);
  }
  const topApps = Array.from(appMap.values())
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .slice(0, 8);

  const subjectMap = new Map<string, number>();
  for (const session of sessions) {
    const tag = session.subjectTag || 'General';
    const prev = subjectMap.get(tag) || 0;
    subjectMap.set(tag, prev + (session.actualDurationSeconds || session.targetDurationSeconds || 0));
  }
  const subjectDistribution = Array.from(subjectMap.entries())
    .map(([subject, durationSeconds]) => ({ subject, durationSeconds }))
    .sort((a, b) => b.durationSeconds - a.durationSeconds);

  const completed = sessions.filter(s => s.status === 'completed' && typeof s.focusScore === 'number');
  const overallFocusScore = completed.length > 0
    ? Math.round(completed.reduce((acc, s) => acc + s.focusScore, 0) / completed.length)
    : 0;

  return { summaries, totals, topApps, subjectDistribution, overallFocusScore };
}