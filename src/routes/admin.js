const express = require('express');
const { statements, wipeUserData, wipeDatabase } = require('../db');
const { hashPassword, verifyPassword } = require('../utils/password');

const router = express.Router();

// Every route here already sits behind requireAuth + requireAdmin in
// server.js. :id always has to resolve to a role='user' account — an admin
// can't target another admin (or itself) through this router.
function getTargetUser(id) {
  return statements.getRegularUserById.get(id);
}

function userCounts(userId) {
  return {
    bookmarks: statements.countBookmarks.get(userId).count,
    contacts: statements.countContacts.get(userId).count,
    events: statements.countEvents.get(userId).count,
    passwords: statements.countPasswords.get(userId).count,
    fileLocations: statements.countFileLocations.get(userId).count,
  };
}

router.get('/admin/users', (req, res) => {
  const users = statements.listRegularUsers.all().map((user) => ({
    ...user,
    enabled: Boolean(user.enabled),
    counts: userCounts(user.id),
  }));
  res.json(users);
});

router.post('/admin/users', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const result = statements.insertUser.run({ username, passwordHash: hashPassword(password), role: 'user' });
    res.status(201).json({ ...getTargetUser(result.lastInsertRowid), enabled: true, counts: userCounts(result.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Username is already taken' });
    throw err;
  }
});

// Read-only oversight: everything a user has, except a saved password's
// actual secret — password_enc/decrypted plaintext are never included here.
router.get('/admin/users/:id', (req, res) => {
  const user = getTargetUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const userId = user.id;
  res.json({
    user: { ...user, enabled: Boolean(user.enabled) },
    bookmarks: statements.listAllBookmarks.all(userId),
    contacts: statements.listContactsBySort['name-asc'].all({ userId, favorite: 0, tag: '', tagLike: '' }),
    events: statements.listEvents.all({ userId, q: '', qLike: '%%' }),
    fileLocations: statements.listFileLocations.all(userId),
    passwords: statements.listPasswordsBySort['name-asc'].all({ userId, q: '', qLike: '', favorite: 0 }),
  });
});

router.put('/admin/users/:id', (req, res) => {
  const user = getTargetUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let nextUsername = user.username;
  let nextPasswordHash;

  if (req.body.username !== undefined) {
    nextUsername = String(req.body.username).trim();
    if (!nextUsername) return res.status(400).json({ error: 'Username cannot be empty' });
  }
  if (req.body.password !== undefined) {
    const password = String(req.body.password);
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    nextPasswordHash = hashPassword(password);
  }

  const full = statements.getUserById.get(user.id);
  try {
    statements.updateUser.run({
      id: user.id,
      username: nextUsername,
      passwordHash: nextPasswordHash || full.password_hash,
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Username is already taken' });
    throw err;
  }

  // A password reset (not just a rename) signs the user out everywhere,
  // same as the self-service account-settings password change implies.
  if (nextPasswordHash) statements.deleteSessionsForUser.run(user.id);

  res.json({ ...getTargetUser(user.id), enabled: Boolean(user.enabled), counts: userCounts(user.id) });
});

router.put('/admin/users/:id/enabled', (req, res) => {
  const user = getTargetUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const enabled = req.body.enabled ? 1 : 0;
  statements.setUserEnabled.run({ id: user.id, enabled });
  // Takes effect immediately rather than waiting for the session to expire.
  if (!enabled) statements.deleteSessionsForUser.run(user.id);

  res.json({ ...getTargetUser(user.id), enabled: Boolean(enabled), counts: userCounts(user.id) });
});

router.delete('/admin/users/:id', (req, res) => {
  const user = getTargetUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  wipeUserData(user.id);
  res.status(204).end();
});

// Full factory reset — every account (this admin included) and everything
// anyone owns, gone. Password-confirmed like every other destructive action
// in the app, plus a typed confirmation phrase given how much more this
// destroys than any single one of them: there's no "undo," and no smaller
// action recovers from calling this by mistake the way, say, re-creating a
// deleted user's login (without their data) at least partially would.
router.post('/admin/reset', (req, res) => {
  const password = req.body.password || '';
  if (!verifyPassword(password, req.user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  if (String(req.body.confirm || '') !== 'RESET') {
    return res.status(400).json({ error: 'Type RESET to confirm' });
  }

  wipeDatabase();
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.status(204).end();
});

module.exports = router;
