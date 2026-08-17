import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import {
  buildHostManifest,
  BridgeState,
  BRIDGE_FRESH_MS,
  isValidExtensionId,
  NATIVE_HOST_NAME,
  HOST_REGISTRY_KEY_CHROME,
  HOST_REGISTRY_KEY_EDGE,
} from '../../shared/bridge';
import { storeSingleton } from '../db/jsonStore';

/**
 * Path of the shared bridge-state file. The native host publishes this file
 * whenever the browser extension reports tab activity; the main app reads it on
 * every tracker tick for browsers.
 */
export function bridgeStateFilePath(): string {
  return path.join(app.getPath('userData'), 'bridge-state.json');
}

export function readBridgeState(): BridgeState | null {
  try {
    const file = bridgeStateFilePath();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as BridgeState;
  } catch (err) {
    console.warn('[Bridge] Failed to read bridge-state:', err);
    return null;
  }
}

/** Last known active-browser-tab, only when the state is fresh. */
export function getBridgeActiveTab(): { title: string; hostname: string } | null {
  const state = readBridgeState();
  if (!state || !state.activeTab) return null;
  if (!state.updatedAt || Date.now() - state.updatedAt > BRIDGE_FRESH_MS) return null;
  const hostname = String(state.activeTab.hostname || '').trim();
  if (!hostname) return null;
  return { title: String(state.activeTab.title || ''), hostname };
}

// ---------------------------------------------------------------------------
// Host mode (runs ONLY when started as FocusStudyBrowserBridge.exe).
// ---------------------------------------------------------------------------

function blog(line: string) {
  try {
    const file = path.join(process.env.TEMP || os.tmpdir(), 'focusstudy-bridge.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // diagnostics must never crash the host
  }
}

/**
 * Resolves the bundled relay script run under ELECTRON_RUN_AS_NODE:
 * - packaged: <installRoot>/resources/bridge-entry.js (extraResources)
 * - dev: <repoRoot>/build/bridge-entry.js
 */
export function resolveRelayScript(): { path: string; exists: boolean } {
  try {
    if (app.isPackaged) {
      const root = path.resolve(path.dirname(app.getAppPath()), '..');
      const candidates = [
        path.join(root, 'resources', 'bridge-entry.js'),
        path.join(root, 'bridge-entry.js'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return { path: candidate, exists: true };
      }
      return { path: candidates[0], exists: false };
    }
    const dev = path.join(process.cwd(), 'build', 'bridge-entry.js');
    return { path: dev, exists: fs.existsSync(dev) };
  } catch (err) {
    blog(`Failed to resolve relay script: ${String(err)}`);
    return { path: '', exists: false };
  }
}

/**
 * Fallback host-mode entry point, used only when the browser has to launch
 * the full Electron GUI executable directly (i.e. the FocusStudyBridge.exe
 * shim is missing). Chromium's native-messaging protocol speaks through
 * stdin/stdout, but an Electron GUI process on Windows receives stdin 'end'
 * before any byte arrives (the GUI runtime closes the stream), and worse,
 * the GUI boot scatters stray bytes on stdout that desync the 4-byte-LE
 * frame protocol. So the GUI executable re-spawns ITSELF as a plain Node
 * process with ELECTRON_RUN_AS_NODE=1 and relays the pipes through itself
 * frame-clean. Chrome/Edge never see this indirection.
 */
export function runNativeHost() {
  blog(`runNativeHost (GUI launcher fallback) argv=${JSON.stringify(process.argv)}`);
  try {
    app.disableHardwareAcceleration();
  } catch {
    // pre-ready guard; harmless
  }

  const relay = resolveRelayScript();
  if (!relay.exists) {
    blog(`relay script not found at ${relay.path || '<empty>'} — exiting`);
    // Without the relay there is nothing to do. Never open a window: the
    // manifest points at this exe and a GUI would be a useless zombie.
    process.exit(1);
    return;
  }

  // app.getPath('userData') resolves to %APPDATA%/<appName> (app name from the
  // package.json name field, e.g. "focus-study"); it is not reliably callable
  // before 'ready', so hand the directory to the relay child through env.
  let userDataDir = '';
  try {
    userDataDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      String((app as any).getName?.() || 'focus-study')
    );
  } catch {
    userDataDir = '';
  }

  const child = spawn(process.execPath, [relay.path], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FOCUSSTUDY_LAUNCHER_PID: String(process.pid),
      ...(userDataDir ? { FOCUSSTUDY_USERDATA_DIR: userDataDir } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  blog(`relay child spawned pid=${child.pid} relay=${relay.path} userData=${userDataDir}`);

  // Relay the browser pipes. The launcher's own GUI boot emits stray bytes
  // (e.g. a "\r\n") on stdout BEFORE this relay is wired up; those bytes may
  // reach Chrome and desync its frame parser (a known Electron limitation),
  // which is exactly why the FocusStudyBridge.exe shim is the primary host.
  try {
    process.stdin.pipe(child.stdin, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
  } catch {
    // If piping fails the child keeps running but transport is dead — let
    // Chrome clean up.
  }
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});
  child.stderr.on('error', () => {});
  process.stdin.on('error', () => {});

  child.on('error', (err: Error) => {
    blog(`relay child error: ${String(err && err.message)}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    blog(`relay child exit code=${code} signal=${signal}`);
    process.exit(code ?? 0);
  });
  // The launcher's only job is to keep the child alive; it must never create
  // windows or exit while the child is running.
}

// ---------------------------------------------------------------------------
// Registration (main app side)
// ---------------------------------------------------------------------------

export function hostManifestDir(): string {
  return path.join(app.getPath('userData'), 'native-hosts');
}

/**
 * Resolves the executable the native-messaging manifest points at:
 * - packaged (primary): <installRoot>/FocusStudyBridge.exe — a tiny console
 *   shim compiled from build/native-host-shim.cs that relays the browser's
 *   pipes into the bridge script without polluting stdout (an Electron GUI
 *   binary emits stray bytes on stdout during its boot, desyncing the
 *   4-byte-LE length-prefixed frame protocol).
 * - packaged (fallback): <installRoot>/FocusStudyBrowserBridge.exe — the GUI
 *   binary itself, used when the shim failed to compile; transport works but
 *   the GUI-boot bytes race the pipe (the "silent disconnect" pathology).
 * - dev: build/FocusStudyBridge.exe if present, else the node_modules
 *   electron binary (only truly works in packaged mode; the GUI fallback
 *   path requires the FocusStudyBrowserBridge.exe/`--focusstudy-bridge`
 *   detection).
 */
export function resolveBridgeExecutable(): { path: string; exists: boolean } {
  try {
    if (app.isPackaged) {
      const root = path.resolve(path.dirname(app.getAppPath()), '..');
      const candidates = [
        path.join(root, 'FocusStudyBridge.exe'),
        path.join(root, 'FocusStudyBrowserBridge.exe'),
        path.join(root, 'resources', 'FocusStudyBrowserBridge.exe'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return { path: candidate, exists: true };
      }
      return { path: candidates[0], exists: false };
    }
    const shim = path.join(process.cwd(), 'build', 'FocusStudyBridge.exe');
    if (fs.existsSync(shim)) return { path: shim, exists: true };
    // Dev: the bare node_modules electron binary cannot serve as a native
    // host (no --focusstudy-bridge detection, GUI boot bytes on stdout).
    // Refuse instead of clobbering a working packaged registration.
    return { path: shim, exists: false };
  } catch (err) {
    console.warn('[Bridge] Failed to resolve bridge executable:', err);
    return { path: '', exists: false };
  }
}

export function extensionFolderPath(): string {
  return app.isPackaged
    ? path.join(path.resolve(path.dirname(app.getAppPath()), '..'), 'resources', 'browser-extension')
    : path.join(process.cwd(), 'browser-extension');
}

function writeManifests(extensionId: string, bridgeExe: string): string[] {
  const errors: string[] = [];
  const dir = hostManifestDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = JSON.stringify(buildHostManifest({ hostExecutablePath: bridgeExe, extensionId }), null, 2);
    for (const name of ['chrome', 'edge']) {
      const file = path.join(dir, `${NATIVE_HOST_NAME}.${name}.json`);
      try {
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, manifest, 'utf-8');
        fs.renameSync(tmp, file);
      } catch (err) {
        errors.push(`manifest ${name}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`manifest dir: ${String(err)}`);
  }
  return errors;
}

function writeRegistryValue(key: string, manifestPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['add', key, '/ve', '/d', manifestPath, '/f'],
      { windowsHide: true },
      (error) => resolve(error ? String(error.message) : null)
    );
  });
}

