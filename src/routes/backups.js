const express = require('express');
const { statements } = require('../db');
const { verifyPassword } = require('../utils/password');
const {
  getSchedule,
  saveSchedule,
  resolveBackupDir,
  validateBackupDir,
  listBackupFiles,
  writeBackupFile,
  readBackupSnapshot,
  deleteBackupFile,
  restoreFromSnapshot,
  rescheduleBackups,
} = require('../backup');

const router = express.Router();

const FREQUENCIES = ['daily', 'weekly'];
const BACKUP_FILENAME_RE = /^syncmark-backup-[\w-]+\.json\.gz$/;

function isValidBackupFilename(name) {
  return typeof name === 'string' && BACKUP_FILENAME_RE.test(name);
}

router.get('/backups', (req, res) => {
  res.json(listBackupFiles());
});

router.post('/backups/run', (req, res) => {
  try {
    res.status(201).json(writeBackupFile());
  } catch (err) {
    res.status(500).json({ error: err.message || 'Backup failed' });
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

  const schedule = saveSchedule(next);
  rescheduleBackups();
  res.json({ ...schedule, effectiveDir: resolveBackupDir(schedule) });
});

router.get('/backups/:file/download', (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });

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
// pattern as DELETE /auth/account, and the same reasoning for forcing a
// fresh login afterward instead of trusting the now-stale session.
router.post('/backups/:file/restore', (req, res) => {
  if (!isValidBackupFilename(req.params.file)) return res.status(400).json({ error: 'Invalid backup filename' });

  const user = statements.getUserById.get(req.session.user_id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const password = req.body.password || '';
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  let snapshot;
  try {
    snapshot = readBackupSnapshot(resolveBackupDir(), req.params.file);
  } catch (err) {
    return res.status(404).json({ error: 'Backup not found' });
  }

  restoreFromSnapshot(snapshot);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.status(204).end();
});

module.exports = router;
