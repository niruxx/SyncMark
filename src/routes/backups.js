const fs = require('fs');
const express = require('express');
const { statements } = require('../db');
const { verifyPassword } = require('../utils/password');
const { resolveSafePath } = require('../utils/fsPath');
const {
  MODULE_KEYS,
  normalizeModules,
  getSchedule,
  saveSchedule,
  resolveBackupDir,
  validateBackupDir,
  listBackupFiles,
  writeBackupFile,
  readBackupSnapshot,
  deleteBackupFile,
  restoreBackup,
  peekBackupModules,
  rescheduleBackups,
} = require('../backup');

const router = express.Router();

const FREQUENCIES = ['daily', 'weekly'];
const BACKUP_FILENAME_RE = /^syncmark-backup-[\w-]+\.(tar\.gz|json\.gz)$/;

function isValidBackupFilename(name) {
  return typeof name === 'string' && BACKUP_FILENAME_RE.test(name);
}

router.get('/backups', async (req, res) => {
  const dir = resolveBackupDir();
  const files = listBackupFiles(dir);
  const withModules = await Promise.all(
    files.map(async (file) => {
      try {
        return { ...file, modules: await peekBackupModules(dir, file.name) };
      } catch {
        return { ...file, modules: [] };
      }
    })
  );
  res.json(withModules);
});

router.post('/backups/run', async (req, res) => {
  try {
    res.status(201).json(await writeBackupFile(normalizeModules(req.body?.modules)));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

router.get('/backups/:file/modules', async (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });
  try {
    res.json({ modules: await peekBackupModules(resolveBackupDir(), req.params.file) });
  } catch (err) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

router.get('/backups/schedule', (req, res) => {
  const schedule = getSchedule();
  res.json({ ...schedule, effectiveDir: resolveBackupDir(schedule) });
});

router.put('/backups/schedule', (req, res) => {
  const body = req.body || {};
  const next = {};

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.frequency !== undefined) {
    if (!FREQUENCIES.includes(body.frequency)) return res.status(400).json({ error: 'Invalid frequency' });
    next.frequency = body.frequency;
  }
  if (body.retentionCount !== undefined) {
    const count = Number(body.retentionCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return res.status(400).json({ error: 'Retention count must be a whole number between 1 and 100' });
    }
    next.retentionCount = count;
  }
  if (body.dir !== undefined) {
    const dir = String(body.dir || '').trim();
    if (dir) {
      const error = validateBackupDir(dir);
      if (error) return res.status(400).json({ error });
      next.dir = dir;
    } else {
      next.dir = null;
    }
  }
  if (body.modules !== undefined) {
    const modules = normalizeModules(body.modules);
    if (!modules) return res.status(400).json({ error: 'Select at least one module to back up' });
    next.modules = modules;
  }

  const schedule = saveSchedule(next);
  rescheduleBackups();
  res.json({ ...schedule, effectiveDir: resolveBackupDir(schedule) });
});

router.get('/backups/:file/download', (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });

  if (req.params.file.endsWith('.tar.gz')) {
    let target;
    try {
      target = resolveSafePath(resolveBackupDir(), req.params.file);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Backup not found' });
    return res.download(target, req.params.file);
  }

  // Legacy .json.gz — same decompress-and-serve-as-.json behaviour as before.
  try {
    const snapshot = readBackupSnapshot(resolveBackupDir(), req.params.file);
    const jsonName = req.params.file.replace(/\.gz$/, '');
    res.setHeader('Content-Disposition', `attachment; filename="${jsonName}"`);
    res.type('application/json').send(JSON.stringify(snapshot, null, 2));
  } catch (err) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

router.delete('/backups/:file', (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });

  try {
    deleteBackupFile(resolveBackupDir(), req.params.file);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: 'Backup not found' });
  }
});

// As destructive as deleting the account — same password-confirmation
// pattern as DELETE /auth/account. Session is only invalidated when the
// `account` module was actually applied (restoring e.g. just Bookmarks
// doesn't touch who's logged in, so there's no reason to sign anyone out).
router.post('/backups/:file/restore', async (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });

  const user = statements.getUserById.get(req.session.user_id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const password = req.body.password || '';
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  let result;
  try {
    result = await restoreBackup(resolveBackupDir(), req.params.file, normalizeModules(req.body.modules));
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Restore failed' });
  }

  if (result.appliedModules.includes('account')) {
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  }
  res.status(200).json({ appliedModules: result.appliedModules });
});

module.exports = router;
