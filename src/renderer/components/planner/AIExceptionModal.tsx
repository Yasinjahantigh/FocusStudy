import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Sparkles, CheckCircle2, XCircle, Send, AlertTriangle } from 'lucide-react';
import { AIJustificationResult } from '../../../shared/types';

interface AIExceptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  appName: string;
  subject: string;
  blockTitle: string;
  onAccessGranted?: (appName: string, durationMinutes?: number) => void;
}

export const AIExceptionModal: React.FC<AIExceptionModalProps> = ({
  isOpen,
  onClose,
  appName,
  subject,
  blockTitle,
  onAccessGranted,
}) => {
  const { t } = useTranslation();

  const [reason, setReason] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [result, setResult] = useState<AIJustificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim() || !window.focusStudyAPI) return;

    setIsEvaluating(true);
    setResult(null);
    setError(null);

    try {
      const res = await window.focusStudyAPI.requestAIException({
        appName,
        title: appName,
        subject,
        blockTitle,
        reason,
      });

      setResult(res);
      if (res.approved && onAccessGranted) {
        onAccessGranted(appName, res.grantedDurationMinutes);
      }
    } catch (err) {
      console.error('[AIExceptionModal] Evaluation error:', err);
      setError(t('aiException.evalError'));
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 relative space-y-4">
        {/* Modal Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">{t('aiException.title')}</h3>
            <p className="text-[11px] text-slate-400">{t('aiException.subtitle')}</p>
          </div>
        </div>

        {/* Target App Banner */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
          <span className="text-slate-400">{t('tracker.activeActivity')}:</span>
          <span className="font-mono text-emerald-400 font-bold">{appName || t('common.requestedTool')}</span>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            maxLength={300}
            placeholder={t('aiException.reasonPlaceholder')}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-purple-500 resize-none"
          />

          {error && (
            <div className="flex items-center gap-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
            >
              {t('common.cancel')}
            </button>

            <button
              type="submit"
              disabled={isEvaluating || !reason.trim()}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/20 transition-all flex items-center gap-1.5"
            >
              {isEvaluating ? (
                <Sparkles className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 rtl:rotate-180" />
              )}
              <span>{isEvaluating ? t('aiException.evaluating') : t('aiException.submit')}</span>
            </button>
          </div>
        </form>

        {/* AI Result Card */}
        {result && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-2 animate-fadeIn ${
              result.approved
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm">
              {result.approved ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>{t('aiException.approved')}</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-400" />
                  <span>{t('aiException.denied')}</span>
                </>
              )}
            </div>
            <p className="leading-relaxed opacity-95">{result.aiResponse}</p>
            {result.approved && result.grantedDurationMinutes ? (
              <p className="text-[11px] font-semibold opacity-90">
                {t('aiException.grantedDuration', { minutes: result.grantedDurationMinutes })}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};