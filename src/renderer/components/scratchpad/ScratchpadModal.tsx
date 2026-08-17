import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Plus, CheckCircle, Trash2, Pencil, X, Check } from 'lucide-react';
import { ScratchpadNote } from '../../../shared/types';

export const ScratchpadModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [content, setContent] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);

  // Editing state (inline note editing)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingTags, setEditingTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && window.focusStudyAPI) {
      window.focusStudyAPI.getNotes().then(setNotes);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !window.focusStudyAPI || isSaving) return;

    setIsSaving(true);
    try {
      const tags = tagInput.split(/\s+/).filter(tag => tag.startsWith('#'));
      const newNote = await window.focusStudyAPI.saveNote(content, tags);
      setNotes([newNote, ...notes]);
      setContent('');
      setTagInput('');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.toggleNoteProcessed(id);
      setNotes(notes.map(n => n.id === id ? { ...n, isProcessed: !n.isProcessed } : n));
    }
  };

  const handleDelete = async (id: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.deleteNote(id);
      setNotes(notes.filter(n => n.id !== id));
    }
  };

  const startEditing = (note: ScratchpadNote) => {
    setEditingId(note.id);
    setEditingContent(note.content);
    setEditingTags(note.tags.join(' '));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingContent('');
    setEditingTags('');
  };

  const saveEditing = async (note: ScratchpadNote) => {
    if (!window.focusStudyAPI || !editingContent.trim()) return;
    const tags = editingTags.split(/\s+/).filter(tag => tag.startsWith('#'));
    await window.focusStudyAPI.updateNote(note.id, editingContent.trim(), tags);
    setNotes(notes.map(n => n.id === note.id ? { ...n, content: editingContent.trim(), tags } : n));
    cancelEditing();
  };

  const filteredNotes = selectedTagFilter
    ? notes.filter((n) => n.tags && n.tags.includes(selectedTagFilter))
    : notes;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 relative">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-emerald-400 font-bold">
            <Brain className="w-5 h-5" />
            <span>{t('scratchpad.title')}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs font-semibold px-2.5 py-1 bg-slate-800 rounded-lg">
            {t('common.close')}
          </button>
        </div>

        {/* Input form */}
        <form onSubmit={handleSave} className="my-4 space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('scratchpad.placeholder')}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 h-20 resize-none"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder={t('scratchpad.tagsPlaceholder')}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={isSaving || !content.trim()}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              <span>{t('scratchpad.parkThought')}</span>
            </button>
          </div>
        </form>

        {/* Tag Filter Badge bar */}
        {selectedTagFilter && (
          <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs mb-2">
            <span className="text-slate-400">
              {t('scratchpad.filterActive')} <strong className="text-teal-400 font-mono">{selectedTagFilter}</strong>
            </span>
            <button onClick={() => setSelectedTagFilter(null)} className="text-rose-400 font-semibold hover:text-rose-300">
              {t('scratchpad.clearFilter')}
            </button>
          </div>
        )}

        {/* Saved notes list */}
        <div className="max-h-60 overflow-y-auto space-y-2 pe-1">
          {filteredNotes.length > 0 ? (
            filteredNotes.map(note => (
              <div
                key={note.id}
                className={`p-3 rounded-xl border text-xs flex items-center justify-between transition-all ${
                  note.isProcessed
                    ? 'bg-slate-950/40 border-slate-800/50 text-slate-500 line-through'
                    : 'bg-slate-950 border-slate-800 text-slate-200'
                }`}
              >
                {editingId === note.id ? (
                  <div className="flex-1 pe-3 space-y-2">
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      rows={2}
                      autoFocus
                      className="w-full bg-slate-900 border border-teal-500/40 rounded-lg p-2 text-xs text-slate-200 focus:outline-none resize-none"
                    />
                    <input
                      type="text"
                      value={editingTags}
                      onChange={(e) => setEditingTags(e.target.value)}
                      placeholder={t('scratchpad.tagsPlaceholder')}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-teal-300 focus:outline-none"
                    />
                    <div className="flex gap-1.5 justify-end">
                      <button onClick={cancelEditing} className="p-1 text-slate-500 hover:text-slate-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => saveEditing(note)} className="p-1 text-emerald-400 hover:text-emerald-300">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 pe-3">
                      <div>{note.content}</div>
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {note.tags.map((tag, idx) => (
                            <button
                              key={idx}
                              onClick={() => setSelectedTagFilter(tag)}
                              className="text-[10px] text-teal-400 font-mono hover:underline"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEditing(note)} className="p-1 hover:text-teal-400">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleToggle(note.id)} className="p-1 hover:text-emerald-400">
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(note.id)} className="p-1 hover:text-rose-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">{t('scratchpad.noNotes')}</div>
          )}
        </div>
      </div>
    </div>
  );
};