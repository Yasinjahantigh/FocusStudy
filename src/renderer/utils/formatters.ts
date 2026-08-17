import { Language } from '../../shared/types';

export const formatNumber = (num: number | string, lang: Language = 'en'): string => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return String(num);

  if (lang === 'fa') {
    return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
  }
  return String(n);
};

export const formatLocalizedTime = (totalSeconds: number, lang: Language = 'en'): string => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;

  if (lang === 'fa') {
    const faM = new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false }).format(m);
    const faS = new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false }).format(s);
    return `${faM}:${faS}`;
  }

  const enM = m.toString().padStart(2, '0');
  const enS = s.toString().padStart(2, '0');
  return `${enM}:${enS}`;
};

export const formatLocalizedPercent = (score: number, lang: Language = 'en'): string => {
  if (lang === 'fa') {
    return `%${formatNumber(score, 'fa')}`;
  }
  return `${score}%`;
};

export const formatHoursFormatted = (seconds: number, lang: Language = 'en'): string => {
  const hours = (seconds / 3600).toFixed(1);
  if (lang === 'fa') {
    return `${formatNumber(hours, 'fa')} ساعت`;
  }
  return `${hours}h`;
};

export const formatSecondsToMMSS = (seconds: number, lang: Language = 'en'): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  if (lang === 'fa') {
    const faM = new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false }).format(m);
    const faS = new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false }).format(s);
    return `${faM}:${faS}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
