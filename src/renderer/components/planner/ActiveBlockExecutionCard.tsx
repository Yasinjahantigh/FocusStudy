import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CheckSquare, Square, Wrench, Brain } from 'lucide-react';
import { WeeklyStudyBlock, Language } from '../../../shared/types';
import { formatNumber } from '../../utils/formatters';

interface ActiveBlockExecutionCardProps {
  block: WeeklyStudyBlock | null;
  onToggleTask: (taskId: string) => void;
  onRequestAIException: () => void;
}

export const ActiveBlockExecutionCard: React.FC<ActiveBlockExecutionCardProps> = ({
  block,
  onToggleTask,
  onRequestAIException,
}) => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  if (!block) return null;

  const completedCount = block.tasks.filter((t) => t.completed).length;
  const progressPercent =
    block.tasks.length > 0 ? Math.round((completedCount / block.tasks.length) * 100) : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Block Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/20 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5" />
            <span>{block.subject}</span>
          </span>
          <span className="text-xs text-slate-300 font-bold">{block.title}</span>
        </div>

        <button
          onClick={onRequestAIException}
          className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-all"
        >
          <Brain className="w-3.5 h-3.5 text-purple-400" />
          <span>{t('aiException.title')}</span>
        </button>
      </div>

      {/* Task Checklist */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
          <span className="flex items-center gap-1">
            <CheckSquare className="w-3.5 h-3.5 text-teal-400" />
            <span>
              {t('planner.todoChecklist')} ({formatNumber(completedCount, currentLang)}/
              {formatNumber(block.tasks.length, currentLang)})
            </span>
          </span>
          <span className="font-mono text-teal-400">{formatNumber(progressPercent, currentLang)}%</span>
        </div>

        <div className="space-y-1.5 max-h-40 overflow-y-auto pe-1">
          {block.tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onToggleTask(task.id)}
              className={`p-2.5 rounded-xl border text-xs flex items-center gap-2.5 cursor-pointer transition-all ${
                task.completed
                  ? 'bg-slate-950/40 border-slate-800/60 text-slate-500 line-through'
                  : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              {task.completed ? (
                <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-slate-500 shrink-0" />
              )}
              <span>{task.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Allowed Tools */}
      {block.allowedApps && block.allowedApps.length > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-slate-400 text-[11px] font-medium">{t('planner.allowedTools')}:</span>
          <div className="flex flex-wrap gap-1">
            {block.allowedApps.map((tool, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 bg-slate-950 text-amber-300 font-mono text-[10px] rounded-md border border-slate-800"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
