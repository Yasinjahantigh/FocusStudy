import { BrowserWindow } from 'electron';
import path from 'path';
import { execFileSync } from 'child_process';
import { AppTracker } from './AppTracker';
import { TimerEngine } from './TimerEngine';
import { RulesEngine } from './RulesEngine';
import { AIEvaluator } from './AIEvaluator';
import { storeSingleton } from '../db/jsonStore';
import { trackerDebug } from './TrackerDebug';
import { ActiveAppInfo, EvidenceSource, ReviewDecision, ReviewScope } from '../../shared/types';
import { domainMatches, normalizeExecutableName } from '../../shared/classification';

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

const DISMISS_GRACE_MS = 30_000;
const REVIEW_GRACE_MS = 10_000;
const TEMP_EXPIRY_SCAN_MS = 30_000;
const WATCH_INTERVAL_MS = 2_500;

/**
 * True when at least one process with the given exe name is running. Used to
 * auto-release the lock when the user closes the distracting app directly.
 */
function isProcessAlive(appName: string): Promise<boolean> {
  const name = String(appName || '').trim();
  if (!/^[A-Za-z0-9._ \-]+\.exe$/i.test(name)) return Promise.resolve(true);
  const { execFile } = require('child_process') as typeof import('child_process');
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(true); // probe failed — do NOT auto-dismiss on error
      resolve(String(stdout || '').toLowerCase().includes(name.toLowerCase()));
    });
  });
}

/**
 * Main-process-owned lock/review controller. Renders interventions in a
 * dedicated always-on-top window so the user sees them even when the main
 * FocusStudy window is behind/below other apps. Decides when to lock/review
 * directly from the tracker events — the renderer is only a passive client.
 */
export class InterventionController {
  private win: BrowserWindow | null = null;
  private loadReady: Promise<void> | null = null;
  private active: InterventionPayload | null = null;

  private tempAllowed = new Map<string, { appName: string; domain?: string; expiresAt: number }>();
  private baselineCleared = new Set<string>();
  private lastDismiss = new Map<string, number>();
  private reviewPendingKey: string | null = null;

  private timerEngine: TimerEngine | null = null;
  private rulesEngine: RulesEngine | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;

  public bind(tracker: AppTracker, timerEngine: TimerEngine, rulesEngine: RulesEngine) {
    this.timerEngine = timerEngine;
    this.rulesEngine = rulesEngine;
    tracker.on('appChanged', (info) => this.evaluate(info));

    this.cleanupTimer = setInterval(() => this.expireTempAllows(), TEMP_EXPIRY_SCAN_MS);
    this.cleanupTimer.unref?.();
  }

