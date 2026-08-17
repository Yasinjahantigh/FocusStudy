import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, AlertTriangle, CheckCircle2, Moon, Globe } from 'lucide-react';
import { ActiveAppInfo, DistractionAlertDTO } from '../../../shared/types';
import { formatNumber } from '../../utils/formatters';

export const ActiveAppTrackerCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language === 'fa' ? 'fa' : 'en';
  const [activeApp, setActiveApp] = useState<ActiveAppInfo | null>(null);
  const [distractionAlert, setDistractionAlert] = useState<DistractionAlertDTO | null>(null);

  useEffect(() => {
    if (!window.focusStudyAPI) return;

    window.focusStudyAPI.getCurrentActiveApp().then(setActiveApp);

    const unsubApp = window.focusStudyAPI.onActiveAppChanged((app) => {
      setActiveApp(app);
    });

    const unsubAlert = window.focusStudyAPI.onDistractionAlert((alert) => {
      setDistractionAlert(alert);
      setTimeout(() => setDistractionAlert(null), 10000);
    });

    return () => {
      unsubApp();
      unsubAlert();
    };
  }, []);

  const getCategoryBadge = (type?: string) => {
    switch (type) {
      case 'productive':
        return (
          <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>{t('categories.productive')}</span>
          </span>
        );
      case 'distracting':
        return (
          <span className="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            <span>{t('categories.distracting')}</span>
          </span>
        );
      case 'idle':
        return (
          <span className="px-2.5 py-1 bg-slate-500/10 text-slate-400 border border-slate-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
            <Moon className="w-3 h-3" />
            <span>{t('categories.idle')}</span>
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 bg-slate-800 text-slate-400 text-xs font-medium rounded-full">
            {t('categories.neutral')}
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold">
            <Monitor className="w-4 h-4 text-emerald-400" />
            <span>{t('tracker.activeActivity')}</span>
          </div>
          {getCategoryBadge(activeApp?.category?.type)}
        </div>

        {activeApp ? (
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 mt-2">
            <div className="font-semibold text-slate-100 text-sm truncate">
              {activeApp.appName}
            </div>
            <div className="text-xs text-slate-400 truncate mt-1">
              {activeApp.title || t('tracker.noTitle')}
            </div>
            {activeApp.domain && (
              <div className="flex items-center gap-1 text-xs text-teal-400 mt-1.5 font-mono">
                <Globe className="w-3 h-3" />
                <span>{activeApp.domain}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-slate-500 space-y-2">
            <Monitor className="w-6 h-6 text-slate-700 mx-auto" />
            <span>{t('tracker.polling')}</span>
            <span className="text-[10px] opacity-60 block">
              {t('tracker.emptyHint')}
            </span>
          </div>
        )}
      </div>

      {distractionAlert && (
        <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300 animate-pulse">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">{t('tracker.distractionNudge')}</span>{' '}
            {t('tracker.nudgeMessage', {
              minutes: formatNumber(Math.floor(distractionAlert.distractionSeconds / 60), currentLang),
              appName: distractionAlert.appName
            })}
          </div>
        </div>
      )}
    </div>
  );
};
