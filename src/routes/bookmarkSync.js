const express = require('express');
const cheerio = require('cheerio');
const { db, statements, ensureFolderAncestors } = require('../db');
const { basicAuth } = require('../middleware/basicAuth');
const { requireFeatureDav } = require('../middleware/featureGate');
const lib = require('../utils/bookmarkLibrary');
const router = express.Router();
const TTL = 15 * 60000;
function state(userId) {
  db.prepare('INSERT OR IGNORE INTO bookmark_sync(user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM bookmark_sync WHERE user_id=?').get(userId);
}
function active(userId) { const row = state(userId); return row.lock_at && row.lock_at + TTL > Date.now() ? row : null; }
function guard(req, res, next) {
  if (!/^\/(?:bookmarks(?:\/|$)|folders(?:\/|$)|import$)/.test(req.path)) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (active(req.user.id)) return res.status(423).json({ error: 'Browser bookmark sync is active; retry after it finishes' });
  next();
}
const snapshot = db.transaction((userId) => {
  let highest = state(userId).highest_id;
  for (const table of ['bookmarks', 'folders']) {
    const rows = db.prepare(`SELECT id,sync_id FROM ${table} WHERE user_id=? ORDER BY id`).all(userId);
    highest = rows.reduce((value, row) => Math.max(value, row.sync_id || 0), highest);
    for (const row of rows) if (row.sync_id === null) db.prepare(`UPDATE ${table} SET sync_id=? WHERE id=? AND user_id=?`).run(++highest, row.id, userId);
  }
  db.prepare('UPDATE bookmark_sync SET highest_id=? WHERE user_id=?').run(highest, userId);
  const root = { children: new Map(), bookmarks: [] };
  function folder(name) {
    let node = root, soFar = '';
    for (const segment of name.split('/').filter(Boolean)) {
      soFar = soFar ? soFar + '/' + segment : segment;
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), bookmarks: [], path: soFar, title: segment });
      node = node.children.get(segment);
    }
    return node;
  }
  for (const row of db.prepare('SELECT * FROM folders WHERE user_id=? ORDER BY position,id').all(userId)) Object.assign(folder(row.name), { id: row.sync_id, position: row.position });
  for (const row of db.prepare('SELECT * FROM bookmarks WHERE user_id=? ORDER BY position,id').all(userId)) folder(row.folder).bookmarks.push(row);
  function render(node) {
    return [...node.children.values(), ...node.bookmarks].sort((a, b) => a.position - b.position).map((item) => item.children
      ? `<folder id="${item.id}"><title>${lib.escape(item.title)}</title>${render(item)}</folder>`
      : `<bookmark id="${item.sync_id}" href="${lib.escape(item.url)}"><title>${lib.escape(item.title)}</title></bookmark>`).join('');
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xbel version="1.0">\n<!--- highestId :${highest}: for Floccus bookmark sync browser extension -->\n${render(root)}\n</xbel>`;
  const revision = '"' + lib.digest(xml) + '"';
  const cached = state(userId);
  const representation = cached.exported_revision === revision ? cached.exported_xml : xml;
  return { xml: representation, etag: '"' + lib.digest(representation) + '"', revision };
});
function parse(xml) {
  if (typeof xml !== 'string' || /<!ENTITY/i.test(xml) || /<!DOCTYPE[^>]*\[/i.test(xml)) lib.fail(400, 'Unsupported XBEL document');
  const tokenPattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?[A-Za-z_][^>]*>/g;
  const stack = [];
  let cursor = 0;
  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    if (xml.slice(cursor, match.index).includes('<')) lib.fail(400, 'Malformed XBEL');
    cursor = match.index + token.length;
    if (/^<(!|\?)/.test(token)) continue;
    const name = /^<\/?([^\s/>]+)/.exec(token)[1];
    if (token.startsWith('</')) { if (stack.pop() !== name) lib.fail(400, 'Malformed XBEL'); }
    else if (!token.endsWith('/>')) stack.push(name);
  }
  if (stack.length || xml.slice(cursor).includes('<')) lib.fail(400, 'Malformed XBEL');
  const $ = cheerio.load(xml, { xmlMode: true });
  if ($.root().contents().toArray().some((node) => node.type === 'text' && node.data.trim())) lib.fail(400, 'Unexpected text outside the XBEL root');
  if ($.root().children().length !== 1 || $.root().children().first()[0].name !== 'xbel') lib.fail(400, 'Expected one XBEL root');
  const ids = new Set(), paths = new Set(), folders = [], bookmarks = [];
  function id(node) {
    const raw = $(node).attr('id');
    if (!/^\d+$/.test(raw || '')) lib.fail(400, 'Every item needs a numeric ID');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647 || ids.has(value)) lib.fail(400, 'Invalid or duplicate item ID');
    ids.add(value); return value;
  }
  function walk(parent, path, depth) {
    if (depth > 40) lib.fail(400, 'Folder tree is too deep');
    $(parent).children().each((position, node) => {
      if (['title', 'desc', 'info'].includes(node.name)) return;
      if (!['folder', 'bookmark'].includes(node.name)) lib.fail(400, 'Unsupported XBEL item');
      const title = $(node).children('title').first().text();
      const syncId = id(node);
      if (ids.size > 20000 || title.length > 2000) lib.fail(400, 'XBEL exceeds item or title limits');
      if (node.name === 'folder') {
        if (!title.trim() || /[\/\\\x00-\x1f]/.test(title) || title !== title.trim()) lib.fail(400, 'Folder names must be nonempty path segments');
        const name = path ? `${path}/${title}` : title;
        if (paths.has(name)) lib.fail(400, 'Duplicate folder path');
        paths.add(name); folders.push({ name, syncId, position }); walk(node, name, depth + 1);
      } else {
        const url = $(node).attr('href');
        if (!lib.validUrl(url)) lib.fail(400, 'Only HTTP(S) bookmarks without embedded credentials are supported');
        bookmarks.push({ title: title || url, url, folder: path, syncId, position });
      }
    });
  }
  walk($('xbel')[0], '', 0);
  const declared = Number(/highestId\s*:(\d+):/.exec(xml)?.[1] || 0);
  if (!Number.isSafeInteger(declared) || declared > 2147483647) lib.fail(400, 'Invalid highest item ID');
  return { folders, bookmarks, highest: Math.max(declared, 0, ...ids) };
}
const apply = db.transaction((userId, tree) => {
  const previous = statements.listAllBookmarks.all(userId);
  const byId = new Map(previous.map((r) => [r.sync_id, r]));
  const oldFolders = db.prepare('SELECT * FROM folders WHERE user_id=?').all(userId);
  if (tree.folders.some((f) => byId.has(f.syncId)) || tree.bookmarks.some((b) => oldFolders.some((f) => f.sync_id === b.syncId))) lib.fail(400, 'Item IDs cannot change type');
  const keep = new Set();
  for (const item of tree.bookmarks) {
    let row = byId.get(item.syncId);
    if (row) statements.updateBookmark.run({ id: row.id, userId, title: item.title, url: item.url, folder: item.folder, favorite: row.favorite });
    else { const result = statements.insertBookmark.run({ userId, title: item.title, url: item.url, folder: item.folder }); row = { id: Number(result.lastInsertRowid) }; }
    db.prepare('UPDATE bookmarks SET sync_id=?, position=? WHERE id=? AND user_id=?').run(item.syncId, item.position, row.id, userId);
    keep.add(row.id);
  }
  for (const row of previous) if (!keep.has(row.id)) statements.deleteBookmark.run(row.id, userId);
  db.prepare('DELETE FROM folders WHERE user_id=?').run(userId);
  for (const folder of tree.folders) {
    ensureFolderAncestors(userId, folder.name);
    db.prepare('UPDATE folders SET sync_id=?, position=? WHERE user_id=? AND name=?').run(folder.syncId, folder.position, userId, folder.name);
  }
  // Deleted collections must not silently reappear through an old public URL.
  for (const share of db.prepare("SELECT id,folder FROM bookmark_shares WHERE owner_id=? AND folder!=''").all(userId)) {
    const old = oldFolders.find((folder) => folder.name === share.folder);
    const next = old && tree.folders.find((folder) => folder.syncId === old.sync_id);
    if (next) db.prepare('UPDATE bookmark_shares SET folder=? WHERE id=?').run(next.name, share.id);
    else db.prepare('DELETE FROM bookmark_shares WHERE id=?').run(share.id);
  }
  db.prepare('UPDATE bookmark_sync SET highest_id=MAX(highest_id,?) WHERE user_id=?').run(tree.highest, userId);
});
router.use('/bookmark-sync', basicAuth, requireFeatureDav('bookmarks'));
router.use('/bookmark-sync', express.text({ type: () => true, limit: '5mb' }));
router.all(/^\/bookmark-sync\/(bookmarks\.xbel(?:\.lock|\.temp)?)?$/, (req, res, next) => {
  try {
    const user = req.davUser.id;
    if (db.prepare('SELECT role FROM users WHERE id=?').get(user).role !== 'user') lib.fail(403, 'A regular account is required');
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Allow: 'OPTIONS, HEAD, GET, PROPFIND, PUT, MOVE, DELETE', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    if (req.method === 'OPTIONS') return res.status(200).end();
    const name = req.path.split('/').pop();
    const client = lib.digest(req.ip + '\0' + (req.get('user-agent') || ''));
    let locked = active(user);
    if (req.method === 'PROPFIND') {
      let value;
      if (name === 'bookmarks.xbel') value = snapshot(user).xml;
      else if (name === 'bookmarks.xbel.temp' && locked?.staged) value = locked.staged;
      else if (name === 'bookmarks.xbel.lock' && locked) value = 'Sync in progress';
      else return res.status(404).end();
      return res.status(207).type('application/xml').send(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${lib.escape(req.path)}</d:href><d:propstat><d:prop><d:getcontentlength>${Buffer.byteLength(value)}</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (name === 'bookmarks.xbel.lock') {
      if (['GET', 'HEAD'].includes(req.method)) {
        if (!locked) return res.status(404).end();
        return res.set('Last-Modified', new Date(locked.lock_at).toUTCString()).type('text/plain').send('Sync in progress');
      }
      if (req.method === 'PUT') {
        if (locked && locked.lock_owner !== client) lib.fail(423, 'Another client is syncing');
        if (locked && Date.now() - locked.lock_at < 110000) lib.fail(423, 'A sync lock is already held');
        if (locked) db.prepare('UPDATE bookmark_sync SET lock_at=? WHERE user_id=?').run(Date.now(), user);
        else db.prepare('UPDATE bookmark_sync SET lock_owner=?,lock_at=?,baseline=?,committed_hash=NULL,staged=NULL WHERE user_id=?').run(client, Date.now(), snapshot(user).etag, user);
        return res.status(201).end();
      }
      if (req.method === 'DELETE') {
        if (locked && locked.lock_owner !== client) lib.fail(423, 'Another client owns the lock');
        db.prepare('UPDATE bookmark_sync SET lock_owner=NULL,lock_at=NULL,baseline=NULL,staged=NULL,committed_hash=NULL WHERE user_id=?').run(user);
        return res.status(204).end();
      }
    }
    if (name === 'bookmarks.xbel.temp') {
      if (!locked || locked.lock_owner !== client) lib.fail(423, 'Acquire the sync lock first');
      if (req.method === 'PUT') { parse(req.body); db.prepare('UPDATE bookmark_sync SET staged=? WHERE user_id=?').run(req.body, user); return res.status(201).end(); }
      if (['GET', 'HEAD'].includes(req.method)) { if (!locked.staged) lib.fail(404, 'No staged tree'); return res.type('application/xml').send(locked.staged); }
      if (req.method === 'DELETE') { db.prepare('UPDATE bookmark_sync SET staged=NULL WHERE user_id=?').run(user); return res.status(204).end(); }
      if (req.method === 'MOVE') {
        const destination = new URL(req.get('Destination') || '', `${req.protocol}://${req.get('host')}`);
        if (destination.host !== req.get('host') || destination.pathname !== '/bookmark-sync/bookmarks.xbel') lib.fail(400, 'Invalid sync destination');
        if (!locked.staged) lib.fail(404, 'No staged tree');
        req.body = locked.staged;
      } else return res.status(405).end();
    } else if (name !== 'bookmarks.xbel') return res.status(404).end();
    if (['GET', 'HEAD'].includes(req.method)) { const data = snapshot(user); return res.set('ETag', data.etag).type('application/xml').send(data.xml); }
    if (req.method === 'PUT' || req.method === 'MOVE') {
      const tree = parse(req.body);
      const current = snapshot(user).etag;
      if (locked && locked.lock_owner !== client) lib.fail(423, 'Another client is syncing');
      if (locked) {
        if (locked.committed_hash) {
          if (locked.committed_hash === lib.digest(req.body)) return res.status(204).end();
          lib.fail(409, 'This sync session already committed a different tree');
        }
        if (locked.baseline !== current) lib.fail(412, 'Library changed during sync');
      } else if (!req.get('If-Match') || req.get('If-Match') !== current) lib.fail(412, 'Acquire a lock or supply the current ETag');
      apply(user, tree);
      const revision = snapshot(user).revision;
      db.prepare('UPDATE bookmark_sync SET exported_xml=?,exported_revision=? WHERE user_id=?').run(req.body, revision, user);
      if (locked) db.prepare('UPDATE bookmark_sync SET committed_hash=?,staged=NULL WHERE user_id=?').run(lib.digest(req.body), user);
      return res.status(204).end();
    }
    res.status(405).end();
  } catch (err) { next(err); }
});
module.exports = { router, guard, snapshot, parse };
