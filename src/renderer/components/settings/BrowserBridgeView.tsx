import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle, Save, CheckCircle2, RefreshCw, Copy, ExternalLink, TerminalSquare } from 'lucide-react';
import { BridgeStatus } from '../../../preload/types';

export const BrowserBridgeView: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [idInput, setIdInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.getBridgeStatus().then((s) => {
        setStatus(s);
        setIdInput(s?.extensionId || '');
      });
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const handleSaveId = async () => {
    if (!window.focusStudyAPI) return;
    const next = await window.focusStudyAPI.setExtensionId(idInput.trim());
    setStatus(next);
    setIdInput(next?.extensionId || '');
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleReRegister = async () => {
    if (!window.focusStudyAPI) return;
    await window.focusStudyAPI.updateBridgeManifests();
    setRefreshKey((k) => k + 1);
  };

  const handleCopyId = async () => {
    if (!idInput) return;
    try {
      await navigator.clipboard.writeText(idInput);
    } catch {
      /* clipboard unavailable */
    }
  };

  const lastSeen = status?.lastSeenAt ? new Date(status.lastSeenAt).toLocaleTimeString() : null;
  const fresh = !!status?.lastSeenAt && Date.now() - status.lastSeenAt < 3 * 60 * 1000;

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Puzzle className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm text-white">{t('settings.browserBridge.title')}</h3>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">{t('settings.browserBridge.description')}</p>

        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-400 block">
            {t('settings.browserBridge.extensionId')}
          </label>
          <div className="flex gap-2">
            <input
              value={idInput}
              onChange={(e) => setIdInput(e.target.value)}
              placeholder="abcdefghijklmnopqrstuvwxyzabcdef"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500 placeholder:text-slate-600 font-mono"
            />
            <button
              onClick={handleSaveId}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {t('common.save')}
            </button>
            <button
              onClick={handleCopyId}
              title={t('settings.browserBridge.copyId')}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleReRegister}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              {t('settings.browserBridge.reRegister')}
            </button>
          </div>
        </div>

        {saved && (
          <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('settings.saved')}
          </div>
        )}

        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500">{t('settings.browserBridge.hostRegistered')}</span>
            <span className={status?.hostRegistered ? 'text-emerald-400' : 'text-rose-400'}>
              {status?.hostRegistered ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('settings.browserBridge.bridgeExe')}</span>
            <span className="text-slate-300 font-mono truncate max-w-[55%]">{status?.bridgeExe?.path || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('settings.browserBridge.lastSeen')}</span>
            <span className={fresh ? 'text-emerald-400' : 'text-slate-400'}>
              {lastSeen ? `${lastSeen}${fresh ? ' ✓' : ''}` : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('settings.browserBridge.lastSource')}</span>
            <span className="text-slate-300">{status?.lastSource || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t('settings.browserBridge.activeTab')}</span>
            <span className="text-slate-300 truncate max-w-[55%]">
              {status?.activeTab ? `${status.activeTab.hostname} — ${status.activeTab.title}` : '—'}
            </span>
          </div>
          {status?.hasErrors && (
            <div className="text-rose-400 pt-1">{t('settings.browserBridge.errors')}</div>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-teal-400" />
          <h3 className="font-bold text-sm text-white">{t('settings.browserBridge.installTitle')}</h3>
        </div>
        <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 leading-relaxed">
          <li>{t('settings.browserBridge.step1')}</li>
          <li>{t('settings.browserBridge.step2')}</li>
          <li>{t('settings.browserBridge.step3')}</li>
          <li>{t('settings.browserBridge.step4')}</li>
          <li>{t('settings.browserBridge.step5')}</li>
        </ol>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <ExternalLink className="w-3 h-3" />
          {status?.stateFile || ''}
        </div>
      </div>
    </div>
  );
};
