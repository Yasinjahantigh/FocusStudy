import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StudyTimerCard } from './components/timer/StudyTimerCard';
import { ActiveAppTrackerCard } from './components/tracker/ActiveAppTrackerCard';
import { AmbientSoundCard } from './components/audio/AmbientSoundCard';
import { AnalyticsDashboard } from './components/dashboard/AnalyticsDashboard';
import { ScratchpadModal } from './components/scratchpad/ScratchpadModal';
import { LanguageSwitcher } from './components/settings/LanguageSwitcher';
import { WeeklyPlannerView } from './components/planner/WeeklyPlannerView';
import { ActiveBlockExecutionCard } from './components/planner/ActiveBlockExecutionCard';
import { WorkspaceAuditModal } from './components/planner/WorkspaceAuditModal';
import { AIExceptionModal } from './components/planner/AIExceptionModal';
import { AISettingsView } from './components/settings/AISettingsView';
import { BrowserBridgeView } from './components/settings/BrowserBridgeView';
import { LayoutDashboard, Timer, Brain, Sparkles, Calendar, Settings } from 'lucide-react';
import { setDocumentDirection } from './i18n';
import { Language, WeeklyStudyBlock, EnvironmentAuditItem } from '../shared/types';
import './index.css';

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<'timer' | 'planner' | 'analytics' | 'settings'>('timer');
  const [isScratchpadOpen, setIsScratchpadOpen] = useState(false);

  // Active Executing Block & Workspace Audit State
  const [activeBlock, setActiveBlock] = useState<WeeklyStudyBlock | null>(null);
  const [pendingBlockToStart, setPendingBlockToStart] = useState<WeeklyStudyBlock | null>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditItems, setAuditItems] = useState<EnvironmentAuditItem[]>([]);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // AI Exception Modal State
  const [isAIExceptionOpen, setIsAIExceptionOpen] = useState(false);

  // Temporary AI Exception Pass entries with expiry timestamps
  const [tempAllowedApps, setTempAllowedApps] = useState<{ appName: string; domain?: string; expiresAt: number }[]>([]);
  // Active Timer status state
  const [timerStatus, setTimerStatus] = useState<'running' | 'paused' | 'completed' | 'abandoned'>('paused');

  // ---- Stable refs so IPC listeners are subscribed once and always read live
  // state through refs instead of re-subscribing on every state change. ----
  const tempAllowedRef = useRef(tempAllowedApps);
  useEffect(() => { tempAllowedRef.current = tempAllowedApps; }, [tempAllowedApps]);

  const activeBlockRef = useRef(activeBlock);
  useEffect(() => { activeBlockRef.current = activeBlock; }, [activeBlock]);

  const timerStatusRef = useRef(timerStatus);
  useEffect(() => { timerStatusRef.current = timerStatus; }, [timerStatus]);

  const persistActiveBlock = (block: WeeklyStudyBlock | null) => {
    setActiveBlock(block);
    if (window.focusStudyAPI) {
      window.focusStudyAPI.setActiveBlockId(block ? block.id : null);
    }
  };

  // Restore persisted active block + initial timer state on mount.
  useEffect(() => {
    if (!window.focusStudyAPI) return;

    window.focusStudyAPI.getTimerState().then((state) => {
      setTimerStatus(state.status);
    });

    window.focusStudyAPI
      .getActiveBlockId()
      .then((id) => {
        if (!id) return null;
        return window.focusStudyAPI.getWeeklyBlocks().then((blocks) => {
          // Resolve the persisted active block by id — blocks[0] was arbitrary.
          if (blocks && blocks.length > 0) {
            return blocks.find((b) => b.id === id) || null;
          }
          return null;
        });
      })
      .then((block) => {
        if (block) setActiveBlock(block);
      })
      .catch(() => {
        // no active block persisted
      });
  }, []);

  // Periodically clean up expired temporary AI app passes
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setTempAllowedApps((prev) => prev.filter((item) => item.expiresAt > now));
    }, 5000);
    return () => clearInterval(cleanupInterval);
  }, []);

  useEffect(() => {
    if (!window.focusStudyAPI) return;

    window.focusStudyAPI.getLanguage().then((lang) => {
      if (lang) {
        i18n.changeLanguage(lang);
        setDocumentDirection(lang as Language);
      }
    });

    // Keyboard shortcuts (global within the app window):
    // - Space: toggle timer (pause/resume) when Timer tab is focused
    // - R: reset timer with confirmation when Timer tab is focused
    // - Ctrl+Alt+S: open scratchpad (also registered as global shortcut in main)
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (activeTab === 'timer') {
        if (e.code === 'Space') {
          e.preventDefault();
          if (timerStatusRef.current === 'running') {
            window.focusStudyAPI?.pauseTimer();
          } else if (timerStatusRef.current === 'paused') {
            window.focusStudyAPI?.startTimer('custom', 25); // will use current mode
          }
        } else if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          if (window.confirm(t('timer.resetTitle') + ' ' + t('timer.resetDescription'))) {
            window.focusStudyAPI?.resetTimer();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const unsubLang = window.focusStudyAPI.onLanguageChanged((lang) => {
      i18n.changeLanguage(lang);
      setDocumentDirection(lang as Language);
    });

    const unsubTimer = window.focusStudyAPI.onTimerTick((state) => {
      setTimerStatus(state.status);
    });

    // When a session completes, the active study block is finished too.
    const unsubCompleted = window.focusStudyAPI.onSessionCompleted(() => {
      if (activeBlockRef.current) {
        persistActiveBlock(null);
      }
    });

    return () => {
      unsubLang();
      unsubTimer();
      unsubCompleted();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [i18n]);

  const handleStartBlockInitiated = async (block: WeeklyStudyBlock) => {
    setPendingBlockToStart(block);
    setAuditError(null);
    if (window.focusStudyAPI) {
      setIsAuditLoading(true);
      // Open the modal right away so the user sees the scanning state while
      // the environment audit runs (it can take several seconds).
      setAuditModalOpen(true);
      try {
        const items = await window.focusStudyAPI.auditEnvironment(block.subject, block.allowedApps);
        setAuditItems(items);
        setAuditModalOpen(true);
      } catch (err) {
        console.error('[App] Environment audit failed:', err);
        setAuditError(t('audit.error'));
        setAuditItems([]);
        setAuditModalOpen(true);
      } finally {
        setIsAuditLoading(false);
      }
    } else {
      persistActiveBlock(block);
      setActiveTab('timer');
    }
  };

  const handleRescanAudit = async () => {
    if (!pendingBlockToStart || !window.focusStudyAPI) return;
    setAuditError(null);
    setIsAuditLoading(true);
    try {
      const items = await window.focusStudyAPI.auditEnvironment(pendingBlockToStart.subject, pendingBlockToStart.allowedApps);
      setAuditItems(items);
    } catch (err) {
      console.error('[App] Environment re-audit failed:', err);
      setAuditError(t('audit.error'));
      setAuditItems([]);
    } finally {
      setIsAuditLoading(false);
    }
  };

  const handleConfirmStartBlock = () => {
    if (pendingBlockToStart) {
      persistActiveBlock(pendingBlockToStart);
      if (window.focusStudyAPI) {
        window.focusStudyAPI.startTimer('custom', pendingBlockToStart.durationMinutes, pendingBlockToStart.title, pendingBlockToStart.subject);
      }
      setActiveTab('timer');
    }
  };

  const handleToggleTaskCompleted = async (taskId: string) => {
    if (activeBlock && window.focusStudyAPI) {
      await window.focusStudyAPI.toggleTaskCompleted(activeBlock.id, taskId);
      setActiveBlock({
        ...activeBlock,
        tasks: activeBlock.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t),
      });
    }
  };

  const handleAccessGranted = (appName: string, durationMinutes: number = 15, domain?: string) => {
    const expiresAt = Date.now() + Math.max(1, durationMinutes) * 60 * 1000;
    setTempAllowedApps((prev) => [...prev.filter(a => a.appName !== appName), { appName, domain, expiresAt }]);
    // Mirror the grant into the main-process intervention controller so the
    // during-session lock honors it too.
    window.focusStudyAPI?.grantTemporaryAccess(appName, durationMinutes, domain);
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 border-e border-slate-800 p-4 flex flex-col justify-between select-none">
        <div>
          {/* Logo Header */}
          <div className="flex items-center gap-3 px-2 py-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-5 h-5 text-slate-950 fill-slate-950" />
            </div>
            <div>
              <h1 className="font-black text-base text-white tracking-wide">{t('common.appName')}</h1>
              <p className="text-[10px] text-emerald-400 font-medium tracking-wider uppercase">{t('common.subtitle')}</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('timer')}
              className={`w-full px-3.5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-3 transition-all ${
                activeTab === 'timer'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Timer className="w-4 h-4" />
              <span>{t('nav.studySession')}</span>
            </button>

            <button
              onClick={() => setActiveTab('planner')}
              className={`w-full px-3.5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-3 transition-all ${
                activeTab === 'planner'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-4 h-4 text-teal-400" />
              <span>{t('nav.weeklyPlanner')}</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full px-3.5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-3 transition-all ${
                activeTab === 'analytics'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>{t('nav.analytics')}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full px-3.5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-3 transition-all ${
                activeTab === 'settings'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Settings className="w-4 h-4 text-purple-400" />
              <span>{t('nav.settings')}</span>
            </button>

            <button
              onClick={() => setIsScratchpadOpen(true)}
              className="w-full px-3.5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-3 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-all"
            >
              <Brain className="w-4 h-4 text-purple-400" />
              <span>{t('nav.thoughtDump')}</span>
            </button>
          </nav>
        </div>

        {/* Footer Quick Action & Language Switcher */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <LanguageSwitcher />

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400">
            <span className="text-slate-300 font-semibold block mb-0.5">{t('common.quickThought')}</span>
            {t('common.pressKey')} <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono text-[10px]">Ctrl+Alt+S</kbd>.
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8 bg-slate-950">
        {activeTab === 'timer' ? (
          <div className="space-y-6 max-w-5xl mx-auto">
            {activeBlock && (
              <ActiveBlockExecutionCard
                block={activeBlock}
                onToggleTask={handleToggleTaskCompleted}
                onRequestAIException={() => setIsAIExceptionOpen(true)}
              />
            )}
            <StudyTimerCard />
            <div className="grid grid-cols-2 gap-6">
              <ActiveAppTrackerCard />
              <AmbientSoundCard />
            </div>
          </div>
        ) : activeTab === 'planner' ? (
          <div className="max-w-5xl mx-auto">
            <WeeklyPlannerView
              onStartBlock={handleStartBlockInitiated}
              activeBlockId={activeBlock?.id || null}
              onActiveBlockChange={persistActiveBlock}
            />
          </div>
        ) : activeTab === 'analytics' ? (
          <div className="max-w-5xl mx-auto">
            <AnalyticsDashboard />
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-6">
            <AISettingsView />
            <BrowserBridgeView />
          </div>
        )}
      </main>

      {/* Scratchpad Modal */}
      <ScratchpadModal isOpen={isScratchpadOpen} onClose={() => setIsScratchpadOpen(false)} />

      {/* Pre-session AI Environment Audit Modal */}
      <WorkspaceAuditModal
        isOpen={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        auditItems={auditItems}
        isLoading={isAuditLoading}
        errorMessage={auditError}
        onConfirmStart={handleConfirmStartBlock}
        onRescan={handleRescanAudit}
        subjectName={pendingBlockToStart?.subject || ''}
        blockTitle={pendingBlockToStart?.title || ''}
      />

      {/* AI Exception Modal */}
      <AIExceptionModal
        isOpen={isAIExceptionOpen}
        onClose={() => setIsAIExceptionOpen(false)}
        appName={activeBlock?.title || t('common.requestedTool')}
        subject={activeBlock?.subject || t('common.studyBlock')}
        blockTitle={activeBlock?.title || ''}
        onAccessGranted={handleAccessGranted}
      />
    </div>
  );
};
