// Full-instance backup/restore, selectable by module. A backup is a gzip'd
// tar archive (see src/utils/tar.js) written through the existing better-
// sqlite3 connection where possible — no file-swapping, no closing/
// reopening the DB, no server restart. Legacy .json.gz backups (DB-only,
// pre-dating File Manager content backup and module selection) are still
// readable and restorable.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { db, statements } = require('./db');
const { resolveSafePath, sanitizeName } = require('./utils/fsPath');
const { TarWriter, extractTarGz } = require('./utils/tar');

const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

// Every module a backup/restore can be scoped to. `tables` are wiped +
// reinserted wholesale when a module is applied; `settingsKeys` (where
// present) claims specific app_settings rows for that module, since
// app_settings is a shared key-value bucket rather than a per-feature
// table — restoring one module must never wipe another module's settings
// out from under it. `account` has no predicate: it's the catch-all for
// any app_settings key not claimed by another module, so a future setting
// nobody remembered to classify still ends up somewhere sane by default.
const MODULES = {
  bookmarks: { label: 'Bookmarks', tables: ['bookmarks', 'folders'] },
  contacts: {
    label: 'Contacts',
    tables: ['contacts', 'contacts_tombstones', 'contact_groups', 'contact_group_members'],
    settingsKeys: (key) => key === 'contacts_seq' || key === 'contacts_dismissed_duplicates',
  },
  calendar: {
    label: 'Calendar',
    tables: ['events', 'events_tombstones'],
    settingsKeys: (key) => key === 'events_seq',
  },
  files: { label: 'Files', tables: ['file_locations'], includesFileContents: true },
  account: { label: 'Account & settings', tables: ['users'] },
};
const MODULE_KEYS = Object.keys(MODULES);

function settingsKeyModule(key) {
  if (MODULES.contacts.settingsKeys(key)) return 'contacts';
  if (MODULES.calendar.settingsKeys(key)) return 'calendar';
  return 'account';
}

function normalizeModules(modules) {
  if (!Array.isArray(modules)) return null;
  const valid = modules.filter((m) => MODULE_KEYS.includes(m));
  return valid.length ? valid : null;
}

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

function buildSnapshot(selectedModules = MODULE_KEYS) {
  const selected = new Set(selectedModules);
  const snapshot = { version: 2, exportedAt: new Date().toISOString(), modules: [...selected], tables: {} };

  for (const key of MODULE_KEYS) {
    if (!selected.has(key)) continue;
    for (const table of MODULES[key].tables) {
      snapshot.tables[table] = tableToJson(table);
    }
  }

  // app_settings is shared across modules — keep only the rows whose owning
  // module was selected, never the whole table wholesale.
  const allSettings = db.prepare('SELECT * FROM app_settings').all();
  snapshot.tables.app_settings = allSettings.filter((row) => selected.has(settingsKeyModule(row.key)));

  return snapshot;
}

// Applies whichever modules are both selected AND actually present in the
// snapshot (a module absent from a partial backup can't be restored from
// it). Only the tables/settings belonging to an applied module are ever
// touched — the rest of the instance's current data is left completely
// alone, which is what makes "restore just Bookmarks" safe to run without
// disturbing Contacts/Calendar/Account. Sessions are only invalidated when
// `account` is applied, since that's the only module that can change who's
// logged in or their password.
const restoreFromSnapshot = db.transaction((snapshot, selectedModules) => {
  const present = new Set(snapshot.modules || MODULE_KEYS);
  const selected = new Set(selectedModules || present);
  const applied = MODULE_KEYS.filter((key) => selected.has(key) && present.has(key));

  for (const key of applied) {
    for (const table of MODULES[key].tables) {
      db.exec(`DELETE FROM ${table}`);
      insertRowsRaw(table, rowsFromJson(table, snapshot.tables?.[table] || []));
    }
  }

  for (const row of snapshot.tables?.app_settings || []) {
    if (applied.includes(settingsKeyModule(row.key))) {
      statements.setSetting.run({ key: row.key, value: row.value });
    }
  }

  if (applied.includes('account')) {
    db.exec('DELETE FROM sessions');
  }

  return applied;
});

// ---------- File Manager directory contents (tar entries) ----------

function locationArchiveDir(row) {
  return `${row.id}-${sanitizeName(row.name) || 'location'}`;
}

// files/<locationId>-<name>/<relative path> — parsed back by id only (never
// by name, which could have changed between backup and restore) so the
// current file_locations row is always the authority on where a file goes.
function parseFilesEntryName(name) {
  if (!name.startsWith('files/')) return null;
  const rest = name.slice('files/'.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const match = rest.slice(0, slash).match(/^(\d+)-/);
  if (!match) return null;
  return { locationId: Number(match[1]), relPath: rest.slice(slash + 1) };
}

// Recursively lists files under a directory, skipping (rather than failing
// the whole backup on) anything that vanishes or is unreadable mid-walk —
// same defensive precedent as the Files feature's own directory browser.
function walkFiles(rootDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        walk(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) results.push({ full, size: stat.size, mtimeSec: Math.floor(stat.mtimeMs / 1000) });
      } catch {
        /* vanished or permission denied — skip */
      }
    }
  }
  walk(rootDir);
  return results;
}

