import type { StreakInfo } from './types';
import { localDateKey, parseLocalDateKey, todayKey as todayKeyFn } from './date.ts';

export type { StreakInfo };

/**
 * Computes current and all-time best streak of consecutive days with at least
 * one completed study session. Today counts when today's date has activity;
 * otherwise a streak that ended yesterday is still shown (grace day).
 */
export function computeStreaks(
  sessions: { startTime: string; status: string }[],
  todayKey?: string
): StreakInfo {
  const activeDays = new Set<string>();
  for (const session of sessions) {
    if (session.status === 'completed') {
      // Parse the ISO startTime and extract local date key
      const date = new Date(session.startTime);
      const key = localDateKey(date);
      if (key) activeDays.add(key);
    }
  }

  const today = todayKey || todayKeyFn();

  const hasDay = (offsetDays: number): boolean => {
    const d = parseLocalDateKey(today);
    d.setDate(d.getDate() + offsetDays);
    return activeDays.has(localDateKey(d));
  };

  // Current streak: today, or yesterday if today has no session yet.
  let current = 0;
  let cursor = hasDay(0) ? 0 : hasDay(-1) ? -1 : null;
  if (cursor !== null) {
    while (hasDay(cursor)) {
      current++;
      cursor--;
    }
  }

  // Best streak over the whole history.
  const sorted = [...activeDays].sort();
  let best = 0;
  let run = 0;
  let prevKey: string | null = null;
  for (const key of sorted) {
    if (prevKey) {
      const prev = new Date(`${prevKey}T12:00:00`);
      const curr = new Date(`${key}T12:00:00`);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    prevKey = key;
    if (run > best) best = run;
  }

  return {
    current,
    best,
    lastActiveDate: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}