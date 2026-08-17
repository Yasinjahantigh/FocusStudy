export interface FocusScoreInput {
  productiveSeconds: number;
  distractingSeconds: number;
  idleSeconds: number;
  elapsedSeconds: number;
  targetSeconds: number;
}

/**
 * Pure focus score computation. Scores are clamped to [0, 100].
 * Penalizes distraction 1.5x, ignores idle time, and rewards session progress.
 */
export function computeFocusScore(input: FocusScoreInput): number {
  const { productiveSeconds, distractingSeconds, idleSeconds, elapsedSeconds, targetSeconds } = input;

  const activeSeconds = Math.max(1, elapsedSeconds - idleSeconds);
  const productivityRatio = Math.max(0, (productiveSeconds - 1.5 * distractingSeconds) / activeSeconds);
  // Stopwatch (targetSeconds <= 0) gets full progress credit so users can reach 100.
  const progressRatio = targetSeconds > 0 ? Math.min(1, elapsedSeconds / targetSeconds) : 1;

  const score = productivityRatio * 70 + progressRatio * 30;
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Splits a run of elapsed seconds into the three tracked buckets based on the
 * current category. Neutral seconds simply belong to no bucket.
 */
export function bucketSecond(categoryType: 'productive' | 'distracting' | 'neutral' | 'idle', seconds: number) {
  return {
    productive: categoryType === 'productive' ? seconds : 0,
    distracting: categoryType === 'distracting' ? seconds : 0,
    idle: categoryType === 'idle' ? seconds : 0,
    neutral: categoryType === 'neutral' ? seconds : 0,
  };
}