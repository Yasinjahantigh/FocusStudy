import { EventEmitter } from 'events';
import { SessionMode, SessionStatus, TimerStateDTO, StudySession, SessionCompletedPayload } from '../../shared/types';
import { computeFocusScore } from '../../shared/scoring';
import { storeSingleton } from '../db/jsonStore';
import { uniqueId } from '../../shared/id';
import { Notification } from 'electron';

export type { SessionCompletedPayload };

export class TimerEngine extends EventEmitter {
  private mode: SessionMode = 'pomodoro';
  private status: SessionStatus = 'paused';
  private targetDurationSeconds = 25 * 60;
  private remainingSeconds = 25 * 60;
  private elapsedSeconds = 0;
  private sessionTitle = 'Study Session';
  private subjectTag = 'General';
  private activeSessionId: string | undefined = undefined;

  private timerInterval: NodeJS.Timeout | null = null;

  private productiveSeconds = 0;
  private distractingSeconds = 0;
  private idleSeconds = 0;

  // Avoid persisting the session to the store on every 1s tick (was a
  // write/sec + focus-score recompute). We accumulate in memory and flush the
  // recorded usage on a 30s throttle and on every state transition.
  private lastUsageFlushAtEpochMs = 0;
  private static readonly USAGE_FLUSH_INTERVAL_MS = 30_000;

  public getState(): TimerStateDTO {
    return {
      mode: this.mode,
      status: this.status,
      remainingSeconds: this.remainingSeconds,
      elapsedSeconds: this.elapsedSeconds,
      targetDurationSeconds: this.targetDurationSeconds,
      sessionTitle: this.sessionTitle,
      subjectTag: this.subjectTag,
      activeSessionId: this.activeSessionId,
    };
  }

  public startTimer(mode: SessionMode = 'pomodoro', durationMinutes: number = 25, title?: string, subject?: string) {
    if (this.status === 'running') return;

    const requestedTarget = durationMinutes * 60;
    const requestedTitle = title && title.trim() ? title.trim() : this.sessionTitle;
    const requestedSubject = subject && subject.trim() ? subject.trim() : this.subjectTag;

    const canResume =
      this.status === 'paused' &&
      !!this.activeSessionId &&
      this.remainingSeconds > 0 &&
      this.mode === mode &&
      this.targetDurationSeconds === requestedTarget &&
      this.sessionTitle === requestedTitle &&
      this.subjectTag === requestedSubject;

    if (canResume) {
      this.status = 'running';
      this.updateDbStatus('running');
      this.startTicking();
      this.emitState();
      return;
    }

    this.mode = mode;
    this.targetDurationSeconds = requestedTarget;
    this.sessionTitle = requestedTitle;
    this.subjectTag = requestedSubject;
    this.activeSessionId = uniqueId('session');
    this.remainingSeconds = this.mode === 'stopwatch' ? requestedTarget : requestedTarget;
    this.elapsedSeconds = 0;
    this.productiveSeconds = 0;
    this.distractingSeconds = 0;
    this.idleSeconds = 0;
    this.lastUsageFlushAtEpochMs = 0;
    this.status = 'running';

    const session: StudySession = {
      id: this.activeSessionId,
      title: this.sessionTitle,
      subjectTag: this.subjectTag,
      mode: this.mode,
      targetDurationSeconds: this.targetDurationSeconds,
      actualDurationSeconds: 0,
      productiveSeconds: 0,
      distractingSeconds: 0,
      idleSeconds: 0,
      status: 'running',
      focusScore: 0,
      startTime: new Date().toISOString(),
    };

    storeSingleton.createSession(session);
    this.startTicking();
    this.emitState();
  }

  public pauseTimer() {
    if (this.status !== 'running') return;
    this.flushUsageIfActive();
    this.status = 'paused';
    this.stopTicking();
    this.updateDbStatus('paused');
    this.emitState();
  }

  public resetTimer() {
    this.stopTicking();
    if (this.activeSessionId && (this.status === 'running' || this.status === 'paused')) {
      this.flushUsageIfActive();
      this.updateDbStatus('abandoned');
    }
    this.status = 'paused';
    this.remainingSeconds = this.targetDurationSeconds;
    this.elapsedSeconds = 0;
    this.productiveSeconds = 0;
    this.distractingSeconds = 0;
    this.idleSeconds = 0;
    this.lastUsageFlushAtEpochMs = 0;
    this.activeSessionId = undefined;
    this.emitState();
  }

  /**
   * Marks the in-flight session as abandoned (used on app quit).
   */
  public abandonActiveSession() {
    if (this.activeSessionId && (this.status === 'running' || this.status === 'paused')) {
      this.flushUsageIfActive();
      this.updateDbStatus('abandoned');
    }
    this.stopTicking();
    this.status = 'paused';
  }

