
const fs = require('fs');
const log = (s) => fs.appendFileSync(process.env.TEMP + '/bridge-entry-test.log', '[' + new Date().toISOString() + '] ' + s + '\n');
log('entry started, RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || ''));
process.stdin.on('data', (c) => log('data ' + c.length));
process.stdin.on('end', () => { log('end'); process.exit(0); });
process.stdin.on('error', (e) => log('error ' + e.message));
setTimeout(() => log('30s timeout reached'), 30000);
