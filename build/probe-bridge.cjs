const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const exe = process.argv[2] || path.resolve(__dirname, '..', 'release', 'win-unpacked', 'FocusStudyBrowserBridge.exe');
const extraArgs = process.argv.slice(3);
const stateFile = path.join(process.env.APPDATA, 'focus-study', 'bridge-state.json');
try { fs.unlinkSync(stateFile); } catch {}

const frame = (obj) => {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32LE(json.length, 0);
  return Buffer.concat([hdr, json]);
};

const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });

let out = Buffer.alloc(0);
let replies = 0;
child.stdout.on('data', (chunk) => {
  out = Buffer.concat([out, chunk]);
  // parse 4-byte LE frames
  let i = 0;
  while (out.length - i >= 4) {
    const len = out.readUInt32LE(i);
    if (out.length < i + 4 + len) break;
    const msg = out.slice(i + 4, i + 4 + len).toString('utf8');
    replies += 1;
    console.log('host reply:', msg);
    i += 4 + len;
  }
  out = out.subarray(i);
});

const snapshot = {
  type: 'tabs_snapshot',
  reason: 'active',
  ts: Date.now(),
  focusedWindowId: 2,
  tabs: [
    { tabId: 10, windowId: 1, title: 'YouTube - video', hostname: 'youtube.com', active: true },
    { tabId: 11, windowId: 2, title: 'Lecture notes', hostname: 'docs.google.com', active: true },
  ],
};
child.stdin.write(frame(snapshot));

const t0 = Date.now();
let verdictGiven = false;

function verdict(reason) {
  if (verdictGiven) return;
  verdictGiven = true;
  const ok = replies >= 1 && fs.existsSync(stateFile);
  console.log(`${reason}: replies=${replies} stateExists=${fs.existsSync(stateFile)} elapsedMs=${Date.now() - t0} VERDICT=${ok ? 'PASS' : 'FAIL'}`);
  if (fs.existsSync(stateFile)) console.log('state:', fs.readFileSync(stateFile, 'utf8'));
  // The host deliberately stays alive after stdin 'end' (the browser owns
  // its lifetime), so we terminate it ourselves: killing the launcher makes
  // the relay watchdog exit too.
  try { child.kill('SIGKILL'); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

// Success path: reply received AND state file present (the host does not
// exit on stdin end by design, so never wait for 'exit').
const poll = setInterval(() => {
  if (replies >= 1 && fs.existsSync(stateFile)) {
    clearInterval(poll);
    verdict('completed');
  } else if (Date.now() - t0 > 15000) {
    clearInterval(poll);
    verdict('TIMEOUT waiting for reply/state');
  }
}, 150);

child.on('exit', (code) => {
  clearInterval(poll);
  verdict(`exited unexpectedly code=${code}`);
});
