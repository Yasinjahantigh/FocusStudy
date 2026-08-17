import { ipcMain, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { TimerEngine } from '../services/TimerEngine';
import { AppTracker } from '../services/AppTracker';
import { RulesEngine } from '../services/RulesEngine';
import { AIEvaluator, testConnection, testAISearch } from '../services/AIEvaluator';
import { storeSingleton } from '../db/jsonStore';
import { extractDomainFromTitle, getAllWindowsNative } from '../native/win32Api';
import { isBrowserExecutable } from '../../shared/classification';
import { Language, TrackInfo, WeeklyStudyBlock, AIJustificationRequest, AudioSettings, AISettings, SessionMode, ReviewDecision, ReviewScope } from '../../shared/types';
import { buildDailySummary, aggregateRange } from '../../shared/aggregation';
import { computeStreaks } from '../../shared/streak';
import { todayKey, localDateKey, daysAgoKey } from '../../shared/date';
import { InterventionController } from '../services/InterventionController';
import { nativeHostStatus, registerNativeHosts, extensionFolderPath } from '../services/nativeHost';
import { trackerDebug } from '../services/TrackerDebug';

function toDateKey(isoOrDate: string): string {
  return localDateKey(new Date(isoOrDate));
}

/**
 * Collapses multiple browser windows/tabs that share the same domain into one
 * row (with a tabCount), so a browser with many open tabs doesn't produce a
 * wall of near-identical msedge.exe / chrome.exe entries in the audit. Native
 * (non-browser) apps are kept one-per-exe regardless of title.
 */
function dedupeBrowserTabs(
  apps: { appName: string; title: string; execPath?: string; domain?: string }[]
): { appName: string; title: string; execPath?: string; domain?: string }[] {
  const out: { appName: string; title: string; execPath?: string; domain?: string }[] = [];
  // Dedupe key for browsers: appName + domain. Non-browsers: appName + title.
  const seen = new Set<string>();
  for (const app of apps) {
    const browser = isBrowserExecutable(app.appName);
    let key: string;
    if (browser) {
      key = `${app.appName.toLowerCase()}|${(app.domain || app.title || '').toLowerCase()}`;
    } else {
      key = `${app.appName.toLowerCase()}|${app.title.toLowerCase()}`;
      // Also collapse exact dupes of non-browser windows (same exe + title).
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(app);
  }
  return out;
}

export function setupIpcHandlers(
  timerEngine: TimerEngine,
  appTracker: AppTracker,
  rulesEngine: RulesEngine,
  getMainWindow: () => BrowserWindow | null,
  getWidgetWindow: () => BrowserWindow | null,
  intervention: InterventionController
) {
  // Resolve the live windows on every call rather than capturing them once.
  // Windows can be recreated on 'activate'; a captured reference would go stale
  // and stop delivering timer ticks / app-changed / planner events to the new
  // window. The getters always return the current window (or null).
  const broadcast = (channel: string, ...args: unknown[]) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(channel, ...args);
    const widget = getWidgetWindow();
    if (widget && !widget.isDestroyed()) widget.webContents.send(channel, ...args);
  };

  // ---------- Weekly Planner ----------

  ipcMain.handle('planner:getBlocks', () => {
    return storeSingleton.getWeeklyBlocks();
  });

  ipcMain.handle('planner:saveBlock', (_, block: WeeklyStudyBlock) => {
    // Minimal shape validation
    if (!block || typeof block !== 'object') return null;
    if (!block.id || typeof block.id !== 'string') return null;
    if (!block.dayOfWeek || typeof block.dayOfWeek !== 'string') return null;
    if (typeof block.durationMinutes !== 'number' || block.durationMinutes < 1 || block.durationMinutes > 300) return null;
    if (typeof block.title !== 'string') return null;
    if (!Array.isArray(block.tasks)) return null;
    if (!Array.isArray(block.allowedApps)) return null;

    const saved = storeSingleton.saveWeeklyBlock(block);
    broadcast('planner:updated');
    return saved;
  });

  ipcMain.handle('planner:deleteBlock', (_, id: string) => {
    storeSingleton.deleteWeeklyBlock(id);
    broadcast('planner:updated');
  });

  ipcMain.handle('planner:toggleTask', (_, blockId: string, taskId: string) => {
    storeSingleton.toggleTaskCompleted(blockId, taskId);
    broadcast('planner:updated');
  });

  ipcMain.handle('planner:resetDayTasks', (_, blockId: string) => {
    const result = storeSingleton.resetDayTasks(blockId);
    broadcast('planner:updated');
    return result;
  });

  ipcMain.handle('planner:getActiveBlockId', () => {
    return storeSingleton.getActiveBlockId();
  });

  ipcMain.handle('planner:setActiveBlockId', (_, id: string | null) => {
    storeSingleton.setActiveBlockId(id || null);
    broadcast('planner:updated');
  });

  // ---------- AI Environment Audit & Exception Evaluator ----------

  ipcMain.handle('ai:getSettings', () => {
    return storeSingleton.getAISettings();
  });

  ipcMain.handle('ai:setSettings', (_, aiSettings: { baseUrl: string; apiKey: string; model: string }) => {
    // Validate baseUrl is a valid URL
    try {
      new URL(aiSettings.baseUrl);
    } catch {
      console.warn('[IPC] ai:setSettings rejected — invalid baseUrl');
      return;
    }
    if (typeof aiSettings.apiKey !== 'string') return;
    if (typeof aiSettings.model !== 'string' || !aiSettings.model.trim()) return;
    storeSingleton.setAISettings(aiSettings);
  });

  ipcMain.handle('ai:testConnection', async (_, settings?: AISettings) => {
    return testConnection(settings && settings.apiKey ? settings : storeSingleton.getAISettings());
  });

  ipcMain.handle('ai:testSearch', async (_, settings?: AISettings) => {
    return testAISearch(settings && settings.apiKey ? settings : storeSingleton.getAISettings());
  });

  ipcMain.handle('ai:auditEnvironment', async (_, subject: string, allowedApps: string[]) => {
    const lang = storeSingleton.getLanguage();
    const aiSettings = storeSingleton.getAISettings();
    const runningApps: { appName: string; title: string; execPath?: string; domain?: string }[] = [];

    // Fast native path: enumerate visible windows via Win32 FFI.
    const nativeWindows = getAllWindowsNative(80);
    if (nativeWindows !== null) {
      for (const win of nativeWindows) {
        const domain = extractDomainFromTitle(win.title, win.appName);
        runningApps.push({
          execPath: win.execPath,
          appName: win.appName,
          title: win.title,
          domain,
        });
      }
    } else {
      // Fallback path: PowerShell process scan (non-Windows or FFI unavailable).
      try {
        const { exec } = require('child_process');
        const psCommand = `powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object @{N='appName';E={$_.ProcessName + '.exe'}}, @{N='title';E={$_.MainWindowTitle}} | ConvertTo-Json -Compress"`;

        const raw = await new Promise<string>((resolve) => {
          exec(psCommand, { encoding: 'utf-8', timeout: 4000 }, (error: any, stdout: string) => {
            if (error || !stdout) resolve('');
            else resolve(stdout.trim());
          });
        });

        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of list) {
            if (item && item.appName && item.title) {
              const domain = extractDomainFromTitle(item.title, item.appName);
              runningApps.push({ appName: item.appName, title: item.title, execPath: item.execPath || '', domain });
            }
          }
        }
      } catch (err) {
        console.warn('[IPC] Native & PowerShell enumeration failed, falling back to current app:', err);
        const currentApp = appTracker.getCurrentApp();
        if (currentApp) {
          runningApps.push({
            execPath: currentApp.execPath,
            appName: currentApp.appName,
            title: currentApp.title,
            domain: currentApp.domain,
          });
        }
      }
    }

    const result = await AIEvaluator.auditEnvironmentReliable(
      dedupeBrowserTabs(runningApps),
      subject,
      allowedApps,
      aiSettings,
      lang,
      rulesEngine.getCategories(),
      rulesEngine.getRules()
    );

    // Apps confirmed at session start are cleared by the intervention lock so a
    // fresh, honest start never triggers an immediate "lock" for apps that were
    // already open and audited before the session began.
    intervention.setBaseline(
      (result || []).map((item) => ({ appName: item.appName, domain: item.domain, title: item.title }))
    );

    return result;
  });

  ipcMain.handle('ai:reviewApp', async (_, app: { appName: string; title: string; execPath?: string; domain?: string }, subject = '') => {
    if (!app || typeof app.appName !== 'string' || typeof app.title !== 'string') return null;
    const settings = storeSingleton.getAISettings();
    const items = await AIEvaluator.auditEnvironmentReliable(
      [{ appName: app.appName.slice(0, 160), title: app.title.slice(0, 500), execPath: String(app.execPath || '').slice(0, 1000), domain: String(app.domain || '').slice(0, 255) }],
      String(subject || '').slice(0, 160),
      [], settings, storeSingleton.getLanguage(), rulesEngine.getCategories(), rulesEngine.getRules()
    );
    return items[0] || null;
  });

  ipcMain.handle('ai:rememberReview', (_, app: { appName: string; domain?: string }, decision: 'productive' | 'neutral' | 'distracting') => {
    if (!app || !['productive', 'neutral', 'distracting'].includes(decision)) return false;
    const categoryId = `cat_${decision}`;
    const patternType = app.domain ? 'domain' : 'executable';
    const patternValue = String(app.domain || app.appName || '').trim().slice(0, 255);
    if (!patternValue || (patternType === 'executable' && !/^[A-Za-z0-9._ \-]+(?:\.exe)?$/i.test(patternValue))) return false;
    rulesEngine.addRule({ pattern_type: patternType, pattern_value: patternValue, category_id: categoryId, priority: 1000 });
    broadcast('rules:updated');
    return true;
  });

  ipcMain.handle('ai:closeProcess', (_, appName: string) => {
    // Strict allowlist: only a plausible Windows executable name (letters,
    // digits, dot, dash, underscore, space) ending in .exe. Anything else is
    // rejected up front — never handed to a shell. This guards against command
    // injection AND prevents nonsensical "Unknown App" close attempts.
    const rawName = String(appName || '').trim();
    const isSafeExe = /^[A-Za-z0-9._ \-]+\.exe$/.test(rawName);
    if (!isSafeExe) return false;
    try {
      const { execFileSync } = require('child_process');
      // execFile (no shell) with an argument array — no string interpolation
      // into a command line, so there is no injection surface.
      execFileSync('taskkill', ['/F', '/IM', rawName], { stdio: 'ignore' });
      return true;
    } catch (err) {
      console.warn('[IPC] Failed to kill process:', rawName, err);
      return false;
    }
  });

  ipcMain.handle('ai:requestException', (_, request: AIJustificationRequest) => {
    const lang = storeSingleton.getLanguage();
    const aiSettings = storeSingleton.getAISettings();
    return AIEvaluator.evaluateJustification(request, aiSettings, lang);
  });

  // ---------- Intervention (main-process lock/review window) ----------

  ipcMain.handle('intervention:testLock', () => {
    intervention.showTestLock();
  });

  ipcMain.handle('intervention:getStatus', () => {
    return intervention.getStatus();
  });

  ipcMain.handle('intervention:grantTemporary', (_, appName: string, minutes: number, domain?: string) => {
    if (!appName || typeof appName !== 'string') return false;
    const n = Number(minutes);
    intervention.grantTemporary(appName.slice(0, 160), Number.isFinite(n) ? n : 15, typeof domain === 'string' ? domain.slice(0, 255) : undefined);
    return true;
  });

  ipcMain.handle('intervention:dismiss', () => {
    intervention.dismiss();
  });

  ipcMain.handle('intervention:rememberReview', (_, decision: ReviewDecision, scope: ReviewScope) => {
    intervention.rememberReview(decision, scope);
  });

  ipcMain.handle('intervention:justify', async (_, reason: string) => {
    return intervention.justify(typeof reason === 'string' ? reason.slice(0, 500) : '');
  });

  ipcMain.handle('intervention:closeApp', (_, appName: string) => {
    return intervention.closeApp(typeof appName === 'string' ? appName : '');
  });

  // ---------- Browser extension bridge ----------

  ipcMain.handle('bridge:getStatus', () => {
    return nativeHostStatus();
  });

  ipcMain.handle('bridge:setExtensionId', (_, id: string) => {
    const clean = String(id || '').trim().toLowerCase().slice(0, 64);
    if (clean) {
      storeSingleton.setExtensionId(clean);
      // Refresh the manifests + registry keys for the new ID (best effort).
      registerNativeHosts(clean).then((res) => {
        if (!res.ok) console.warn('[IPC] Native host refresh failed:', res.errors);
      });
    }
    return nativeHostStatus();
  });

  ipcMain.handle('bridge:updateManifests', async () => {
    return registerNativeHosts(storeSingleton.getExtensionId());
  });

  ipcMain.handle('bridge:getExtensionFolder', () => {
    return extensionFolderPath();
  });

  ipcMain.handle('tracker:getDebug', () => {
    return trackerDebug.snapshot();
  });

  // ---------- Language & Settings ----------

  ipcMain.handle('settings:getLanguage', () => {
    return storeSingleton.getLanguage();
  });

  ipcMain.handle('settings:setLanguage', (_, lang: Language) => {
    storeSingleton.setLanguage(lang);
    broadcast('language:changed', lang);
  });

  // ---------- Audio Settings ----------

  ipcMain.handle('audio:getSettings', () => {
    return storeSingleton.getAudioSettings();
  });

  ipcMain.handle('audio:setSettings', (_, audio: Partial<AudioSettings>) => {
    storeSingleton.setAudioSettings(audio);
    broadcast('audio:settingsChanged', storeSingleton.getAudioSettings());
  });

  ipcMain.handle('audio:setMasterMuted', (_, muted: boolean) => {
    storeSingleton.setAudioSettings({ masterMuted: Boolean(muted) });
    broadcast('audio:masterMuted', Boolean(muted));
  });

  // ---------- Music Player ----------

  ipcMain.handle('music:selectFolder', async () => {
    const main = getMainWindow();
    const result = main
      ? await dialog.showOpenDialog(main, {
          properties: ['openDirectory'],
          title: 'انتخاب پوشه موسیقی پس‌زمینه / Select Background Music Folder',
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'انتخاب پوشه موسیقی پس‌زمینه / Select Background Music Folder',
        });

    if (result.canceled || result.filePaths.length === 0) {
      return storeSingleton.getMusicFolderPath();
    }

    const folderPath = result.filePaths[0];
    storeSingleton.setMusicFolderPath(folderPath);
    return folderPath;
  });

  ipcMain.handle('music:getFolder', () => {
    return storeSingleton.getMusicFolderPath();
  });

  ipcMain.handle('music:getTracks', () => {
    const folderPath = storeSingleton.getMusicFolderPath();
    if (!folderPath || !fs.existsSync(folderPath)) {
      return [];
    }

    try {
      const files = fs.readdirSync(folderPath);
      const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];

      const tracks: TrackInfo[] = files
        .filter(file => audioExts.includes(path.extname(file).toLowerCase()))
        .map(file => {
          const fullPath = path.join(folderPath, file);
          return {
            id: Buffer.from(fullPath).toString('base64'),
            name: path.basename(file, path.extname(file)),
            filePath: fullPath,
            mediaUrl: `local-media://${encodeURIComponent(fullPath)}`,
          };
        });

      return tracks;
    } catch (err) {
      console.error('[IPC] Failed to read music folder:', err);
      return [];
    }
  });

  // ---------- Timer ----------

  ipcMain.handle('timer:getState', () => {
    return timerEngine.getState();
  });

  ipcMain.handle('timer:start', (_, mode, durationMinutes, title, subject) => {
    // Validate mode
    const validModes: SessionMode[] = ['pomodoro', 'custom', 'stopwatch'];
    if (!validModes.includes(mode as SessionMode)) {
      console.warn('[IPC] timer:start rejected — invalid mode:', mode);
      return;
    }
    // Validate durationMinutes: finite number, >= 0, <= 1440 (24h)
    const minutes = Number(durationMinutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      console.warn('[IPC] timer:start rejected — invalid durationMinutes:', durationMinutes);
      return;
    }
    // A brand-new session starts clean: previous baseline/dismiss state must not
    // carry over into it.
    intervention.clearBaseline();
    timerEngine.startTimer(mode as SessionMode, minutes, title, subject);
  });

  ipcMain.handle('timer:pause', () => {
    timerEngine.pauseTimer();
  });

  ipcMain.handle('timer:reset', () => {
    timerEngine.resetTimer();
  });

  // ---------- App Tracker ----------

  ipcMain.handle('app:getCurrent', () => {
    return appTracker.getCurrentApp();
  });

  // ---------- Scratchpad ----------

  ipcMain.handle('scratchpad:save', (_, content: string, tags: string[] = []) => {
    const sessionId = timerEngine.getState().activeSessionId;
    return storeSingleton.saveNote(content, tags, sessionId);
  });

  ipcMain.handle('scratchpad:update', (_, id: string, content: string, tags: string[]) => {
    storeSingleton.updateNote(id, content, tags);
  });

  ipcMain.handle('scratchpad:getNotes', (_, sessionId?: string) => {
    return storeSingleton.getNotes(sessionId);
  });

  ipcMain.handle('scratchpad:toggleProcessed', (_, noteId: string) => {
    storeSingleton.toggleNoteProcessed(noteId);
  });

  ipcMain.handle('scratchpad:delete', (_, noteId: string) => {
    storeSingleton.deleteNote(noteId);
  });

  // ---------- Analytics & Sessions ----------

  ipcMain.handle('analytics:getDailySummary', (_, date: string) => {
    const dateKey = toDateKey(date);
    const sessions = storeSingleton.getSessionsForRange(dateKey, dateKey);
    const appLogs = storeSingleton.getAppLogsForDate(dateKey);
    const categories = storeSingleton.getCategories();
    return buildDailySummary(dateKey, appLogs, sessions, categories);
  });

  ipcMain.handle('analytics:getRange', (_, startDate: string, endDate: string) => {
    const startKey = toDateKey(startDate);
    const endKey = toDateKey(endDate || startKey);
    const sessions = storeSingleton.getSessionsForRange(startKey, endKey);
    const logs = storeSingleton.getAppLogsForRange(startKey, endKey);
    const categories = storeSingleton.getCategories();
    const { summaries, totals, topApps, subjectDistribution, overallFocusScore } = aggregateRange(
      startKey,
      endKey,
      logs,
      sessions,
      categories
    );

    return {
      startDate: startKey,
      endDate: endKey,
      summaries,
      topApps,
      subjectDistribution,
      overallFocusScore,
      totalStudySeconds: totals.totalStudySeconds,
      productiveSeconds: totals.productiveSeconds,
      distractingSeconds: totals.distractingSeconds,
      neutralSeconds: totals.neutralSeconds,
      idleSeconds: totals.idleSeconds,
      completedSessionsCount: totals.completedSessionsCount,
      activeDaysCount: totals.activeDaysCount,
    };
  });

  ipcMain.handle('analytics:getStreak', () => {
    // Only need recent sessions for streak computation (streaks only depend on
    // consecutive recent days). Bounded to last 2 years (~730 days) is plenty.
    const end = todayKey();
    const start = daysAgoKey(730);
    const sessions = storeSingleton.getSessionsForRange(start, end);
    return computeStreaks(sessions, todayKey());
  });

  ipcMain.handle('sessions:getRecent', (_, limit = 10) => {
    const n = Number(limit);
    const clamped = Math.min(Math.max(1, Number.isFinite(n) ? n : 10), 200);
    return storeSingleton.getRecentSessions(clamped);
  });

  // ---------- Data Export ----------

  ipcMain.handle('data:export', () => {
    return storeSingleton.exportAll();
  });

  ipcMain.handle('data:exportCsv', async () => {
    const csv = storeSingleton.exportCsv();
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return { success: false, error: 'No main window' };
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(main, {
      title: 'Export Study Data (CSV)',
      defaultPath: `focusstudy-export-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Canceled' };
    try {
      const fs = require('fs');
      await fs.promises.writeFile(result.filePath, csv, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err) {
      console.error('[IPC] CSV export failed:', err);
      return { success: false, error: String(err) };
    }
  });

  // ---------- Rules & Categories ----------

  ipcMain.handle('rules:getCategories', () => rulesEngine.getCategories());
  ipcMain.handle('rules:getRules', () => rulesEngine.getRules());
  ipcMain.handle('rules:addRule', (_, rule) => rulesEngine.addRule(rule));
  ipcMain.handle('rules:deleteRule', (_, ruleId) => rulesEngine.deleteRule(ruleId));

  // ---------- Widget ----------

  ipcMain.handle('widget:setAlwaysOnTop', (_, flag: boolean) => {
    const widget = getWidgetWindow();
    if (widget && !widget.isDestroyed()) widget.setAlwaysOnTop(flag, 'screen-saver');
  });

  ipcMain.handle('widget:toggleExpand', () => {
    const widget = getWidgetWindow();
    if (!widget || widget.isDestroyed()) return false;
    const bounds = widget.getBounds();
    const isExpanded = bounds.height > 120;
    if (isExpanded) {
      widget.setSize(320, 100);
    } else {
      widget.setSize(320, 280);
    }
    return !isExpanded;
  });

  ipcMain.handle('widget:minimize', () => {
    const widget = getWidgetWindow();
    if (!widget || widget.isDestroyed()) return false;
    widget.minimize();
    return true;
  });

  // ---------- Events forwarding ----------

  timerEngine.on('tick', (state) => {
    broadcast('timer:tick', state);
  });

  timerEngine.on('session:completed', (payload) => {
    broadcast('session:completed', payload);
  });

  appTracker.on('appChanged', (appInfo) => {
    broadcast('app:changed', appInfo);
  });

  appTracker.on('distractionAlert', (alert) => {
    broadcast('app:distractionAlert', alert);
  });
}
