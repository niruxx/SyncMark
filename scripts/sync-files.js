#!/usr/bin/env node
// Uses an existing rclone remote; credentials stay in rclone's own config.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; }
const local = option('--local');
const remote = option('--remote');
const filters = option('--filters');
const watch = option('--watch');
if (args.includes('--help') || !local || !remote) {
  console.log('Usage: node scripts/sync-files.js --local <folder> --remote <rclone-remote:folder> [--filters <file>] [--initialize] [--dry-run] [--watch <seconds>]');
  console.log('Configure a WebDAV remote with rclone config first. Initialize with an empty local folder. Later runs retain both versions of conflicts. See docs/file-sync.md.');
  process.exit(args.includes('--help') ? 0 : 1);
}
if (!/^[\w.-]+:/.test(remote) || !fs.existsSync(local) || !fs.statSync(local).isDirectory()) throw new Error('Supply an existing local folder and a configured rclone remote');
if (filters && !fs.existsSync(filters)) throw new Error('Filters file not found');
if (watch && (!/^\d+$/.test(watch) || Number(watch) < 30)) throw new Error('Watch interval must be at least 30 seconds');
if (args.includes('--initialize') && fs.readdirSync(local).length) throw new Error('Initialize into an empty local folder to avoid first-sync overwrites');
let stopping = false;
let child;
let timer;
function stop() { stopping = true; clearTimeout(timer); if (child) child.kill('SIGINT'); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function sync(first) {
  const command = ['bisync', path.resolve(local), remote, '--conflict-resolve', 'none', '--conflict-loser', 'num', '--compare', 'size,checksum', '--download-hash', '--resilient', '--recover', '--verbose'];
  if (filters) command.push('--filters-file', path.resolve(filters));
  if (first && args.includes('--initialize')) command.push('--resync', '--resync-mode', 'path2');
  if (args.includes('--dry-run')) command.push('--dry-run');
  const code = await new Promise((resolve) => {
    child = spawn('rclone', command, { stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', (err) => { console.error(`Unable to run rclone: ${err.message}. Install rclone and configure the remote first.`); resolve(1); });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  child = null;
  if (code !== 0) { process.exitCode = code; return; } // Stop on failure; never automatically resync.
  if (watch && !stopping && !args.includes('--dry-run')) timer = setTimeout(() => sync(false).catch((err) => { console.error(err.message); process.exitCode = 1; }), Number(watch) * 1000);
}
sync(true).catch((err) => { console.error(err.message); process.exitCode = 1; });
