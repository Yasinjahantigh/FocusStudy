/**
 * Local date key helper — returns YYYY-MM-DD in the user's LOCAL timezone.
 * This replaces UTC-based `toISOString().slice(0, 10)` which breaks streaks
 * for timezones like UTC+3:30 (Iran) where a session at 1am local falls on
 * the previous UTC day.
 */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convenience for "today" in local TZ.
 */
export function todayKey(): string {
  return localDateKey(new Date());
}

/**
 * Returns a local date key `daysAgo` days before today.
 */
export function daysAgoKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return localDateKey(d);
}

/**
 * Parse a local date key (YYYY-MM-DD) back to a Date at noon local time.
 * Using noon avoids DST edge cases at midnight.
 */
export function parseLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}