  /**
   * While an intervention is shown, verify the locked process is still alive.
   * If the user closed the app, the lock/release window must be dismissed too.
   */
  private startWatch() {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => this.watch(), WATCH_INTERVAL_MS);
    this.watchTimer.unref?.();
  }

  private stopWatch() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  private async watch() {
    const active = this.active;
    if (!active) return;
    const appName = active.appName;
    const alive = await isProcessAlive(appName);
    if (!this.active || this.active.appName !== appName) return;
    if (!alive) {
      trackerDebug.record({
        ts: Date.now(),
        appName,
        title: '',
        domain: undefined,
        category: 'released',
        confidence: 1,
        source: 'watchdog',
        needsReview: false,
        isChange: true,
        event: 'lock-released-app-closed',
      });
      // Release without a dismiss grace: if the user reopens the app it must be
      // locked again. Do NOT re-evaluate here — the last known app is exactly
      // the dead one and the tracker's next 'appChanged' event will handle the
      // real foreground switch.
      this.clearActive();
    }
  }

  private expireTempAllows() {
    const now = Date.now();
    for (const [key, entry] of this.tempAllowed) {
      if (entry.expiresAt <= now) this.tempAllowed.delete(key);
    }
  }

  // ---------- Baseline (session-start audit clears these apps) ----------

  public setBaseline(items: { appName: string; domain?: string; title?: string }[]) {
    const set = new Set<string>();
    for (const item of items || []) {
      if (!item) continue;
      const appName = String(item.appName || '').trim().toLowerCase();
      if (appName) set.add(appName);
      const domain = String(item.domain || '').trim().toLowerCase();
      if (domain) set.add(domain);
      const title = String(item.title || '').trim().toLowerCase();
      if (title) set.add(title);
    }
    this.baselineCleared = set;
  }

  public clearBaseline() {
    this.baselineCleared.clear();
    this.tempAllowed.clear();
    this.reviewPendingKey = null;
    this.clearActive();
  }

  // ---------- Guards ----------

  private isTempAllowed(info: ActiveAppInfo): boolean {
    const now = Date.now();
    const appName = (info.appName || '').toLowerCase();
    const domain = (info.domain || '').toLowerCase();
    const title = (info.title || '').toLowerCase();
    for (const entry of this.tempAllowed.values()) {
      if (entry.expiresAt <= now) continue;
      const allowedApp = (entry.appName || '').toLowerCase();
      if (appName === allowedApp) return true;
      if (entry.domain && domainMatches(domain, entry.domain)) return true;
      if (allowedApp.endsWith('.exe') && appName === allowedApp) return true;
      if (!entry.domain && allowedApp && title.includes(allowedApp)) return true;
    }
    return false;
  }

  private isBaselineCleared(info: ActiveAppInfo): boolean {
    if (this.baselineCleared.size === 0) return false;
    const appName = (info.appName || '').toLowerCase();
    const domain = (info.domain || '').toLowerCase();
    const title = (info.title || '').toLowerCase();
    for (const allowed of this.baselineCleared) {
      const value = allowed.toLowerCase();
      if (appName === normalizeExecutableName(value)) return true;
      if (domainMatches(domain, value)) return true;
      if (value && title.includes(value)) return true;
    }
    return false;
  }

  private blockAllowedApps(info: ActiveAppInfo): boolean {
    try {
      const blockId = storeSingleton.getActiveBlockId();
      if (!blockId) return false;
      const block = storeSingleton.getWeeklyBlocks().find((b) => b.id === blockId);
      const allowed = block?.allowedApps || [];
      if (!allowed.length) return false;
      const appName = (info.appName || '').toLowerCase();
      const domain = (info.domain || '').toLowerCase();
      const title = (info.title || '').toLowerCase();
      return allowed.some((raw) => {
        const value = String(raw || '').trim().toLowerCase();
        if (!value) return false;
        return (
          appName === normalizeExecutableName(value) ||
          domainMatches(domain, value) ||
          title.includes(value)
        );
      });
    } catch {
      return false;
    }
  }

  private dismissKey(info: Pick<ActiveAppInfo, 'appName' | 'domain'>): string {
    const key = (info.appName || '').toLowerCase();
    const domain = (info.domain || '').toLowerCase();
    return domain ? `${key}|${domain}` : key;
  }

  // ---------- Evaluation (called on every app change) ----------

  public evaluate(info: ActiveAppInfo) {
    // One intervention at a time; ignore all other app switches while active.
    if (this.active) return;
    if (!this.timerEngine || this.timerEngine.getState().status !== 'running') return;
    if (info.isIdle) return;
    this.expireTempAllows();

    const now = Date.now();
    if (this.isTempAllowed(info) || this.isBaselineCleared(info)) return;
    if (this.blockAllowedApps(info)) return;

    if (info.needsReview && info.reviewFingerprint) {
      if (this.reviewPendingKey === info.reviewFingerprint) return;
      const grace = this.lastDismiss.get(this.dismissKey(info));
      if (grace && now - grace < REVIEW_GRACE_MS) return;
      this.reviewPendingKey = info.reviewFingerprint;
      this.runReview(info);
      return;
    }

    if (info.category?.type === 'distracting') {
      const grace = this.lastDismiss.get(this.dismissKey(info));
      if (grace && now - grace < DISMISS_GRACE_MS) return;
      trackerDebug.record({
        ts: now, appName: info.appName, title: (info.title || '').slice(0, 300),
        domain: info.domain, category: 'distracting', confidence: 0, source: 'lock',
        needsReview: false, isChange: true, event: 'lock-shown',
      });
      this.show({
        kind: 'lock',
        appName: info.appName,
        title: info.title,
        domain: info.domain,
        subject: this.activeSubject(),
        blockTitle: this.activeBlockTitle(),
        version: 1,
      });
    }
  }

  private async runReview(info: ActiveAppInfo) {
    try {
      const fingerprint = info.reviewFingerprint!;
      const subject = this.activeSubject();
      const item = await AIEvaluator.auditEnvironmentReliable(
        [{ appName: info.appName, title: info.title, execPath: info.execPath, domain: info.domain }],
        subject,
        [],
        storeSingleton.getAISettings(),
        storeSingleton.getLanguage(),
        this.rulesEngine?.getCategories() || [],
        this.rulesEngine?.getRules() || []
      );
      if (this.reviewPendingKey !== fingerprint) return;
      const result = item?.[0];
      this.show({
        kind: 'review',
        appName: info.appName,
        title: info.title,
        domain: info.domain,
        fingerprint,
        subject,
        blockTitle: this.activeBlockTitle(),
        reason: result?.reason,
        confidence: result?.confidence,
        source: result?.source,
        sources: result?.sources,
        version: 1,
      });
    } catch (err) {
      console.warn('[Intervention] Review failed:', err);
      if (this.reviewPendingKey !== info.reviewFingerprint) return;
      this.show({
        kind: 'review',
        appName: info.appName,
        title: info.title,
        domain: info.domain,
        fingerprint: info.reviewFingerprint,
        subject: this.activeSubject(),
        blockTitle: this.activeBlockTitle(),
        reason: '',
        confidence: 0,
        source: 'fallback',
        version: 1,
      });
    }
  }

  private activeSubject(): string {
    return storeSingleton.getActiveBlockId()
      ? storeSingleton.getWeeklyBlocks().find((b) => b.id === storeSingleton.getActiveBlockId())?.subject || ''
      : '';
  }

  private activeBlockTitle(): string {
    return storeSingleton.getActiveBlockId()
      ? storeSingleton.getWeeklyBlocks().find((b) => b.id === storeSingleton.getActiveBlockId())?.title || ''
      : '';
  }

  // ---------- User actions ----------

  public grantTemporary(appName: string, minutes: number, domain?: string) {
    if (!appName) return;
    this.expireTempAllows();
    this.tempAllowed.set(appName.toLowerCase(), {
      appName,
      domain: domain && domain.trim() ? domain.trim().toLowerCase() : undefined,
      expiresAt: Date.now() + Math.max(1, Number(minutes) || 15) * 60 * 1000,
    });
    this.clearActive();
  }

  public dismiss() {
    if (this.active) {
      this.markDismissed(this.active);
      if (this.active.kind === 'review') this.reviewPendingKey = null;
    }
    this.clearActive();
  }

  public rememberReview(decision: ReviewDecision, scope: ReviewScope) {
    const active = this.active;
    if (!active) return;
    if (scope === 'permanent' && this.rulesEngine) {
      const patternType = active.domain ? 'domain' : 'executable';
      const patternValue = String(active.domain || active.appName || '').trim().slice(0, 255);
      const safe = patternType === 'executable' ? /^[A-Za-z0-9._ \-]+(?:\.exe)?$/i.test(patternValue) : true;
      if (patternValue && safe && (/^(productive|neutral|distracting)$/.test(decision))) {
        try {
          this.rulesEngine.addRule({
            pattern_type: patternType as 'executable' | 'domain',
            pattern_value: patternValue,
            category_id: `cat_${decision}`,
            priority: 1000,
          });
        } catch (err) {
          console.warn('[Intervention] Remember rule failed:', err);
        }
      }
    } else {
      this.grantTemporary(active.appName, scope === 'block' ? 60 : 15, active.domain);
      return;
    }
    this.clearActive();
  }

  public justify(reason: string): Promise<{ approved: boolean; aiResponse: string; grantedDurationMinutes?: number }> {
    const active = this.active;
    if (!active || active.kind !== 'lock') {
      return Promise.resolve({ approved: false, aiResponse: '', grantedDurationMinutes: 0 });
    }
    return AIEvaluator.evaluateJustification(
      {
        appName: active.appName,
        title: active.title,
        subject: active.subject,
        blockTitle: active.blockTitle,
        reason: String(reason || ''),
      },
      storeSingleton.getAISettings(),
      storeSingleton.getLanguage()
    ).then((res) => {
      if (res.approved) this.grantTemporary(active.appName, res.grantedDurationMinutes || 15, active.domain);
      return res;
    });
  }

  public closeApp(appName: string): boolean {
    return closeProcessByName(appName);
  }

  private markDismissed(active: InterventionPayload) {
    this.lastDismiss.set(
      this.dismissKey({ appName: active.appName, domain: active.domain }),
      Date.now()
    );
  }

  // ---------- Window management ----------

  private clearActive() {
    this.active = null;
    this.hide();
    this.stopWatch();
  }

  private hide() {
    const win = this.win;
    if (win && !win.isDestroyed()) win.hide();
  }

  private show(payload: InterventionPayload) {
    this.active = payload;
    this.startWatch();
    const win = this.ensureWindow();
    win.show();
    win.focus();
    this.loadReady
      ?.then(() => {
        if (this.active === payload && win === this.win && !win.isDestroyed()) {
          win.webContents.send('intervention:show', payload);
        }
      })
      .catch(() => undefined);
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: 620,
      height: 720,
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#020617',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Keep the intervention visible: if the user clicks away, re-focus it.
    win.on('blur', () => {
      const self = this;
      setTimeout(() => {
        if (self.active && win === self.win && !win.isDestroyed()) win.focus();
      }, 200);
    });
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
    const file = path.join(__dirname, '../renderer/intervention.html');
    this.loadReady = win.loadFile(file).then(() => undefined);
    return win;
  }

  public showTestLock() {
    this.show({
      kind: 'lock',
      appName: 'FocusStudy Test',
      title: '',
      subject: this.activeSubject() || 'Test',
      blockTitle: this.activeBlockTitle() || 'Test',
      version: 1,
    });
  }

  public getStatus() {
    return {
      active: !!this.active,
      kind: this.active?.kind ?? null,
      appName: this.active?.appName ?? null,
    };
  }

  public dispose() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.stopWatch();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

/**
 * Closes a process by exact executable name with a strict allowlist. Shared by
 * the lock controller and the legacy ai:closeProcess IPC handler.
 */
export function closeProcessByName(appName: string): boolean {
  const rawName = String(appName || '').trim();
  const isSafeExe = /^[A-Za-z0-9._ \-]+\.exe$/.test(rawName);
  if (!isSafeExe) return false;
  try {
    execFileSync('taskkill', ['/F', '/IM', rawName], { stdio: 'ignore' });
    return true;
  } catch (err) {
    console.warn('[Intervention] Failed to kill process:', rawName, err);
    return false;
  }
}