/**
 * Registers (or refreshes) the per-user native-messaging host for Chrome and
 * Edge. Safe to call on every app start and whenever the extension ID changes.
 */
export async function registerNativeHosts(extensionId: string): Promise<{ ok: boolean; errors: string[] }> {
  const bridge = resolveBridgeExecutable();
  if (!bridge.path || !bridge.exists) return { ok: false, errors: ['bridge executable not found — reinstall FocusStudy or run from the packaged build'] };
  if (!isValidExtensionId(extensionId)) {
    return { ok: false, errors: ['extension id not set — paste the extension ID from the extension popup'] };
  }
  const errors = writeManifests(extensionId, bridge.path);
  const chromeManifest = path.join(hostManifestDir(), `${NATIVE_HOST_NAME}.chrome.json`);
  const edgeManifest = path.join(hostManifestDir(), `${NATIVE_HOST_NAME}.edge.json`);
  const chromeError = await writeRegistryValue(HOST_REGISTRY_KEY_CHROME, chromeManifest);
  const edgeError = await writeRegistryValue(HOST_REGISTRY_KEY_EDGE, edgeManifest);
  if (chromeError) errors.push(`chrome registry: ${chromeError}`);
  if (edgeError) errors.push(`edge registry: ${edgeError}`);
  return { ok: errors.length === 0, errors };
}

export interface NativeHostStatus {
  extensionId: string;
  hostRegistered: boolean;
  bridgeExe: { path: string; exists: boolean };
  relayScript: { path: string; exists: boolean };
  stateFile: string;
  lastSeenAt: number | null;
  lastSource: string | null;
  activeTab: { title: string; hostname: string } | null;
  hasErrors: boolean;
}

export function nativeHostStatus(): NativeHostStatus {
  const state = readBridgeState();
  const extId = storeSingleton.getExtensionId();
  const bridge = resolveBridgeExecutable();
  const relay = resolveRelayScript();
  const manifestsExist = fs.existsSync(path.join(hostManifestDir(), `${NATIVE_HOST_NAME}.chrome.json`));
  return {
    extensionId: extId || '',
    hostRegistered: manifestsExist,
    bridgeExe: bridge,
    relayScript: relay,
    stateFile: bridgeStateFilePath(),
    lastSeenAt: state?.updatedAt ?? null,
    lastSource: state?.source ?? null,
    activeTab: getBridgeActiveTab(),
    hasErrors: !bridge.exists,
  };
}
