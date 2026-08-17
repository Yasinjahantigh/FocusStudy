import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { Brain, CheckCircle, ExternalLink, Lock, ShieldAlert, XCircle } from 'lucide-react';
import { InterventionPayload } from '../preload/types';
import { ReviewDecision, ReviewScope } from '../shared/types';
import { Language } from '../shared/types';
import i18n, { setDocumentDirection } from './i18n';
import './index.css';

const InterventionPage: React.FC = () => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<InterventionPayload | null>(null);

  useEffect(() => {
    if (!window.focusStudyAPI) return;
    window.focusStudyAPI.getLanguage().then((lang) => {
      if (lang) {
        i18n.changeLanguage(lang);
        setDocumentDirection(lang as Language);
      }
    });
    const unsubLang = window.focusStudyAPI.onLanguageChanged((lang) => {
      i18n.changeLanguage(lang);
      setDocumentDirection(lang as Language);
    });
    return unsubLang;
  }, []);

  const [busy, setBusy] = useState(false);
  const [justifying, setJustifying] = useState(false);
  const [justifyOpen, setJustifyOpen] = useState(false);
  const [justifyText, setJustifyText] = useState('');
  const [justifyResult, setJustifyResult] = useState<string | null>(null);
  const [justifyApproved, setJustifyApproved] = useState(false);

  useEffect(() => {
    const off = window.focusStudyAPI.onInterventionShow((p) => {
      setPayload(p);
      setBusy(false);
      setJustifying(false);
      setJustifyOpen(false);
      setJustifyText('');
      setJustifyResult(null);
      setJustifyApproved(false);
    });
    return off;
  }, []);

  if (!payload) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-slate-950">
        <p className="text-slate-600 text-xs">FocusStudy</p>
      </div>
    );
  }

  const doTempAllow = (minutes: number) => {
    setBusy(true);
    window.focusStudyAPI.grantTemporaryAccess(payload.appName, minutes, payload.domain).finally(() => {
      setPayload(null);
    });
  };

  const doCloseApp = () => {
    setBusy(true);
    window.focusStudyAPI.closeInterventionApp(payload.appName).then(() => {
      setPayload(null);
    });
  };

  const doDismiss = () => {
    setBusy(true);
    window.focusStudyAPI.dismissIntervention().then(() => setPayload(null));
  };

  const doRemember = (decision: ReviewDecision) => {
    setBusy(true);
    window.focusStudyAPI.rememberReviewDecision(decision, 'permanent' as ReviewScope).then(() => {
      setPayload(null);
    });
  };

  const doJustify = () => {
    if (!justifyText.trim()) return;
    setJustifying(true);
    setJustifyResult(null);
    window.focusStudyAPI
      .justifyIntervention(justifyText.trim())
      .then((res) => {
        setJustifyApproved(res.approved);
        setJustifyResult(res.approved ? t('intervention.justifyApproved', { minutes: res.grantedDurationMinutes || 15 }) : t('intervention.justifyDenied', { message: res.aiResponse }));
      })
      .catch(() => setJustifyResult(t('intervention.justifyError')))
      .finally(() => {
        setJustifying(false);
        setBusy(false);
      });
  };

  return (
    <div className="w-screen h-screen bg-slate-950/98 flex items-center justify-center p-5 text-center animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-7 shadow-2xl space-y-5">
        {payload.kind === 'lock' ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-lg shadow-rose-500/10">
              <Lock className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-extrabold text-white">{t('lockOverlay.title')}</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t('lockOverlay.description', { subject: payload.subject || payload.blockTitle || '-', app: payload.appName })}
              </p>
              {payload.title ? <p className="text-[11px] text-slate-500 truncate">{payload.title}</p> : null}
            </div>

            {justifyResult ? (
              <div className={`text-[11px] rounded-xl p-3 border ${justifyApproved ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
                {justifyResult}
              </div>
            ) : null}

            {justifyOpen ? (
              <div className="space-y-2">
                <textarea
                  value={justifyText}
                  onChange={(e) => setJustifyText(e.target.value)}
                  placeholder={t('intervention.justifyPlaceholder', { app: payload.appName })}
                  rows={3}
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-purple-500 resize-none placeholder:text-slate-600"
                />
                <button
                  onClick={doJustify}
                  disabled={justifying || !justifyText.trim()}
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Brain className="w-4 h-4" />
                  <span>{justifying ? '...' : t('intervention.justifySubmit')}</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setJustifyOpen(true)}
                disabled={busy}
                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/20 transition-all flex items-center justify-center gap-2"
              >
                <Brain className="w-4 h-4 text-purple-200" />
                <span>{t('lockOverlay.requestException')}</span>
              </button>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={doCloseApp}
                disabled={busy || justifying}
                className="w-full py-2.5 px-4 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>{t('lockOverlay.closeApp', { app: payload.appName })}</span>
              </button>
              <button
                onClick={doDismiss}
                disabled={busy || justifying}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition-all disabled:opacity-50"
              >
                {t('lockOverlay.backToStudy')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/25 text-purple-300 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-extrabold text-white">{t('intervention.reviewTitle')}</h2>
              <p className="text-xs text-slate-400">{t('intervention.reviewSubject', { subject: payload.subject || payload.blockTitle || '-', app: payload.appName })}</p>
              <p className="text-[11px] text-slate-500 truncate">{payload.title}</p>
            </div>

            <div className="text-start bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <p className="text-xs text-slate-300">
                <span className="font-semibold text-purple-300">{t('intervention.reason')}:</span> {payload.reason || '—'}
              </p>
              <p className="text-[10px] text-slate-500">
                {t('intervention.confidence')}: {Math.round((payload.confidence || 0) * 100)}% · {t('intervention.source')}: {payload.source || 'fallback'}
              </p>
              {(payload.sources || []).map((source, index) => (
                <a key={index} href={source.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 truncate">
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  {source.title}
                </a>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => doTempAllow(15)} disabled={busy} className="py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
                <CheckCircle className="w-4 h-4" />
                {t('intervention.allow15')}
              </button>
              <button onClick={doCloseApp} disabled={busy} className="py-2.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50">
                <XCircle className="w-4 h-4" />
                {t('lockOverlay.closeApp', { app: payload.appName })}
              </button>
            </div>

            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <Brain className="w-3.5 h-3.5 text-purple-300" />
                {t('intervention.remember')}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button disabled={busy} onClick={() => doRemember('productive')} className="py-2 bg-slate-800 hover:bg-emerald-500/20 text-[10px] text-emerald-300 rounded-lg disabled:opacity-50">
                  {t('intervention.productive')}
                </button>
                <button disabled={busy} onClick={() => doRemember('neutral')} className="py-2 bg-slate-800 hover:bg-slate-600 text-[10px] text-slate-300 rounded-lg disabled:opacity-50">
                  {t('intervention.neutral')}
                </button>
                <button disabled={busy} onClick={() => doRemember('distracting')} className="py-2 bg-slate-800 hover:bg-rose-500/20 text-[10px] text-rose-300 rounded-lg disabled:opacity-50">
                  {t('intervention.distracting')}
                </button>
              </div>
              <button disabled={busy} onClick={() => doTempAllow(60)} className="text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-50">
                {t('intervention.allowBlock')}
              </button>
            </div>

            <button onClick={doDismiss} disabled={busy} className="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-50">
              {t('intervention.back')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('intervention-root')!).render(
  <React.StrictMode>
    <InterventionPage />
  </React.StrictMode>
);
