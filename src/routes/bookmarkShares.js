const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { normalizeFolderPath } = require('../utils/folderPath');
const { hashPassword, verifyPassword } = require('../utils/password');
const { parseCookies } = require('../utils/cookies');
const lib = require('../utils/bookmarkLibrary');
const { requireFeatureDav } = require('../middleware/featureGate');
const router = express.Router();
const publicRouter = express.Router();
function available(share) {
  return share && (!share.expires_at || share.expires_at > new Date().toISOString()) && db.prepare('SELECT enabled FROM users WHERE id=?').get(share.owner_id)?.enabled;
}
function ownedGroup(id, user) { const g = db.prepare('SELECT * FROM bookmark_groups WHERE id=? AND owner_id=?').get(id, user); if (!g) lib.fail(404, 'Group not found'); return g; }
function users(names) {
  if (!Array.isArray(names) || names.length > 100 || names.some((n) => typeof n !== 'string')) lib.fail(400, 'Supply at most 100 usernames');
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].map((name) => {
    const user = db.prepare("SELECT id FROM users WHERE username=? AND enabled=1 AND role='user'").get(name);
    if (!user) lib.fail(400, `Regular account not found: ${name}`);
    return user.id;
  });
}
function canRead(share, userId) {
  return share.owner_id === userId || db.prepare(`SELECT 1 FROM bookmark_share_grants g WHERE g.share_id=? AND
    (g.user_id=? OR g.group_id IN (SELECT group_id FROM bookmark_group_members WHERE user_id=?)) LIMIT 1`).get(share.id, userId, userId);
}
const handle = (fn) => (req, res, next) => { try { fn(req, res); } catch (err) { next(err); } };
router.get('/bookmark-groups', (req, res) => {
  res.json(db.prepare('SELECT * FROM bookmark_groups WHERE owner_id=? ORDER BY name').all(req.user.id).map((g) => ({ ...g, members: db.prepare('SELECT u.username FROM bookmark_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY u.username').all(g.id).map((u) => u.username) })));
});
for (const method of ['post', 'put']) router[method](method === 'post' ? '/bookmark-groups' : '/bookmark-groups/:id', handle((req, res) => {
  const name = req.body.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) lib.fail(400, 'A group name of 1–100 characters is required');
  const members = users(req.body.members || []);
  let id;
  db.transaction(() => {
    if (method === 'put') { id = ownedGroup(req.params.id, req.user.id).id; db.prepare('UPDATE bookmark_groups SET name=? WHERE id=?').run(name.trim(), id); }
    else id = Number(db.prepare('INSERT INTO bookmark_groups(owner_id,name) VALUES (?,?)').run(req.user.id, name.trim()).lastInsertRowid);
    db.prepare('DELETE FROM bookmark_group_members WHERE group_id=?').run(id);
    for (const user of members) db.prepare('INSERT INTO bookmark_group_members(group_id,user_id) VALUES (?,?)').run(id, user);
  })();
  res.status(method === 'post' ? 201 : 200).json({ id, name: name.trim() });
}));
router.delete('/bookmark-groups/:id', handle((req, res) => { ownedGroup(req.params.id, req.user.id); db.prepare('DELETE FROM bookmark_groups WHERE id=?').run(req.params.id); res.status(204).end(); }));
router.get('/bookmark-shares', (req, res) => {
  res.json(db.prepare('SELECT id,folder,title,expires_at,created_at,token_hash IS NOT NULL AS public,password_hash IS NOT NULL AS passwordProtected FROM bookmark_shares WHERE owner_id=? ORDER BY id DESC').all(req.user.id));
});
router.get('/bookmark-shares/received', (req, res) => {
  res.json(db.prepare('SELECT * FROM bookmark_shares WHERE owner_id != ?').all(req.user.id).filter((s) => available(s) && canRead(s, req.user.id)).map((s) => ({ id: s.id, title: s.title, owner: db.prepare('SELECT username FROM users WHERE id=?').get(s.owner_id)?.username })));
});
router.post('/bookmark-shares', handle((req, res) => {
  const folder = normalizeFolderPath(req.body.folder || '');
  if (folder && !db.prepare('SELECT id FROM folders WHERE user_id=? AND name=?').get(req.user.id, folder)) lib.fail(404, 'Folder not found');
  const title = String(req.body.title || folder || 'Bookmarks').trim();
  if (!title || title.length > 200) lib.fail(400, 'Use a title of 1–200 characters');
  const userIds = users(req.body.users || []);
  const groupIds = req.body.groups || [];
  if (!Array.isArray(groupIds) || groupIds.length > 100 || groupIds.some((id) => !Number.isSafeInteger(id))) lib.fail(400, 'Invalid groups');
  groupIds.forEach((id) => ownedGroup(id, req.user.id));
  if (!req.body.public && !userIds.length && !groupIds.length) lib.fail(400, 'Select a recipient or enable a public link');
  let expires = null;
  if (req.body.expiresAt) { const date = new Date(req.body.expiresAt); if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) lib.fail(400, 'Expiration must be in the future'); expires = date.toISOString(); }
  const password = req.body.password || '';
  if (typeof password !== 'string' || password.length > 256) lib.fail(400, 'Invalid password');
  const token = req.body.public ? crypto.randomBytes(32).toString('base64url') : null;
  let id;
  db.transaction(() => {
    id = Number(db.prepare('INSERT INTO bookmark_shares(owner_id,folder,title,token_hash,password_hash,expires_at) VALUES (?,?,?,?,?,?)').run(req.user.id, folder, title, token ? lib.digest(token) : null, password ? hashPassword(password) : null, expires).lastInsertRowid);
    for (const user of userIds) db.prepare('INSERT INTO bookmark_share_grants(share_id,user_id) VALUES (?,?)').run(id, user);
    for (const group of new Set(groupIds)) db.prepare('INSERT INTO bookmark_share_grants(share_id,group_id) VALUES (?,?)').run(id, group);
  })();
  res.status(201).json({ id, url: token ? `/s/bookmarks/${token}` : null, rss: token ? `/s/bookmarks/${token}/rss` : null });
}));
router.get('/bookmark-shares/:id/items', handle((req, res) => {
  const share = db.prepare('SELECT * FROM bookmark_shares WHERE id=?').get(req.params.id);
  if (!available(share) || !canRead(share, req.user.id)) lib.fail(404, 'Collection not found');
  res.json({ title: share.title, items: lib.publicItems(share) });
}));
router.delete('/bookmark-shares/:id', handle((req, res) => {
  const result = db.prepare('DELETE FROM bookmark_shares WHERE id=? AND owner_id=?').run(req.params.id, req.user.id);
  if (!result.changes) lib.fail(404, 'Share not found');
  res.status(204).end();
}));
publicRouter.use('/s/bookmarks', requireFeatureDav('bookmarks'));
publicRouter.use('/s/bookmarks', (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  next();
});
function fromToken(token) {
  if (!/^[\w-]{43}$/.test(token)) lib.fail(404, 'Collection not found');
  const share = db.prepare('SELECT * FROM bookmark_shares WHERE token_hash=?').get(lib.digest(token));
  if (!available(share)) lib.fail(404, 'Collection not found');
  return share;
}
function unlocked(req, share) {
  if (!share.password_hash) return true;
  const cookie = parseCookies(req.headers.cookie)[`bookmark_share_${share.id}`];
  return cookie && db.prepare('SELECT 1 FROM bookmark_share_sessions WHERE token_hash=? AND share_id=? AND expires_at>?').get(lib.digest(cookie), share.id, new Date().toISOString());
}
function page(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${lib.escape(title)} · SyncMark</title><style>body{font:16px system-ui;background:#f6f8fc;color:#202124;max-width:850px;margin:40px auto;padding:24px}main{background:white;padding:32px;border-radius:28px}article{padding:16px 0;border-bottom:1px solid #ddd}a{color:#0b57d0;overflow-wrap:anywhere}p{line-height:1.7}input,button{font:inherit;padding:12px;border:1px solid #aaa;border-radius:12px}button{background:#d3e3fd}small{color:#555}</style><main><h1>${lib.escape(title)}</h1>${body}</main></html>`;
}
publicRouter.get('/s/bookmarks/:token', handle((req, res) => {
  const share = fromToken(req.params.token);
  if (!unlocked(req, share)) return res.status(401).type('html').send(page(share.title, '<p>This collection is protected by a password.</p><form method="post"><label>Password <input type="password" name="password" required maxlength="256" autocomplete="current-password"></label> <button>Open collection</button></form>'));
  res.type('html').send(page(share.title, `<p><a href="${lib.escape(req.path)}/rss">RSS feed</a></p>${lib.publicItems(share).map((b) => `<article><a href="${lib.escape(b.url)}" rel="noopener noreferrer" target="_blank">${lib.escape(b.title)}</a><p>${lib.escape(b.url)}</p><small>${lib.escape(b.tags.join(' · '))}</small></article>`).join('') || '<p>No bookmarks in this collection.</p>'}`));
}));
const attempts = new Map();
publicRouter.post('/s/bookmarks/:token', express.urlencoded({ extended: false, limit: '2kb' }), handle((req, res) => {
  const share = fromToken(req.params.token);
  const key = `${req.ip}:${share.id}`;
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const rate = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
  if (++rate.count > 10 || attempts.size > 10000) lib.fail(429, 'Too many attempts; try again later');
  attempts.set(key, rate);
  if (typeof req.body.password !== 'string' || !share.password_hash || !verifyPassword(req.body.password, share.password_hash)) lib.fail(401, 'Incorrect password');
  attempts.delete(key);
  db.prepare('DELETE FROM bookmark_share_sessions WHERE expires_at<=?').run(new Date().toISOString());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO bookmark_share_sessions(token_hash,share_id,expires_at) VALUES (?,?,?)').run(lib.digest(token), share.id, new Date(now + 3600000).toISOString());
  res.set('Set-Cookie', `bookmark_share_${share.id}=${token}; HttpOnly; SameSite=Lax; Path=/s/bookmarks/${req.params.token}; Max-Age=3600${req.secure ? '; Secure' : ''}`);
  res.redirect(303, req.path);
}));
publicRouter.get('/s/bookmarks/:token/rss', handle((req, res) => {
  const share = fromToken(req.params.token);
  if (!unlocked(req, share)) {
    const key = `${req.ip}:${share.id}`;
    const current = attempts.get(key);
    const rate = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 15 * 60000 };
    if (rate.count >= 10 || attempts.size > 10000) lib.fail(429, 'Too many attempts; try again later');
    const raw = /^Basic\s+(.+)$/i.exec(req.get('Authorization') || '');
    const decoded = raw ? Buffer.from(raw[1], 'base64').toString('utf8') : '';
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : '';
    if (!password || password.length > 256 || !verifyPassword(password, share.password_hash)) {
      if (raw) { rate.count++; attempts.set(key, rate); }
      res.set('WWW-Authenticate', 'Basic realm="SyncMark shared bookmarks"');
      lib.fail(401, 'Enter the collection password (any username) in your feed reader');
    }
    attempts.delete(key);
  }
  res.type('application/rss+xml').send(lib.rss(share.title, lib.publicItems(share), `${req.protocol}://${req.get('host')}/s/bookmarks/${req.params.token}`));
}));
module.exports = { router, publicRouter };
