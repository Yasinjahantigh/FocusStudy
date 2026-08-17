import path from 'path';
import { app, safeStorage } from 'electron';
import fs from 'fs';
import {
  AppCategory,
  CategorizationRule,
  StudySession,
  AppLog,
  ScratchpadNote,
  Language,
  WeeklyStudyBlock,
  AudioSettings,
  AISettings,
} from '../../shared/types';
import { uniqueId } from '../../shared/id';

interface StorageData {
  settings: {
    language: Language;
    musicFolderPath?: string;
    ai?: AISettings;
    audio: AudioSettings;
    /** Browser extension ID used for native-messaging host registration. */
    extensionId?: string;
  };
  weeklyBlocks: WeeklyStudyBlock[];
  sessions: StudySession[];
  categories: AppCategory[];
  rules: CategorizationRule[];
  logs: AppLog[];
  notes: ScratchpadNote[];
  activeBlockId: string | null;
  lastSessionEndDate: string | null;
}

const MAX_LOGS = 50000;
const MAX_SESSIONS = 5000;
const MAX_NOTES = 2000;
const GOOGLE_GENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function normalizeAIBaseUrl(value: string | undefined): string {
  const raw = (value || GOOGLE_GENAI_BASE_URL).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    // Migrate the old Google OpenAI-compatible URL to the native Gen AI SDK
    // endpoint used for Gemma and Google Search grounding.
    if (parsed.hostname.toLowerCase() === 'generativelanguage.googleapis.com') {
      return GOOGLE_GENAI_BASE_URL;
    }
  } catch {
    // Keep invalid/custom text here; IPC validation and the connection test
    // will provide the user-facing error without crashing the store.
  }
  return raw;
}

const DEFAULT_AUDIO: AudioSettings = {
  musicVolume: 0.6,
  noiseVolume: 0.4,
  noiseEnabled: false,
  masterMuted: false,
};

