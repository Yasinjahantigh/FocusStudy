import { ActiveAppInfo, StudySession, TimerStateDTO, ScratchpadNote, DailySummaryDTO, AnalyticsRangeDTO, CategorizationRule, AppCategory, Language, TrackInfo, WeeklyStudyBlock, EnvironmentAuditItem, AIJustificationRequest, AIJustificationResult, AudioSettings, StreakInfo, DistractionAlertDTO, SessionCompletedPayload, AISettings, AppLog, ReviewDecision, ReviewScope, EvidenceSource } from '../shared/types';

export type { SessionCompletedPayload, DistractionAlertDTO } from '../shared/types';

export interface InterventionPayload {
  kind: 'lock' | 'review';
  appName: string;
  title: string;
  domain?: string;
  fingerprint?: string;
  subject: string;
  blockTitle: string;
  reason?: string;
  confidence?: number;
  source?: string;
  sources?: EvidenceSource[];
  version: 1;
}

export interface BridgeStatus {
  extensionId: string;
  hostRegistered: boolean;
  bridgeExe: { path: string; exists: boolean };
  relayScript: { path: string; exists: boolean };
  stateFile: string;
  lastSeenAt: number | null;
  lastSource: string | null;
  activeTab: { title: string; hostname: string } | null;
  hasErrors: boolean;
}

export interface TrackerDebugSnapshot {
  entries: {
    ts: number;
    pid?: number;
    appName: string;
    title: string;
    domain?: string;
    category?: string;
    confidence?: number;
    source?: string;
    needsReview: boolean;
    isChange: boolean;
    event?: string;
  }[];
  filePath: string;
}

export interface FocusStudyAPI {
  // Weekly Planner & AI Evaluator APIs
  getWeeklyBlocks: () => Promise<WeeklyStudyBlock[]>;
  saveWeeklyBlock: (block: WeeklyStudyBlock) => Promise<WeeklyStudyBlock>;
  deleteWeeklyBlock: (id: string) => Promise<void>;
  toggleTaskCompleted: (blockId: string, taskId: string) => Promise<void>;
  resetDayTasks: (blockId: string) => Promise<boolean>;
  getActiveBlockId: () => Promise<string | null>;
  setActiveBlockId: (id: string | null) => Promise<void>;
  onPlannerUpdated: (callback: () => void) => () => void;

  auditEnvironment: (subject: string, allowedApps: string[]) => Promise<EnvironmentAuditItem[]>;
  reviewApp: (app: { appName: string; title: string; execPath?: string; domain?: string }, subject?: string) => Promise<EnvironmentAuditItem | null>;
  rememberReview: (app: { appName: string; domain?: string }, decision: ReviewDecision, scope?: ReviewScope) => Promise<boolean>;
  closeProcess: (appName: string) => Promise<boolean>;
  requestAIException: (request: AIJustificationRequest) => Promise<AIJustificationResult>;
  testAIConnection: (settings?: AISettings) => Promise<{ ok: boolean; message: string }>;
  testAISearch: (settings?: AISettings) => Promise<{ ok: boolean; searched: boolean; mode: 'google-sdk' | 'openai'; message: string }>;
  getAISettings: () => Promise<AISettings>;
  setAISettings: (settings: AISettings) => Promise<void>;

  // Settings & Language APIs
  getLanguage: () => Promise<Language>;
  setLanguage: (lang: Language) => Promise<void>;
  onLanguageChanged: (callback: (lang: Language) => void) => () => void;

  // Audio Settings APIs
  getAudioSettings: () => Promise<AudioSettings>;
  setAudioSettings: (settings: Partial<AudioSettings>) => Promise<void>;
  setMasterMuted: (muted: boolean) => Promise<void>;
  onAudioSettingsChanged: (callback: (settings: AudioSettings) => void) => () => void;
  onMasterMuted: (callback: (muted: boolean) => void) => () => void;

  // Background Music Player APIs
  selectMusicFolder: () => Promise<string>;
  getMusicFolder: () => Promise<string>;
  getMusicTracks: () => Promise<TrackInfo[]>;

  // Timer APIs
  getTimerState: () => Promise<TimerStateDTO>;
  startTimer: (mode: 'pomodoro' | 'custom' | 'stopwatch', durationMinutes: number, title?: string, subject?: string) => Promise<void>;
  pauseTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  onTimerTick: (callback: (state: TimerStateDTO) => void) => () => void;
  onSessionCompleted: (callback: (payload: SessionCompletedPayload) => void) => () => void;

  // Active App & Monitoring APIs
  getCurrentActiveApp: () => Promise<ActiveAppInfo | null>;
  onActiveAppChanged: (callback: (app: ActiveAppInfo) => void) => () => void;
  onDistractionAlert: (callback: (alert: DistractionAlertDTO) => void) => () => void;

  // Scratchpad APIs
  saveNote: (content: string, tags?: string[]) => Promise<ScratchpadNote>;
  updateNote: (id: string, content: string, tags: string[]) => Promise<void>;
  getNotes: (sessionId?: string) => Promise<ScratchpadNote[]>;
  toggleNoteProcessed: (noteId: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;

  // Analytics & Sessions APIs
  getDailySummary: (date: string) => Promise<DailySummaryDTO>;
  getAnalyticsRange: (startDate: string, endDate: string) => Promise<AnalyticsRangeDTO>;
  getStreak: () => Promise<StreakInfo>;
  getRecentSessions: (limit?: number) => Promise<StudySession[]>;
  exportData: () => Promise<{
    settings: { language: string; musicFolderPath?: string; audio: AudioSettings };
    weeklyBlocks: WeeklyStudyBlock[];
    sessions: StudySession[];
    categories: AppCategory[];
    rules: CategorizationRule[];
    logs: AppLog[];
    notes: ScratchpadNote[];
  }>;
  exportCsv: () => Promise<{ success: boolean; path?: string; error?: string }>;

  // Rules & Settings APIs
  getCategories: () => Promise<AppCategory[]>;
  getRules: () => Promise<CategorizationRule[]>;
  addRule: (rule: Omit<CategorizationRule, 'id'>) => Promise<CategorizationRule>;
  deleteRule: (ruleId: string) => Promise<void>;

  // Mini-Widget Controls
  setWidgetAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
  toggleWidgetExpand: () => Promise<boolean>;
  minimizeWidget: () => Promise<boolean>;

  // Intervention (main-process lock/review window) APIs
  testInterventionLock: () => Promise<void>;
  getInterventionStatus: () => Promise<{ active: boolean; kind: 'lock' | 'review' | null; appName: string | null }>;
  grantTemporaryAccess: (appName: string, minutes: number, domain?: string) => Promise<boolean>;
  dismissIntervention: () => Promise<void>;
  rememberReviewDecision: (decision: ReviewDecision, scope: ReviewScope) => Promise<void>;
  justifyIntervention: (reason: string) => Promise<AIJustificationResult>;
  closeInterventionApp: (appName: string) => Promise<boolean>;
  onInterventionShow: (callback: (payload: InterventionPayload) => void) => () => void;

  // Browser extension bridge APIs
  getBridgeStatus: () => Promise<BridgeStatus>;
  setExtensionId: (id: string) => Promise<BridgeStatus>;
  updateBridgeManifests: () => Promise<{ ok: boolean; errors: string[] }>;
  getBridgeExtensionFolder: () => Promise<string>;
  getTrackerDebug: () => Promise<TrackerDebugSnapshot>;
}

declare global {
  interface Window {
    focusStudyAPI: FocusStudyAPI;
  }
}
