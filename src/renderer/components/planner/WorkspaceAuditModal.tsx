import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, AlertTriangle, CheckCircle, Trash2, Loader2, Brain, Lock, Send, ShieldCheck, ShieldAlert, Minus, RefreshCw } from 'lucide-react';
import { EnvironmentAuditItem, AIJustificationResult } from '../../../shared/types';
import { isBrowserExecutable } from '@shared/classification';

interface WorkspaceAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  auditItems: EnvironmentAuditItem[];
  isLoading?: boolean;
  errorMessage?: string | null;
  onConfirmStart: () => void;
  /** Re-run the environment audit (A3): replaces the snapshot with current windows. */
  onRescan?: () => void;
  subjectName?: string;
  blockTitle?: string;
}

const AVATAR_GRADIENTS = [
  'from-teal-500 to-emerald-500',
  'from-indigo-500 to-purple-500',
  'from-rose-500 to-orange-400',
  'from-sky-500 to-cyan-400',
  'from-amber-500 to-yellow-400',
  'from-fuchsia-500 to-pink-500',
];

export const WorkspaceAuditModal: React.FC<WorkspaceAuditModalProps> = ({
  isOpen,
  onClose,
  auditItems: initialAuditItems,
  isLoading = false,
  errorMessage = null,
  onConfirmStart,
  onRescan,
  subjectName,
  blockTitle,
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<EnvironmentAuditItem[]>(initialAuditItems);
  const [closingApp, setClosingApp] = useState<string | null>(null);
  const [isClosingAll, setIsClosingAll] = useState(false);
  // Track rows whose "Close App" call returned false (non-closable / failed),
  // so we can surface an actionable inline error instead of a silent lockout.
  const [closeFailed, setCloseFailed] = useState<Set<string>>(new Set());
  const [isRescanning, setIsRescanning] = useState(false);

  // Inline AI justification flow per flagged app.
  const [justifyingFor, setJustifyingFor] = useState<EnvironmentAuditItem | null>(null);
  const [justifyReason, setJustifyReason] = useState('');
  const [isJustifying, setIsJustifying] = useState(false);
  const [justifyResult, setJustifyResult] = useState<AIJustificationResult | null>(null);

  useEffect(() => {
    setItems(initialAuditItems);
    setJustifyingFor(null);
    setJustifyReason('');
    setJustifyResult(null);
    setCloseFailed(new Set());
  }, [initialAuditItems]);

  if (!isOpen) return null;

  // A browser is not a single closable "app" — taskkill would kill ALL its
  // tabs (study tabs included). For browser-classified items the only safe
  // guidance is to close the specific tab manually, then re-scan.
  const isBrowserRow = (appName: string) => isBrowserExecutable(appName);

  const flaggedCount = items.filter(i => i.verdict === 'distracting' || i.verdict === 'needs_review').length;
  const neutralCount = items.filter(i => i.verdict === 'neutral').length;
  const approvedCount = items.filter(i => i.verdict === 'productive').length;

  const avatarClass = (idx: number) => AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];

  const handleCloseProcess = async (appName: string) => {
    if (!window.focusStudyAPI) return;
    // Never taskkill a browser (would kill all tabs). Show guidance instead.
    if (isBrowserExecutable(appName)) return;
    setClosingApp(appName);
    try {
      const closed = await window.focusStudyAPI.closeProcess(appName);
      if (closed) {
        setItems(prev => prev.filter(i => i.appName !== appName));
        setCloseFailed(prev => { const n = new Set(prev); n.delete(appName); return n; });
        if (justifyingFor?.appName === appName) {
          setJustifyingFor(null);
          setJustifyReason('');
          setJustifyResult(null);
        }
      } else {
        // Surface the failure so the user isn't silently locked out.
        setCloseFailed(prev => new Set(prev).add(appName));
      }
    } finally {
      setClosingApp(null);
    }
  };

  const handleCloseAll = async () => {
    if (!window.focusStudyAPI || isClosingAll) return;
    setIsClosingAll(true);
    // Only attempt to closable native distracting apps — browsers need manual
    // tab-close (handled per-row with a hint), not a taskkill.
    const toClose = items.filter(i => (i.verdict === 'distracting' || i.verdict === 'needs_review') && !isBrowserExecutable(i.appName));
    const failed = new Set<string>();
    for (const item of toClose) {
      const closed = await window.focusStudyAPI.closeProcess(item.appName);
      if (!closed) failed.add(item.appName);
    }
    const closedNames = new Set(toClose.filter(i => !failed.has(i.appName)).map(i => i.appName));
    setItems(prev => prev.filter(i => !closedNames.has(i.appName)));
    setCloseFailed(failed);
    setIsClosingAll(false);
  };

  const handleRemember = async (item: EnvironmentAuditItem, decision: 'productive' | 'neutral' | 'distracting') => {
    if (!window.focusStudyAPI) return;
    const saved = await window.focusStudyAPI.rememberReview({ appName: item.appName, domain: item.domain }, decision, 'permanent');
    if (saved) setItems(prev => prev.filter(candidate => candidate !== item));
  };

  const handleRescan = async () => {
    if (!onRescan) return;
    setIsRescanning(true);
    try {
      await onRescan();
    } finally {
      setIsRescanning(false);
    }
  };

  const startJustify = (item: EnvironmentAuditItem) => {
    setJustifyingFor(item);
    setJustifyReason('');
    setJustifyResult(null);
  };

  const cancelJustify = () => {
    setJustifyingFor(null);
    setJustifyReason('');
    setJustifyResult(null);
  };

  const handleSubmitJustification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!justifyingFor || !justifyReason.trim() || !window.focusStudyAPI || isJustifying) return;

    setIsJustifying(true);
    setJustifyResult(null);
    try {
      const res = await window.focusStudyAPI.requestAIException({
        appName: justifyingFor.appName,
        title: justifyingFor.title,
        subject: subjectName || '',
        blockTitle: blockTitle || '',
        reason: justifyReason.trim(),
      });
      setJustifyResult(res);
      if (res.approved) {
        setItems(prev => prev.filter(i => i.appName !== justifyingFor.appName));
      }
    } catch (err) {
      console.error('[WorkspaceAuditModal] Justification failed:', err);
      setJustifyResult({ approved: false, aiResponse: t('aiException.evalError') });
    } finally {
      setIsJustifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 relative space-y-4 overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="relative flex items-center gap-3 pb-3 border-b border-slate-800">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <ShieldCheck className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">{t('audit.title')}</h3>
            <p className="text-[11px] text-slate-400">
              {subjectName ? t('audit.subtitleWithSubject', { subject: subjectName }) : t('audit.subtitle')}
            </p>
          </div>
        </div>

        {/* Audit Body Content */}
        {isLoading ? (
          <div className="relative p-8 text-center space-y-3">
            <div className="relative w-16 h-16 mx-auto">
              <div className="absolute inset-0 rounded-full border-2 border-teal-400/30 animate-ping" />
              <div className="absolute inset-0 rounded-full border-2 border-teal-400/60 border-t-transparent animate-spin" />
              <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-teal-400" />
            </div>
            <p className="text-xs text-slate-400">{t('audit.scanning')}</p>
            <p className="text-[10px] text-slate-500 font-mono animate-pulse">{t('audit.scanningHint')}</p>
          </div>
        ) : errorMessage ? (
          <div className="relative p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold mb-0.5">{t('audit.error')}</div>
              <div className="text-[11px] opacity-90">{errorMessage}</div>
            </div>
          </div>
        ) : (
          <div className="relative space-y-3">
            {/* Verdict Summary Banner */}
            {flaggedCount > 0 ? (
              <div className="p-3 bg-gradient-to-r from-amber-500/15 to-rose-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-300 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <div className="font-bold mb-0.5">
                    {t('audit.flaggedBanner', { count: flaggedCount })}
                  </div>
                  <div className="text-[11px] opacity-90">{t('audit.mustResolve')}</div>
                </div>
              </div>
            ) : neutralCount > 0 ? (
              <div className="p-3 bg-gradient-to-r from-slate-500/15 to-slate-600/10 border border-slate-500/30 rounded-2xl text-xs text-slate-300 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-500/15 border border-slate-500/20 flex items-center justify-center shrink-0">
                  <Minus className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1">
                  <div className="font-bold mb-0.5">{t('audit.neutralBanner')}</div>
                  <div className="text-[11px] opacity-90">{t('audit.neutralBannerHint')}</div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-gradient-to-r from-emerald-500/15 to-teal-500/10 border border-emerald-500/30 rounded-2xl text-xs text-emerald-300 flex items-center gap-3">
                <div className="text-xl shrink-0">🎉</div>
                <div>
                  <div className="font-bold">{t('audit.clearMsg')}</div>
                  <div className="text-[11px] opacity-90">{t('audit.clearHint')}</div>
                </div>
              </div>
            )}

            {/* Scan counter chip + re-scan */}
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3 h-3 text-teal-400" />
                <span>
                  {t('audit.scannedCount', { count: items.length })}
                  {approvedCount > 0 && ` • ${t('audit.approvedCount', { count: approvedCount })}`}
                  {neutralCount > 0 && ` • ${t('audit.neutralCount', { count: neutralCount })}`}
                </span>
              </div>
              {onRescan && !isLoading && !errorMessage && (
                <button
                  onClick={handleRescan}
                  disabled={isRescanning}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700/60 hover:bg-slate-800/60 text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"
                  title={t('audit.rescan')}
                >
                  {isRescanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  <span>{t('audit.rescan')}</span>
                </button>
              )}
            </div>

            {/* Per-App Verdict Checklist */}
            <div className="max-h-60 overflow-y-auto space-y-2 pe-1">
              {items.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500 font-mono">{t('audit.noAppsFound')}</div>
              )}

              {items.map((item, idx) => {
                const verdict = item.verdict || 'neutral';
                const isReview = verdict === 'needs_review';
                const isFlagged = verdict === 'distracting' || isReview;
                const isNeutral = verdict === 'neutral';
                return (
                  <div
                    key={`${item.appName}-${idx}`}
                    className={`rounded-2xl border p-3 transition-all animate-fadeIn ${
                      isFlagged
                        ? isReview ? 'bg-slate-950 border-purple-500/35' : 'bg-slate-950 border-amber-500/25'
                        : isNeutral
                          ? 'bg-slate-950/60 border-slate-600/30'
                          : 'bg-slate-950/60 border-emerald-500/15'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* App Avatar */}
                      <div
                        className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${avatarClass(idx)} flex items-center justify-center font-black text-slate-950 text-sm shrink-0 shadow-md`}
                      >
                        {(item.appName || '?').charAt(0).toUpperCase()}
                      </div>

                      {/* App Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-xs truncate ${isFlagged ? (isReview ? 'text-purple-200' : 'text-rose-200') : isNeutral ? 'text-slate-300' : 'text-slate-200'}`}>
                            {item.appName}
                          </span>
                          {item.domain && (
                            <span className="text-[9px] font-mono text-teal-400 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded-md truncate max-w-[90px]">
                              {item.domain}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{item.title}</div>
                      </div>

                      {/* Verdict Pill */}
                      {isReview ? (
                        <span className="px-2.5 py-1 bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-bold rounded-full flex items-center gap-1 shrink-0">
                          <Brain className="w-3 h-3" />
                          {t('audit.needsReview')}
                        </span>
                      ) : isFlagged ? (
                        <span className="px-2.5 py-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold rounded-full flex items-center gap-1 shrink-0">
                          <ShieldAlert className="w-3 h-3" />
                          {t('audit.needsReview')}
                        </span>
                      ) : isNeutral ? (
                        <span className="px-2.5 py-1 bg-slate-500/10 text-slate-300 border border-slate-500/30 text-[10px] font-bold rounded-full flex items-center gap-1 shrink-0">
                          <Minus className="w-3 h-3" />
                          {t('audit.neutral')}
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 text-[10px] font-bold rounded-full flex items-center gap-1 shrink-0">
                          <CheckCircle className="w-3 h-3" />
                          {t('audit.approved')}
                        </span>
                      )}
                    </div>

                    {/* Flagged-row actions */}
                    {isFlagged && (
                      <div className="mt-2 pt-2 border-t border-slate-800/70 space-y-2">
                        <div className={`text-[10px] ${isReview ? 'text-purple-300/90' : 'text-amber-400/90'}`}>
                          <span className="font-semibold">{t('audit.reasonLabel')}</span> {item.reason}
                        </div>
                        {item.confidence !== undefined && (
                          <div className="text-[9px] text-slate-500">{Math.round(item.confidence * 100)}% {t('intervention.confidence')} • {item.source || 'local'} {item.sources?.length ? `• ${item.sources.length} ${t('audit.sourcesSuffix')}` : ''}</div>
                        )}
                        {item.sources && item.sources.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {item.sources.map((source, sourceIndex) => (
                              <a key={sourceIndex} href={source.url} target="_blank" rel="noreferrer" className="text-[9px] text-teal-400 hover:text-teal-300 underline truncate max-w-[180px]">
                                {source.title}
                              </a>
                            ))}
                          </div>
                        )}
                        {isReview && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <span className="text-[9px] text-slate-500">{t('audit.rememberAs')}</span>
                            <button onClick={() => handleRemember(item, 'productive')} className="px-2 py-1 bg-emerald-500/10 text-emerald-300 rounded-md text-[9px]">{t('intervention.productive')}</button>
                            <button onClick={() => handleRemember(item, 'neutral')} className="px-2 py-1 bg-slate-700/60 text-slate-300 rounded-md text-[9px]">{t('intervention.neutral')}</button>
                            <button onClick={() => handleRemember(item, 'distracting')} className="px-2 py-1 bg-rose-500/10 text-rose-300 rounded-md text-[9px]">{t('intervention.distracting')}</button>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => (justifyingFor?.appName === item.appName ? cancelJustify() : startJustify(item))}
                            disabled={isClosingAll || closingApp === item.appName}
                            className="px-2.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-[11px] font-bold rounded-lg flex items-center gap-1 transition-all disabled:opacity-50"
                          >
                            <Brain className="w-3.5 h-3.5" />
                            <span>{justifyingFor?.appName === item.appName ? t('common.cancel') : t('audit.justify')}</span>
                          </button>
                          {isBrowserRow(item.appName) ? (
                            <span className="flex items-center gap-1 text-[10px] text-slate-400 italic px-2 py-1 border border-slate-700/50 rounded-lg">
                              <Minus className="w-3 h-3" />
                              {t('audit.closeTabHint')}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCloseProcess(item.appName)}
                              disabled={closingApp === item.appName || isClosingAll}
                              className="px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-bold rounded-lg flex items-center gap-1 shrink-0 transition-all disabled:opacity-50"
                            >
                              {closingApp === item.appName ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              <span>{t('audit.closeApp')}</span>
                            </button>
                          )}
                        </div>

                        {/* Close-failure inline error (non-closable app) */}
                        {closeFailed.has(item.appName) && !isBrowserRow(item.appName) && (
                          <div className="flex items-start gap-1.5 text-[10px] rounded-lg px-2 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-300">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>{t('audit.closeFailed')}</span>
                          </div>
                        )}

                        {/* Inline AI Justification Form */}
                        {justifyingFor?.appName === item.appName && (
                          <form onSubmit={handleSubmitJustification} className="space-y-2 pt-1">
                            <textarea
                              value={justifyReason}
                              onChange={(e) => setJustifyReason(e.target.value)}
                              required
                              rows={2}
                              maxLength={300}
                              placeholder={t('aiException.reasonPlaceholder')}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500 resize-none"
                            />
                            {justifyResult && (
                              <div
                                className={`flex items-start gap-1.5 text-[11px] rounded-lg px-2 py-1.5 ${
                                  justifyResult.approved
                                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                                }`}
                              >
                                {justifyResult.approved ? (
                                  <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                ) : (
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                )}
                                <span>{justifyResult.aiResponse || (justifyResult.approved ? t('audit.justified') : t('audit.denied'))}</span>
                              </div>
                            )}
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="submit"
                                disabled={isJustifying || !justifyReason.trim()}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg flex items-center gap-1"
                              >
                                {isJustifying ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5 rtl:rotate-180" />
                                )}
                                <span>{t('audit.submitJustification')}</span>
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Neutral-row: optional close (manual guidance for browser tabs) */}
                    {isNeutral && (
                      <div className="mt-2 pt-2 border-t border-slate-800/70 space-y-2">
                        {item.reason && (
                          <div className="text-[10px] text-slate-400">
                            <span className="font-semibold">{t('audit.reasonLabel')}</span> {item.reason}
                          </div>
                        )}
                        <div className="flex justify-end items-center gap-1.5">
                          {isBrowserRow(item.appName) ? (
                            <span className="flex items-center gap-1 text-[10px] text-slate-500 italic px-2 py-1 border border-slate-700/50 rounded-lg">
                              <Minus className="w-3 h-3" />
                              {t('audit.closeTabHint')}
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCloseProcess(item.appName)}
                              disabled={closingApp === item.appName || isClosingAll}
                              className="px-2.5 py-1.5 bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 border border-slate-600/40 text-[11px] font-bold rounded-lg flex items-center gap-1 transition-all disabled:opacity-50"
                            >
                              {closingApp === item.appName ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              <span>{t('audit.closeApp')}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Close All Flagged */}
            {flaggedCount > 0 && (
              <button
                onClick={handleCloseAll}
                disabled={isClosingAll}
                className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-300 border border-rose-500/25 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all"
              >
                {isClosingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{t('audit.closeAll')}</span>
              </button>
            )}
          </div>
        )}

        {/* Modal Action Buttons */}
        <div className="relative pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
          <span className={`flex items-center gap-1 text-[11px] ${flaggedCount > 0 ? 'text-amber-400/80' : 'text-slate-500'}`}>
            <Lock className="w-3.5 h-3.5" />
            {flaggedCount > 0 && !isLoading && !errorMessage ? t('audit.startLocked') : t('audit.readyToStart')}
          </span>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>

            <button
              onClick={() => {
                onConfirmStart();
                onClose();
              }}
              disabled={isLoading || flaggedCount > 0}
              className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4 fill-slate-950" />
              <span>{t('planner.startBlock')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