// ---------- schedule config (app_settings, same pattern as feature flags) ----------

const FREQUENCY_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };
const DEFAULT_SCHEDULE = {
  enabled: false,
  frequency: 'daily',
  retentionCount: 14,
  dir: null,
  lastRunAt: null,
  modules: MODULE_KEYS,
};

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

// Same 3-line check files.js already does for a location's path — only
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
    .filter((name) => name.startsWith('syncmark-backup-') && (name.endsWith('.tar.gz') || name.endsWith('.json.gz')))
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

async function writeBackupFile(selectedModules) {
  const schedule = getSchedule();
  const modules = normalizeModules(selectedModules) || normalizeModules(schedule.modules) || MODULE_KEYS;
  const dir = resolveBackupDir(schedule);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `syncmark-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
  const destPath = path.join(dir, filename);

  const writer = new TarWriter(destPath);
  await writer.addBuffer('db.json', Buffer.from(JSON.stringify(buildSnapshot(modules))));

  if (modules.includes('files')) {
    for (const row of statements.listFileLocations.all()) {
      const archiveDir = locationArchiveDir(row);
      for (const file of walkFiles(row.path)) {
        const relPosix = path.relative(row.path, file.full).split(path.sep).join('/');
        try {
          await writer.addFile(`files/${archiveDir}/${relPosix}`, file.full, file.size, file.mtimeSec);
        } catch (err) {
          console.error(`Backup: failed to archive ${file.full}:`, err.message);
        }
      }
    }
  }

  await writer.finish();

  pruneOldBackups(dir, schedule.retentionCount);
  saveSchedule({ lastRunAt: new Date().toISOString() });
  const stat = fs.statSync(destPath);
  return { name: filename, size: stat.size, modules };
}

// Legacy .json.gz — unchanged shape from before module selection existed.
function readBackupSnapshot(dir, filename) {
  const target = resolveSafePath(dir, filename);
  const json = zlib.gunzipSync(fs.readFileSync(target)).toString('utf8');
  return JSON.parse(json);
}

function deleteBackupFile(dir, filename) {
  fs.unlinkSync(resolveSafePath(dir, filename));
}

// Which modules a given backup actually contains — cheap even for a large
// .tar.gz, since db.json is always the first entry and extraction stops
// right after it rather than decompressing the (often much larger) file
// portion just to answer this.
async function peekBackupModules(dir, filename) {
  if (filename.endsWith('.json.gz')) {
    const snapshot = readBackupSnapshot(dir, filename);
    return snapshot.modules || MODULE_KEYS;
  }
  const target = resolveSafePath(dir, filename);
  let modules = MODULE_KEYS;
  await extractTarGz(target, {
    stopAfterJson: true,
    onJson: async (snapshot) => {
      modules = snapshot.modules || MODULE_KEYS;
    },
  });
  return modules;
}

async function restoreFromArchive(archivePath, selectedModules) {
  let appliedModules = [];
  let sawDbJson = false;

  await extractTarGz(archivePath, {
    onJson: async (snapshot) => {
      sawDbJson = true;
      appliedModules = restoreFromSnapshot(snapshot, selectedModules);
    },
    resolveDest: (name) => {
      if (!appliedModules.includes('files')) return null;
      const parsed = parseFilesEntryName(name);
      if (!parsed) return null;
      const location = statements.getFileLocation.get(parsed.locationId);
      if (!location) return null;
      try {
        fs.mkdirSync(location.path, { recursive: true });
        return resolveSafePath(location.path, parsed.relPath);
      } catch {
        return null;
      }
    },
  });

  if (!sawDbJson) throw new Error('Backup archive did not contain a database snapshot');
  return { appliedModules };
}

// Dispatches by format — the one place that needs to know both still exist.
async function restoreBackup(dir, filename, selectedModules) {
  const target = resolveSafePath(dir, filename);
  if (filename.endsWith('.tar.gz')) {
    return restoreFromArchive(target, selectedModules);
  }
  const snapshot = readBackupSnapshot(dir, filename);
  const appliedModules = restoreFromSnapshot(snapshot, selectedModules);
  return { appliedModules };
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

async function runScheduledBackup() {
  try {
    await writeBackupFile();
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
  MODULES,
  MODULE_KEYS,
  normalizeModules,
  buildSnapshot,
  restoreFromSnapshot,
  restoreFromArchive,
  restoreBackup,
  peekBackupModules,
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
