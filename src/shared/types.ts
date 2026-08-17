export type SessionMode = 'pomodoro' | 'custom' | 'stopwatch';
export type SessionStatus = 'running' | 'paused' | 'completed' | 'abandoned';
export type CategoryType = 'productive' | 'distracting' | 'neutral' | 'idle';
export type Language = 'en' | 'fa';
export type DayOfWeek = 'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * When enabled, the AI requests declare a `search_web` tool. If the served
   * model (e.g. local Gemma via LM Studio / Ollama) issues a tool call, the
   * app executes the search (DuckDuckGo, no API key) and feeds results back.
   * Google-hosted OpenAI-compatible endpoints receive `google_search` too.
   */
  searchEnabled?: boolean;
}

export interface AudioSettings {
  musicVolume: number;
  noiseVolume: number;
  noiseEnabled: boolean;
  masterMuted: boolean;
}

export interface AppSettings {
  language: Language;
  musicFolderPath?: string;
  ai?: AISettings;
}

export interface StudyBlockTask {
  id: string;
  text: string;
  completed: boolean;
}

export interface WeeklyStudyBlock {
  id: string;
  dayOfWeek: DayOfWeek;
  subject: string;
  title: string;
  durationMinutes: number;
  startTime?: string;
  tasks: StudyBlockTask[];
  allowedApps: string[];
}

export type AppVerdict = 'productive' | 'neutral' | 'distracting' | 'needs_review';

export type DecisionSource =
  | 'user_rule'
  | 'allowed_app'
  | 'system'
  | 'built_in'
  | 'google_grounding'
  | 'web_search'
  | 'fallback';

export interface EvidenceSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface EnvironmentAuditItem {
  appName: string;
  title: string;
  execPath?: string;
  domain?: string;
  /** When multiple browser tabs share the same domain, they collapse into one
   * row; tabCount reports how many windows/tabs were grouped. */
  tabCount?: number;
  /** Three-state verdict instead of a binary flag:
   *  - productive: useful/safe for studying (approved, no action)
   *  - neutral:    not harmful but not needed either (e.g. a VPN) — user may close
   *  - distracting: must be closed or justified before the block starts.
   */
  verdict: AppVerdict;
  reason: string;
  confidence?: number;
  source?: DecisionSource;
  fingerprint?: string;
  sources?: EvidenceSource[];
}

export interface AppReviewRequest {
  appName: string;
  title: string;
  execPath?: string;
  domain?: string;
  subject?: string;
  blockTitle?: string;
  fingerprint?: string;
}

export type ReviewDecision = 'productive' | 'neutral' | 'distracting';
export type ReviewScope = 'session' | 'block' | 'permanent';

export interface AIJustificationRequest {
  appName: string;
  title: string;
  subject: string;
  blockTitle: string;
  reason: string;
}

export interface AIJustificationResult {
  approved: boolean;
  aiResponse: string;
  grantedDurationMinutes?: number;
}

export interface TrackInfo {
  id: string;
  name: string;
  filePath: string;
  mediaUrl: string;
  duration?: number;
}

export interface AppCategory {
  id: string;
  name: string;
  type: CategoryType;
  color_hex: string;
}

export interface CategorizationRule {
  id: string;
  pattern_type: 'executable' | 'title_regex' | 'domain';
  pattern_value: string;
  category_id: string;
  priority: number;
}

export interface ActiveAppInfo {
  execPath: string;
  appName: string;
  title: string;
  domain?: string;
  category: AppCategory;
  isIdle: boolean;
  idleTimeSeconds: number;
  timestamp: number;
  /** True when the local rules cannot identify this app with enough confidence. */
  needsReview?: boolean;
  reviewFingerprint?: string;
}

export interface StudySession {
  id: string;
  title: string;
  subjectTag: string;
  mode: SessionMode;
  targetDurationSeconds: number;
  actualDurationSeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  idleSeconds: number;
  status: SessionStatus;
  focusScore: number;
  startTime: string;
  endTime?: string;
}

export interface AppLog {
  id?: number;
  sessionId?: string;
  appName: string;
  executablePath: string;
  windowTitle: string;
  domain?: string;
  categoryId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

export interface ScratchpadNote {
  id: string;
  sessionId?: string;
  content: string;
  tags: string[];
  isProcessed: boolean;
  createdAt: string;
}

export interface TimerStateDTO {
  mode: SessionMode;
  status: SessionStatus;
  remainingSeconds: number;
  elapsedSeconds: number;
  targetDurationSeconds: number;
  sessionTitle: string;
  subjectTag: string;
  activeSessionId?: string;
}

export interface SessionCompletedPayload {
  sessionId: string;
  status: SessionStatus;
  elapsedSeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  idleSeconds: number;
  focusScore: number;
  subjectTag: string;
  durationMinutes: number;
}

export interface StreakInfo {
  current: number;
  best: number;
  lastActiveDate: string | null;
}

export interface DistractionAlertDTO {
  appName: string;
  title: string;
  distractionSeconds: number;
  message: string;
}

export interface DailySummaryDTO {
  date: string;
  totalStudySeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  neutralSeconds: number;
  idleSeconds: number;
  completedSessionsCount: number;
  averageFocusScore: number;
  appBreakdown: { appName: string; durationSeconds: number; type: CategoryType; color: string }[];
  hourlyActivity: { hour: number; productive: number; distracting: number; neutral: number; idle: number }[];
}

export interface AnalyticsRangeDTO {
  startDate: string;
  endDate: string;
  summaries: DailySummaryDTO[];
  topApps: { appName: string; durationSeconds: number; type: CategoryType }[];
  subjectDistribution: { subject: string; durationSeconds: number }[];
  overallFocusScore: number;
  totalStudySeconds: number;
  productiveSeconds: number;
  distractingSeconds: number;
  neutralSeconds: number;
  idleSeconds: number;
  completedSessionsCount: number;
  activeDaysCount: number;
}
