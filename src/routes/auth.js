const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { statements, wipeDatabase, setFeatureFlags } = require('../db');
const { hashPassword, verifyPassword } = require('../utils/password');
const { parseCookies } = require('../utils/cookies');
const { requireAuth, getSession } = require('../middleware/auth');

const router = express.Router();

const SESSION_DURATIONS_MS = {
  '5m': 5 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  permanent: null,
};
const DEFAULT_SESSION_DURATION = 'hourly';
const PERMANENT_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60; // ~10 years, in seconds

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Picture must be a PNG, JPEG, GIF, or WebP image'));
    }
    cb(null, true);
  },
});

function currentSessionDuration() {
  const row = statements.getSetting.get('session_duration');
  return SESSION_DURATIONS_MS.hasOwnProperty(row?.value) ? row.value : DEFAULT_SESSION_DURATION;
}

function createSession(userId) {
  const durationKey = currentSessionDuration();
  const ms = SESSION_DURATIONS_MS[durationKey];
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = ms ? new Date(Date.now() + ms).toISOString() : null;
  statements.insertSession.run({ token, userId, expiresAt });
  return { token, ms };
}

function setSessionCookie(res, token, ms) {
  const maxAge = ms ? Math.floor(ms / 1000) : PERMANENT_COOKIE_MAX_AGE;
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

router.get('/auth/status', (req, res) => {
  const { count } = statements.countUsers.get();
  if (count === 0) return res.json({ setupRequired: true, authenticated: false });

  res.json({ setupRequired: false, authenticated: Boolean(getSession(req)) });
});

router.post('/auth/setup', (req, res) => {
  const { count } = statements.countUsers.get();
  if (count > 0) return res.status(409).json({ error: 'Setup has already been completed' });

  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const features = req.body.features;
  if (features && !features.bookmarks && !features.contacts && !features.calendar && !features.files) {
    return res.status(400).json({ error: 'At least one feature must stay enabled' });
  }

  const passwordHash = hashPassword(password);
  const result = statements.insertUser.run({ username, passwordHash });
  if (features) setFeatureFlags(features);

  const { token, ms } = createSession(result.lastInsertRowid);
  setSessionCookie(res, token, ms);
  res.status(201).json({ ok: true });
});

router.post('/auth/login', (req, res) => {
  statements.deleteExpiredSessions.run({ now: new Date().toISOString() });

  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = statements.getUserByUsername.get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const { token, ms } = createSession(user.id);
  setSessionCookie(res, token, ms);
  res.json({ ok: true });
});

router.post('/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session) statements.deleteSession.run(cookies.session);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/auth/settings', requireAuth, (req, res) => {
  res.json({ sessionDuration: currentSessionDuration() });
});

router.put('/auth/settings', requireAuth, (req, res) => {
  const duration = req.body.sessionDuration;
  if (!SESSION_DURATIONS_MS.hasOwnProperty(duration)) {
    return res.status(400).json({ error: 'Invalid session duration' });
  }
  statements.setSetting.run({ key: 'session_duration', value: duration });
  res.json({ sessionDuration: duration });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const user = statements.getUserById.get(req.session.user_id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: user.username, hasAvatar: Boolean(user.has_avatar) });
});

router.get('/auth/avatar', requireAuth, (req, res) => {
  const row = statements.getAvatar.get(req.session.user_id);
  if (!row || !row.avatar) return res.status(404).json({ error: 'No profile picture set' });

  // Only ever echo back a mime type from our own allow-list, and forbid sniffing,
  // so a stored file can't be coaxed into executing as something else.
  const mime = AVATAR_MIME_TYPES.includes(row.avatar_mime) ? row.avatar_mime : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(row.avatar);
});

router.post('/auth/avatar', requireAuth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'Picture must be 2 MB or smaller' : err.message || 'Upload failed',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    if (!AVATAR_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Picture must be a PNG, JPEG, GIF, or WebP image' });
    }

    statements.setAvatar.run({
      id: req.session.user_id,
      avatar: req.file.buffer,
      mime: req.file.mimetype,
    });
    res.status(201).json({ ok: true });
  });
});

router.delete('/auth/avatar', requireAuth, (req, res) => {
  statements.clearAvatar.run({ id: req.session.user_id });
  res.status(204).end();
});

router.put('/auth/account', requireAuth, (req, res) => {
  const user = statements.getUserById.get(req.session.user_id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const currentPassword = req.body.currentPassword || '';
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  let nextUsername = user.username;
  let nextPasswordHash = user.password_hash;

  if (req.body.username !== undefined) {
    nextUsername = String(req.body.username).trim();
    if (!nextUsername) return res.status(400).json({ error: 'Username cannot be empty' });
  }
  if (req.body.newPassword !== undefined) {
    const newPassword = String(req.body.newPassword);
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    nextPasswordHash = hashPassword(newPassword);
  }

  if (nextUsername === user.username && nextPasswordHash === user.password_hash) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    statements.updateUser.run({ id: user.id, username: nextUsername, passwordHash: nextPasswordHash });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    throw err;
  }

  res.json({ username: nextUsername });
});

router.delete('/auth/account', requireAuth, (req, res) => {
  const user = statements.getUserById.get(req.session.user_id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const password = req.body.password || '';
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  wipeDatabase();
  clearSessionCookie(res);
  res.status(204).end();
});

module.exports = router;
