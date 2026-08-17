# FocusStudy

A Windows desktop application for focused study sessions, laptop usage monitoring, ambient audio, and productivity tracking.

> [🇮🇷 مستندات فارسی](#مستندات-فارسی)

## Features

- **Study Timer** — Pomodoro, custom duration, and stopwatch modes with session completion chimes
- **App Tracker** — Real-time Win32 foreground window detection with intelligent categorization (productive / distracting / neutral / idle)
- **AI Environment Audit** — Pre-session workspace analysis using dual AI paths (Google GenAI SDK + OpenAI-compatible endpoints) with a 3-verdict system
- **Focus Lock** — Configurable app blocking during sessions with AI-powered exception requests
- **Weekly Planner** — Schedule study blocks with subjects, tasks, and allowed tools
- **Analytics Dashboard** — Daily/weekly/monthly focus scores, streak tracking, app usage breakdown, subject distribution, JSON/CSV export
- **Ambient Audio** — Procedural brown noise + local music folder player with shuffle/repeat
- **Scratchpad** — Quick thought capture with tagging (global `Ctrl+Alt+S`)
- **i18n** — English & Persian (RTL)
- **Mini Widget** — Always-on-top HUD for quick timer control
- **Browser Bridge (optional)** — Chrome/Edge extension reports the *real* active tab (title + hostname only) to the tracker

## Downloads

Grab the latest installer from the [Releases](../../releases) page:

| Artifact | Description |
|----------|-------------|
| `FocusStudy Setup x.y.z.exe` | NSIS installer (x64) |
| `FocusStudy-BrowserBridge-vx.y.z.zip` | Optional browser extension (load unpacked) |

> The app is not code-signed yet, so Windows SmartScreen may show an "Unknown publisher" warning.

## AI Configuration

The AI features (environment audit, focus-lock exceptions, review) are optional and need one API key you provide yourself:

1. Get a free API key from **Google AI Studio**: https://aistudio.google.com/apikey
2. In FocusStudy: **Settings** → paste the key. Defaults work out of the box:
   - Base URL: `https://generativelanguage.googleapis.com/v1beta`
   - Model: `gemma-4-31b-it`
3. Optionally enable **AI Web Search** for up-to-date answers.

Any OpenAI-compatible endpoint works too (LM Studio, Ollama, local Gemma builds…) — just set its Base URL. The key is stored encrypted via the Windows OS keychain when available.

## Browser Bridge (optional)

The bundled Chrome/Edge extension tells FocusStudy the real active browser tab instead of just the window title.

It sends **tab titles + hostnames only** — never full URLs, page content, cookies, or credentials.

1. Install FocusStudy 1.1.0+ and start it.
2. Unzip `FocusStudy-BrowserBridge-vx.y.z.zip` and load the folder unpacked in `edge://extensions` or `chrome://extensions` (enable *Developer mode*) → *Load unpacked*.
3. Click the FocusStudy extension icon → copy the extension ID.
4. In FocusStudy: **Settings → Browser Bridge** → paste the ID → save.
5. **Restart the browser**, then press *Test connection* in the extension popup — it should say "connected".

If the test fails, the popup now shows the exact native-host error. See [browser-extension/README.md](browser-extension/README.md) for troubleshooting and manual registration details.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Toggle timer (Timer tab focused) |
| `R` | Reset timer (with confirmation) |
| `Ctrl+Alt+S` | Open scratchpad (global) |

## Development

```bash
# Install dependencies
npm ci

# Type-check
npm run typecheck

# Tests (node:test, no framework needed)
npm test

# Dev server (Electron + Vite HMR)
npm run dev
```

### Building for release

```bash
# NSIS installer into release/ (no publish)
npm run package

# Zip the browser extension for release
npm run ext:zip
```

Release checklist: [RELEASE.md](RELEASE.md). Change history: [CHANGELOG.md](CHANGELOG.md).

## Architecture

```
src/
├── main/           # Electron main process
│   ├── index.ts    # App entry, bridge mode, local-media protocol
│   ├── ipc/        # IPC handlers (36+)
│   ├── services/   # TimerEngine, AppTracker, RulesEngine, AIEvaluator,
│   │               # InterventionController, nativeHost (browser bridge)
│   ├── native/     # Win32 FFI via Koffi (GetForegroundWindow, EnumWindows…)
│   └── db/         # JSON persistence (jsonStore)
├── renderer/       # React 18 frontend
│   ├── components/ # Timer, Tracker, Planner, Analytics, Audio, Settings…
│   ├── i18n/       # EN/FA locales + RTL
│   └── services/   # SoundEngine
├── shared/         # Types, classification, scoring, streak, bridge protocol
└── preload/        # Context bridge (secure IPC, contextIsolation: true)
browser-extension/  # Chrome/Edge MV3 bridge extension
build/              # electron-builder hooks, bridge relay, icons
```

### Tech Stack

- **Electron 31** + **React 18** + **TypeScript** + **Vite** (`vite-plugin-electron/simple`)
- **Koffi** for Win32 FFI (no native compilation)
- **@google/genai** + fetch-based OpenAI-compatible dual AI paths
- **Tailwind CSS**, **Recharts**, **zustand**, **i18next**
- **node:test** for unit tests

### Security & privacy

- Renderer windows run with `contextIsolation: true`, `nodeIntegration: false`; all IPC goes through a whitelisted preload bridge.
- `local-media://` protocol is restricted to the configured music folder (path traversal blocked) and streams with Range support.
- The API key is stored encrypted via the Windows OS keychain when available.
- The Browser Bridge transmits only tab titles and hostnames to the local native host — nothing leaves your machine by itself.

## License

MIT — see [LICENSE](LICENSE).

---

# مستندات فارسی

## FocusStudy چیست؟

FocusStudy یک اپلیکیشن دسکتاپ ویندوز برای جلسات مطالعه متمرکز است: تایمر پومودورو، پایش برنامه‌های فعال لپ‌تاپ، قفل تمرکز با بررسی هوش مصنوعی، برنامه‌ریز هفتگی، تحلیل و آمار، صدای پس‌زمینه و رابط کاربری کامل فارسی (راست‌به‌چپ).

## امکانات

- **تایمر مطالعه** — پومودورو، مدت سفارشی و زمان‌سنج با صدای پایان جلسه
- **ردیاب برنامه‌ها** — تشخیص لحظه‌ای پنجره فعال ویندوز و دسته‌بندی هوشمند (مفید / حواس‌پرت‌کننده / خنثی / بیکار)
- **بررسی محیط با AI** — تحلیل پنجره‌ها و تب‌های باز قبل از شروع جلسه با دو مسیر هوش مصنوعی (Google GenAI و هر endpoint سازگار با OpenAI)
- **قفل تمرکز** — مسدودسازی برنامه‌های مزاحم حین جلسه با امکان درخواست استثنا از AI
- **برنامه هفتگی** — پارت‌های مطالعاتی با موضوع، چک‌لیست کارها و ابزارهای مجاز
- **داشبورد تحلیل** — امتیاز تمرکز روزانه/هفتگی/ماهانه، زنجیره روزها، تفکیک استفاده از برنامه‌ها، خروجی JSON و CSV
- **صدای محیط** — نویز قهوه‌ای + پخش‌کننده موسیقی محلی
- **دفترچه افکار مزاحم** — ثبت سریع فکرهای مزاحم با برچسب (`Ctrl+Alt+S`)
- **پل مرورگر (اختیاری)** — افزونه کروم/اج برای دیدن تب واقعی فعال (فقط عنوان تب و نام دامنه)

## دانلود

آخرین نسخه را از صفحه [Releases](../../releases) بگیرید:

- `FocusStudy Setup x.y.z.exe` — نصب‌کننده (NSIS, x64)
- `FocusStudy-BrowserBridge-vx.y.z.zip` — افزونه مرورگر (اختیاری)

> برنامه هنوز امضای دیجیتال ندارد؛ ممکن است ویندوز هشدار «ناشر ناشناس» نشان دهد.

## تنظیم هوش مصنوعی

قابلیت‌های AI (تحلیل محیط، استثنای قفل تمرکز، بررسی برنامه‌ها) اختیاری‌اند و فقط به یک کلید API نیاز دارند که خودتان می‌سازید:

1. کلید رایگان از **Google AI Studio** بگیرید: https://aistudio.google.com/apikey
2. در FocusStudy بخش **تنظیمات**: کلید را وارد کنید. مقادیر پیش‌فرض آماده‌اند:
   - Base URL: `https://generativelanguage.googleapis.com/v1beta`
   - مدل: `gemma-4-31b-it`
3. در صورت نیاز، **جستجوی وب AI** را فعال کنید.

هر endpoint سازگار با OpenAI (مثل LM Studio، Ollama، مدل‌های محلی Gemma) هم جواب می‌دهد — فقط Base URL را تغییر دهید. کلید API در صورت امکان با رمزنگاری ویندوز ذخیره می‌شود.

## پل مرورگر (اختیاری)

افزونه مرورگر، تب واقعی فعال را به جای عنوان کلی پنجره به FocusStudy گزارش می‌دهد. فقط **عنوان تب و نام دامنه** فرستاده می‌شود — هرگز URL کامل، محتوای صفحه، کوکی یا اطلاعات ورود.

1. FocusStudy نسخه ۱.۱.۰ یا جدیدتر را نصب و اجرا کنید.
2. فایل `FocusStudy-BrowserBridge-vx.y.z.zip` را از حالت فشرده خارج کنید و پوشه را در `edge://extensions` یا `chrome://extensions` با فعال بودن حالت توسعه، *Load unpacked* کنید.
3. روی آیکون افزونه کلیک و شناسه (Extension ID) را کپی کنید.
4. در FocusStudy: **تنظیمات → Browser Bridge** → شناسه را وارد و ذخیره کنید.
5. **مرورگر را کامل ببندید و دوباره باز کنید**، سپس در پنجره افزونه دکمه «تست اتصال» را بزنید — باید «اتصال برقرار شد» را ببینید.

اگر تست شکست خورد، پنجره افزونه خطای دقیق native host را نشان می‌دهد. جزئیات بیشتر و ثبت دستی: [browser-extension/README.md](browser-extension/README.md)

## توسعه

```bash
npm ci            # نصب وابستگی‌ها
npm run typecheck # بررسی تایپ
npm test          # تست‌ها (node:test)
npm run dev       # اجرای توسعه (Electron + Vite HMR)
```

ساخت خروجی:

```bash
npm run package   # نصب‌کننده NSIS در پوشه release
npm run ext:zip   # زیپ افزونه مرورگر برای انتشار
```

## حریم خصوصی و امنیت

- پنجره‌های برنامه با `contextIsolation: true` و بدون `nodeIntegration` اجرا می‌شوند؛ ارتباط فقط از طریق پل امن IPC.
- پروتکل `local-media://` فقط به پوشه موسیقی تنظیم‌شده دسترسی دارد (جلوگیری از دسترسی به مسیرهای دیگر).
- کلید API در صورت امکان با رمزنگاری ویندوز (Keychain) ذخیره می‌شود.
- پل مرورگر فقط عنوان تب و دامنه را به native host محلی می‌فرستد؛ چیزی به‌طور مستقل از دستگاه شما خارج نمی‌شود.

## لایسنس

MIT — [LICENSE](LICENSE)