  public recordAppUsage(categoryType: 'productive' | 'distracting' | 'neutral' | 'idle', durationSeconds: number) {
    if (this.status !== 'running') return;

    if (categoryType === 'productive') this.productiveSeconds += durationSeconds;
    else if (categoryType === 'distracting') this.distractingSeconds += durationSeconds;
    else if (categoryType === 'idle') this.idleSeconds += durationSeconds;

    // Throttle the (relatively) expensive store write + focus-score recompute to
    // once per USAGE_FLUSH_INTERVAL_MS while running, instead of every tick.
    const now = Date.now();
    if (this.activeSessionId && now - this.lastUsageFlushAtEpochMs >= TimerEngine.USAGE_FLUSH_INTERVAL_MS) {
      this.lastUsageFlushAtEpochMs = now;
      this.persistRecordedUsage();
    }
  }

  /**
   * Writes the accumulated productive/distracting/idle seconds + live focus
   * score to the session record. Called throttled during a run and eagerly on
   * every state transition (pause/complete/abandon/reset) so no usage is lost.
   */
  private persistRecordedUsage() {
    if (!this.activeSessionId) return;
    const focusScore = computeFocusScore({
      productiveSeconds: this.productiveSeconds,
      distractingSeconds: this.distractingSeconds,
      idleSeconds: this.idleSeconds,
      elapsedSeconds: this.elapsedSeconds,
      targetSeconds: this.targetDurationSeconds,
    });
    storeSingleton.updateSession(this.activeSessionId, {
      actualDurationSeconds: this.elapsedSeconds,
      productiveSeconds: this.productiveSeconds,
      distractingSeconds: this.distractingSeconds,
      idleSeconds: this.idleSeconds,
      focusScore,
    });
  }

  private flushUsageIfActive() {
    if (this.lastUsageFlushAtEpochMs !== 0) {
      this.persistRecordedUsage();
      this.lastUsageFlushAtEpochMs = 0;
    }
  }

  private startTicking() {
    this.stopTicking();
    this.timerInterval = setInterval(() => {
      if (this.status !== 'running') return;

      this.elapsedSeconds += 1;
      if (this.mode !== 'stopwatch') {
        this.remainingSeconds = Math.max(0, this.remainingSeconds - 1);
        if (this.remainingSeconds === 0) {
          this.completeSession();
          return;
        }
      }
      this.emitState();
    }, 1000);
  }

  private stopTicking() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private completeSession() {
    this.flushUsageIfActive();
    this.status = 'completed';
    this.stopTicking();
    this.updateDbStatus('completed');

    const payload: SessionCompletedPayload = {
      sessionId: this.activeSessionId || '',
      status: 'completed',
      elapsedSeconds: this.elapsedSeconds,
      productiveSeconds: this.productiveSeconds,
      distractingSeconds: this.distractingSeconds,
      idleSeconds: this.idleSeconds,
      focusScore: computeFocusScore({
        productiveSeconds: this.productiveSeconds,
        distractingSeconds: this.distractingSeconds,
        idleSeconds: this.idleSeconds,
        elapsedSeconds: this.elapsedSeconds,
        targetSeconds: this.targetDurationSeconds,
      }),
      subjectTag: this.subjectTag,
      durationMinutes: Math.round(this.targetDurationSeconds / 60),
    };
    this.emit('session:completed', payload);
    this.emitState();

    if (Notification.isSupported()) {
      const lang = storeSingleton.getLanguage();
      const title = lang === 'fa' ? 'جلسه مطالعه با موفقیت تمام شد 🎉' : 'Focus Study Session Completed! 🎉';
      const body = lang === 'fa'
        ? `آفرین! جلسه ${payload.durationMinutes} دقیقه‌ای "${this.subjectTag}" با موفقیت تمام شد. امتیاز تمرکز: ${payload.focusScore}`
        : `Great job! Your ${payload.durationMinutes} minute "${this.subjectTag}" session is done. Focus score: ${payload.focusScore}`;
      new Notification({ title, body }).show();
    }
  }

  private updateDbStatus(status: SessionStatus, endTime?: string) {
    if (!this.activeSessionId) return;

    if (status === 'running') {
      storeSingleton.updateSession(this.activeSessionId, { status, endTime: undefined });
    } else {
      storeSingleton.updateSession(this.activeSessionId, {
        status,
        endTime: endTime || new Date().toISOString(),
      });
    }
  }

  private emitState() {
    this.emit('tick', this.getState());
  }
}