const DEFAULT_DATA: StorageData = {
  settings: {
    language: 'en',
    musicFolderPath: '',
    ai: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      model: 'gemma-4-31b-it',
    },
    audio: { ...DEFAULT_AUDIO },
    extensionId: '',
  },
  weeklyBlocks: [
    // Saturday
    { id: 'sat_school', dayOfWeek: 'saturday', subject: 'مدرسه', title: 'مدرسه', durationMinutes: 330, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'sat_hesaban', dayOfWeek: 'saturday', subject: 'حسابان', title: 'حسابان', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'sat_shimi', dayOfWeek: 'saturday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'sat_fizik', dayOfWeek: 'saturday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'sat_jobrani', dayOfWeek: 'saturday', subject: 'جبرانی', title: 'جبرانی', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'sat_routine', dayOfWeek: 'saturday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Sunday
    { id: 'sun_school', dayOfWeek: 'sunday', subject: 'مدرسه', title: 'مدرسه', durationMinutes: 330, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'sun_hesaban', dayOfWeek: 'sunday', subject: 'حسابان', title: 'حسابان', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'sun_shimi', dayOfWeek: 'sunday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'sun_fizik', dayOfWeek: 'sunday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'sun_jobrani', dayOfWeek: 'sunday', subject: 'جبرانی', title: 'جبرانی', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'sun_routine', dayOfWeek: 'sunday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Monday
    { id: 'mon_hesaban_1', dayOfWeek: 'monday', subject: 'حسابان', title: 'حسابان (نوبت اول)', durationMinutes: 90, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'mon_hesaban_2', dayOfWeek: 'monday', subject: 'حسابان', title: 'حسابان (نوبت دوم)', durationMinutes: 90, startTime: '10:00', tasks: [], allowedApps: [] },
    { id: 'mon_shimi', dayOfWeek: 'monday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '12:00', tasks: [], allowedApps: [] },
    { id: 'mon_fizik', dayOfWeek: 'monday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'mon_jobrani_1', dayOfWeek: 'monday', subject: 'جبرانی', title: 'جبرانی (ویژه)', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'mon_jobrani_2', dayOfWeek: 'monday', subject: 'جبرانی', title: 'جبرانی (نوبت دوم)', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'mon_jobrani_3', dayOfWeek: 'monday', subject: 'جبرانی', title: 'جبرانی (نوبت سوم)', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'mon_routine', dayOfWeek: 'monday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Tuesday
    { id: 'tue_school', dayOfWeek: 'tuesday', subject: 'مدرسه', title: 'مدرسه', durationMinutes: 330, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'tue_hesaban', dayOfWeek: 'tuesday', subject: 'حسابان', title: 'حسابان', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'tue_shimi', dayOfWeek: 'tuesday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'tue_fizik', dayOfWeek: 'tuesday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'tue_jobrani', dayOfWeek: 'tuesday', subject: 'جبرانی', title: 'جبرانی', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'tue_routine', dayOfWeek: 'tuesday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Wednesday
    { id: 'wed_school', dayOfWeek: 'wednesday', subject: 'مدرسه', title: 'مدرسه', durationMinutes: 330, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'wed_hesaban', dayOfWeek: 'wednesday', subject: 'حسابان', title: 'حسابان', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'wed_shimi', dayOfWeek: 'wednesday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'wed_fizik', dayOfWeek: 'wednesday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'wed_jobrani', dayOfWeek: 'wednesday', subject: 'جبرانی', title: 'جبرانی', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'wed_routine', dayOfWeek: 'wednesday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Thursday
    { id: 'thu_school', dayOfWeek: 'thursday', subject: 'مدرسه', title: 'مدرسه', durationMinutes: 330, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'thu_hesaban', dayOfWeek: 'thursday', subject: 'حسابان', title: 'حسابان', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'thu_shimi', dayOfWeek: 'thursday', subject: 'شیمی', title: 'شیمی', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'thu_fizik', dayOfWeek: 'thursday', subject: 'فیزیک', title: 'فیزیک', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'thu_jobrani', dayOfWeek: 'thursday', subject: 'جبرانی', title: 'جبرانی', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'thu_routine', dayOfWeek: 'thursday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },

    // Friday
    { id: 'fri_azmoon_1', dayOfWeek: 'friday', subject: 'آزمون', title: 'آزمون (نوبت اول)', durationMinutes: 90, startTime: '08:00', tasks: [], allowedApps: [] },
    { id: 'fri_azmoon_2', dayOfWeek: 'friday', subject: 'آزمون', title: 'آزمون (نوبت دوم)', durationMinutes: 90, startTime: '10:00', tasks: [], allowedApps: [] },
    { id: 'fri_tahlil_1', dayOfWeek: 'friday', subject: 'تحلیل', title: 'تحلیل آزمون (نوبت اول)', durationMinutes: 90, startTime: '12:00', tasks: [], allowedApps: [] },
    { id: 'fri_tahlil_2', dayOfWeek: 'friday', subject: 'تحلیل', title: 'تحلیل آزمون (نوبت دوم)', durationMinutes: 90, startTime: '16:00', tasks: [], allowedApps: [] },
    { id: 'fri_hendeseh', dayOfWeek: 'friday', subject: 'هندسه', title: 'هندسه', durationMinutes: 90, startTime: '18:00', tasks: [], allowedApps: [] },
    { id: 'fri_jobrani_1', dayOfWeek: 'friday', subject: 'جبرانی', title: 'جبرانی (نوبت اول)', durationMinutes: 90, startTime: '20:00', tasks: [], allowedApps: [] },
    { id: 'fri_jobrani_2', dayOfWeek: 'friday', subject: 'جبرانی', title: 'جبرانی (نوبت دوم)', durationMinutes: 90, startTime: '22:00', tasks: [], allowedApps: [] },
    { id: 'fri_routine', dayOfWeek: 'friday', subject: 'روتین', title: 'روتین آخر شب', durationMinutes: 60, startTime: '23:30', tasks: [], allowedApps: [] },
  ],
  sessions: [],
  categories: [
    { id: 'cat_productive', name: 'Productive', type: 'productive', color_hex: '#10B981' },
    { id: 'cat_distracting', name: 'Distracting', type: 'distracting', color_hex: '#EF4444' },
    { id: 'cat_neutral', name: 'Neutral', type: 'neutral', color_hex: '#64748B' },
    { id: 'cat_idle', name: 'Away / Idle', type: 'idle', color_hex: '#94A3B8' },
  ],
  rules: [
    { id: 'rule_code', pattern_type: 'executable', pattern_value: 'Code.exe', category_id: 'cat_productive', priority: 100 },
    { id: 'rule_devenv', pattern_type: 'executable', pattern_value: 'devenv.exe', category_id: 'cat_productive', priority: 100 },
    { id: 'rule_notion', pattern_type: 'executable', pattern_value: 'Notion.exe', category_id: 'cat_productive', priority: 90 },
    { id: 'rule_obsidian', pattern_type: 'executable', pattern_value: 'Obsidian.exe', category_id: 'cat_productive', priority: 90 },
    { id: 'rule_anki', pattern_type: 'executable', pattern_value: 'anki.exe', category_id: 'cat_productive', priority: 90 },
    { id: 'rule_discord', pattern_type: 'executable', pattern_value: 'Discord.exe', category_id: 'cat_distracting', priority: 100 },
    { id: 'rule_steam', pattern_type: 'executable', pattern_value: 'steam.exe', category_id: 'cat_distracting', priority: 100 },
    { id: 'rule_youtube', pattern_type: 'domain', pattern_value: 'youtube.com', category_id: 'cat_distracting', priority: 80 },
    { id: 'rule_reddit', pattern_type: 'domain', pattern_value: 'reddit.com', category_id: 'cat_distracting', priority: 80 },
    { id: 'rule_twitter', pattern_type: 'domain', pattern_value: 'x.com', category_id: 'cat_distracting', priority: 80 },
    { id: 'rule_aparat', pattern_type: 'domain', pattern_value: 'aparat.com', category_id: 'cat_distracting', priority: 80 },
    { id: 'rule_github', pattern_type: 'domain', pattern_value: 'github.com', category_id: 'cat_productive', priority: 80 },
    { id: 'rule_stackoverflow', pattern_type: 'domain', pattern_value: 'stackoverflow.com', category_id: 'cat_productive', priority: 80 },
    { id: 'rule_chatgpt', pattern_type: 'domain', pattern_value: 'chatgpt.com', category_id: 'cat_productive', priority: 80 },
    { id: 'rule_claude', pattern_type: 'domain', pattern_value: 'claude.ai', category_id: 'cat_productive', priority: 80 },
  ],
  logs: [],
  notes: [],
  activeBlockId: null,
  lastSessionEndDate: null,
};

function deepMergeAudio(base: AudioSettings, override?: Partial<AudioSettings>): AudioSettings {
  return {
    musicVolume: clampNumber(Number(override?.musicVolume ?? base.musicVolume), 0, 1, 0.6),
    noiseVolume: clampNumber(Number(override?.noiseVolume ?? base.noiseVolume), 0, 1, 0.4),
    noiseEnabled: Boolean(override?.noiseEnabled ?? base.noiseEnabled),
    masterMuted: Boolean(override?.masterMuted ?? base.masterMuted),
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

class JSONStore {
  private filePath: string;
  private aiKeyFilePath: string;
  private data: StorageData;
  private saveTimer: NodeJS.Timeout | null = null;
  private needsFlush = false;

  constructor() {
    const userDataPath = app ? app.getPath('userData') : path.join(process.cwd(), 'data');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    this.filePath = path.join(userDataPath, 'focus_study_store.json');
    this.aiKeyFilePath = path.join(userDataPath, 'focus_study_ai.key');
    this.data = this.load();
  }

  private readSecureAIKey(): string | undefined {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.aiKeyFilePath)) return undefined;
      return safeStorage.decryptString(fs.readFileSync(this.aiKeyFilePath));
    } catch (err) {
      console.warn('[JSONStore] Secure AI key could not be read:', err);
      return undefined;
    }
  }

  private writeSecureAIKey(value: string) {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const encrypted = safeStorage.encryptString(value);
    const tmpPath = `${this.aiKeyFilePath}.tmp`;
    fs.writeFileSync(tmpPath, encrypted);
    fs.renameSync(tmpPath, this.aiKeyFilePath);
    return true;
  }

  /** Migrates an older plaintext key once Electron's OS-backed encryption is ready. */
  public migrateSensitiveSettings() {
    const plaintext = this.data.settings.ai?.apiKey || '';
    if (!plaintext || !safeStorage.isEncryptionAvailable()) return;
    try {
      if (this.writeSecureAIKey(plaintext)) {
        this.data.settings.ai!.apiKey = '';
        this.scheduleSave();
      }
    } catch (err) {
      console.warn('[JSONStore] AI key migration skipped:', err);
    }
  }

  private load(): StorageData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8').trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          const merged = this.mergeWithDefaults(parsed);
          this.repairData(merged);
          return merged;
        }
      }
    } catch (err) {
      console.error('[JSONStore] Error reading JSON store, backing up and starting fresh:', err);
      try {
        const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
        fs.renameSync(this.filePath, backupPath);
        console.warn(`[JSONStore] Corrupt store backed up to: ${backupPath}`);
      } catch {
        // ignore backup failure
      }
    }
    return structuredClone(DEFAULT_DATA);
  }

  private mergeWithDefaults(parsed: any): StorageData {
    const data: StorageData = structuredClone(DEFAULT_DATA);

    if (parsed && typeof parsed === 'object') {
      if (parsed.settings && typeof parsed.settings === 'object') {
        data.settings.language = parsed.settings.language === 'fa' ? 'fa' : 'en';
        if (typeof parsed.settings.musicFolderPath === 'string') data.settings.musicFolderPath = parsed.settings.musicFolderPath;
        if (parsed.settings.ai && typeof parsed.settings.ai === 'object') {
          data.settings.ai = {
            baseUrl: normalizeAIBaseUrl(typeof parsed.settings.ai.baseUrl === 'string' ? parsed.settings.ai.baseUrl : DEFAULT_DATA.settings.ai!.baseUrl),
            apiKey: typeof parsed.settings.ai.apiKey === 'string' ? parsed.settings.ai.apiKey : '',
            model: typeof parsed.settings.ai.model === 'string' ? parsed.settings.ai.model : DEFAULT_DATA.settings.ai!.model,
            searchEnabled: parsed.settings.ai.searchEnabled === true,
          };
        }
        data.settings.audio = deepMergeAudio(DEFAULT_AUDIO, parsed.settings.audio);
        if (typeof parsed.settings.extensionId === 'string') {
          data.settings.extensionId = String(parsed.settings.extensionId).trim().toLowerCase().slice(0, 64);
        }
      }

      if (Array.isArray(parsed.weeklyBlocks)) data.weeklyBlocks = parsed.weeklyBlocks;
      if (Array.isArray(parsed.sessions)) data.sessions = parsed.sessions;
      if (Array.isArray(parsed.categories) && parsed.categories.length > 0) data.categories = parsed.categories;
      if (Array.isArray(parsed.rules)) {
        for (const r of parsed.rules) {
          if (
            r && typeof r === 'object' && r.id && r.pattern_type && r.pattern_value && r.category_id && typeof r.priority === 'number' &&
            !data.rules.some(existing => existing.id === r.id || (existing.pattern_type === r.pattern_type && existing.pattern_value.toLowerCase() === String(r.pattern_value).toLowerCase()))
          ) {
            data.rules.push(r);
          }
        }
      }
      if (Array.isArray(parsed.logs)) data.logs = parsed.logs;
      if (Array.isArray(parsed.notes)) data.notes = parsed.notes;
      if (typeof parsed.activeBlockId === 'string') data.activeBlockId = parsed.activeBlockId;
      if (typeof parsed.lastSessionEndDate === 'string') data.lastSessionEndDate = parsed.lastSessionEndDate;
    }
    return data;
  }

  /**
   * Sanitizes invariants so a partial/corrupt write cannot break the app.
   */
  private repairData(data: StorageData) {
    if (!Array.isArray(data.categories) || data.categories.length === 0) data.categories = DEFAULT_DATA.categories;
    data.logs = Array.isArray(data.logs) ? data.logs.slice(-MAX_LOGS) : [];
    data.sessions = Array.isArray(data.sessions) ? data.sessions.slice(-MAX_SESSIONS) : [];
    data.notes = Array.isArray(data.notes) ? data.notes.slice(-MAX_NOTES) : [];
    if (!Array.isArray(data.rules)) data.rules = DEFAULT_DATA.rules;
    if (!Array.isArray(data.weeklyBlocks)) data.weeklyBlocks = [];
    if (data.activeBlockId && !data.weeklyBlocks.some(b => b.id === data.activeBlockId)) {
      data.activeBlockId = null;
    }
  }

  /**
   * Schedules a debounced atomic save. High-frequency callers (per-second tracking)
   * should rely on this; critical operations call flush().
   */
  private scheduleSave() {
    this.needsFlush = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
  }

  /**
   * Writes the store atomically (temp file + rename) on the main thread.
   */
  public flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.needsFlush) return;
    this.needsFlush = false;

    try {
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Roll back the flag so the next mutation retries the save.
      this.needsFlush = true;
      console.error('[JSONStore] Error flushing store:', err);
    }
  }

  /**
   * Marks any in-flight sessions as abandoned. Called on app startup so a crash or
   * an unclean quit never leaves a session stuck in 'running'.
   */
  public abandonRunningSessions(): number {
    const now = new Date().toISOString();
    let count = 0;
    for (const session of this.data.sessions) {
      if (session.status === 'running' || session.status === 'paused') {
        session.status = 'abandoned';
        session.endTime = now;
        count++;
      }
    }
    if (count > 0) this.scheduleSave();
    return count;
  }

  // ---------- Settings ----------

  public getLanguage(): Language {
    return this.data.settings.language || 'en';
  }

  public setLanguage(lang: Language) {
    this.data.settings.language = lang;
    this.scheduleSave();
  }

  public getMusicFolderPath(): string {
    return this.data.settings.musicFolderPath || '';
  }

  public setMusicFolderPath(folderPath: string) {
    this.data.settings.musicFolderPath = folderPath;
    this.scheduleSave();
  }

  public getAISettings(): AISettings {
    const ai = this.data.settings.ai;
    return {
      baseUrl: normalizeAIBaseUrl(ai?.baseUrl),
      apiKey: this.readSecureAIKey() || ai?.apiKey || '',
      model: ai?.model || 'gemma-4-31b-it',
      searchEnabled: ai?.searchEnabled ?? false,
    };
  }

  public setAISettings(ai: Partial<AISettings>) {
    const current = this.getAISettings();
    const nextKey = ai.apiKey ?? current.apiKey;
    let storedKey = nextKey;
    try {
      if (nextKey && this.writeSecureAIKey(nextKey)) storedKey = '';
      if (!nextKey && fs.existsSync(this.aiKeyFilePath)) fs.unlinkSync(this.aiKeyFilePath);
    } catch (err) {
      console.warn('[JSONStore] Secure AI key write failed; keeping legacy storage:', err);
    }
    this.data.settings.ai = {
      baseUrl: normalizeAIBaseUrl(ai.baseUrl || current.baseUrl),
      apiKey: storedKey,
      model: ai.model || current.model,
      searchEnabled: ai.searchEnabled ?? current.searchEnabled,
    };
    this.scheduleSave();
  }

  public getAudioSettings(): AudioSettings {
    return this.data.settings.audio;
  }

  public getExtensionId(): string {
    return this.data.settings.extensionId || '';
  }

  public setExtensionId(id: string) {
    this.data.settings.extensionId = String(id || '').trim().toLowerCase().slice(0, 64);
    this.scheduleSave();
  }

  public setAudioSettings(audio: Partial<AudioSettings>) {
    this.data.settings.audio = deepMergeAudio(this.data.settings.audio, audio);
    this.scheduleSave();
  }

  // ---------- Active block ----------

  public getActiveBlockId(): string | null {
    return this.data.activeBlockId;
  }

  public setActiveBlockId(id: string | null) {
    if (id !== null && !this.data.weeklyBlocks.some(b => b.id === id)) return;
    this.data.activeBlockId = id;
    this.scheduleSave();
  }

  // ---------- Weekly Study Blocks ----------

  public getWeeklyBlocks(): WeeklyStudyBlock[] {
    return this.data.weeklyBlocks || [];
  }

  public saveWeeklyBlock(block: WeeklyStudyBlock): WeeklyStudyBlock {
    if (!this.data.weeklyBlocks) this.data.weeklyBlocks = [];
    const idx = this.data.weeklyBlocks.findIndex(b => b.id === block.id);
    if (idx !== -1) {
      this.data.weeklyBlocks[idx] = block;
    } else {
      this.data.weeklyBlocks.push(block);
    }
    this.scheduleSave();
    return block;
  }

  public deleteWeeklyBlock(id: string) {
    if (!this.data.weeklyBlocks) return;
    this.data.weeklyBlocks = this.data.weeklyBlocks.filter(b => b.id !== id);
    if (this.data.activeBlockId === id) this.data.activeBlockId = null;
    this.scheduleSave();
  }

  public toggleTaskCompleted(blockId: string, taskId: string) {
    if (!this.data.weeklyBlocks) return;
    const block = this.data.weeklyBlocks.find(b => b.id === blockId);
    if (block) {
      const task = block.tasks.find(t => t.id === taskId);
      if (task) {
        task.completed = !task.completed;
        this.scheduleSave();
      }
    }
  }

  /**
   * Marks today's block tasks as pending again so a weekly schedule can repeat
   * every day instead of accumulating stale checkmarks.
   */
  public resetDayTasks(blockId: string) {
    const block = this.data.weeklyBlocks.find(b => b.id === blockId);
    if (block) {
      for (const task of block.tasks) {
        task.completed = false;
      }
      this.scheduleSave();
      return true;
    }
    return false;
  }

  // ---------- Categories & Rules ----------

  public getCategories(): AppCategory[] {
    return this.data.categories;
  }

  public getRules(): CategorizationRule[] {
    return this.data.rules;
  }

  public addRule(rule: Omit<CategorizationRule, 'id'>): CategorizationRule {
    const newRule: CategorizationRule = { id: uniqueId('rule'), ...rule };
    this.data.rules.push(newRule);
    this.scheduleSave();
    return newRule;
  }

  public deleteRule(ruleId: string) {
    this.data.rules = this.data.rules.filter(r => r.id !== ruleId);
    this.scheduleSave();
  }

  // ---------- Sessions ----------

  public createSession(session: StudySession) {
    this.data.sessions.push(session);
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions = this.data.sessions.slice(-MAX_SESSIONS);
    }
    this.scheduleSave();
  }

  public updateSession(id: string, update: Partial<StudySession>) {
    const idx = this.data.sessions.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.data.sessions[idx] = { ...this.data.sessions[idx], ...update };
      this.scheduleSave();
    }
  }

  public getSessionById(id: string): StudySession | undefined {
    return this.data.sessions.find(s => s.id === id);
  }

  public getRecentSessions(limit = 10): StudySession[] {
    return [...this.data.sessions]
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, limit);
  }

  public getSessionsForRange(startDate: string, endDate: string): StudySession[] {
    return this.data.sessions.filter(s => {
      const sDate = s.startTime.slice(0, 10);
      return sDate >= startDate && sDate <= endDate;
    });
  }

  public recordSessionEnd(dateStr: string) {
    this.data.lastSessionEndDate = dateStr;
    this.scheduleSave();
  }

  public getLastSessionEndDate(): string | null {
    return this.data.lastSessionEndDate;
  }

  // ---------- Logs ----------

  public addAppLog(log: AppLog) {
    const lastLog = this.data.logs.length > 0 ? this.data.logs[this.data.logs.length - 1] : null;

    if (
      lastLog &&
      Number(lastLog.durationSeconds) > 0 &&
      lastLog.appName === log.appName &&
      lastLog.windowTitle === log.windowTitle &&
      lastLog.domain === log.domain &&
      lastLog.sessionId === log.sessionId &&
      lastLog.categoryId === log.categoryId
    ) {
      lastLog.endTime = log.endTime;
      lastLog.durationSeconds += log.durationSeconds;
    } else {
      this.data.logs.push(log);
      if (this.data.logs.length > MAX_LOGS) {
        this.data.logs = this.data.logs.slice(-MAX_LOGS);
      }
    }
    this.scheduleSave();
  }

  public getAppLogsForDate(dateStr: string): AppLog[] {
    return this.data.logs.filter(l => l.startTime.slice(0, 10) === dateStr);
  }

  public getAppLogsForRange(startDate: string, endDate: string): AppLog[] {
    return this.data.logs.filter(l => {
      const d = l.startTime.slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  }

  // ---------- Notes ----------

  public saveNote(content: string, tags: string[] = [], sessionId?: string): ScratchpadNote {
    const note: ScratchpadNote = {
      id: uniqueId('note'),
      sessionId,
      content,
      tags,
      isProcessed: false,
      createdAt: new Date().toISOString(),
    };
    this.data.notes.unshift(note);
    if (this.data.notes.length > MAX_NOTES) {
      this.data.notes = this.data.notes.slice(0, MAX_NOTES);
    }
    this.scheduleSave();
    return note;
  }

  public updateNote(id: string, content: string, tags: string[]) {
    const note = this.data.notes.find(n => n.id === id);
    if (note) {
      note.content = content;
      note.tags = tags;
      this.scheduleSave();
    }
  }

  public getNotes(sessionId?: string): ScratchpadNote[] {
    if (sessionId) {
      return this.data.notes.filter(n => n.sessionId === sessionId);
    }
    return this.data.notes;
  }

  public toggleNoteProcessed(noteId: string) {
    const idx = this.data.notes.findIndex(n => n.id === noteId);
    if (idx !== -1) {
      this.data.notes[idx].isProcessed = !this.data.notes[idx].isProcessed;
      this.scheduleSave();
    }
  }

  public deleteNote(noteId: string) {
    this.data.notes = this.data.notes.filter(n => n.id !== noteId);
    this.scheduleSave();
  }

  // ---------- Data Export ----------

  /**
   * Returns a complete export payload for backup/analysis.
   * API keys are redacted.
   */
  public exportAll(): {
    settings: { language: string; musicFolderPath?: string; audio: AudioSettings };
    weeklyBlocks: WeeklyStudyBlock[];
    sessions: StudySession[];
    categories: AppCategory[];
    rules: CategorizationRule[];
    logs: AppLog[];
    notes: ScratchpadNote[];
  } {
    return {
      settings: {
        language: this.data.settings.language,
        musicFolderPath: this.data.settings.musicFolderPath,
        audio: this.data.settings.audio,
      },
      weeklyBlocks: this.data.weeklyBlocks,
      sessions: this.data.sessions,
      categories: this.data.categories,
      rules: this.data.rules,
      logs: this.data.logs,
      notes: this.data.notes,
    };
  }

  /**
   * Returns a CSV string of sessions + logs for spreadsheet analysis.
   */
  public exportCsv(): string {
    const sessions = this.data.sessions;
    const logs = this.data.logs;
    const categories = this.data.categories;
    const catMap = new Map(categories.map(c => [c.id, c]));

    // Sessions CSV
    const sessionHeaders = [
      'id', 'title', 'subjectTag', 'mode', 'targetDurationSeconds',
      'actualDurationSeconds', 'productiveSeconds', 'distractingSeconds',
      'idleSeconds', 'status', 'focusScore', 'startTime', 'endTime'
    ];

    const sessionRows = sessions.map(s => [
      s.id,
      `"${s.title.replace(/"/g, '""')}"`,
      `"${s.subjectTag.replace(/"/g, '""')}"`,
      s.mode,
      s.targetDurationSeconds,
      s.actualDurationSeconds,
      s.productiveSeconds,
      s.distractingSeconds,
      s.idleSeconds,
      s.status,
      s.focusScore,
      s.startTime,
      s.endTime || '',
    ].join(','));

    // App logs CSV
    const logHeaders = [
      'id', 'sessionId', 'appName', 'executablePath', 'windowTitle',
      'domain', 'categoryId', 'categoryType', 'categoryColor',
      'startTime', 'endTime', 'durationSeconds'
    ];

    const logRows = logs.map(l => {
      const cat = catMap.get(l.categoryId);
      return [
        l.id ?? '',
        l.sessionId ?? '',
        `"${l.appName.replace(/"/g, '""')}"`,
        `"${l.executablePath.replace(/"/g, '""')}"`,
        `"${l.windowTitle.replace(/"/g, '""')}"`,
        `"${(l.domain || '').replace(/"/g, '""')}"`,
        l.categoryId,
        cat?.type || '',
        cat?.color_hex || '',
        l.startTime,
        l.endTime,
        l.durationSeconds,
      ].join(',');
    });

    return [
      '=== Sessions ===',
      sessionHeaders.join(','),
      ...sessionRows,
      '',
      '=== App Logs ===',
      logHeaders.join(','),
      ...logRows,
    ].join('\n');
  }
}

export const storeSingleton = new JSONStore();
