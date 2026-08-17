import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { DailySummaryDTO, AnalyticsRangeDTO, Language, StreakInfo, CategoryType } from '../../../shared/types';
import { Trophy, Clock, Target, Zap, Calendar as CalendarIcon, Flame, BookOpen, Layers, Download, FileText } from 'lucide-react';
import { formatNumber, formatHoursFormatted } from '../../utils/formatters';

type RangeMode = 'today' | 'week' | 'month';

const RecentSessionsList: React.FC<{ currentLang: Language; t: (key: string, params?: Record<string, string | number>) => string }> = ({
  currentLang,
  t,
}) => {
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (!window.focusStudyAPI) return;
    window.focusStudyAPI.getRecentSessions(15).then(setSessions).catch(() => setSessions([]));
  }, []);

  if (sessions.length === 0) {
    return <div className="py-8 text-center text-xs text-slate-500 font-mono">{t('analytics.noData')}</div>;
  }

  return (
    <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
      {sessions.map((session) => (
        <div
          key={session.id}
          className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-2 transition-all hover:border-slate-700"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-semibold truncate max-w-[200px]">{session.title || t('widget.focusSession')}</span>
            <span className="text-slate-500 font-mono whitespace-nowrap">
              {formatNumber(new Date(session.startTime).getDate(), currentLang)}/
              {formatNumber(new Date(session.startTime).getMonth() + 1, currentLang)}/
              {formatNumber(new Date(session.startTime).getFullYear().toString().slice(-2), currentLang)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-[10px]">
            <div className="flex items-center gap-1 text-slate-400">
              <BookOpen className="w-3 h-3" />
              <span className="truncate max-w-[100px]">{session.subjectTag || t('common.general')}</span>
            </div>
            <div className={`flex items-center gap-1 font-mono ${
              session.status === 'completed' ? 'text-emerald-400' :
              session.status === 'abandoned' ? 'text-rose-400' :
              'text-amber-400'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span>{t(`timer.${session.status}` || session.status)}</span>
            </div>
            <div className="flex items-center gap-1 text-teal-400 font-mono">
              <Zap className="w-2.5 h-2.5" />
              <span>{session.focusScore}%</span>
            </div>
            <div className="flex items-center gap-1 text-slate-400 font-mono ml-auto">
              <Clock className="w-2.5 h-2.5" />
              <span>{formatHoursFormatted(session.actualDurationSeconds, currentLang)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const COLORS: Record<CategoryType, string> = {
  productive: '#10B981',
  distracting: '#EF4444',
  neutral: '#64748B',
  idle: '#94A3B8',
};

function daysAgoKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const AnalyticsDashboard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  const [rangeMode, setRangeMode] = useState<RangeMode>('today');
  const [daily, setDaily] = useState<DailySummaryDTO | null>(null);
  const [range, setRange] = useState<AnalyticsRangeDTO | null>(null);
  const [streak, setStreak] = useState<StreakInfo>({ current: 0, best: 0, lastActiveDate: null });
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(() => {
    if (!window.focusStudyAPI) return;
    setIsLoading(true);

    window.focusStudyAPI.getStreak().then(setStreak).catch(() => {});

    if (rangeMode === 'today') {
      const today = daysAgoKey(0);
      window.focusStudyAPI
        .getDailySummary(today)
        .then(setDaily)
        .catch(() => setDaily(null))
        .finally(() => setIsLoading(false));
    } else {
      const end = daysAgoKey(0);
      const start = daysAgoKey(rangeMode === 'week' ? 6 : 29);
      window.focusStudyAPI
        .getAnalyticsRange(start, end)
        .then(setRange)
        .catch(() => setRange(null))
        .finally(() => setIsLoading(false));
    }
  }, [rangeMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live refresh: re-fetch when a session completes, when the window regains
  // focus, and every 30 seconds while the dashboard is mounted.
  useEffect(() => {
    if (!window.focusStudyAPI) return;
    const unsubCompleted = window.focusStudyAPI.onSessionCompleted(fetchData);
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(fetchData, 30_000);
    return () => {
      unsubCompleted();
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [fetchData]);

  const handleExportJson = async () => {
    if (!window.focusStudyAPI) return;
    try {
      const data = await window.focusStudyAPI.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `focusstudy-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[AnalyticsDashboard] JSON export failed:', err);
    }
  };

  const handleExportCsv = async () => {
    if (!window.focusStudyAPI) return;
    try {
      const result = await window.focusStudyAPI.exportCsv();
      if (result.success) {
        // Success notification could be shown via toast
      }
    } catch (err) {
      console.error('[AnalyticsDashboard] CSV export failed:', err);
    }
  };

  const stats = rangeMode === 'today'
    ? {
        focusScore: daily?.averageFocusScore || 0,
        studySeconds: daily?.totalStudySeconds || 0,
        completedSessions: daily?.completedSessionsCount || 0,
        distractionSeconds: daily?.distractingSeconds || 0,
        hourlyActivity: daily?.hourlyActivity || [],
        appBreakdown: daily?.appBreakdown || [],
        productive: daily?.productiveSeconds || 0,
        distracting: daily?.distractingSeconds || 0,
        neutral: daily?.neutralSeconds || 0,
        idle: daily?.idleSeconds || 0,
      }
    : {
        focusScore: range?.overallFocusScore || 0,
        studySeconds: range?.totalStudySeconds || 0,
        completedSessions: range?.completedSessionsCount || 0,
        distractionSeconds: range?.distractingSeconds || 0,
        hourlyActivity: (range?.summaries || []).map(s => ({
          hour: Number(s.date.slice(8, 10)),
          productive: s.productiveSeconds,
          distracting: s.distractingSeconds,
          neutral: s.neutralSeconds,
          idle: s.idleSeconds,
          date: s.date,
        })),
        appBreakdown: range?.topApps || [],
        productive: range?.productiveSeconds || 0,
        distracting: range?.distractingSeconds || 0,
        neutral: range?.neutralSeconds || 0,
        idle: range?.idleSeconds || 0,
      };

  const categoryPieData = [
    { name: t('categories.productive'), value: stats.productive, color: COLORS.productive },
    { name: t('categories.distracting'), value: stats.distracting, color: COLORS.distracting },
    { name: t('categories.neutral'), value: stats.neutral, color: COLORS.neutral },
    { name: t('categories.idle'), value: stats.idle, color: COLORS.idle },
  ].filter(item => item.value > 0);

  const subjectData = (range?.subjectDistribution || []).slice(0, 6);
  const maxSubjectSeconds = subjectData.length > 0 ? subjectData[0].durationSeconds : 0;
  const maxAppSeconds = stats.appBreakdown.length > 0 ? stats.appBreakdown[0].durationSeconds : 0;

  const rangeLabel = rangeMode === 'today'
    ? daysAgoKey(0)
    : `${daysAgoKey(rangeMode === 'week' ? 6 : 29)} — ${daysAgoKey(0)}`;

  return (
    <div className="space-y-6">
      {/* Header: Range Filter + Streak Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-2 text-slate-300 font-bold text-xs">
          <CalendarIcon className="w-4 h-4 text-emerald-400" />
          <span>{t('analytics.rangeLabel', { range: rangeLabel })}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setRangeMode('today')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              rangeMode === 'today'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('analytics.today')}
          </button>
          <button
            onClick={() => setRangeMode('week')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              rangeMode === 'week'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('analytics.last7Days')}
          </button>
          <button
            onClick={() => setRangeMode('month')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              rangeMode === 'month'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('analytics.last30Days')}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportJson}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border bg-slate-950 border-slate-800 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all flex items-center gap-1"
            title={t('analytics.exportJson')}
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('analytics.exportJson')}</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border bg-slate-950 border-slate-800 text-slate-400 hover:text-teal-400 hover:border-teal-500/30 transition-all flex items-center gap-1"
            title={t('analytics.exportCsv')}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('analytics.exportCsv')}</span>
          </button>
        </div>
      </div>

      {/* Streak Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/15 text-amber-400 rounded-xl">
            <Flame className="w-5 h-5 fill-amber-400" />
          </div>
          <div>
            <div className="text-xs text-amber-300 font-semibold">{t('analytics.currentStreak')}</div>
            <div className="text-lg font-black text-white">
              {formatNumber(streak.current, currentLang)} {t('analytics.daysUnit')}
            </div>
          </div>
        </div>
        <div className="text-end">
          <div className="text-xs text-slate-400 font-medium">{t('analytics.bestStreak')}</div>
          <div className="text-lg font-black text-amber-300">{formatNumber(streak.best, currentLang)} {t('analytics.daysUnit')}</div>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">{t('analytics.dailyScore')}</div>
            <div className="text-xl font-bold text-slate-100">
              {formatNumber(stats.focusScore, currentLang)} / {formatNumber(100, currentLang)}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 text-teal-400 rounded-xl">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">{t('analytics.productiveStudy')}</div>
            <div className="text-xl font-bold text-slate-100">
              {formatHoursFormatted(stats.studySeconds, currentLang)}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-slate-500/10 text-slate-300 rounded-xl">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">{t('analytics.sessionsCompleted')}</div>
            <div className="text-xl font-bold text-slate-100">
              {t('analytics.sessionsCount', { count: formatNumber(stats.completedSessions, currentLang) })}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-3">
          <div className="p-3 bg-rose-500/10 text-rose-400 rounded-xl">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">{t('analytics.distractionTime')}</div>
            <div className="text-xl font-bold text-slate-100">
              {t('analytics.minutes', { count: formatNumber(Math.round(stats.distractionSeconds / 60), currentLang) })}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Activity Chart (hourly for a day, per-day for ranges) */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">
            {rangeMode === 'today' ? t('analytics.hourlyBreakdown') : t('analytics.dailyBreakdown')}
          </h3>
          {isLoading && stats.hourlyActivity.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500 font-mono">{t('analytics.loading')}</div>
          ) : stats.hourlyActivity.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.hourlyActivity}>
                  <XAxis
                    dataKey="hour"
                    stroke="#64748b"
                    fontSize={10}
                    tickFormatter={(h) => (rangeMode === 'today' ? `${formatNumber(h, currentLang)}:00` : formatNumber(h, currentLang))}
                  />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="productive" stackId="a" fill={COLORS.productive} name={t('categories.productive')} />
                  <Bar dataKey="neutral" stackId="a" fill={COLORS.neutral} name={t('categories.neutral')} />
                  <Bar dataKey="distracting" stackId="a" fill={COLORS.distracting} name={t('categories.distracting')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500 font-mono">
              {t('analytics.noData')}
            </div>
          )}
        </div>

        {/* Category Pie Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            {t('analytics.usageCategories')}
          </h3>
          <div className="h-48 relative">
            {categoryPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryPieData} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={4}>
                    {categoryPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
                {t('analytics.noData')}
              </div>
            )}
          </div>
          <div className="space-y-1.5 pt-2 border-t border-slate-800">
            {categoryPieData.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-slate-400">{c.name}</span>
                </div>
                <span className="font-bold text-slate-200">{formatHoursFormatted(c.value, currentLang)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Subject Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-teal-400" />
            {t('analytics.subjectDistribution')}
          </h3>
          {subjectData.length > 0 ? (
            <div className="space-y-3">
              {subjectData.map((s) => (
                <div key={s.subject}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 font-semibold truncate">{s.subject}</span>
                    <span className="font-mono text-teal-400 font-bold">{formatHoursFormatted(s.durationSeconds, currentLang)}</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                    <div
                      className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full rounded-full"
                      style={{ width: `${maxSubjectSeconds > 0 ? Math.round((s.durationSeconds / maxSubjectSeconds) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">{t('analytics.noData')}</div>
          )}
        </div>

        {/* Top Apps */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            {t('analytics.topApps')}
          </h3>
          {stats.appBreakdown.length > 0 ? (
            <div className="space-y-3">
              {stats.appBreakdown.slice(0, 6).map((app) => (
                <div key={`${app.appName}-${app.type}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 font-semibold truncate font-mono">{app.appName}</span>
                    <span
                      className="px-2 py-0.5 text-[10px] font-semibold rounded-full"
                      style={{
                        backgroundColor: `${COLORS[app.type] || COLORS.neutral}20`,
                        color: COLORS[app.type] || COLORS.neutral,
                        border: `1px solid ${COLORS[app.type] || COLORS.neutral}40`,
                      }}
                    >
                      {t(`categories.${app.type}`)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${maxAppSeconds > 0 ? Math.round((app.durationSeconds / maxAppSeconds) * 100) : 0}%`,
                          backgroundColor: COLORS[app.type] || COLORS.neutral,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 w-16 text-end">
                      {formatHoursFormatted(app.durationSeconds, currentLang)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">{t('analytics.noData')}</div>
          )}
        </div>
      </div>

      {/* Recent Sessions List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-purple-400" />
          {t('analytics.recentSessions')}
        </h3>
        {isLoading ? (
          <div className="py-8 text-center text-xs text-slate-500 font-mono">{t('analytics.loading')}</div>
        ) : (
          <RecentSessionsList currentLang={currentLang} t={t} />
        )}
      </div>
    </div>
  );
};