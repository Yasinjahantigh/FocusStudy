import { contextBridge, ipcRenderer } from 'electron';
import { Language, AISettings } from '../shared/types';

contextBridge.exposeInMainWorld('focusStudyAPI', {
  // Weekly Planner & AI Evaluator APIs
  getWeeklyBlocks: () => ipcRenderer.invoke('planner:getBlocks'),
  saveWeeklyBlock: (block: any) => ipcRenderer.invoke('planner:saveBlock', block),
  deleteWeeklyBlock: (id: string) => ipcRenderer.invoke('planner:deleteBlock', id),
  toggleTaskCompleted: (blockId: string, taskId: string) => ipcRenderer.invoke('planner:toggleTask', blockId, taskId),
  resetDayTasks: (blockId: string) => ipcRenderer.invoke('planner:resetDayTasks', blockId),
  getActiveBlockId: () => ipcRenderer.invoke('planner:getActiveBlockId'),
  setActiveBlockId: (id: string | null) => ipcRenderer.invoke('planner:setActiveBlockId', id),
  onPlannerUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('planner:updated', handler);
    return () => ipcRenderer.removeListener('planner:updated', handler);
  },

  auditEnvironment: (subject: string, allowedApps: string[]) => ipcRenderer.invoke('ai:auditEnvironment', subject, allowedApps),
  reviewApp: (app: any, subject?: string) => ipcRenderer.invoke('ai:reviewApp', app, subject),
  rememberReview: (app: any, decision: string, scope?: string) => ipcRenderer.invoke('ai:rememberReview', app, decision, scope),
  closeProcess: (appName: string) => ipcRenderer.invoke('ai:closeProcess', appName),
  requestAIException: (request: any) => ipcRenderer.invoke('ai:requestException', request),
  testAIConnection: (settings?: AISettings) => ipcRenderer.invoke('ai:testConnection', settings),
  testAISearch: (settings?: AISettings) => ipcRenderer.invoke('ai:testSearch', settings),
  getAISettings: () => ipcRenderer.invoke('ai:getSettings'),
  setAISettings: (settings: any) => ipcRenderer.invoke('ai:setSettings', settings),

  // Settings & Language APIs
  getLanguage: () => ipcRenderer.invoke('settings:getLanguage'),
  setLanguage: (lang: Language) => ipcRenderer.invoke('settings:setLanguage', lang),
  onLanguageChanged: (callback: (lang: Language) => void) => {
    const handler = (_: any, lang: Language) => callback(lang);
    ipcRenderer.on('language:changed', handler);
    return () => ipcRenderer.removeListener('language:changed', handler);
  },

  // Audio Settings APIs
  getAudioSettings: () => ipcRenderer.invoke('audio:getSettings'),
  setAudioSettings: (settings: any) => ipcRenderer.invoke('audio:setSettings', settings),
  setMasterMuted: (muted: boolean) => ipcRenderer.invoke('audio:setMasterMuted', muted),
  onAudioSettingsChanged: (callback: (settings: any) => void) => {
    const handler = (_: any, settings: any) => callback(settings);
    ipcRenderer.on('audio:settingsChanged', handler);
    return () => ipcRenderer.removeListener('audio:settingsChanged', handler);
  },
  onMasterMuted: (callback: (muted: boolean) => void) => {
    const handler = (_: any, muted: boolean) => callback(muted);
    ipcRenderer.on('audio:masterMuted', handler);
    return () => ipcRenderer.removeListener('audio:masterMuted', handler);
  },

  // Background Music Player APIs
  selectMusicFolder: () => ipcRenderer.invoke('music:selectFolder'),
  getMusicFolder: () => ipcRenderer.invoke('music:getFolder'),
  getMusicTracks: () => ipcRenderer.invoke('music:getTracks'),

  // Timer APIs
  getTimerState: () => ipcRenderer.invoke('timer:getState'),
  startTimer: (mode: string, durationMinutes: number, title?: string, subject?: string) =>
    ipcRenderer.invoke('timer:start', mode, durationMinutes, title, subject),
  pauseTimer: () => ipcRenderer.invoke('timer:pause'),
  resetTimer: () => ipcRenderer.invoke('timer:reset'),
  onTimerTick: (callback: (state: any) => void) => {
    const handler = (_: any, state: any) => callback(state);
    ipcRenderer.on('timer:tick', handler);
    return () => ipcRenderer.removeListener('timer:tick', handler);
  },
  onSessionCompleted: (callback: (payload: any) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('session:completed', handler);
    return () => ipcRenderer.removeListener('session:completed', handler);
  },

  // Active App & Monitoring APIs
  getCurrentActiveApp: () => ipcRenderer.invoke('app:getCurrent'),
  onActiveAppChanged: (callback: (app: any) => void) => {
    const handler = (_: any, appInfo: any) => callback(appInfo);
    ipcRenderer.on('app:changed', handler);
    return () => ipcRenderer.removeListener('app:changed', handler);
  },
  onDistractionAlert: (callback: (alert: any) => void) => {
    const handler = (_: any, alert: any) => callback(alert);
    ipcRenderer.on('app:distractionAlert', handler);
    return () => ipcRenderer.removeListener('app:distractionAlert', handler);
  },

  // Scratchpad APIs
  saveNote: (content: string, tags?: string[]) => ipcRenderer.invoke('scratchpad:save', content, tags),
  updateNote: (id: string, content: string, tags: string[]) => ipcRenderer.invoke('scratchpad:update', id, content, tags),
  getNotes: (sessionId?: string) => ipcRenderer.invoke('scratchpad:getNotes', sessionId),
  toggleNoteProcessed: (noteId: string) => ipcRenderer.invoke('scratchpad:toggleProcessed', noteId),
  deleteNote: (noteId: string) => ipcRenderer.invoke('scratchpad:delete', noteId),

  // Analytics APIs
  getDailySummary: (date: string) => ipcRenderer.invoke('analytics:getDailySummary', date),
  getAnalyticsRange: (startDate: string, endDate: string) => ipcRenderer.invoke('analytics:getRange', startDate, endDate),
  getStreak: () => ipcRenderer.invoke('analytics:getStreak'),
  getRecentSessions: (limit?: number) => ipcRenderer.invoke('sessions:getRecent', limit),
  exportData: () => ipcRenderer.invoke('data:export'),
  exportCsv: () => ipcRenderer.invoke('data:exportCsv'),

  // Rules APIs
  getCategories: () => ipcRenderer.invoke('rules:getCategories'),
  getRules: () => ipcRenderer.invoke('rules:getRules'),
  addRule: (rule: any) => ipcRenderer.invoke('rules:addRule', rule),
  deleteRule: (ruleId: string) => ipcRenderer.invoke('rules:deleteRule', ruleId),

  // Mini-Widget APIs
  setWidgetAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.invoke('widget:setAlwaysOnTop', alwaysOnTop),
  toggleWidgetExpand: () => ipcRenderer.invoke('widget:toggleExpand'),
  minimizeWidget: () => ipcRenderer.invoke('widget:minimize'),

  // Intervention (main-process lock/review window) APIs
  testInterventionLock: () => ipcRenderer.invoke('intervention:testLock'),
  getInterventionStatus: () => ipcRenderer.invoke('intervention:getStatus'),
  grantTemporaryAccess: (appName: string, minutes: number, domain?: string) =>
    ipcRenderer.invoke('intervention:grantTemporary', appName, minutes, domain),
  dismissIntervention: () => ipcRenderer.invoke('intervention:dismiss'),
  rememberReviewDecision: (decision: string, scope: string) =>
    ipcRenderer.invoke('intervention:rememberReview', decision, scope),
  justifyIntervention: (reason: string) => ipcRenderer.invoke('intervention:justify', reason),
  closeInterventionApp: (appName: string) => ipcRenderer.invoke('intervention:closeApp', appName),
  onInterventionShow: (callback: (payload: any) => void) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('intervention:show', handler);
    return () => ipcRenderer.removeListener('intervention:show', handler);
  },

  // Browser extension bridge APIs
  getBridgeStatus: () => ipcRenderer.invoke('bridge:getStatus'),
  setExtensionId: (id: string) => ipcRenderer.invoke('bridge:setExtensionId', id),
  updateBridgeManifests: () => ipcRenderer.invoke('bridge:updateManifests'),
  getBridgeExtensionFolder: () => ipcRenderer.invoke('bridge:getExtensionFolder'),
  getTrackerDebug: () => ipcRenderer.invoke('tracker:getDebug'),
});
