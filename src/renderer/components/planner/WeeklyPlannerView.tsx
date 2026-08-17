import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, Trash2, CheckSquare, Square, Wrench, Play, Pencil, RotateCcw } from 'lucide-react';
import { WeeklyStudyBlock, DayOfWeek, Language, StudyBlockTask } from '../../../shared/types';
import { formatNumber } from '../../utils/formatters';

const DAYS: DayOfWeek[] = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

interface WeeklyPlannerViewProps {
  onStartBlock: (block: WeeklyStudyBlock) => void;
  activeBlockId?: string | null;
  onActiveBlockChange?: (block: WeeklyStudyBlock | null) => void;
}

export const WeeklyPlannerView: React.FC<WeeklyPlannerViewProps> = ({
  onStartBlock,
  activeBlockId,
  onActiveBlockChange,
}) => {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('saturday');
  const [blocks, setBlocks] = useState<WeeklyStudyBlock[]>([]);

  // Modal State for adding/editing a block
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Partial<WeeklyStudyBlock> | null>(null);

  const [newTaskInput, setNewTaskInput] = useState('');
  const [newToolInput, setNewToolInput] = useState('');

  const loadBlocks = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.getWeeklyBlocks().then(setBlocks);
    }
  };

  useEffect(() => {
    loadBlocks();
    if (!window.focusStudyAPI) return;
    const unsub = window.focusStudyAPI.onPlannerUpdated(loadBlocks);
    return () => unsub();
  }, []);

  const handleOpenAddModal = () => {
    setEditingBlock({
      dayOfWeek: selectedDay,
      subject: '',
      title: '',
      durationMinutes: 45,
      startTime: '09:00',
      tasks: [],
      allowedApps: ['CalculatorApp', 'Notion.exe'],
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (block: WeeklyStudyBlock) => {
    setEditingBlock({
      ...block,
      tasks: block.tasks.map(task => ({ ...task })),
      allowedApps: [...block.allowedApps],
    });
    setIsModalOpen(true);
  };

  const handleSaveBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBlock?.title?.trim() || !window.focusStudyAPI) return;

    const fullBlock: WeeklyStudyBlock = {
      id: editingBlock.id || 'block_' + Date.now(),
      dayOfWeek: editingBlock.dayOfWeek || selectedDay,
      subject: editingBlock.subject || 'General',
      title: editingBlock.title.trim(),
      durationMinutes: Math.min(300, Math.max(1, Number(editingBlock.durationMinutes) || 45)),
      startTime: editingBlock.startTime || '09:00',
      tasks: editingBlock.tasks || [],
      allowedApps: editingBlock.allowedApps || [],
    };

    await window.focusStudyAPI.saveWeeklyBlock(fullBlock);
    setIsModalOpen(false);
    loadBlocks();
  };

  const handleDeleteBlock = async (id: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.deleteWeeklyBlock(id);
      if (activeBlockId === id && onActiveBlockChange) {
        onActiveBlockChange(null);
      }
      loadBlocks();
    }
  };

  const handleToggleTask = async (blockId: string, taskId: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.toggleTaskCompleted(blockId, taskId);
      loadBlocks();
    }
  };

  const handleResetDayTasks = async (blockId: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.resetDayTasks(blockId);
      loadBlocks();
    }
  };

  const handleStartBlock = (block: WeeklyStudyBlock) => {
    if (onActiveBlockChange) {
      onActiveBlockChange(block);
    }
    onStartBlock(block);
  };

  const handleAddTaskToEditing = () => {
    if (!newTaskInput.trim() || !editingBlock) return;
    const newTask: StudyBlockTask = {
      id: 't_' + Date.now(),
      text: newTaskInput.trim(),
      completed: false,
    };
    setEditingBlock({
      ...editingBlock,
      tasks: [...(editingBlock.tasks || []), newTask],
    });
    setNewTaskInput('');
  };

  const handleRemoveTaskFromEditing = (taskId: string) => {
    if (!editingBlock) return;
    setEditingBlock({
      ...editingBlock,
      tasks: (editingBlock.tasks || []).filter(t => t.id !== taskId),
    });
  };

  const handleAddToolToEditing = () => {
    if (!newToolInput.trim() || !editingBlock) return;
    const tool = newToolInput.trim();
    if (!editingBlock.allowedApps?.includes(tool)) {
      setEditingBlock({
        ...editingBlock,
        allowedApps: [...(editingBlock.allowedApps || []), tool],
      });
    }
    setNewToolInput('');
  };

  const handleRemoveToolFromEditing = (tool: string) => {
    if (!editingBlock) return;
    setEditingBlock({
      ...editingBlock,
      allowedApps: (editingBlock.allowedApps || []).filter(a => a !== tool),
    });
  };

  const currentDayBlocks = blocks
    .filter(b => b.dayOfWeek === selectedDay)
    .sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Calendar className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{t('planner.title')}</h2>
            <p className="text-xs text-slate-400">{t('planner.subtitle')}</p>
          </div>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>{t('planner.addBlock')}</span>
        </button>
      </div>

      {/* Days Tabs (Saturday to Friday) */}
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day) => {
          const dayCount = blocks.filter(b => b.dayOfWeek === day).length;
          const isSelected = selectedDay === day;
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(day)}
              className={`p-3 rounded-xl border text-center transition-all ${
                isSelected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <div className="text-xs font-bold">{t(`planner.days.${day}`)}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-1">
                {formatNumber(dayCount, currentLang)} {t('planner.blocksUnit')}
              </div>
            </button>
          );
        })}
      </div>

      {/* Study Blocks List for Selected Day */}
      <div className="space-y-4">
        {currentDayBlocks.length > 0 ? (
          currentDayBlocks.map((block) => {
            const completedCount = block.tasks.filter(t => t.completed).length;
            const progress = block.tasks.length > 0 ? Math.round((completedCount / block.tasks.length) * 100) : 0;
            const isActive = activeBlockId === block.id;

            return (
              <div
                key={block.id}
                className={`bg-slate-900 border rounded-2xl p-5 shadow-xl space-y-4 transition-all ${
                  isActive ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/20">
                      {block.subject}
                    </span>
                    <h3 className="font-bold text-slate-100 text-sm">{block.title}</h3>
                    {isActive && (
                      <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-bold rounded-full border border-amber-500/30">
                        {t('planner.activeLabel')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">
                      ⏱ {formatNumber(block.durationMinutes, currentLang)} {t('planner.minutesUnit')}
                    </span>

                    <button
                      onClick={() => handleStartBlock(block)}
                      className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all"
                    >
                      <Play className="w-3.5 h-3.5 fill-slate-950 rtl:rotate-180" />
                      <span>{t('planner.startBlock')}</span>
                    </button>

                    <button
                      onClick={() => handleOpenEditModal(block)}
                      className="p-1.5 text-slate-500 hover:text-teal-400 transition-all"
                      title={t('planner.editBlock')}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteBlock(block.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition-all"
                      title={t('planner.deleteBlock')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Checklist Section */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
                    <span className="flex items-center gap-1">
                      <CheckSquare className="w-3.5 h-3.5 text-teal-400" />
                      {t('planner.todoChecklist')} ({formatNumber(completedCount, currentLang)}/{formatNumber(block.tasks.length, currentLang)})
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-teal-400">{formatNumber(progress, currentLang)}%</span>
                      <button
                        onClick={() => handleResetDayTasks(block.id)}
                        className="p-1 text-slate-500 hover:text-amber-400 transition-all"
                        title={t('planner.resetDay')}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {block.tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleToggleTask(block.id, task.id)}
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

                {/* Allowed Tools Section */}
                {block.allowedApps && block.allowedApps.length > 0 && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-slate-400 text-[11px] font-medium">{t('planner.allowedTools')}:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {block.allowedApps.map((tool, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-slate-950 text-amber-300 font-mono text-[10px] rounded-md border border-slate-800">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 text-xs">
            {t('planner.noBlocks')}
          </div>
        )}
      </div>

      {/* Add / Edit Block Modal */}
      {isModalOpen && editingBlock && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-sm">
                {editingBlock.id ? t('planner.editBlock') : t('planner.addBlock')}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1 bg-slate-800 rounded-lg">
                {t('common.close')}
              </button>
            </div>

            <form onSubmit={handleSaveBlock} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{t('planner.blockTitle')}</label>
                <input
                  type="text"
                  required
                  value={editingBlock.title || ''}
                  onChange={(e) => setEditingBlock({ ...editingBlock, title: e.target.value })}
                  placeholder={t('planner.blockTitlePlaceholder')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{t('planner.subject')}</label>
                  <input
                    type="text"
                    required
                    value={editingBlock.subject || ''}
                    onChange={(e) => setEditingBlock({ ...editingBlock, subject: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t('planner.durationMinutes')}</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="300"
                    value={editingBlock.durationMinutes || 45}
                    onChange={(e) => setEditingBlock({ ...editingBlock, durationMinutes: parseInt(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t('planner.startTime')}</label>
                  <input
                    type="time"
                    value={editingBlock.startTime || '09:00'}
                    onChange={(e) => setEditingBlock({ ...editingBlock, startTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t('planner.day')}</label>
                <select
                  value={editingBlock.dayOfWeek || selectedDay}
                  onChange={(e) => setEditingBlock({ ...editingBlock, dayOfWeek: e.target.value as DayOfWeek })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {t(`planner.days.${day}`)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tasks Checklist Inputs */}
              <div>
                <label className="text-slate-400 block mb-1">{t('planner.todoChecklist')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTaskToEditing())}
                    placeholder={t('planner.addTaskPlaceholder')}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button type="button" onClick={handleAddTaskToEditing} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold">
                    +
                  </button>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {(editingBlock.tasks || []).map((task) => (
                    <div key={task.id} className="p-2 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-300">{task.text}</span>
                      <button type="button" onClick={() => handleRemoveTaskFromEditing(task.id)} className="text-rose-400 text-xs px-1">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Allowed Tools Input */}
              <div>
                <label className="text-slate-400 block mb-1">{t('planner.allowedTools')}</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newToolInput}
                    onChange={(e) => setNewToolInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddToolToEditing())}
                    placeholder={t('planner.addToolPlaceholder')}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button type="button" onClick={handleAddToolToEditing} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold">
                    +
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(editingBlock.allowedApps || []).map((tool, idx) => (
                    <span key={idx} className="px-2 py-1 bg-slate-950 text-amber-300 font-mono text-[10px] rounded-lg border border-slate-800 flex items-center gap-1">
                      {tool}
                      <button type="button" onClick={() => handleRemoveToolFromEditing(tool)} className="text-rose-400 hover:text-rose-300">✕</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">
                  {t('common.cancel')}
                </button>
                <button type="submit" className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20">
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};