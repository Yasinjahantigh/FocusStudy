import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, RotateCcw, Maximize2, Minimize2, CheckSquare, Square, Volume2, VolumeX, Minus } from 'lucide-react';
import { TimerStateDTO, ActiveAppInfo, Language, WeeklyStudyBlock, StudyBlockTask } from '../../../shared/types';
import { formatLocalizedTime } from '../../utils/formatters';
import { setDocumentDirection } from '../../i18n';
import { soundEngineSingleton } from '../../services/SoundEngine';

export const MiniWidget: React.FC = () => {
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

  const [activeApp, setActiveApp] = useState<ActiveAppInfo | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Active Block Tasks State for Mini-Widget HUD (real persisted active block).
  const [activeTask, setActiveTask] = useState<StudyBlockTask | null>(null);
  const [activeBlock, setActiveBlock] = useState<WeeklyStudyBlock | null>(null);

  const mutedRef = useRef(false);

  const findFirstPendingTask = (block: WeeklyStudyBlock | null): StudyBlockTask | null => {
    if (!block) return null;
    return block.tasks.find((task) => !task.completed) || block.tasks[0] || null;
  };

  const loadActiveBlock = () => {
    if (!window.focusStudyAPI) return;
    window.focusStudyAPI
      .getActiveBlockId()
      .then((id) => {
        if (!id) return null;
        return window.focusStudyAPI.getWeeklyBlocks().then((blocks) => {
          // Resolve the persisted active block by its id, not by array position —
          // blocks[0] returned an arbitrary block when the active one wasn't first.
          if (blocks && blocks.length > 0) {
            return blocks.find((b) => b.id === id) || null;
          }
          return null;
        });
      })
      .then((block) => {
        if (block) {
          setActiveBlock(block);
          setActiveTask(findFirstPendingTask(block));
        } else {
          setActiveBlock(null);
          setActiveTask(null);
        }
      })
      .catch(() => {
        setActiveBlock(null);
        setActiveTask(null);
      });
  };

  useEffect(() => {
    if (!window.focusStudyAPI) return;

    window.focusStudyAPI.getLanguage().then((lang) => {
      if (lang) {
        i18n.changeLanguage(lang);
        setDocumentDirection(lang as Language);
      }
    });

    window.focusStudyAPI.getTimerState().then(setTimerState);

    window.focusStudyAPI.getAudioSettings().then((settings) => {
      const muted = settings.masterMuted;
      mutedRef.current = muted;
      setIsMuted(muted);
      soundEngineSingleton.setMasterVolume(muted ? 0 : 1);
    });

    const unsubLang = window.focusStudyAPI.onLanguageChanged((lang) => {
      i18n.changeLanguage(lang);
      setDocumentDirection(lang as Language);
    });

    const unsubTimer = window.focusStudyAPI.onTimerTick(setTimerState);
    const unsubApp = window.focusStudyAPI.onActiveAppChanged(setActiveApp);

    loadActiveBlock();
    const unsubPlanner = window.focusStudyAPI.onPlannerUpdated(loadActiveBlock);

    const unsubMuted = window.focusStudyAPI.onMasterMuted((muted) => {
      mutedRef.current = muted;
      setIsMuted(muted);
      soundEngineSingleton.setMasterVolume(muted ? 0 : 1);
    });

    return () => {
      unsubLang();
      unsubTimer();
      unsubApp();
      unsubPlanner();
      unsubMuted();
    };
  }, [i18n]);

  const handleToggleExpand = async () => {
    if (window.focusStudyAPI) {
      const expanded = await window.focusStudyAPI.toggleWidgetExpand();
      setIsExpanded(expanded);
    }
  };

  const handleToggleMute = () => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    soundEngineSingleton.setMasterVolume(nextMuted ? 0 : 1);
    if (window.focusStudyAPI) {
      window.focusStudyAPI.setMasterMuted(nextMuted);
    }
  };

  const handleToggleTask = async () => {
    if (activeBlock && activeTask && window.focusStudyAPI) {
      await window.focusStudyAPI.toggleTaskCompleted(activeBlock.id, activeTask.id);
      const updated = { ...activeTask, completed: !activeTask.completed };
      setActiveTask(updated);
      if (updated.completed) {
        const nextPending = activeBlock.tasks.filter(task => task.id !== activeTask.id).find(task => !task.completed);
        if (nextPending) setActiveTask(nextPending);
      }
    }
  };

  const displaySeconds = timerState.mode === 'stopwatch' ? timerState.elapsedSeconds : timerState.remainingSeconds;
  const progressPercent =
    timerState.mode === 'stopwatch'
      ? 100
      : Math.min(
          100,
          Math.round(((timerState.targetDurationSeconds - timerState.remainingSeconds) / Math.max(1, timerState.targetDurationSeconds)) * 100)
        );

  return (
    <div className="w-full h-full bg-slate-950/90 backdrop-blur-2xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col justify-between select-none text-slate-100 font-sans">
      {/* Draggable Top Bar HUD */}
      <div className="drag-region bg-slate-900/90 px-3 py-2 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-2 no-drag-region">
          {/* Circular Pulse Status */}
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              timerState.status === 'running' ? 'bg-emerald-500 animate-ping' : 'bg-amber-400'
            }`}
          />
          <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider">
            {formatLocalizedTime(displaySeconds, currentLang)}
          </span>
        </div>

        <div className="text-[10px] text-slate-300 font-semibold truncate max-w-[110px] bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
          {activeApp?.appName || t('common.appName')}
        </div>

        <div className="flex items-center gap-1 no-drag-region">
          <button
            onClick={handleToggleMute}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
            title={isMuted ? t('widget.unmute') : t('widget.mute')}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
          </button>

          <button
            onClick={() => window.focusStudyAPI.minimizeWidget()}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
            title={t('widget.minimize')}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleToggleExpand}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Progress Bar (Always Visible Header Strip) */}
      <div className="w-full bg-slate-900 h-1 overflow-hidden">
        <div
          className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Expanded HUD Controls & Active To-Do Checklist Item */}
      {isExpanded && (
        <div className="p-3 space-y-3 no-drag-region bg-slate-900/60 flex-1 flex flex-col justify-between">
          {/* Active Session Title & Subject Tag */}
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded-md border border-emerald-500/20 truncate max-w-[90px]">
              {timerState.subjectTag || t('common.general')}
            </span>
            <span className="text-[11px] font-bold text-slate-200 truncate max-w-[160px]">
              {timerState.sessionTitle || t('widget.focusSession')}
            </span>
          </div>

          {/* Current Active Task Checklist HUD */}
          {activeTask ? (
            <div
              onClick={handleToggleTask}
              className={`p-2 rounded-xl border text-[11px] flex items-center gap-2 cursor-pointer transition-all ${
                activeTask.completed
                  ? 'bg-slate-950/60 border-slate-800/80 text-slate-500 line-through'
                  : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              {activeTask.completed ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="truncate">{activeTask.text}</span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 text-center py-1 font-mono">{t('widget.noActiveTask')}</div>
          )}

          {/* Transport Controls */}
          <div className="flex items-center justify-center gap-3">
            {timerState.status !== 'running' ? (
              <button
                onClick={() => window.focusStudyAPI.startTimer('pomodoro', 25)}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-slate-950 rtl:rotate-180" />
                <span>{t('timer.startSession')}</span>
              </button>
            ) : (
              <button
                onClick={() => window.focusStudyAPI.pauseTimer()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-extrabold text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5"
              >
                <Pause className="w-3.5 h-3.5 fill-slate-950" />
                <span>{t('timer.pauseSession')}</span>
              </button>
            )}

            <button
              onClick={() => window.focusStudyAPI.resetTimer()}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all border border-slate-700"
              title={t('timer.resetTimer')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};