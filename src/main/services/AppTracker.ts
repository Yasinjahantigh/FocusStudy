import { EventEmitter } from 'events';
import { getActiveWindowNative, getIdleTimeSecondsNative, extractDomainFromTitle } from '../native/win32Api';
import { RulesEngine } from './RulesEngine';
import { TimerEngine } from './TimerEngine';
import { ActiveAppInfo, DistractionAlertDTO } from '../../shared/types';
import { storeSingleton } from '../db/jsonStore';
import { getBridgeActiveTab } from './nativeHost';
import { mergeTabInfo } from '../../shared/bridge';
import { isBrowserExecutable } from '../../shared/classification';
import { trackerDebug } from './TrackerDebug';

interface PendingLog {
  sessionId?: string;
  appName: string;
  executablePath: string;
  windowTitle: string;
  domain?: string;
  categoryId: string;
  openedAt: number;
}

export class AppTracker extends EventEmitter {
  private rulesEngine: RulesEngine;
  private timerEngine: TimerEngine;
  private isTracking = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private currentActiveApp: ActiveAppInfo | null = null;
  private idleThresholdSeconds = 300;

  private consecutiveDistractionSeconds = 0;
  private lastAlertTime = 0;

  private pendingLog: PendingLog | null = null;
  private lastLogFlushAt = Date.now();

  constructor(rulesEngine: RulesEngine, timerEngine: TimerEngine) {
    super();
    this.rulesEngine = rulesEngine;
    this.timerEngine = timerEngine;
  }

  public start() {
    if (this.isTracking) return;
    this.isTracking = true;

    this.pollInterval = setInterval(() => {
      this.pollActiveApp();
    }, 1000);
  }

  public stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isTracking = false;
  }

  public getCurrentApp(): ActiveAppInfo | null {
    return this.currentActiveApp;
  }

  /**
   * Closes the open log accumulator and persists it. Called on app switch
   * and before shutdown so no tracked time is lost.
   */
  public flushCurrentLog() {
    if (!this.pendingLog) return;
    const now = Date.now();
    const durationSeconds = Math.max(1, Math.round((now - this.pendingLog.openedAt) / 1000));

    try {
      storeSingleton.addAppLog({
        sessionId: this.pendingLog.sessionId,
        appName: this.pendingLog.appName,
        executablePath: this.pendingLog.executablePath,
        windowTitle: this.pendingLog.windowTitle,
        domain: this.pendingLog.domain,
        categoryId: this.pendingLog.categoryId,
        startTime: new Date(this.pendingLog.openedAt).toISOString(),
        endTime: new Date(now).toISOString(),
        durationSeconds,
      });
    } catch (err) {
      console.error('[AppTracker] Error logging app usage:', err);
    }
    this.pendingLog = null;
  }

  private startPendingLog(appInfo: ActiveAppInfo) {
    const sessionId = this.timerEngine.getState().activeSessionId;
    this.pendingLog = {
      sessionId,
      appName: appInfo.appName,
      executablePath: appInfo.execPath,
      windowTitle: appInfo.title,
      domain: appInfo.domain,
      categoryId: appInfo.category.id,
      openedAt: Date.now(),
    };
  }

  private pollActiveApp() {
    const now = Date.now();
    const rawInfo = getActiveWindowNative();
    const idleSeconds = getIdleTimeSecondsNative();
    const isIdle = idleSeconds >= this.idleThresholdSeconds;

    if (!rawInfo) {
      // No foreground window available; extend the current log window and bail.
      this.lastLogFlushAt = now;
      return;
    }

    // Browser windows: prefer the bridge's authoritative active-tab metadata
    // (hostname + tab title) over brittle window-title heuristics, so that
    // switching tabs / opening new tabs is detected with real domains.
    let title = rawInfo.title;
    let domain = extractDomainFromTitle(rawInfo.title, rawInfo.appName);
    if (isBrowserExecutable(rawInfo.appName)) {
      const merged = mergeTabInfo(
        { appName: rawInfo.appName, title: rawInfo.title, domain },
        getBridgeActiveTab()
      );
      title = merged.title;
      domain = merged.domain;
    }

    const assessment = this.rulesEngine.assessApp({
      execPath: rawInfo.execPath,
      appName: rawInfo.appName,
      title,
      domain,
      isIdle,
    });
    const category = assessment.category;

    const isChange =
      !this.currentActiveApp ||
      this.currentActiveApp.appName !== rawInfo.appName ||
      this.currentActiveApp.title !== title ||
      this.currentActiveApp.domain !== domain ||
      this.currentActiveApp.category.id !== category.id ||
      this.currentActiveApp.isIdle !== isIdle;

    trackerDebug.record({
      ts: now,
      appName: rawInfo.appName,
      title: title.slice(0, 300),
      domain,
      category: category.type,
      confidence: assessment.confidence,
      source: assessment.source,
      needsReview: !assessment.known,
      isChange,
    });

    if (isChange) {
      // Persist the finished window segment before switching.
      this.flushCurrentLog();

      const activeAppInfo: ActiveAppInfo = {
        execPath: rawInfo.execPath,
        appName: rawInfo.appName,
        title,
        domain,
        category,
        isIdle,
        idleTimeSeconds: idleSeconds,
        timestamp: now,
        needsReview: !assessment.known,
        reviewFingerprint: !assessment.known
          ? `${rawInfo.appName.toLowerCase()}|${(domain || rawInfo.execPath || '').toLowerCase()}`
          : undefined,
      };

      this.currentActiveApp = activeAppInfo;
      this.startPendingLog(activeAppInfo);
      this.emit('appChanged', activeAppInfo);
    }

    this.timerEngine.recordAppUsage(category.type, 1);

    // Safety net: if the same window has been active for a long time without any
    // event, make sure the accumulated duration is still persisted periodically.
    const sessionIdChanged =
      this.pendingLog && this.pendingLog.sessionId !== this.timerEngine.getState().activeSessionId;
    if (sessionIdChanged) this.flushCurrentLog();

    if (now - this.lastLogFlushAt >= 60_000 && this.pendingLog) {
      // Merge the current span into storage so a crash loses at most ~1 min.
      this.flushCurrentLog();
      this.lastLogFlushAt = now;
    }

    if (category.type === 'distracting' && !isIdle && this.timerEngine.getState().status === 'running') {
      this.consecutiveDistractionSeconds += 1;
      if (this.consecutiveDistractionSeconds >= 10 && now - this.lastAlertTime > 60000) {
        this.lastAlertTime = now;
        const alert: DistractionAlertDTO = {
          appName: rawInfo.appName,
          title: rawInfo.title,
          distractionSeconds: this.consecutiveDistractionSeconds,
          // Message is localized in the renderer (tracker.nudgeMessage); keep
          // the payload language-neutral here.
          message: '',
        };
        this.emit('distractionAlert', alert);
      }
    } else {
      // Decay (not hard-reset) so brief 1s glance-aways don't gate the alert:
      // a 9s-on / 1s-off / 9s-on pattern should still eventually alert.
      this.consecutiveDistractionSeconds = Math.max(0, this.consecutiveDistractionSeconds - 1);
    }
  }
}
