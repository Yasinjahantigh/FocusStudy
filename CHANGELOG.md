# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-08-17

### Fixed
- **Browser Bridge worked for exactly one connection and then went silent forever** (the "installed but nothing happens" bug): Chrome/Edge parse the native host's stdout as 4-byte little-endian length frames, but the Electron GUI executable (`FocusStudyBrowserBridge.exe`) launched directly by the browser emits stray bytes during its GUI boot (a `\r\n` from the Chromium runtime + the Win32 FFI init log) *before* the relay process takes over. Those bytes desync the frame stream, the reply never parses, and the browser silently disconnects. Fixed with a tiny console shim `FocusStudyBridge.exe` (compiled at package time from `build/native-host-shim.cs`) that Chrome launches instead: it writes nothing to stdout and relays the browser pipes into the `ELECTRON_RUN_AS_NODE` bridge script. The native-messaging manifest now points at the shim, with automatic fallback to the GUI binary if no C# compiler is present.
- **Browser Bridge extension now reports errors**: the popup shows the real native-host error (missing host, ID mismatch, antivirus block) instead of a generic message; `connectNative` failures and `chrome.runtime.lastError` are captured and surfaced.
- Native-messaging handshake timeout raised from 1.5s to 3s (first launch of the Electron host binary on Windows is slow).
- Removed the unsupported `windows.onFocusChanged` listener from the MV3 service worker (it is filtered out by Chromium anyway; tab activation/update events cover focus switches).
- Dropped the unnecessary `host_permissions: <all_urls>` from the extension manifest (privacy: only `tabs` + `nativeMessaging` are needed for titles/hostnames).
- The relay (`bridge-entry.js`) hardens its stdout: all `console.*` goes to stderr and `stdout.write` accepts frame buffers only, so nothing can pollute the native-messaging transport.
- **i18n**: `en.json`/`fa.json` contained a duplicated top-level `common` object, so `JSON.parse` silently dropped `common.yes`/`common.no` (used by Settings → Browser Bridge). Merged into a single block.
- **Intervention window now follows the saved language** (Persian/RTL): it previously always rendered in English because it never loaded the stored language.
- Hardcoded strings localized: audit "remember as" buttons, confidence/source meta line, "Copy" tooltip in Browser Bridge settings.
- Extension popup is now bilingual (English/Persian, follows browser language).
- `build/probe-bridge.cjs`: waited for host exit, but the host intentionally stays alive after stdin closes (the browser owns its lifetime) — the probe now polls for reply + state file.

### Removed
- Dead code: `AppReviewOverlay.tsx` and `AppLockOverlay.tsx` (superseded by the main-process `intervention.html` window; neither was imported anywhere).

### Added
- i18n test that parses the raw locale JSON and fails on duplicate keys (the old test could not catch the duplicated `common` block since `JSON.parse` collapses it silently).
- Bilingual (EN + FA) README for the GitHub release.

## [1.1.0] - 2026-08-17

### Added
- **Browser Bridge (optional)**: Chrome/Edge extension → native host (`FocusStudyBrowserBridge.exe`, a dedicated Electron bridge binary shipped via afterPack) → `bridge-state.json` → tracker merges the real active tab (title + hostname only; no URLs/content). Auto-registered per-user for Chrome and Edge (`HKCU\Software\...\NativeMessagingHosts`).
- **Main-process Intervention window**: lock/review now render in a dedicated always-on-top frameless window (`intervention.html`) so interventions are visible even when the main window is behind other apps. Includes AI justification, temporary grants (15/60 min), remember-permanent rules and close-app.
- **Settings → Browser Bridge**: paste the extension ID (with copy + re-register), live host/tab diagnostics, install steps.
- **Tracker debug log**: ring buffer + `%APPDATA%\FocusStudy\tracker-debug.json` (last 40 events) for diagnosing silent lock failures.
- Extension popup with ID copy + native-host connection test; `npm run ext:zip` produces `release/FocusStudy-BrowserBridge-v1.1.0.zip`.
- Export study data as JSON (full backup) and CSV (spreadsheet analysis)
- Recent sessions list in Analytics Dashboard
- Keyboard shortcuts: Space (toggle timer), R (reset timer), Ctrl+Alt+S (scratchpad)
- Onboarding hints: empty state for tracker, first-run AI config hint
- i18n parity test (en.json ↔ fa.json)

