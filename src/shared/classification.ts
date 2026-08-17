import type { AppCategory, CategorizationRule } from './types';

export interface RawAppInfo {
  execPath: string;
  appName: string;
  title: string;
  domain?: string;
  isIdle: boolean;
}

export interface LocalAppAssessment {
  category: AppCategory;
  known: boolean;
  source: 'user_rule' | 'system' | 'built_in' | 'fallback';
  confidence: number;
}

export function normalizeExecutableName(value: string): string {
  const trimmed = (value || '').trim().toLowerCase().replace(/^.*[\\/]/, '');
  return trimmed.endsWith('.exe') ? trimmed : `${trimmed}.exe`;
}

/** Exact hostname or a real subdomain match; never a substring match. */
export function domainMatches(hostname: string | undefined, registeredDomain: string): boolean {
  const host = (hostname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const rule = (registeredDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!host || !rule) return false;
  // Allow a concise user rule such as "youtube" to match a hostname label,
  // while still rejecting substring collisions such as "myyoutube.com".
  if (!rule.includes('.')) return host.split('.').includes(rule);
  return host === rule || host.endsWith(`.${rule}`);
}

export const DISTRACTING_EXECUTABLES = [
  // Messaging / social
  'discord.exe', 'telegram.exe', 'whatsapp.exe', 'instagram.exe', 'tiktok.exe',
  'snapchat.exe', 'viber.exe', 'skype.exe', 'messenger.exe', 'line.exe',
  'twitter.exe', 'twitch.exe', 'kick.exe', 'signal.exe', 'slack.exe',
  'teams.exe', 'zoom.exe', 'wechat.exe', 'qq.exe',
  // Games & game platforms
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'battle.net.exe',
  'riotclient.exe', 'leagueclient.exe', 'valorant.exe', 'csgo.exe', 'dota2.exe',
  'roblox.exe', 'minecraft.exe', 'fortnite.exe', 'pubg.exe', 'stardew valley.exe',
  'gta5.exe', 'eurotruck2.exe', 'lol.exe', 'gamebar.exe', 'xbox app.exe',
  'ea app.exe', 'eausexe.exe', 'gog galaxy.exe',
  // Media players & streaming
  'spotify.exe', 'netflix.exe', 'vlc.exe', 'kmplayer.exe', 'potplayer.exe',
  'itunes.exe', 'youtube music.exe', 'plex.exe', 'jellyfin.exe', 'deezer.exe',
  'tidal.exe', 'audible.exe', 'aimp.exe', 'foobar2000.exe', 'mxplayer.exe',
  // Shopping / other time sinks
  'aliexpress.exe', 'amazon.exe', 'shein.exe',
];

export const DISTRACTING_KEYWORDS = [
  'youtube', 'reddit', 'instagram', 'twitter', 'tiktok', 'facebook', 'twitch',
  'chat', 'game', 'gaming', 'stream', 'music', 'movie', 'shopping', 'shop',
  'series', 'episode', 'anime', 'news', 'breaking', 'sport', 'match',
  'zoom', 'teams', 'slack', 'signal', 'wechat', 'plex', 'jellyfin', 'deezer',
  'tidal', 'audible', 'ebay',
  'چت', 'بازی', 'گیم', 'فیلم', 'سریال', 'انیمه', 'آهنگ', 'موزیک', 'فروشگاه',
  'توییت', 'اینستاگرام', 'تلگرام', 'واتساپ', 'یوتیوب', 'آپارات', 'دیجی‌کالا',
  'فروش', 'تخفیف', 'خبر', 'تماشا', 'پخش', 'ویدیو', 'بازار', 'خرید', 'پادکست', 'رادیو',
];

export const DISTRACTING_DOMAINS = [
  // Social / messaging
  'youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'instagram.com',
  'tiktok.com', 'telegram.org', 'facebook.com', 'discord.com',
  // Media / streaming
  'aparat.com', 'twitch.tv', 'netflix.com', 'spotify.com', 'deezer.com',
  'tidal.com', 'soundcloud.com', 'hulu.com', 'disneyplus.com', 'hbomax.com',
  'crunchyroll.com', 'vimeo.com', 'dailymotion.com', 'last.fm',
  // Shopping
  'digikala.com', 'divar.ir', 'torob.com', 'basalam.com', 'amazon.com',
  'aliexpress.com', 'shein.com', 'ebay.com',
  // News / sport
  'varzesh3.com',
  // Image boards
  'pinterest.com', '9gag.com', 'imgur.com',
];

export const PRODUCTIVE_EXECUTABLES = [
  'code.exe', 'devenv.exe', 'idea64.exe', 'pycharm64.exe', 'webstorm64.exe',
  'notion.exe', 'obsidian.exe', 'anki.exe', 'acrobat.exe', 'winword.exe',
  'excel.exe', 'powerpnt.exe', 'calculatorapp.exe', 'calculator.exe',
  'explorer.exe', 'onenote.exe', 'outlook.exe',
];

/**
 * Genuine Windows system, tray, VPN, antivirus, GPU-control, screenshot, and
 * input apps. These are NOT distracting even though their title may be unknown
 * — used as a "system whitelist" so the strict unknown-app default does not
 * falsely lock them mid-session.
 */
export const SYSTEM_TRAY_EXECUTABLES = [
  // Windows shell / system UI
  'explorer.exe', 'systemsettings.exe', 'settings.exe',
  'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'searchhost.exe',
  'lockapp.exe', 'lockscreencontroller.exe', 'textinputhost.exe',
  'windowsinternal-composableshell.extramodels.experiencehost.exe',
  'applicationframehost.exe', 'shellcontenthost.exe', 'runtimebroker.exe',
  'sihost.exe', 'ctfmon.exe', 'dwm.exe', 'fontdrvhost.exe', 'wermgr.exe',
  // Security
  'windowssecurity.exe', 'securityhealthservice.exe', 'securityhealthsystray.exe',
  'smartscreen.exe',
  // GPU / overlay
  'nvidia share.exe', 'nvidia.exe', 'nvidia backend.exe', 'nvcontainer.exe',
  'rtss.exe', 'rivatuner.exe', 'msi afterburner.exe',
  // Screenshot / snip
  'snippingtool.exe', 'screenclippinghost.exe', 'snipandsketch.exe', 'screenshot.exe',
  // VPN (common clients)
  'vpnui.exe', 'anyconnect.exe', 'openvpn.exe', 'openvpn-gui.exe',
  'nordvpn.exe', 'expressvpn.exe', 'surfshark.exe', 'windscribe.exe', 'protonvpn.exe',
  // Print / system services
  'spoolsv.exe', 'printdialog.exe',
  // Antivirus (common) — name-based, exact
  'avp.exe', 'kavfs.exe', 'mcshield.exe', 'avgsvc.exe', 'avguix.exe',
  'msmpeng.exe', 'mbamtray.exe',
];

export function isSystemTrayApp(appName: string): boolean {
  const lower = (appName || '').toLowerCase();
  return SYSTEM_TRAY_EXECUTABLES.includes(lower);
}

/**
 * Browsers are NOT intrinsically productive — a browser is only as productive as
 * the site in its active tab. Their classification is therefore driven by the
 * extracted domain (see classifyApp/extractDomainFromTitle), and a browser on
 * an UNknown domain defaults to neutral, never to productive.
 */
export const BROWSER_EXECUTABLES = [
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe',
  'vivaldi.exe', 'arc.exe',
];

export function isBrowserExecutable(appName: string): boolean {
  const lower = (appName || '').toLowerCase();
  return BROWSER_EXECUTABLES.includes(lower);
}

/**
 * AI assistants (ChatGPT, Gemini, Claude, Copilot, DeepSeek, ...) are legitimate
 * study tools: students ask them homework/math questions. They must NOT be
 * auto-flagged by keyword heuristics (e.g. "chat" matching "ChatGPT").
 */
export const AI_ASSISTANT_PATTERNS = [
  'chatgpt', 'openai', 'gemini', 'bard', 'claude', 'anthropic', 'copilot',
  'deepseek', 'perplexity', 'mistral', 'grok', 'llama', 'gemma', 'ai assistant',
];

export function isAIAssistant(appName: string, title = '', domain = ''): boolean {
  const haystack = `${appName} ${title} ${domain}`.toLowerCase();
  return AI_ASSISTANT_PATTERNS.some(p => haystack.includes(p));
}

/**
 * Whole-word distracting-keyword match against a text field. Using a standalone
 * token test (word boundaries) avoids substring false positives such as
 * "game loop architecture" or "music theory" matching "game"/"music". Domain
 * matching stays substring (domains like youtube.com contain "youtube").
 */
export function matchesDistractingKeyword(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return DISTRACTING_KEYWORDS.some(kw => {
    // Farsi keywords and multi-word tokens aren't matched by \b; use substring
    // for non-ASCII, whole-word for ASCII Latin tokens.
    if (/[^\x00-\x7f]/.test(kw) || kw.includes(' ')) {
      return lower.includes(kw);
    }
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}([^a-z0-9]|$)`, 'i');
    return re.test(lower);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Known browser executables — used to decide whether to attempt extracting a
 * domain from the window title (only browsers expose a site in their title).
 */
const BROWSER_NAME_HINTS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'];

export function isBrowserName(appName: string): boolean {
  const lower = (appName || '').toLowerCase();
  return BROWSER_NAME_HINTS.some(h => lower.includes(h));
}

/**
 * Pure (no FFI) extraction of a hostname/domain from a browser window title.
 * Extracted to the shared layer so it is unit-testable without koffi and is
 * reused identically by the live tracker and the pre-session audit. Returns
 * undefined for non-browser apps or when no plausible domain is found.
 *
 * Guards against common false positives: file extensions (`main.ts`), version
 * numbers (`v1.2.3`), and dates (`08.2026`).
 */
export function extractDomainFromTitle(title: string, appName: string): string | undefined {
  if (!isBrowserName(appName)) {
    return undefined;
  }

  const FILE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|html?|css|scss|json|md|pdf|docx?|xlsx?|pptx?|exe|zip|rar|7z|tar|gz|png|jpe?g|gif|svg|webp|mp[34]|wav|flac|ogg|mov|avi|cs|cpp|c|java|py|rb|go|rs|php|sql|yml|yaml|toml|ini|log|txt|csv)$/i;
  const isValidTld = (tld: string) => /^[a-z]{2,}$/i.test(tld);

  // 1. Prefer an explicit URL in the title (most reliable signal).
  const urlMatch = title.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9.]+?)\s*$/i)
    || title.match(/(?:^|\s|\.)([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)\s*(?:[-|•·–—]|$)/i)
    || title.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9.]+)/i);
  if (urlMatch) {
    const host = urlMatch[1].toLowerCase();
    const parts = host.split('.');
    const tld = parts[parts.length - 1];
    if (isValidTld(tld) && !FILE_EXT_RE.test(host)) {
      return host.replace(/\/.*$/, '');
    }
  }

  // 2. Generic dotted-token scan, rejecting extensions / dates / numeric TLDs.
  const tokens = title.match(/[a-zA-Z0-9-]+\.[a-zA-Z0-9.]+/g) || [];
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (FILE_EXT_RE.test(lower)) continue;
    const parts = lower.split('.');
    const tld = parts[parts.length - 1];
    if (isValidTld(tld) && !/^\d+$/.test(parts[0])) {
      return lower.replace(/\/.*$/, '');
    }
  }

  // 3. Fallback: popular platforms mentioned by name in the title.
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('youtube') || title.includes('یوتیوب')) return 'youtube.com';
  if (lowerTitle.includes('aparat') || title.includes('آپارات')) return 'aparat.com';
  if (lowerTitle.includes('reddit') || title.includes('ردیت')) return 'reddit.com';
  if (lowerTitle.includes('github') || title.includes('گیت‌هاب')) return 'github.com';
  if (lowerTitle.includes('stackoverflow') || lowerTitle.includes('stack overflow')) return 'stackoverflow.com';
  if (lowerTitle.includes('wikipedia') || title.includes('ویکی‌پدیا')) return 'wikipedia.org';
  if (lowerTitle.includes('notion')) return 'notion.so';
  if (lowerTitle.includes('figma')) return 'figma.com';
  if (lowerTitle.includes('coursera')) return 'coursera.org';
  if (lowerTitle.includes('udemy')) return 'udemy.com';
  if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return 'chatgpt.com';
  if (lowerTitle.includes('claude')) return 'claude.ai';
  if (lowerTitle.includes('medium')) return 'medium.com';
  if (lowerTitle.includes('instagram') || title.includes('اینستاگرام')) return 'instagram.com';
  if (lowerTitle.includes('twitter') || lowerTitle.includes('x.com') || title.includes('توییتر')) return 'x.com';
  if (lowerTitle.includes('telegram') || title.includes('تلگرام')) return 'telegram.org';

  return undefined;
}

function fallbackCategory(categoryType: 'idle' | 'distracting' | 'productive' | 'neutral'): AppCategory {
  const map: Record<string, AppCategory> = {
    productive: { id: 'cat_productive', name: 'Productive', type: 'productive', color_hex: '#10B981' },
    distracting: { id: 'cat_distracting', name: 'Distracting', type: 'distracting', color_hex: '#EF4444' },
    neutral: { id: 'cat_neutral', name: 'Neutral', type: 'neutral', color_hex: '#64748B' },
    idle: { id: 'cat_idle', name: 'Away / Idle', type: 'idle', color_hex: '#94A3B8' },
  };
  return map[categoryType] || map.neutral;
}

/**
 * Pure classification: user-defined rules first (highest priority first),
 * then built-in smart heuristics, then neutral.
 */
export function classifyApp(
  categories: AppCategory[],
  rules: CategorizationRule[],
  raw: RawAppInfo
): AppCategory {
  const catOf = (id: string): AppCategory | undefined => categories.find(c => c.id === id);

  if (raw.isIdle) {
    return catOf('cat_idle') || fallbackCategory('idle');
  }

  const sortedRules = [...(rules || [])].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const rule of sortedRules) {
    if (rule.pattern_type === 'executable' && normalizeExecutableName(raw.appName) === normalizeExecutableName(rule.pattern_value)) {
      const cat = catOf(rule.category_id);
      if (cat) return cat;
    }
    if (rule.pattern_type === 'domain' && domainMatches(raw.domain, rule.pattern_value)) {
      const cat = catOf(rule.category_id);
      if (cat) return cat;
    }
    if (rule.pattern_type === 'title_regex') {
      try {
        const regex = new RegExp(rule.pattern_value, 'i');
        if (regex.test(raw.title)) {
          const cat = catOf(rule.category_id);
          if (cat) return cat;
        }
      } catch {
        // invalid regex rules are skipped
      }
    }
  }

  const lowerApp = (raw.appName || '').toLowerCase();
  const lowerTitle = (raw.title || '').toLowerCase();
  const lowerDomain = (raw.domain || '').toLowerCase();

  // AI study assistants (ChatGPT/Gemini/Claude/...) are productive even before
  // domain/exe heuristics — they would otherwise match the "chat" keyword.
  if (isAIAssistant(raw.appName, raw.title, raw.domain)) {
    return catOf('cat_productive') || fallbackCategory('productive');
  }

  // Domain-first classification: when a domain is extracted (mainly from
  // browsers), the SITE decides productivity, not the browser binary. This
  // stops "browser on unknown shopping site" defaulting to productive.
  if (lowerDomain) {
    // Match the distracting keyword against the registered label (the part
    // before the TLD), not the whole domain string, so "randomshop.xyz" does
    // not match "shop" as a substring.
    const domainLabel = lowerDomain.split('.')[0];
    if (matchesDistractingKeyword(domainLabel) || matchesDistractingKeyword(lowerDomain)) {
      return catOf('cat_distracting') || fallbackCategory('distracting');
    }
    // Known distracting domain (exact or subdomain match), in addition to the
    // keyword check above which catches "youtube.com" via the "youtube" keyword.
    if (DISTRACTING_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith('.' + d))) {
      return catOf('cat_distracting') || fallbackCategory('distracting');
    }
    // Known productive domains are handled by user rules above; an unknown
    // domain on a browser is neutral (not productive).
    if (isBrowserExecutable(lowerApp)) {
      return catOf('cat_neutral') || fallbackCategory('neutral');
    }
  }

  // Native distracting app (exact basename match, not substring, to avoid
  // "GameBar" matching "game" type false positives from includes()).
  if (DISTRACTING_EXECUTABLES.includes(lowerApp)) {
    return catOf('cat_distracting') || fallbackCategory('distracting');
  }
  // A known productive executable wins over weak title-keyword signals, so a
  // code editor on a docs page titled "game loop architecture" / "music
  // theory" is NOT flagged (the title keyword is only trusted when we have no
  // productive binary to trust).
  if (PRODUCTIVE_EXECUTABLES.includes(lowerApp)) {
    return catOf('cat_productive') || fallbackCategory('productive');
  }
  // Title keywords are a WEAK last-resort signal for genuinely unknown apps:
  // require whole-word matches, and only apply when no productive/distracting
  // executable was identified above.
  if (matchesDistractingKeyword(lowerTitle)) {
    return catOf('cat_distracting') || fallbackCategory('distracting');
  }

  // Known browser on an unknown site (no domain extracted): neutral, not
  // productive — its productivity is unknown until the tab resolves.
  if (isBrowserExecutable(lowerApp)) {
    return catOf('cat_neutral') || fallbackCategory('neutral');
  }

  // Windows system, tray, VPN, antivirus, GPU-control, screenshot, and input
  // apps are NOT distracting even though their title may be unknown (system whitelist).
  if (isSystemTrayApp(lowerApp)) {
    return catOf('cat_neutral') || fallbackCategory('neutral');
  }

  // Unknown non-browser, non-system-tray app — conservative default so the
  // mid-session lock engages. Users can add legitimate apps via categorization
  // rules or the block's allowedApps, or justify via AI at lock time.
  return catOf('cat_distracting') || fallbackCategory('distracting');
}

/**
 * Classification metadata used by the audit and live review gate. The legacy
 * classifyApp() function intentionally keeps its conservative distracting
 * fallback for existing analytics, while this API distinguishes an unknown
 * app from a confidently distracting app.
 */
export function assessApp(
  categories: AppCategory[],
  rules: CategorizationRule[],
  raw: RawAppInfo
): LocalAppAssessment {
  const catOf = (id: string): AppCategory | undefined => categories.find(c => c.id === id);
  const fallback = (type: 'productive' | 'distracting' | 'neutral' | 'idle'): AppCategory =>
    catOf(`cat_${type}`) || fallbackCategory(type);
  const app = normalizeExecutableName(raw.appName);
  const domain = (raw.domain || '').toLowerCase();
  const title = (raw.title || '').toLowerCase();
  const sortedRules = [...(rules || [])].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  if (raw.isIdle) return { category: fallback('idle'), known: true, source: 'system', confidence: 1 };
  for (const rule of sortedRules) {
    let matches = false;
    if (rule.pattern_type === 'executable') matches = app === normalizeExecutableName(rule.pattern_value);
    else if (rule.pattern_type === 'domain') matches = domainMatches(domain, rule.pattern_value);
    else if (rule.pattern_type === 'title_regex') {
      try { matches = new RegExp(rule.pattern_value, 'i').test(raw.title); } catch { matches = false; }
    }
    if (matches) {
      const category = catOf(rule.category_id);
      if (category) return { category, known: true, source: 'user_rule', confidence: 1 };
    }
  }

  if (isSystemTrayApp(app)) return { category: fallback('neutral'), known: true, source: 'system', confidence: 1 };
  if (isAIAssistant(raw.appName, raw.title, raw.domain)) return { category: fallback('productive'), known: true, source: 'built_in', confidence: 0.95 };
  if (domain) {
    if (DISTRACTING_DOMAINS.some(d => domainMatches(domain, d)) || matchesDistractingKeyword(domain.split('.')[0])) {
      return { category: fallback('distracting'), known: true, source: 'built_in', confidence: 0.94 };
    }
    if (isBrowserExecutable(app)) return { category: fallback('neutral'), known: false, source: 'fallback', confidence: 0.35 };
  }
  if (DISTRACTING_EXECUTABLES.includes(app)) return { category: fallback('distracting'), known: true, source: 'built_in', confidence: 0.98 };
  if (PRODUCTIVE_EXECUTABLES.includes(app)) return { category: fallback('productive'), known: true, source: 'built_in', confidence: 0.95 };
  // A title keyword alone is weak evidence ("game theory" and "music theory"
  // are legitimate study material), so it must still go through review/search.
  if (matchesDistractingKeyword(title)) return { category: fallback('neutral'), known: false, source: 'fallback', confidence: 0.55 };
  if (isBrowserExecutable(app)) return { category: fallback('neutral'), known: false, source: 'fallback', confidence: 0.3 };

  return { category: fallback('neutral'), known: false, source: 'fallback', confidence: 0.15 };
}

export function appFingerprint(raw: Pick<RawAppInfo, 'execPath' | 'appName' | 'domain'>): string {
  const executable = normalizeExecutableName(raw.appName);
  const browser = isBrowserExecutable(executable);
  return browser
    ? `${executable}|${(raw.domain || '').trim().toLowerCase() || 'unknown'}`
    : `${executable}|${(raw.execPath || '').trim().toLowerCase()}`;
}
