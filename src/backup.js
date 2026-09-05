// Full-instance backup/restore. A "backup" is a gzip'd JSON snapshot of every
// table (except live session tokens) written through the existing better-
// sqlite3 connection — no file-swapping, no closing/reopening the DB, no
// server restart. Restore runs the same way: one transaction, through the
// same connection, wipe + re-insert with original ids preserved so JSON
// column references (contact relationships, group membership) stay valid.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { db, statements } = require('./db');
const { resolveSafePath } = require('./utils/fsPath');

const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

// Every table wipeDatabase touches except `sessions` — a backup should never
// carry live session tokens, and restoring old ones would be both stale and
// a needless security liability.
const TABLES = [
  'users',
  'app_settings',
  'bookmarks',
  'folders',
  'contacts',
  'contacts_tombstones',
  'contact_groups',
  'contact_group_members',
  'events',
  'events_tombstones',
  'file_locations',
];

// BLOB columns need base64 round-tripping to survive JSON — everything else
// already comes back from better-sqlite3 as strings/numbers.
const BLOB_COLUMNS = { users: ['avatar'], contacts: ['photo'] };

function tableToJson(table) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const blobCols = BLOB_COLUMNS[table] || [];
  if (blobCols.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const col of blobCols) {
      if (Buffer.isBuffer(copy[col])) copy[col] = copy[col].toString('base64');
    }
    return copy;
  });
}

function rowsFromJson(table, rows) {
  const blobCols = BLOB_COLUMNS[table] || [];
  if (blobCols.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const col of blobCols) {
      copy[col] = typeof copy[col] === 'string' ? Buffer.from(copy[col], 'base64') : null;
    }
    return copy;
  });
}

// Columns always mirror the export's SELECT * (restore never invents new
// shapes), so one generic INSERT built from Object.keys covers every table
// instead of a bespoke prepared statement each.
function insertRowsRaw(table, rows) {
  if (!rows || rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`);
  for (const row of rows) stmt.run(row);
}

function buildSnapshot() {
  const snapshot = { version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) snapshot.tables[table] = tableToJson(table);
  return snapshot;
}

const restoreFromSnapshot = db.transaction((snapshot) => {
  for (const table of TABLES) {
    db.exec(`DELETE FROM ${table}`);
    insertRowsRaw(table, rowsFromJson(table, snapshot.tables?.[table] || []));
  }
  // Never restore old session tokens — force a fresh login instead.
  db.exec('DELETE FROM sessions');
});

// ---------- schedule config (app_settings, same pattern as feature flags) ----------

const FREQUENCY_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };
const DEFAULT_SCHEDULE = { enabled: false, frequency: 'daily', retentionCount: 14, dir: null, lastRunAt: null };

function getSchedule() {
  const row = statements.getSetting.get('backup_schedule');
  if (!row) return { ...DEFAULT_SCHEDULE };
  try {
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

function saveSchedule(partial) {
  const next = { ...getSchedule(), ...partial };
  statements.setSetting.run({ key: 'backup_schedule', value: JSON.stringify(next) });
  return next;
}

function resolveBackupDir(schedule = getSchedule()) {
  return schedule.dir || DEFAULT_BACKUP_DIR;
}

// Same 3-line check files.js already uses for a location's path — only
// required when the admin overrides the default directory.
function validateBackupDir(dir) {
  if (!dir) return null;
  if (!path.isAbsolute(dir)) return 'Backup directory must be an absolute path';
  if (!fs.existsSync(dir)) return 'Backup directory does not exist on this server';
  if (!fs.statSync(dir).isDirectory()) return 'Backup directory is not a directory';
  return null;
}

// ---------- backup files on disk ----------

function listBackupFiles(dir = resolveBackupDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('syncmark-backup-') && name.endsWith('.json.gz'))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

function pruneOldBackups(dir, retentionCount) {
  const excess = listBackupFiles(dir).slice(Math.max(retentionCount, 1));
  for (const file of excess) {
    try {
      fs.unlinkSync(path.join(dir, file.name));
    } catch {
      /* already gone */
    }
  }
}

function writeBackupFile() {
  const schedule = getSchedule();
  const dir = resolveBackupDir(schedule);
  fs.mkdirSync(dir, { recursive: true });

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(buildSnapshot())));
  const filename = `syncmark-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
  fs.writeFileSync(path.join(dir, filename), gz);

  pruneOldBackups(dir, schedule.retentionCount);
  saveSchedule({ lastRunAt: new Date().toISOString() });
  return { name: filename, size: gz.length };
}

function readBackupSnapshot(dir, filename) {
  const target = resolveSafePath(dir, filename);
  const json = zlib.gunzipSync(fs.readFileSync(target)).toString('utf8');
  return JSON.parse(json);
}

function deleteBackupFile(dir, filename) {
  fs.unlinkSync(resolveSafePath(dir, filename));
}

// ---------- scheduler ----------
// Recursive setTimeout (not setInterval) so a schedule change or a catch-up
// run after downtime both naturally recompute the next fire time instead of
// drifting or double-firing.

let schedulerTimer = null;

function computeNextRunAt(schedule) {
  const intervalMs = FREQUENCY_MS[schedule.frequency] || FREQUENCY_MS.daily;
  if (!schedule.lastRunAt) return Date.now();
  return new Date(schedule.lastRunAt).getTime() + intervalMs;
}

function scheduleNext() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  const schedule = getSchedule();
  if (!schedule.enabled) return;

  // A personal server isn't always on — if it was off past the next run
  // time, catch up shortly after boot instead of waiting a full cycle.
  const delay = Math.max(computeNextRunAt(schedule) - Date.now(), 5000);
  schedulerTimer = setTimeout(runScheduledBackup, delay);
}

function runScheduledBackup() {
  try {
    writeBackupFile();
  } catch (err) {
    console.error('Scheduled backup failed:', err);
  }
  scheduleNext();
}

function startScheduler() {
  scheduleNext();
}

function rescheduleBackups() {
  scheduleNext();
}

module.exports = {
  DEFAULT_BACKUP_DIR,
  buildSnapshot,
  restoreFromSnapshot,
  getSchedule,
  saveSchedule,
  resolveBackupDir,
  validateBackupDir,
  listBackupFiles,
  writeBackupFile,
  readBackupSnapshot,
  deleteBackupFile,
  startScheduler,
  rescheduleBackups,
};
