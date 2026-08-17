import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, RotateCcw, Flame, BookOpen, AlertTriangle, Coffee, CheckCircle2, Clock, Target, Zap } from 'lucide-react';
import { TimerStateDTO, SessionMode, Language, StreakInfo, SessionCompletedPayload } from '../../../shared/types';
import { formatLocalizedTime, formatNumber, formatHoursFormatted } from '../../utils/formatters';

const QUICK_MINUTES = [5, 15, 25, 45, 60];

// Module-level AudioContext reused across chimes. Creating a fresh context per
// completion leaked the contexts (browser caps ~6) and silently disabled the
// chime after a few sessions. One lazy context is resumed before each play and
// closed on the final note; if a new chime starts while one is playing we reuse
// the open context so the nodes just stack briefly.
let sharedAudioCtx: AudioContext | null = null;
function getChimeContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      sharedAudioCtx = new Ctor();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export const StudyTimerCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  const [timerState, setTimerState] = useState<TimerStateDTO>({
    mode: 'pomodoro',
    status: 'paused',
    remainingSeconds: 25 * 60,
    elapsedSeconds: 0,
    targetDurationSeconds: 25 * 60,
    sessionTitle: '',
    subjectTag: '',
  });

  const [streak, setStreak] = useState<StreakInfo>({ current: 0, best: 0, lastActiveDate: null });

  const [selectedMode, setSelectedMode] = useState<SessionMode>('pomodoro');
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [customTitle, setCustomTitle] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [completedPayload, setCompletedPayload] = useState<SessionCompletedPayload | null>(null);
  const [isStartingBreak, setIsStartingBreak] = useState(false);

  const prevStatusRef = useRef(timerState.status);

  const playCompletionChime = () => {
    const audioCtx = getChimeContext();
    if (!audioCtx) return;
    try {
      // A suspended/interrupted context (autoplay policy) needs an explicit
      // resume before scheduling notes, otherwise the chime stays silent.
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const now = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.3); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.6); // G5

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 1.2);
      // Release the oscillator/gain nodes once the chime is done so the graph
      // stays small across many sessions. The shared context itself is kept.
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* already disconnected */
        }
      };
    } catch (err) {
      console.error('[StudyTimerCard] Audio chime error:', err);
    }
  };

  const refreshStreak = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.getStreak().then(setStreak).catch(() => {});
    }
  };

  useEffect(() => {
    if (!window.focusStudyAPI) return;

    // Fetch the true initial state from the main process (session may already be running).
    window.focusStudyAPI.getTimerState().then((state) => {
      setTimerState(state);
      prevStatusRef.current = state.status;
      if (state.sessionTitle) setCustomTitle(state.sessionTitle);
      if (state.subjectTag) setCustomSubject(state.subjectTag);
    });

    refreshStreak();

    const unsubscribe = window.focusStudyAPI.onTimerTick((state) => {
      if (prevStatusRef.current === 'running' && state.status === 'completed') {
        playCompletionChime();
      }
      prevStatusRef.current = state.status;
      setTimerState(state);
    });

    const unsubCompleted = window.focusStudyAPI.onSessionCompleted((payload) => {
      setCompletedPayload(payload);
      refreshStreak();
    });

    return () => {
      unsubscribe();
      unsubCompleted();
    };
  }, []);

  const handleModeChange = (mode: SessionMode, mins: number) => {
    if (timerState.status === 'running') return;
    setSelectedMode(mode);
    setSelectedMinutes(mins);
  };

  const handleStart = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.startTimer(selectedMode, selectedMinutes, customTitle || undefined, customSubject || undefined);
    }
  };

  const handlePause = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.pauseTimer();
    }
  };

  const handleConfirmReset = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.resetTimer();
    }
    setIsResetConfirmOpen(false);
  };

  const handleStartBreak = (minutes: number) => {
    if (!window.focusStudyAPI) return;
    setIsStartingBreak(true);
    window.focusStudyAPI
      .startTimer('custom', minutes, t('timer.breakSession'), t('timer.breakTag'))
      .catch(() => {})
      .finally(() => setIsStartingBreak(false));
    setCompletedPayload(null);
  };

  const progressPercent = timerState.mode === 'stopwatch'
    ? 100
    : Math.min(
        100,
        Math.round(((timerState.targetDurationSeconds - timerState.remainingSeconds) / Math.max(1, timerState.targetDurationSeconds)) * 100)
      );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
      {/* Background Subtle Ambient Glow */}
      <div className="absolute -right-12 -top-12 rtl:-left-12 rtl:right-auto w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div>
        {/* Mode Selector Tabs (when paused) */}
        {timerState.status === 'paused' && (
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => handleModeChange('pomodoro', 25)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  selectedMode === 'pomodoro' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t('timer.pomodoro')} (25m)
              </button>
              <button
                onClick={() => handleModeChange('custom', 25)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  selectedMode === 'custom' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t('timer.custom')}
              </button>
              <button
                onClick={() => handleModeChange('stopwatch', 60)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  selectedMode === 'stopwatch' ? 'bg-emerald-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t('timer.stopwatch')}
              </button>
            </div>

            {selectedMode === 'custom' && (
              <div className="flex items-center justify-center gap-2">
                {QUICK_MINUTES.map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedMinutes(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                      selectedMinutes === m
                        ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {formatNumber(m, currentLang)}m
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Session Meta Headers */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/20 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              <span>{timerState.subjectTag || t('common.general')}</span>
            </span>
            <span className="px-2.5 py-1 bg-slate-800 text-slate-400 text-xs font-medium rounded-full uppercase tracking-wider">
              {timerState.mode}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold bg-amber-400/10 px-2.5 py-1 rounded-full border border-amber-400/20" title={t('timer.bestStreak', { count: formatNumber(streak.best, currentLang) })}>
            <Flame className="w-3.5 h-3.5 fill-amber-400" />
            <span>{t('timer.streakText', { count: formatNumber(streak.current, currentLang) })}</span>
          </div>
        </div>

        {/* Title Input when paused */}
        {timerState.status === 'paused' && (
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('timer.sessionTitleLabel')}</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                maxLength={80}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('timer.subjectTagLabel')}</label>
              <input
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                maxLength={40}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        )}

        {/* Timer Main Display */}
        <div className="text-center my-6">
          <div className="text-6xl font-black tracking-tight text-white font-mono drop-shadow-md">
            {formatLocalizedTime(timerState.mode === 'stopwatch' ? timerState.elapsedSeconds : timerState.remainingSeconds, currentLang)}
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {timerState.status === 'running'
              ? t('timer.inProgressText', { title: timerState.sessionTitle || t('timer.focusSession') })
              : t('timer.readyText')}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden mb-6 border border-slate-800">
          <div
            className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-500 ease-out rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-center gap-4">
        {timerState.status !== 'running' ? (
          <button
            onClick={handleStart}
            disabled={selectedMinutes < 1}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-slate-950 rtl:rotate-180" />
            <span>{timerState.status === 'paused' && timerState.activeSessionId ? t('timer.resumeSession') : t('timer.startSession')}</span>
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 text-sm"
          >
            <Pause className="w-4 h-4 fill-slate-950" />
            <span>{t('timer.pauseSession')}</span>
          </button>
        )}

        <button
          onClick={() => setIsResetConfirmOpen(true)}
          className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all border border-slate-700"
          title={t('timer.resetTimer')}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Reset Confirmation Modal */}
      {isResetConfirmOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>{t('timer.resetTitle')}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {t('timer.resetDescription')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-3.5 py-1.5 bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmReset}
                className="px-4 py-1.5 bg-rose-500 text-white rounded-lg text-xs font-bold shadow-md shadow-rose-500/20"
              >
                {t('timer.confirmReset')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Completed Summary Modal */}
      {completedPayload && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/20 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-fadeIn">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">{t('timer.sessionCompleteTitle')}</h3>
                <p className="text-[11px] text-slate-400">{t('timer.sessionCompleteSubtitle', { subject: completedPayload.subjectTag })}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                <Target className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">{formatNumber(completedPayload.focusScore, currentLang)}</div>
                <div className="text-[10px] text-slate-400">{t('analytics.dailyScore')}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                <Clock className="w-4 h-4 text-teal-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">{formatNumber(completedPayload.durationMinutes, currentLang)}m</div>
                <div className="text-[10px] text-slate-400">{t('timer.sessionDuration')}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                <Zap className="w-4 h-4 text-rose-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">{formatHoursFormatted(completedPayload.distractingSeconds, currentLang)}</div>
                <div className="text-[10px] text-slate-400">{t('analytics.distractionTime')}</div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setCompletedPayload(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
              >
                {t('common.close')}
              </button>
              <button
                onClick={() => handleStartBreak(5)}
                disabled={isStartingBreak}
                className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-teal-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Coffee className="w-4 h-4" />
                {t('timer.startBreak')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};