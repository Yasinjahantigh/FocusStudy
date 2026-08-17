let uniqueCounter = 0;

/**
 * Generates a collision-resistant unique ID with a prefix.
 * Combines timestamp + counter + random suffix for extremely low collision
 * probability under rapid calls (e.g., session/rule/note creation).
 */
export function uniqueId(prefix = 'id'): string {
  uniqueCounter++;
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now()}_${uniqueCounter}_${randomSuffix}`;
}