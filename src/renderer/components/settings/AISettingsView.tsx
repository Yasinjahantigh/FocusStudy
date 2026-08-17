import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Save, CheckCircle2, Server, Key, Box, ShieldCheck, Plus, Trash2, PlugZap, Search, Globe } from 'lucide-react';
import { AISettings, CategorizationRule, AppCategory } from '../../../shared/types';

export const AISettingsView: React.FC = () => {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState('https://generativelanguage.googleapis.com/v1beta');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemma-4-31b-it');
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Connection test state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  // Search test state
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [searchTestResult, setSearchTestResult] = useState<{ ok: boolean; searched?: boolean; mode?: 'google-sdk' | 'openai'; message?: string } | null>(null);

  // Categorization Rules State
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [categories, setCategories] = useState<AppCategory[]>([]);
  const [newPatternType, setNewPatternType] = useState<'executable' | 'title_regex' | 'domain'>('executable');
  const [newPatternValue, setNewPatternValue] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('cat_productive');
  const [newPriority, setNewPriority] = useState(90);

  const loadRules = () => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.getRules().then(setRules);
      window.focusStudyAPI.getCategories().then(setCategories);
    }
  };

  useEffect(() => {
    if (window.focusStudyAPI) {
      window.focusStudyAPI.getAISettings().then((settings) => {
        if (settings) {
          setBaseUrl(settings.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
          setApiKey(settings.apiKey || '');
          setModel(settings.model || 'gemma-4-31b-it');
          setSearchEnabled(!!settings.searchEnabled);
        }
      });
      loadRules();
    }
  }, []);

  const handleSaveAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (window.focusStudyAPI) {
      const settings: AISettings = {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || 'gemma-4-31b-it',
        searchEnabled,
      };
      await window.focusStudyAPI.setAISettings(settings);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
  };

  const currentFormSettings = (): AISettings => ({
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim() || 'gemma-4-31b-it',
    searchEnabled,
  });

  const handleTestConnection = async () => {
    if (!window.focusStudyAPI) return;
    setIsTesting(true);
    setTestResult(null);
    try {
const result = await window.focusStudyAPI.testAIConnection(currentFormSettings());
    if (result && typeof result === 'object' && 'ok' in result) {
      setTestResult({
        ok: result.ok as boolean,
        message: result.message as string,
      });
    } else {
      setTestResult({ ok: true, message: t('settings.testSuccess') });
    }
    } catch (err) {
      console.error('[AISettingsView] Connection test error:', err);
      setTestResult({ ok: false, message: t('settings.testFailed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestSearch = async () => {
    if (!window.focusStudyAPI) return;
    setIsTestingSearch(true);
    setSearchTestResult(null);
    try {
      const result = await window.focusStudyAPI.testAISearch(currentFormSettings());
      setSearchTestResult({
        ok: !!result?.ok,
        searched: !!result?.searched,
        mode: result?.mode || 'openai',
        message: result?.message || t('settings.testFailed'),
      });
    } catch (err) {
      console.error('[AISettingsView] Search test error:', err);
      setSearchTestResult({ ok: false, message: t('settings.testFailed') });
    } finally {
      setIsTestingSearch(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatternValue.trim() || !window.focusStudyAPI) return;

    await window.focusStudyAPI.addRule({
      pattern_type: newPatternType,
      pattern_value: newPatternValue.trim(),
      category_id: newCategoryId,
      priority: Number(newPriority) || 50
    });

    setNewPatternValue('');
    loadRules();
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (window.focusStudyAPI) {
      await window.focusStudyAPI.deleteRule(ruleId);
      loadRules();
    }
  };

  const patternTypeLabel = (type: string) => {
    switch (type) {
      case 'executable': return t('settings.patternExecutable');
      case 'domain': return t('settings.patternDomain');
      case 'title_regex': return t('settings.patternTitleRegex');
      default: return type;
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
          <Cpu className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{t('settings.title')}</h2>
          <p className="text-xs text-slate-400">{t('settings.subtitle')}</p>
        </div>
      </div>

      {/* AI Settings Form Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
          <Server className="w-4 h-4 text-purple-400" />
          <span>{t('settings.aiModelConfig')}</span>
        </h3>

        <form onSubmit={handleSaveAI} className="space-y-4 text-xs">
          {/* Base URL */}
          <div>
            <label className="text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-purple-400" />
              <span>{t('settings.baseUrlLabel')}</span>
            </label>
            <input
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('settings.baseUrlPlaceholder')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Key className="w-4 h-4 text-purple-400" />
              <span>{t('settings.apiKeyLabel')}</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.apiKeyPlaceholder')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {/* Model Name */}
          <div>
            <label className="text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Box className="w-4 h-4 text-purple-400" />
              <span>{t('settings.modelLabel')}</span>
            </label>
            <input
              type="text"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('settings.modelPlaceholder')}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>

          {/* Web Search for AI */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Globe className="w-5 h-5 text-emerald-400 mt-0.5" />
              <div>
                <p className="text-slate-200 font-semibold">{t('settings.searchEnabled')}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t('settings.searchHint')}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={searchEnabled}
                onChange={(e) => setSearchEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-slate-800 peer-checked:bg-emerald-500 rounded-full transition-all after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4"></div>
            </label>
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || !baseUrl || !model}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-semibold rounded-xl transition-all flex items-center gap-1.5"
            >
              <PlugZap className="w-4 h-4 text-purple-400" />
              <span>{isTesting ? t('settings.testing') : t('settings.testConnection')}</span>
            </button>

            <button
              type="button"
              onClick={handleTestSearch}
              disabled={isTestingSearch || !searchEnabled}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-semibold rounded-xl transition-all flex items-center gap-1.5"
            >
              <Search className="w-4 h-4 text-emerald-400" />
              <span>{isTestingSearch ? t('settings.testingSearch') : t('settings.testSearch')}</span>
            </button>

            {testResult && (
              <span
                className={`text-[11px] font-semibold flex items-center gap-1.5 ${
                  testResult.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full bg-rose-500 inline-block" />
                )}
                <span>{testResult.message}</span>
              </span>
            )}
          </div>

          {searchTestResult && (
            <div
              className={`p-3 rounded-xl border text-[11px] font-medium flex items-start gap-2 ${
                searchTestResult.ok
                  ? searchTestResult.searched
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              <Globe className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <span className="inline-block px-1.5 py-0.5 bg-slate-800/80 border border-slate-600/40 rounded-md font-mono text-[9px] uppercase me-1.5 align-middle">
                  {searchTestResult.mode === 'google-sdk' ? 'Google SDK' : 'OpenAI API'}
                </span>
                {searchTestResult.message}
              </span>
            </div>
          )}

          {/* Alert Banner */}
          {savedSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('settings.savedSuccess')}</span>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-lg shadow-purple-600/20 transition-all flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{t('common.save')}</span>
            </button>
          </div>
        </form>

        {/* First-run hint when no AI key is set */}
        {!apiKey.trim() && (
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs text-purple-300">
            <p className="font-semibold mb-1">{t('settings.noAiKeyHint')}</p>
            <p className="text-slate-400">{t('settings.noAiKeyHintDesc')}</p>
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-[11px] text-slate-400 space-y-1">
        <p className="text-slate-200 font-semibold">{t('settings.privacyTitle')}</p>
        <p>{t('settings.privacyHint')}</p>
        <p className="text-emerald-400/80">{t('settings.secureKeyHint')}</p>
      </div>

      {/* App Categorization Rules Management Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
          <ShieldCheck className="w-4 h-4 text-teal-400" />
          <span>{t('settings.rulesTitle')}</span>
        </h3>

        {/* Add New Rule Form */}
        <form onSubmit={handleAddRule} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
          <div className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-teal-400" />
            <span>{t('settings.addRule')}</span>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-slate-400 block mb-1">{t('settings.patternTypeLabel')}</label>
              <select
                value={newPatternType}
                onChange={(e: any) => setNewPatternType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-teal-500"
              >
                <option value="executable">{t('settings.patternExecutable')}</option>
                <option value="domain">{t('settings.patternDomain')}</option>
                <option value="title_regex">{t('settings.patternTitleRegex')}</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">{t('settings.patternValueLabel')}</label>
              <input
                type="text"
                required
                placeholder={t('settings.patternValuePlaceholder')}
                value={newPatternValue}
                onChange={(e) => setNewPatternValue(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">{t('settings.categoryLabel')}</label>
              <select
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-teal-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">{t('settings.priorityLabel')}</label>
              <input
                type="number"
                min="1"
                max="200"
                value={newPriority}
                onChange={(e) => setNewPriority(parseInt(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{t('settings.addRuleBtn')}</span>
            </button>
          </div>
        </form>

        {/* Existing Rules List */}
        <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
          {rules.map((rule) => {
            const cat = categories.find((c) => c.id === rule.category_id);
            return (
              <div
                key={rule.id}
                className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md font-mono text-[10px] uppercase">
                    {patternTypeLabel(rule.pattern_type)}
                  </span>
                  <span className="font-mono text-slate-200 font-bold">{rule.pattern_value}</span>
                  {cat && (
                    <span
                      className="px-2 py-0.5 text-[10px] font-semibold rounded-full"
                      style={{ backgroundColor: `${cat.color_hex}20`, color: cat.color_hex, border: `1px solid ${cat.color_hex}40` }}
                    >
                      {cat.name}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {t('settings.priorityLabel')}: {rule.priority}
                  </span>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {rules.length === 0 && (
            <div className="py-6 text-center text-xs text-slate-500 font-mono">{t('settings.noRules')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
