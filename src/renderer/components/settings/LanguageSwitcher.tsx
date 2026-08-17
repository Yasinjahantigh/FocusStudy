import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Language } from '../../../shared/types';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const currentLang = (i18n.language || 'en') as Language;

  const toggleLanguage = () => {
    const nextLang: Language = currentLang === 'en' ? 'fa' : 'en';
    i18n.changeLanguage(nextLang);

    if (window.focusStudyAPI) {
      window.focusStudyAPI.setLanguage(nextLang);
    }
  };

  return (
    <button
      onClick={toggleLanguage}
      className="w-full px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-between transition-all"
    >
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-emerald-400" />
        <span>{currentLang === 'en' ? 'English' : 'فارسی'}</span>
      </div>
      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-slate-800 rounded text-emerald-400">
        {currentLang === 'en' ? 'FA' : 'EN'}
      </span>
    </button>
  );
};
