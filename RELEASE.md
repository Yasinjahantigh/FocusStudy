# Release Checklist

## Pre-Release

- [ ] All tests pass: `npm run typecheck && npm test && npm run build`
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated with release notes
- [ ] No uncommitted secrets (API keys, certs) in repo

## Build

- [ ] Clean build: `npm ci && npm run build`
- [ ] Package: `npm run package` (produces NSIS installer in `release/`)
- [ ] Extension zip: `npm run ext:zip` (produces `release/FocusStudy-BrowserBridge-v1.x.x.zip`)
- [ ] Verify installer runs and app launches
- [ ] Verify app works in packaged mode (no dev server):
  - Timer starts/completes
  - App tracker detects foreground window (including switching to a browser → real tab title)
  - Lock/review window appears always-on-top (`intervention.html`) when a distracting app is used during a running part
  - AI audit runs (if configured)
  - Audio plays (brown noise + music)
  - Settings persist
  - RTL/FA works
- [ ] Browser bridge smoke test:
  - `win-unpacked/FocusStudyBrowserBridge.exe` exists (afterPack copy of electron binary)
  - Settings → Browser Bridge: paste extension ID → *Native host registered* = Yes
  - Run the bridge binary manually once (`FocusStudyBrowserBridge.exe`) → exits cleanly
  - With the extension loaded + ID set: active-tab report appears (title + hostname), `bridge-state.json` updated

## Code Signing (Optional but Recommended)

```bash
# Windows (requires valid EV cert for SmartScreen)
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD=your_password
npm run dist
```

If no cert: build runs but Windows will show "Unknown Publisher" warning.

## Artifacts

Expected in `release/`:
- `FocusStudy Setup 1.x.x.exe` — NSIS installer
- `win-unpacked/` — unpacked app (for manual verification)

Verify `win-unpacked/`:
- [ ] `FocusStudy.exe` exists
- [ ] `FocusStudyBrowserBridge.exe` exists (native-messaging bridge binary)
- [ ] `FocusStudyBridge.exe` exists (byte-clean console shim launched by Chrome/Edge; **if missing, the browser bridge silently fails** — requires csc.exe on the build machine)
- [ ] `resources/browser-extension/` exists (load-unpacked source for Chrome/Edge)
- [ ] `resources/app.asar` exists (main + renderer bundled)
- [ ] `resources/app.asar.unpacked/node_modules/koffi/` exists (asarUnpack)
- [ ] `resources/app.asar.unpacked/node_modules/@google/genai/` NOT unpacked (stays in asar)

## Bridge verification (quick probe)

```bash
node build/probe-bridge.cjs "release\win-unpacked\FocusStudyBridge.exe"
# expect: host reply + VERDICT=PASS and printed bridge-state.json content
```

## Publish

- [ ] GitHub Release created with tag `v1.x.x`
- [ ] Installer attached to release
- [ ] Release notes from CHANGELOG.md

## Post-Release

- [ ] Announce in relevant channels
- [ ] Monitor for crash reports / issues
- [ ] Plan next iteration