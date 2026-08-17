import koffi from 'koffi';

let user32: any = null;
let kernel32: any = null;

let GetForegroundWindow: any = null;
let GetWindowThreadProcessId: any = null;
let GetWindowTextW: any = null;
let EnumWindows: any = null;
let EnumWindowsProc: any = null;
let IsWindowVisible: any = null;
let OpenProcess: any = null;
let QueryFullProcessImageNameW: any = null;
let CloseHandle: any = null;
let GetLastInputInfo: any = null;
let GetTickCount64: any = null;

let isWin32Available = false;

try {
  if (process.platform === 'win32') {
    user32 = koffi.load('user32.dll');
    kernel32 = koffi.load('kernel32.dll');

    GetForegroundWindow = user32.func('GetForegroundWindow', 'void *', []);
    GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', ['void *', koffi.out('uint32 *')]);
    GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void *', koffi.out('uint16 *'), 'int']);
    EnumWindowsProc = koffi.proto('EnumWindowsProc', 'int', ['void *', 'int']);
    EnumWindows = user32.func('EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'int']);
    IsWindowVisible = user32.func('IsWindowVisible', 'int', ['void *']);

    OpenProcess = kernel32.func('OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
    QueryFullProcessImageNameW = kernel32.func('QueryFullProcessImageNameW', 'int', ['void *', 'uint32', koffi.out('uint16 *'), koffi.inout('uint32 *')]);
    CloseHandle = kernel32.func('CloseHandle', 'int', ['void *']);

    const LASTINPUTINFO = koffi.struct('LASTINPUTINFO', {
      cbSize: 'uint32',
      dwTime: 'uint32',
    });

    // NOTE: '_Out_' zero-fills the struct BEFORE the call in koffi 2.16, which
    // wiped cbSize and made Windows reject the call (error 87). '_Inout_'
    // preserves the caller-provided cbSize. Same for the proto: it must be
    // wrapped in koffi.pointer(...) or koffi.load fails and the entire
    // tracker falls back to a dead state.
    GetLastInputInfo = user32.func('GetLastInputInfo', 'int', ['_Inout_ LASTINPUTINFO *'], { LASTINPUTINFO });
    GetTickCount64 = kernel32.func('GetTickCount64', 'uint64', []);

    isWin32Available = true;
    console.log('[Win32API] Successfully initialized Win32 FFI bindings via Koffi.');
  }
} catch (err) {
  console.warn('[Win32API] Koffi Win32 FFI initialization note:', err);
  isWin32Available = false;
}

function decodeWideChars(buf: Uint16Array, count: number): string {
  const chars: number[] = [];
  for (let i = 0; i < count; i++) {
    if (buf[i] === 0) break;
    chars.push(buf[i]);
  }
  return String.fromCharCode(...chars);
}

/**
 * PID → resolved exe name cache. The AppTracker polls every 1s and the
 * foreground PID rarely changes between ticks, so we avoid the costly
 * OpenProcess/QueryFullProcessImageNameW/CloseHandle syscalls on every tick
 * by caching the result per PID. Cache is a Map (bounded) and entries are
 * reused by the per-window enumeration in getAllWindowsNative too.
 */
const pidExeCache = new Map<number, { fullPath: string; appName: string }>();
const PID_CACHE_MAX = 256;

function rememberPidExe(pid: number, info: { fullPath: string; appName: string } | null) {
  if (info) {
    if (pidExeCache.size >= PID_CACHE_MAX) pidExeCache.delete(pidExeCache.keys().next().value!);
    pidExeCache.set(pid, info);
  }
}

export function invalidatePidCache(pid?: number) {
  if (pid === undefined) pidExeCache.clear();
  else pidExeCache.delete(pid);
}

export function getActiveWindowNative(): { execPath: string; appName: string; title: string } | null {
  if (!isWin32Available) {
    return null;
  }

  let hwnd: any = null;
  let foregroundFailed = false;
  try {
    hwnd = GetForegroundWindow();
    if (!hwnd) foregroundFailed = true;
  } catch (err) {
    console.error('[Win32API] GetForegroundWindow error:', err);
    foregroundFailed = true;
  }

  // Safety: when no foreground window is reported (foreground thread without a
  // window, locked desktop, FFI quirk), fall back to the topmost visible titled
  // window via EnumWindows (z-order). This replaces the old silent early-return
  // that froze the tracker on the previously-seen app.
  if (foregroundFailed) {
    const fallback = getAllWindowsNative(1);
    const top = fallback?.[0];
    if (top) return top;
    return null;
  }

  try {
    const pidBuf = Buffer.alloc(4);
    GetWindowThreadProcessId(hwnd, pidBuf);
    const pid = pidBuf.readUInt32LE(0);
    if (!pid) return null;

    // Never report the app's own windows (main window / widget) as the active
    // app — otherwise the tracker sticks to "FocusStudy.exe" and never reacts.
    if (pid === process.pid) return null;

    const titleBuf = new Uint16Array(512);
    const titleLen = GetWindowTextW(hwnd, titleBuf, 512);
    if (titleLen <= 0) return null;
    const title = decodeWideChars(titleBuf, titleLen).trim();
    if (!title) return null;

    // Cached result first to avoid per-tick OpenProcess/CloseHandle churn.
    const cached = pidExeCache.get(pid);
    if (cached) {
      return { execPath: cached.fullPath, appName: cached.appName, title };
    }

    const exec = queryProcessExeName(pid);
    if (!exec) {
      return null;
    }

    rememberPidExe(pid, exec);
    return { execPath: exec.fullPath, appName: exec.appName, title };
  } catch (err) {
    console.error('[Win32API] Error fetching active window info:', err);
    return null;
  }
}

function queryProcessExeName(pid: number): { fullPath: string; appName: string } | null {
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!hProcess) return null;

  try {
    const pathBuf = new Uint16Array(1024);
    const sizeBuf = [1024];
    const success = QueryFullProcessImageNameW(hProcess, 0, pathBuf, sizeBuf);
    if (!success) return null;

    const fullPath = decodeWideChars(pathBuf, sizeBuf[0]);
    if (!fullPath) return null;

    const appName = fullPath.split('\\').pop() || fullPath;
    return { fullPath, appName };
  } finally {
    CloseHandle(hProcess);
  }
}

/**
 * Enumerates all visible top-level windows with non-empty titles, resolving
 * each to its process executable. Skips the FocusStudy process itself.
 * Used by the pre-session workspace audit; returns null when native API is
 * unavailable (caller should fall back to PowerShell).
 */
export function getAllWindowsNative(limit = 60): { execPath: string; appName: string; title: string }[] | null {
  if (!isWin32Available) {
    return null;
  }

  const results: { execPath: string; appName: string; title: string }[] = [];
  const selfPid = process.pid;

  try {
    EnumWindows(
      (hwnd: any, _lParam: number) => {
        if (results.length >= limit) return 0;
        try {
          if (!IsWindowVisible(hwnd)) return 1;

          const titleBuf = new Uint16Array(512);
          const len = GetWindowTextW(hwnd, titleBuf, 512);
          if (len <= 0) return 1;
          const title = decodeWideChars(titleBuf, len).trim();
          if (!title) return 1;

          const pidBuf = [0];
          GetWindowThreadProcessId(hwnd, pidBuf);
          const pid = pidBuf[0];
          if (!pid || pid === selfPid) return 1;

          // Reuse the live PID cache so a browser with many tabs/windows that
          // share one PID is only opened+queried once across the enumeration.
          const exec = pidExeCache.get(pid) || queryProcessExeName(pid);
          if (!exec) return 1;
          rememberPidExe(pid, exec);

          results.push({ execPath: exec.fullPath, appName: exec.appName, title });
        } catch {
          // skip problematic windows
        }
        return 1;
      },
      0
    );
  } catch (err) {
    console.error('[Win32API] Error enumerating windows:', err);
    return null;
  }

  return results;
}

export function getIdleTimeSecondsNative(): number {
  if (!isWin32Available) {
    return 0;
  }

  try {
    const lii = { cbSize: 8, dwTime: 0 };
    // koffi's '_Out_' marker zero-fills the struct before the call (wiping the
    // cbSize we set), so we pass a mutable '_Inout_' pointer and keep cbSize.
    const ret = GetLastInputInfo(lii);
    if (!ret) return 0;

    const nowTicks = Number(GetTickCount64());
    const lastInputTicks = lii.dwTime;

    const idleMs = Math.max(0, nowTicks - lastInputTicks);
    return Math.floor(idleMs / 1000);
  } catch (err) {
    console.error('[Win32API] Error getting idle time:', err);
    return 0;
  }
}

import { extractDomainFromTitle as sharedExtractDomainFromTitle } from '../../shared/classification';

// Pure extraction lives in shared/classification.ts (unit-tested there, no
// koffi import). Re-exported from the native module to keep the existing
// call sites (`import { extractDomainFromTitle } from '../native/win32Api'`)
// unchanged.
export function extractDomainFromTitle(title: string, appName: string): string | undefined {
  return sharedExtractDomainFromTitle(title, appName);
}