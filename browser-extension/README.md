# FocusStudy Browser Bridge (optional)

Sends **only tab titles + hostnames** from Chrome / Microsoft Edge to the
FocusStudy native host. Full URLs, page content, cookies and credentials are
never read or transmitted.

Requires **FocusStudy 1.1.0+** (the native host `FocusStudyBrowserBridge.exe`
ships inside the installer and is registered automatically in the per-user
registry).

## Install (one-time)

1. Run the FocusStudy 1.1.0 installer and start FocusStudy.
2. Load the extension (developer mode):
   - **Edge**: `edge://extensions` → enable *Developer mode* → *Load unpacked*
     → select this folder (`browser-extension`).
   - **Chrome**: `chrome://extensions` → enable *Developer mode* → *Load unpacked*
     → select this folder.
3. Click the FocusStudy extension icon → copy the extension ID (32 lowercase
   letters, e.g. `abcdefghijklmnopqrstuvwxyzabcdef`).
4. In FocusStudy: **Settings → Browser Bridge** → paste the ID → save. The app
   writes the native-messaging manifests to `%APPDATA%\FocusStudy\native-hosts`
   and registers the per-user registry keys for Chrome and Edge.
5. Restart the browser (required after registry/manifest changes), then press
   the *Test connection* button in the extension popup — it should say
   **"Native host connected"**.
6. Done. Tab switches are now reported to FocusStudy (title + hostname only).

## How it works

```
browser tab ──► background.js ──► Chrome native messaging ──► FocusStudyBrowserBridge.exe
                                                                      │
                          FocusStudy (main) ◄── bridge-state.json ────┘
```

- `background.js` listens to tab activation / updates / window focus and sends
  a `tabs_snapshot` (debounced, max 80 tabs) over stdin using the standard
  native-messaging frame format (4-byte LE length + JSON).
- The host (a second copy of the FocusStudy binary running in bridge mode)
  merges the frames, publishes `%APPDATA%\FocusStudy\bridge-state.json`
  atomically, and replies `{ok:true}`.
- The FocusStudy tracker reads the state file each tick; fresh states
  (< 3 min) override generic browser titles with the real active tab.

## Manual registration (if the app couldn't do it)

The packaged installer handles this, but for manual setups:

1. Copy `FocusStudyBrowserBridge.exe` from the install dir to somewhere stable.
2. Edit `native-host-manifest.json` (template): set `path` to the bridge exe and
   `allowed_origins` to `chrome-extension://<YOUR_EXTENSION_ID>/`.
3. Save as `%APPDATA%\FocusStudy\native-hosts\com.focusstudy.browser_bridge.chrome.json`
   (and copy the same file with `.edge.json`).
4. Add registry default values:

```
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.focusstudy.browser_bridge" /ve /d "C:\path\to\manifest.json" /f
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.focusstudy.browser_bridge" /ve /d "C:\path\to\manifest.json" /f
```

## Troubleshooting

- Popup shows the exact native-host error (if any) after *Test connection* —
  e.g. "Native host has exited" (manifest ID mismatch) or "Failed to start
  native messaging host" (host exe missing / blocked by antivirus).
- Popup says host not found → FocusStudy not running/installed, extension ID
  mismatch, or browser not restarted after saving the ID.
- Bridge diagnostics: `%TEMP%\focusstudy-bridge.log` (frame traffic,
  relay startup, failures).
- Active-tab card still shows the browser executable → the state file is older
  than 3 minutes (extension not installed / browser closed) or the host process
  isn't reachable; check FocusStudy **Settings → Browser Bridge** for the
  *Last seen* timestamp.
- Always restart the browser after changing the extension ID in FocusStudy.
