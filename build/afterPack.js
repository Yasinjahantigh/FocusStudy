// electron-builder afterPack hook:
// 1. Copies the unacked app executable to FocusStudyBrowserBridge.exe (runs
//    in bridge mode; resolves the relay script under ELECTRON_RUN_AS_NODE).
// 2. Compiles build/native-host-shim.cs into FocusStudyBridge.exe — a tiny
//    console app that Chrome/Edge invoke for native messaging. The shim keeps
//    the stdio pipes byte-clean (the Electron GUI boot emits stray bytes that
//    desync the 4-byte-LE frame protocol) and simply relays the pipes into
//    the bridge script. See build/native-host-shim.cs for details.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findCsc() {
  const candidates = [
    path.join(os.homedir(), '.dotnet', 'tools', 'csc.exe'),
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function compileShim(repoRoot, appOutDir) {
  const src = path.join(repoRoot, 'build', 'native-host-shim.cs');
  const dest = path.join(appOutDir, 'FocusStudyBridge.exe');
  if (!fs.existsSync(src)) {
    console.warn('[afterPack] native-host-shim.cs not found — browser bridge will fall back to the GUI binary.');
    return false;
  }
  const csc = findCsc();
  if (!csc) {
    console.warn('[afterPack] No C# compiler (csc.exe) found — browser bridge will fall back to the GUI binary.');
    return false;
  }
  try {
    execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', `/out:${dest}`, src], {
      stdio: 'pipe',
      windowsHide: true,
    });
    if (!fs.existsSync(dest)) throw new Error('csc reported success but no output file');
    console.log(`[afterPack] Compiled native-host shim -> ${dest}`);
    return true;
  } catch (err) {
    console.warn('[afterPack] Shim compilation failed — falling back to GUI binary:', err && err.message ? err.message : err);
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch { /* ignore */ }
    return false;
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const productFilename = context.packager.appInfo.productFilename || 'FocusStudy';
  const src = path.join(context.appOutDir, `${productFilename}.exe`);
  const dest = path.join(context.appOutDir, 'FocusStudyBrowserBridge.exe');
  if (!fs.existsSync(src)) {
    console.warn(`[afterPack] ${productFilename}.exe not found in appOutDir, skipping bridge binary.`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`[afterPack] Copied bridge binary -> ${dest}`);

  const repoRoot = path.resolve(context.appOutDir, '..', '..');
  compileShim(repoRoot, context.appOutDir);
};
