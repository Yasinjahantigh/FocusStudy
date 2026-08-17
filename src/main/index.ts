import { app, BrowserWindow, globalShortcut, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { RulesEngine } from './services/RulesEngine';
import { TimerEngine } from './services/TimerEngine';
import { AppTracker } from './services/AppTracker';
import { setupIpcHandlers } from './ipc';
import { storeSingleton } from './db/jsonStore';
import { runNativeHost, registerNativeHosts } from './services/nativeHost';
import { InterventionController } from './services/InterventionController';
import { trackerDebug } from './services/TrackerDebug';

// Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
});

// ---------------------------------------------------------------------------
// Native-messaging host mode. A second copy of the electron binary named
// FocusStudyBrowserBridge.exe (or `--focusstudy-bridge`) runs ONLY this branch:
// a stdio loop that publishes browser tab state. It never creates windows,
// never takes the single-instance lock, and exits via app.exit() so the JSON
// store is never touched by the host process.
// ---------------------------------------------------------------------------
const isBridgeMode =
  process.argv.includes('--focusstudy-bridge') ||
  path.basename(path.resolve(process.execPath)).toLowerCase() === 'focusstudybrowserbridge.exe';

if (isBridgeMode) {
  runNativeHost();
} else {
  // Register custom privileged protocol 'local-media' for local audio streaming.
  // Kept NON-standard so the encoded path after 'local-media://' is never
  // re-normalized as a host, and served as raw bytes (with Range support) so
  // seeking works for large audio files.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'local-media',
      privileges: {
        secure: true,
        stream: true,
      },
    },
  ]);

  let mainWindow: BrowserWindow | null = null;
  let widgetWindow: BrowserWindow | null = null;

  function loadWindowUrl(win: BrowserWindow, url: string, isFile = false) {
    if (isFile) {
      win.loadFile(url);
    } else {
      win.loadURL(url).catch((err) => {
        console.warn(`[Electron] Failed to load ${url}, retrying in 500ms...`, err);
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.loadURL(url);
          }
        }, 500);
      });
    }

    win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
      if (errorCode === -3) return; // ignore aborts during reloads
      console.warn(`[Electron] Window failed to load (${errorCode}: ${errorDescription}). Retrying in 1s...`);
      setTimeout(() => {
        if (!win.isDestroyed()) {
          if (isFile) win.loadFile(url);
          else win.loadURL(url);
        }
      }, 1000);
    });
  }

  function createWindows() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 650,
      title: 'FocusStudy',
      autoHideMenuBar: true,
      backgroundColor: '#0f172a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    widgetWindow = new BrowserWindow({
      width: 300,
      height: 80,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      // Keep the widget in the taskbar so it can be restored after minimizing.
      skipTaskbar: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const pageUrl = process.env.VITE_DEV_SERVER_URL;

    if (pageUrl) {
      const mainUrl = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
      // Delay initial URL load by 500ms to ensure Vite HTTP server has completed socket listening
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) loadWindowUrl(mainWindow, mainUrl);
        if (widgetWindow && !widgetWindow.isDestroyed()) loadWindowUrl(widgetWindow, `${mainUrl}widget.html`);
      }, 500);
    } else {
      loadWindowUrl(mainWindow, path.join(__dirname, '../renderer/index.html'), true);
      loadWindowUrl(widgetWindow, path.join(__dirname, '../renderer/widget.html'), true);
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
      // Closing the main window ends the whole app: also close the widget and
      // the intervention overlay so nothing is left running with no owner.
      // (window-all-closed below then quits the process.)
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        const w = widgetWindow;
        widgetWindow = null;
        w.destroy();
      }
      if (intervention) intervention.dispose();
    });
    widgetWindow.on('closed', () => {
      widgetWindow = null;
    });
  }

  let timerEngine: TimerEngine | null = null;
  let appTracker: AppTracker | null = null;
  let intervention: InterventionController | null = null;

  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      // Encrypt API credentials with the OS keychain before any renderer is created.
      storeSingleton.migrateSensitiveSettings();
      // Register the browser native-messaging host (per-user, best effort).
      registerNativeHosts(storeSingleton.getExtensionId()).catch((err: unknown) => {
        console.warn('[Main] Native host registration skipped:', err);
      });
      // Serve local audio files as raw bytes over the 'local-media' scheme.
      // Buffer-based serving (instead of net.fetch on file:// URLs) is reliable
      // in both dev (http origin) and packaged (file origin) builds, and the
      // manual Range handling keeps seeking fast for large tracks.
      const AUDIO_MIME: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.mp4': 'audio/mp4',
      };

      protocol.handle('local-media', async (request) => {
        const encodedPath = request.url.slice('local-media://'.length);
        const requestedPath = decodeURIComponent(encodedPath);

        // Path traversal protection: only allow files within the configured music folder.
        const musicFolder = storeSingleton.getMusicFolderPath();
        if (!musicFolder) {
          console.warn('[LocalMedia] No music folder configured');
          return new Response('Not Found', { status: 404 });
        }

        // Resolve both paths to their real absolute paths.
        const resolvedRequested = path.resolve(requestedPath);
        const resolvedMusicFolder = path.resolve(musicFolder);

        // Ensure the requested file is inside the music folder.
        if (!resolvedRequested.startsWith(resolvedMusicFolder + path.sep) && resolvedRequested !== resolvedMusicFolder) {
          console.warn('[LocalMedia] Path traversal attempt blocked:', requestedPath);
          return new Response('Forbidden', { status: 403 });
        }

        try {
          const stat = await fs.promises.stat(resolvedRequested);
          if (!stat.isFile()) throw new Error('Not a file');

          const ext = path.extname(resolvedRequested).toLowerCase();
          const mime = AUDIO_MIME[ext] || 'application/octet-stream';

          const rangeHeader = request.headers.get('Range');
          if (rangeHeader) {
            const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
            if (match) {
              const start = parseInt(match[1], 10);
              const end = match[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
              if (start >= 0 && start <= end && start < stat.size) {
                const handle = await fs.promises.open(resolvedRequested, 'r');
                try {
                  const length = end - start + 1;
                  const buffer = Buffer.alloc(length);
                  await handle.read(buffer, 0, length, start);
                  return new Response(buffer, {
                    status: 206,
                    headers: {
                      'Content-Type': mime,
                      'Content-Length': String(length),
                      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                      'Accept-Ranges': 'bytes',
                    },
                  });
                } finally {
                  await handle.close();
                }
              }
            }
          }

          // Stream the file instead of reading it entirely into memory.
          const handle = await fs.promises.open(resolvedRequested, 'r');
          const readable = handle.createReadStream();
          return new Response(readable as any, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(stat.size),
              'Accept-Ranges': 'bytes',
            },
          });
        } catch (err) {
          console.warn('[LocalMedia] Failed to serve audio file:', encodedPath, err);
          return new Response('Not Found', { status: 404 });
        }
      });

      // Recover sessions that were left 'running' by a crash or unclean shutdown.
      const abandoned = storeSingleton.abandonRunningSessions();
      if (abandoned > 0) {
        console.warn(`[Main] Marked ${abandoned} stale session(s) as abandoned.`);
      }

      const rulesEngine = new RulesEngine();
      timerEngine = new TimerEngine();
      appTracker = new AppTracker(rulesEngine, timerEngine);
      intervention = new InterventionController();

      appTracker.start();
      intervention.bind(appTracker, timerEngine, rulesEngine);

      createWindows();

      if (mainWindow && widgetWindow) {
        setupIpcHandlers(
          timerEngine,
          appTracker,
          rulesEngine,
          () => mainWindow,
          () => widgetWindow,
          intervention
        );
      }

      globalShortcut.register('CommandOrControl+Alt+S', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send('scratchpad:openModal');
        }
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindows();
        }
      });
    });
  }

  app.on('before-quit', () => {
    // Persist any pending log segments and the final store state.
    if (appTracker) appTracker.flushCurrentLog();
    if (timerEngine) timerEngine.abandonActiveSession();
    if (intervention) intervention.dispose();
    storeSingleton.flush();
    trackerDebug.persist();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}