### Changed
- `getActiveWindowNative`: returns `null` for FocusStudy's own windows and title-less windows (card no longer stuck on "FocusStudy"), Buffer out-params, z-order fallback.
- App-change detection now compares the merged tab identity instead of raw heuristics; browser tabs use the bridge state when fresh (< 3 min).
- Lock/review decision logic moved from the renderer into `InterventionController` (single source of truth, resolves "silent lock" bug).
- **Native host architecture**: the bridge exe relays Chrome's pipes to itself respawned with `ELECTRON_RUN_AS_NODE` (an Electron GUI process on Windows cannot read stdin), with a bundled `bridge-entry.js` relay script and a launcher watch-dog so no orphan processes survive.
- Native-messaging framing (4-byte LE length + JSON) shared between host and tests; `tabs_snapshot` payload pinned to `focusedWindowId` + active flags.
- Version bumped to 1.1.0.

### Fixed
- **Win32 FFI was silently dead in every build** (1.0.0 included): koffi 2.16 rejects a `proto` type used directly as a parameter (must be `koffi.pointer(proto)`), so `koffi.load` threw at init and the tracker/audit fell back to nothing. Also `GetLastInputInfo` was declared with `_Out_`, which zero-fills the struct before the call (wiping `cbSize`, Windows error 87) — switched to `_Inout_`.
- No reaction when switching windows/tabs during a session when the main window was hidden/taskbar-focused.
- Active-app card always showing "FocusStudy".
- Extension sending `JSON.stringify` strings over native messaging (broken host framing).
- Bridge host exiting before the state file was written (stdin 'end' race + unref'd keepalive).
- Extension ID validation: 32 chars from `[a-p]` only.

## [1.0.0] - 2026-08-14

### Added
- Initial release
- Pomodoro/custom/stopwatch timer with chime
- Win32 app tracker with categorization
- AI environment audit (dual backend)
- Focus lock with AI exception flow
- Weekly planner with tasks & allowed tools
- Analytics dashboard (daily/weekly/monthly)
- Brown noise + music player
- Scratchpad with tags
- EN/FA i18n with RTL
- Mini widget HUD

### Changed
- **Tracker overhaul**: PID→exe caching, 30s throttle on persistence, distraction counter decay, neutral default for unknown browser domains, exact exe matching, domain-first classification, whole-word keyword matching
- **Pre-session audit**: Browser tab dedupe, re-scan button, close-tab guidance (no taskkill), inline error on close failure, baseline capture for clean-environment lock
- **During-session lock**: 8s sustained distraction threshold, blockless sessions = nudge only, baseline-aware (won't re-lock cleared apps), non-exe close shows error
- **Date handling**: Local timezone date keys (fixes streak breakage at UTC boundaries, e.g., Iran UTC+3:30)
- **Stopwatch scoring**: Full progress credit (reaches 100 instead of capped at 70)
- **ID generation**: `uniqueId(prefix)` with timestamp + counter + random suffix (no collisions)
- **IPC validation**: planner:saveBlock shape, ai:setSettings URL check, sessions:getRecent clamp ≤200, streak bounded to 2 years
- **Security**: local-media path traversal blocked, ai:closeProcess uses execFile (no shell), unhandledRejection/uncaughtException handlers
- **AudioContext reuse**: Single shared context for completion chime (fixes leak)
- **Stable IPC listeners**: App.tsx effect split to prevent re-subscribe churn
- **Active block resolution**: By ID not array position

### Fixed
- Command injection in `ai:closeProcess`
- Path traversal in `local-media://` protocol
- AudioContext leak on session completion
- Stale window refs in IPC broadcast (window recreation on `activate`)
- Renderer output path mismatch (dist/renderer vs dist/)
- `blocks[0]` active block resolution bug
- Distraction counter hard reset → decay
- Hardcoded Persian alert message → localized in renderer
- Browser-on-unknown-site misclassified as productive
- Domain extraction false positives (file extensions, dates)
- Keyword false positives ("game loop architecture" → distracting)
- Stopwatch focus score cap (70 → 100)