const express = require('express');
const crypto = require('crypto');
const { db, statements, isFeatureEnabled } = require('../db');
const { verifyPassword } = require('../utils/password');
const meta = require('../utils/passwordMetadata');
const router = express.Router();
const clientRouter = express.Router();
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const handle = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/password-folders', (req, res) => {
  const folders = db.prepare('SELECT name FROM password_folders WHERE user_id=? UNION SELECT folder AS name FROM passwords WHERE user_id=? AND folder!=\'\' ORDER BY name').all(req.user.id, req.user.id).map((r) => r.name);
  const tags = [...new Set(db.prepare('SELECT tags FROM passwords WHERE user_id=?').all(req.user.id).flatMap((r) => meta.tags(r.tags)))].sort();
  res.json({ folders, tags });
});
router.post('/password-folders', handle((req, res) => {
  const name = meta.folder(req.body.name || ''); if (!name) meta.fail(400, 'Folder name is required');
  db.prepare('INSERT OR IGNORE INTO password_folders(user_id,name) VALUES (?,?)').run(req.user.id, name); res.status(201).json({ name });
}));
router.put('/password-folders', handle((req, res) => {
  const old = meta.folder(req.body.oldName || ''), next = meta.folder(req.body.newName || '');
  if (!old || !next || next.startsWith(old + '/')) meta.fail(400, 'Choose valid folder names outside the original subtree');
  if (old === next) return res.json({ name: next });
  const folders = db.prepare('SELECT name FROM password_folders WHERE user_id=?').all(req.user.id).map((r) => r.name);
  const matches = (name) => name === old || name.startsWith(old + '/');
  if (!folders.some(matches)) meta.fail(404, 'Folder not found');
  if (folders.some((name) => !matches(name) && (name === next || name.startsWith(next + '/')))) meta.fail(409, 'Destination folder exists');
  db.transaction(() => {
    for (const name of folders.filter(matches)) db.prepare('UPDATE password_folders SET name=? WHERE user_id=? AND name=?').run(next + name.slice(old.length), req.user.id, name);
    for (const row of db.prepare('SELECT id,folder FROM passwords WHERE user_id=?').all(req.user.id).filter((r) => matches(r.folder))) db.prepare('UPDATE passwords SET folder=? WHERE id=? AND user_id=?').run(next + row.folder.slice(old.length), row.id, req.user.id);
  })(); res.json({ name: next });
}));
router.delete('/password-folders', handle((req, res) => {
  const name = meta.folder(req.body.name || ''); if (!name) meta.fail(400, 'Folder name is required');
  db.transaction(() => {
    for (const row of db.prepare('SELECT id,folder FROM passwords WHERE user_id=?').all(req.user.id)) if (row.folder === name || row.folder.startsWith(name + '/')) db.prepare("UPDATE passwords SET folder='' WHERE id=? AND user_id=?").run(row.id, req.user.id);
    for (const row of db.prepare('SELECT name FROM password_folders WHERE user_id=?').all(req.user.id)) if (row.name === name || row.name.startsWith(name + '/')) db.prepare('DELETE FROM password_folders WHERE user_id=? AND name=?').run(req.user.id, row.name);
  })(); res.status(204).end();
}));
router.get('/password-sharing/me', handle((req, res) => {
  const keys = db.prepare('SELECT * FROM password_sharing_keys WHERE user_id=?').get(req.user.id);
  if (!keys) meta.fail(404, 'Sharing identity has not been created on this device');
  res.json({ userId: req.user.id, username: req.user.username, publicKey: keys.public_key, privateEnc: keys.private_enc, fingerprint: keys.fingerprint });
}));
router.post('/password-sharing/me', handle((req, res) => {
  if (!statements.getVaultKeys.get(req.user.id)) meta.fail(409, 'Set up and unlock your vault first');
  const { publicKey, privateEnc } = req.body;
  if (typeof publicKey !== 'string' || publicKey.length > 5000 || !meta.encryptedField(privateEnc, 50000)) meta.fail(400, 'Invalid encrypted sharing identity');
  let key;
  try { key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }); } catch { meta.fail(400, 'Invalid public key'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 3072) meta.fail(400, 'Use a 3072-bit RSA sharing key');
  const canonical = key.export({ format: 'der', type: 'spki' });
  const fingerprint = digest(canonical);
  if (db.prepare('SELECT 1 FROM password_sharing_keys WHERE user_id=?').get(req.user.id)) meta.fail(409, 'Sharing identity already exists');
  db.prepare('INSERT INTO password_sharing_keys(user_id,public_key,private_enc,fingerprint) VALUES (?,?,?,?)').run(req.user.id, canonical.toString('base64'), privateEnc, fingerprint);
  res.status(201).json({ userId: req.user.id, username: req.user.username, publicKey: canonical.toString('base64'), privateEnc, fingerprint });
}));
router.get('/password-sharing/directory', handle((req, res) => {
  if (typeof req.query.username !== 'string' || req.query.username.length > 200) meta.fail(400, 'Username is required');
  const row = db.prepare("SELECT u.id,u.username,k.public_key AS publicKey,k.fingerprint FROM users u JOIN password_sharing_keys k ON k.user_id=u.id WHERE u.username=? AND u.enabled=1 AND u.role='user'").get(req.query.username);
  if (!row) meta.fail(404, 'Recipient must unlock their vault once to enable sharing');
  res.json(row);
}));
router.post('/password-shares', handle((req, res) => {
  const body = req.body;
  if (!/^[a-f0-9-]{36}$/i.test(body.id || '') || !Number.isSafeInteger(body.recipientId) || !Number.isSafeInteger(body.passwordId) || body.recipientId === req.user.id) meta.fail(400, 'Invalid share target');
  if (!statements.getPassword.get(body.passwordId, req.user.id)) meta.fail(404, 'Password not found');
  const recipient = db.prepare("SELECT k.fingerprint FROM password_sharing_keys k JOIN users u ON u.id=k.user_id WHERE k.user_id=? AND u.enabled=1 AND u.role='user'").get(body.recipientId);
  if (!recipient || recipient.fingerprint !== body.recipientFingerprint) meta.fail(409, 'Recipient identity changed; verify it again');
  if (typeof body.wrappedKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.wrappedKey) || Buffer.from(body.wrappedKey, 'base64').length !== 384 || !meta.encryptedField(body.payload, 500000)) meta.fail(400, 'Invalid encrypted share');
  const expiry = new Date(body.expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now() || expiry.getTime() > Date.now() + 366 * 86400000) meta.fail(400, 'Share expiration must be within the next year');
  if (db.prepare('SELECT COUNT(*) AS n FROM password_shares WHERE sender_id=? AND expires_at>?').get(req.user.id, new Date().toISOString()).n >= 200) meta.fail(429, 'Revoke an old share first');
  db.prepare('INSERT INTO password_shares(id,sender_id,recipient_id,password_id,wrapped_key,payload,recipient_fingerprint,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(body.id, req.user.id, body.recipientId, body.passwordId, body.wrappedKey, body.payload, body.recipientFingerprint, expiry.toISOString());
  res.status(201).json({ id: body.id });
}));
router.get('/password-shares', (req, res) => {
  const rows = db.prepare(`SELECT s.*,u.username AS sender,v.username AS recipient FROM password_shares s JOIN users u ON u.id=s.sender_id JOIN users v ON v.id=s.recipient_id
    WHERE (s.sender_id=? OR s.recipient_id=?) AND s.expires_at>? AND u.enabled=1 AND v.enabled=1 ORDER BY s.created_at DESC`).all(req.user.id, req.user.id, new Date().toISOString());
  res.json(rows.map((row) => row.recipient_id === req.user.id ? row : { id: row.id, password_id: row.password_id, recipient: row.recipient, expires_at: row.expires_at, outgoing: true }));
});
router.delete('/password-shares/:id', handle((req, res) => {
  if (!db.prepare('DELETE FROM password_shares WHERE id=? AND (sender_id=? OR recipient_id=?)').run(req.params.id, req.user.id, req.user.id).changes) meta.fail(404, 'Share not found');
  res.status(204).end();
}));
router.get('/password-clients', (req, res) => res.json(db.prepare('SELECT id,name,expires_at,created_at,last_used_at FROM password_clients WHERE user_id=? ORDER BY created_at DESC').all(req.user.id)));
router.post('/password-clients', handle((req, res) => {
  if (typeof req.body.password !== 'string' || req.body.password.length > 1024 || !verifyPassword(req.body.password, req.user.password_hash)) meta.fail(403, 'Confirm your account login password');
  if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 100 || !Number.isInteger(req.body.days) || req.body.days < 1 || req.body.days > 90) meta.fail(400, 'Choose a name and a lifetime of 1–90 days');
  if (db.prepare('SELECT COUNT(*) AS n FROM password_clients WHERE user_id=? AND expires_at>?').get(req.user.id, new Date().toISOString()).n >= 20) meta.fail(429, 'Revoke an old client first');
  const id = crypto.randomUUID(), token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + req.body.days * 86400000).toISOString();
  db.prepare('INSERT INTO password_clients(id,user_id,name,token_hash,expires_at) VALUES (?,?,?,?,?)').run(id, req.user.id, req.body.name.trim(), digest(token), expiresAt);
  res.status(201).json({ id, token, expiresAt });
}));
router.delete('/password-clients/:id', handle((req, res) => {
  if (!db.prepare('DELETE FROM password_clients WHERE id=? AND user_id=?').run(req.params.id, req.user.id).changes) meta.fail(404, 'Client not found');
  res.status(204).end();
}));
clientRouter.use('/api/password-client', (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (!isFeatureEnabled('passwords')) return res.status(403).end();
  const match = /^Bearer ([\w-]{43})$/.exec(req.get('Authorization') || '');
  const row = match && db.prepare("SELECT c.*,u.username FROM password_clients c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND c.expires_at>? AND u.enabled=1 AND u.role='user'").get(digest(match[1]), new Date().toISOString());
  if (!row) return res.status(401).json({ error: 'Client credential expired or revoked' });
  req.passwordClient = row;
  db.prepare('UPDATE password_clients SET last_used_at=? WHERE id=?').run(new Date().toISOString(), row.id);
  next();
});
clientRouter.get('/api/password-client/keys', handle((req, res) => {
  const row = statements.getVaultKeys.get(req.passwordClient.user_id);
  if (!row) meta.fail(404, 'Vault not configured');
  // Clients only need the passphrase wrap, not the recovery artifact.
  res.json({ vaultSalt: row.vault_salt, wrappedDekPassphrase: row.wrapped_dek_passphrase, wrappedDekPassphraseIv: row.wrapped_dek_passphrase_iv });
}));
clientRouter.get('/api/password-client/items', (req, res) => res.json(statements.listAllPasswordsRaw.all(req.passwordClient.user_id)));
clientRouter.all(/^\/api\/password-client(?:\/.*)?$/, (req, res) => res.status(405).end());
module.exports = { router, clientRouter };
