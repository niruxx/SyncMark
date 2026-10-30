const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmark-bookmark-test-'));
process.env.SYNCMARK_DATA_DIR = path.join(fixture, 'data');
fs.mkdirSync(process.env.SYNCMARK_DATA_DIR);
const legacy = require('better-sqlite3')(path.join(process.env.SYNCMARK_DATA_DIR, 'bookmarks.sqlite3'));
legacy.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,role TEXT DEFAULT 'user',enabled INTEGER DEFAULT 1,avatar BLOB,avatar_mime TEXT,created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE bookmarks(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,url TEXT,folder TEXT DEFAULT '',favorite INTEGER DEFAULT 0,position REAL DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
  INSERT INTO users(id,username,password_hash) VALUES (1,'legacy','unused:hash');
  INSERT INTO bookmarks(id,user_id,title,url,folder,favorite,position) VALUES (1,1,'Existing library','https://example.com/legacy','',1,99);`);
legacy.close();
const { db, statements, setFeatureFlags, insertManyBookmarks } = require('../src/db');
const { hashPassword } = require('../src/utils/password');
const network = require('../src/utils/bookmarkFetch');
const realFetch = network.fetchPage;
network.fetchPage = async (url, options) => {
  if (url.startsWith('https://example.com/article')) return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><title>Reference</title><body><nav>Navigation</nav><article>Unique captured astronomy text.<script>alert(1)</script><img src="http://127.0.0.1/private"></article></body></html>', url };
  if (url === 'https://example.com/missing') return { status: 404, headers: {}, body: '', url };
  return realFetch(url, options);
};
const tools = require('../src/routes/bookmarkTools');
network.fetchPage = realFetch;
const sync = require('../src/routes/bookmarkSync');
const shares = require('../src/routes/bookmarkShares');

test('bookmark metadata, maintenance, sharing, feeds, and browser sync', async (t) => {
  const accounts = {};
  for (const name of ['alice', 'bob', 'carol']) {
    accounts[name] = Number(statements.insertUser.run({ username: name, passwordHash: hashPassword('test-password'), role: 'user' }).lastInsertRowid);
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(name + '-token', accounts[name], '2099-01-01T00:00:00Z');
  }
  const app = express(); app.use(sync.router); app.use(express.json()); app.use(shares.publicRouter);
  app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('bookmarks', tools));
  app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('bookmarks', shares.router));
  const writes = express.Router(); writes.use(sync.guard); writes.use(require('../src/routes/bookmarks'), require('../src/routes/folders'), require('../src/routes/import'));
  app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('bookmarks', writes));
  app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 400).json({ error: err.message }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, options = {}, name = 'alice') => fetch(base + '/api' + url, { ...options, headers: { Cookie: `session=${name}-token`, ...options.headers } });
  const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dav = (name = 'bookmarks.xbel', options = {}, client = 'client-a') => fetch(base + '/bookmark-sync/' + name, { ...options, headers: { Authorization: 'Basic ' + Buffer.from('alice:test-password').toString('base64'), 'User-Agent': client, ...options.headers } });
  let bookmark;
  try {
    await t.test('additive migration preserves existing bookmarks and initializes metadata defaults', () => {
      const row = statements.getBookmark.get(1, 1);
      assert.equal(row.title, 'Existing library'); assert.equal(row.favorite, 1); assert.equal(row.position, 99);
      assert.equal(row.tags, '[]'); assert.equal(row.notes, ''); assert.equal(row.archive_text, ''); assert.equal(row.visit_count, 0);
    });
    await t.test('tags and private notes persist, filter, search, and validate', async () => {
      const response = await api('/bookmarks', json({ title: 'Reference', url: 'https://example.com/article', folder: 'Research', tags: [' Space ', 'space', 'Read'], notes: 'Private telescope notes' }));
      assert.equal(response.status, 201); bookmark = await response.json();
      assert.deepEqual(bookmark.tags, ['space', 'read']);
      assert.equal((await (await api('/bookmarks?tag=space')).json()).length, 1);
      assert.equal((await (await api('/bookmarks?q=telescope')).json()).length, 1);
      assert.deepEqual(await (await api('/bookmarks/tags')).json(), ['read', 'space']);
      assert.equal((await api(`/bookmarks/${bookmark.id}`, json({ tags: [123] }, 'PUT'))).status, 400);
      assert.equal((await api('/bookmarks', json({ title: 'Bad', url: 'javascript:alert(1)' }))).status, 400);
      await api(`/bookmarks/${bookmark.id}`, json({ title: 'New reference title' }, 'PUT'));
      const updated = await (await api(`/bookmarks/${bookmark.id}`)).json();
      assert.equal(updated.notes, 'Private telescope notes'); assert.deepEqual(updated.tags, ['space', 'read']);
    });
    await t.test('readable archives remove active content and participate in search', async () => {
      assert.equal((await api(`/bookmarks/${bookmark.id}/archive`, { method: 'POST' })).status, 200);
      const archive = await api(`/bookmarks/${bookmark.id}/archive`);
      assert.match(archive.headers.get('content-type'), /text\/plain/);
      const text = await archive.text(); assert.match(text, /astronomy/); assert.doesNotMatch(text, /alert|127\.0\.0\.1|Navigation/);
      const found = await (await api('/bookmarks?q=astronomy')).json(); assert.equal(found.length, 1); assert.equal(found[0].has_archive, true); assert.equal('archive_text' in found[0], false);
      assert.equal((await api(`/bookmarks/${bookmark.id}/archive`, {}, 'bob')).status, 404);
      await api(`/bookmarks/${bookmark.id}`, json({ url: 'https://example.com/article-two' }, 'PUT'));
      assert.equal((await api(`/bookmarks/${bookmark.id}/archive`)).status, 404);
      await api(`/bookmarks/${bookmark.id}/archive`, { method: 'POST' });
    });
    await t.test('link health distinguishes broken, blocked, and valid links', async () => {
      assert.equal((await (await api(`/bookmarks/${bookmark.id}/check`, { method: 'POST' })).json()).status, 'ok');
      const missing = await (await api('/bookmarks', json({ title: 'Missing', url: 'https://example.com/missing' }))).json();
      assert.equal((await (await api(`/bookmarks/${missing.id}/check`, { method: 'POST' })).json()).status, 'broken');
      const local = await (await api('/bookmarks', json({ title: 'Local', url: 'http://127.0.0.1/private' }))).json();
      assert.equal((await (await api(`/bookmarks/${local.id}/check`, { method: 'POST' })).json()).status, 'blocked');
      assert.equal((await api(`/bookmarks/${local.id}/archive`, { method: 'POST' })).status, 403);
    });
    await t.test('SSRF protection blocks nonpublic IPs, DNS rebinding targets, and private redirects', async () => {
      for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(network.isPublicAddress(address), false, address);
      assert.equal(network.isPublicAddress('1.1.1.1'), true); assert.equal(network.isPublicAddress('2606:4700:4700::1111'), true);
      await assert.rejects(realFetch('http://public.example/', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), (err) => err.status === 403);
      const http = require('http'), original = http.request;
      const { EventEmitter } = require('events'), { PassThrough } = require('stream');
      let calls = 0;
      http.request = (url, options, callback) => {
        calls++;
        const req = new EventEmitter(); req.destroy = (err) => req.emit('error', err);
        req.end = () => queueMicrotask(() => {
          options.lookup(url.hostname, {}, (err, address) => assert.equal(address, '1.1.1.1'));
          const res = new PassThrough(); res.statusCode = 302; res.headers = { location: 'http://127.0.0.1/private' }; callback(res);
        }); return req;
      };
      try { await assert.rejects(realFetch('http://public.example/', { lookup: async () => [{ address: '1.1.1.1', family: 4 }] }), (err) => err.status === 403); assert.equal(calls, 1); }
      finally { http.request = original; }
    });
    await t.test('duplicate URL merge preserves metadata and rejects other users or unrelated URLs', async () => {
      const duplicate = await (await api('/bookmarks', json({ title: 'Duplicate', url: 'https://EXAMPLE.com/article-two#section', tags: ['other'], notes: 'Second note', favorite: true }))).json();
      const groups = await (await api('/bookmarks/duplicates')).json(); assert.equal(groups.length, 1);
      const wrongUser = await (await api('/bookmarks', json({ title: 'Other', url: 'https://example.com/article-two' }), 'bob')).json();
      assert.equal((await api('/bookmarks/duplicates/merge', json({ keepId: bookmark.id, ids: [bookmark.id, wrongUser.id] }))).status, 404);
      assert.equal((await api('/bookmarks/duplicates/merge', json({ keepId: bookmark.id, ids: [bookmark.id, duplicate.id] }))).status, 200);
      const kept = await (await api(`/bookmarks/${bookmark.id}`)).json(); assert.deepEqual(kept.tags, ['space', 'read', 'other']); assert.match(kept.notes, /Second note/); assert.equal(kept.favorite, 1);
      assert.equal((await api(`/bookmarks/${duplicate.id}`)).status, 404);
    });
    await t.test('visit counts and recent/frequent widgets are private and exclude never-opened bookmarks', async () => {
      await api(`/bookmarks/${bookmark.id}/visit`, { method: 'POST' }); await api(`/bookmarks/${bookmark.id}/visit`, { method: 'POST' });
      const dashboard = await (await api('/bookmarks/dashboard')).json(); assert.equal(dashboard.visits, 2); assert.equal(dashboard.recent[0].id, bookmark.id); assert.equal(dashboard.frequent[0].visit_count, 2);
      assert.equal((await api(`/bookmarks/${bookmark.id}/visit`, { method: 'POST' }, 'bob')).status, 404);
      assert.equal((await (await api('/bookmarks/dashboard', {}, 'bob')).json()).visits, 0);
    });
    await t.test('direct user collection grants are read-only and do not expose private fields', async () => {
      const share = await (await api('/bookmark-shares', json({ folder: 'Research', users: ['bob'], title: 'Research share' }))).json();
      assert.equal(share.url, null);
      assert.equal((await (await api('/bookmark-shares/received', {}, 'bob')).json()).length, 1);
      const items = await (await api(`/bookmark-shares/${share.id}/items`, {}, 'bob')).json();
      assert.equal(items.items.length, 1); assert.equal('notes' in items.items[0], false); assert.equal('archive_text' in items.items[0], false); assert.equal('visit_count' in items.items[0], false);
      assert.equal((await api(`/bookmark-shares/${share.id}/items`, {}, 'carol')).status, 404);
      assert.equal((await api(`/bookmark-shares/${share.id}`, { method: 'DELETE' }, 'bob')).status, 404);
    });
    await t.test('group membership changes immediately grant and remove collection access', async () => {
      const group = await (await api('/bookmark-groups', json({ name: 'Readers', members: ['bob'] }))).json();
      const share = await (await api('/bookmark-shares', json({ folder: 'Research', groups: [group.id] }))).json();
      assert.equal((await api(`/bookmark-shares/${share.id}/items`, {}, 'bob')).status, 200);
      await api(`/bookmark-groups/${group.id}`, json({ name: 'Readers', members: ['carol'] }, 'PUT'));
      assert.equal((await api(`/bookmark-shares/${share.id}/items`, {}, 'bob')).status, 404);
      assert.equal((await api(`/bookmark-shares/${share.id}/items`, {}, 'carol')).status, 200);
      assert.equal((await api('/bookmark-shares', json({ groups: [group.id] }), 'bob')).status, 404);
      await api(`/bookmark-groups/${group.id}`, { method: 'DELETE' });
      assert.equal((await api(`/bookmark-shares/${share.id}/items`, {}, 'carol')).status, 404);
    });
    await t.test('public shares, password cookies, RSS credentials, escaping, expiration, and revocation', async () => {
      const created = await api('/bookmark-shares', json({ folder: 'Research', public: true, password: 'share-password', title: '<script>Public & RSS</script>' }));
      assert.equal(created.status, 201); const share = await created.json();
      const stored = db.prepare('SELECT * FROM bookmark_shares WHERE id=?').get(share.id); assert.notEqual(stored.token_hash, share.url.split('/').pop()); assert.notEqual(stored.password_hash, 'share-password');
      assert.equal((await fetch(base + share.url)).status, 401);
      const unlocked = await fetch(base + share.url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=share-password', redirect: 'manual' });
      assert.equal(unlocked.status, 303);
      const cookie = unlocked.headers.get('set-cookie').split(';')[0];
      const guest = await fetch(base + share.url, { headers: { Cookie: cookie } }); assert.equal(guest.status, 200);
      const html = await guest.text(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /Private telescope notes|Second note|Unique captured/);
      assert.equal((await fetch(base + share.rss)).status, 401);
      const feed = await fetch(base + share.rss, { headers: { Authorization: 'Basic ' + Buffer.from('share:share-password').toString('base64') } }); assert.equal(feed.status, 200); assert.match(feed.headers.get('content-type'), /rss\+xml/); assert.match(await feed.text(), /<rss version="2.0">/);
      db.prepare('UPDATE bookmark_shares SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', share.id);
      assert.equal((await fetch(base + share.url, { headers: { Cookie: cookie } })).status, 404);
      await api(`/bookmark-shares/${share.id}`, { method: 'DELETE' });
      assert.equal((await fetch(base + share.rss)).status, 404);
    });
    await t.test('folder rename follows collection shares and deletion revokes old links', async () => {
      const share = await (await api('/bookmark-shares', json({ folder: 'Research', public: true }))).json();
      assert.equal((await api('/folders', json({ oldName: 'Research', newName: 'Study' }, 'PUT'))).status, 200);
      assert.equal((await fetch(base + share.url)).status, 200);
      const data = await (await api(`/bookmark-shares/${share.id}/items`)).json(); assert.equal(data.items.length, 1);
      await api('/folders', json({ name: 'Study' }, 'DELETE'));
      assert.equal((await fetch(base + share.url)).status, 404);
    });
    await t.test('folder names containing SQL wildcards cannot include or move other collections', async () => {
      await api('/bookmarks', json({ title: 'Literal', url: 'https://example.com/literal', folder: '100%/Child' }));
      await api('/bookmarks', json({ title: 'Other', url: 'https://example.com/unrelated', folder: '100x/Child' }));
      assert.equal((await (await api('/bookmarks?folder=100%25')).json()).length, 1);
      await api('/folders', json({ oldName: '100%', newName: 'Literal' }, 'PUT'));
      const other = await (await api('/bookmarks?folder=100x')).json(); assert.equal(other.length, 1); assert.equal(other[0].folder, '100x/Child');
      await api('/folders', json({ name: 'Literal' }, 'DELETE'));
      assert.equal((await (await api('/bookmarks?folder=100x')).json()).length, 1);
    });
    await t.test('JSON export/import preserves tags, notes, favorites, and unfiled bookmarks', async () => {
      const exported = await (await api('/export?format=json')).json();
      const parsed = require('../src/parsers/json').parseJsonBookmarks(exported);
      const original = exported.find((r) => r.notes.includes('telescope'));
      assert.equal(original.folder, ''); assert.ok(original.tags.length);
      insertManyBookmarks(accounts.carol, parsed);
      const rows = await (await api('/bookmarks?q=telescope', {}, 'carol')).json(); assert.equal(rows.length, 1); assert.equal(rows[0].folder, ''); assert.deepEqual(rows[0].tags, original.tags); assert.equal(rows[0].favorite, 1);
    });
    await t.test('Floccus lock, temp upload, size PROPFIND, MOVE, and metadata-preserving round trip', async () => {
      assert.equal((await dav('bookmarks.xbel.lock')).status, 404);
      assert.equal((await dav('bookmarks.xbel.lock', { method: 'PUT', body: 'lock' })).status, 201);
      assert.equal((await dav('bookmarks.xbel.lock', { method: 'PUT', body: 'lock' }, 'client-b')).status, 423);
      assert.equal((await api('/bookmarks', json({ title: 'During sync', url: 'https://example.com/new' }))).status, 423);
      assert.equal((await api('/files/nonexistent', json({}))).status, 404);
      const download = await dav(); const xml = await download.text(); assert.match(xml, /highestId/);
      const tree = sync.parse(xml); const highest = tree.highest;
      const uploaded = xml.replace('</xbel>', `<bookmark id="${highest + 1}" href="https://example.com/from-browser"><title>From browser — café</title></bookmark>\n</xbel>`);
      assert.equal((await dav('bookmarks.xbel.temp', { method: 'PUT', headers: { 'Content-Type': 'application/xml' }, body: uploaded })).status, 201);
      const tempSize = await dav('bookmarks.xbel.temp', { method: 'PROPFIND', headers: { Depth: '0' } }); assert.equal(tempSize.status, 207); assert.match(await tempSize.text(), new RegExp(`<d:getcontentlength>${Buffer.byteLength(uploaded)}</d:getcontentlength>`));
      assert.equal((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { Destination: base + '/bookmark-sync/bookmarks.xbel' } })).status, 204);
      assert.equal(await (await dav()).text(), uploaded);
      assert.equal(Number((await dav('bookmarks.xbel', { method: 'HEAD' })).headers.get('content-length')), Buffer.byteLength(uploaded));
      assert.equal((await (await api('/bookmarks?q=from-browser')).json()).length, 1);
      const retained = await (await api(`/bookmarks/${bookmark.id}`)).json(); assert.match(retained.notes, /telescope/); assert.equal(retained.visit_count, 2); assert.equal(retained.has_archive, true);
      assert.equal((await dav('bookmarks.xbel.lock', { method: 'DELETE' })).status, 204);
      assert.equal((await api('/bookmarks', json({ title: 'After sync', url: 'https://example.com/after' }))).status, 201);
    });
    await t.test('sync rejects malformed trees, stale writes, other accounts, and intervening changes', async () => {
      const current = await dav(); const tag = current.headers.get('etag'), xml = await current.text();
      assert.equal((await dav('bookmarks.xbel', { method: 'PUT', headers: { 'If-Match': tag }, body: '<xbel><folder></xbel>' })).status, 400);
      await api('/bookmarks', json({ title: 'Intervening', url: 'https://example.com/intervening' }));
      assert.equal((await dav('bookmarks.xbel', { method: 'PUT', headers: { 'If-Match': tag }, body: xml })).status, 412);
      const duplicate = '<xbel><bookmark id="1" href="https://example.com"><title>A</title></bookmark><bookmark id="1" href="https://example.com/b"><title>B</title></bookmark></xbel>';
      assert.throws(() => sync.parse(duplicate));
      assert.throws(() => sync.parse('<!DOCTYPE xbel [<!ENTITY x "test">]><xbel/>'));
      const other = await fetch(base + '/bookmark-sync/bookmarks.xbel', { headers: { Authorization: 'Basic ' + Buffer.from('bob:test-password').toString('base64') } });
      assert.doesNotMatch(await other.text(), /Intervening|From browser/);
      assert.equal((await dav('bookmarks.xbel.lock', { method: 'PUT', body: 'lock' })).status, 201);
      const before = await (await dav()).text();
      const tree = sync.parse(before); const removeId = tree.bookmarks.find((b) => b.url === 'https://example.com/after').syncId;
      const changed = before.replace(new RegExp(`<bookmark id="${removeId}"[^>]*>[\\s\\S]*?</bookmark>`), '');
      assert.equal((await dav('bookmarks.xbel', { method: 'PUT', body: changed })).status, 204);
      assert.equal((await (await api('/bookmarks?q=https%3A%2F%2Fexample.com%2Fafter')).json()).length, 0);
      await dav('bookmarks.xbel.lock', { method: 'DELETE' });
    });
    await t.test('feature disabling blocks tools, public shares, and sync', async () => {
      const share = await (await api('/bookmark-shares', json({ public: true }))).json();
      setFeatureFlags({ bookmarks: false });
      assert.equal((await api('/bookmarks/dashboard')).status, 404);
      assert.equal((await fetch(base + share.url)).status, 403);
      assert.equal((await dav()).status, 403);
      setFeatureFlags({ bookmarks: true });
    });
    await t.test('bookmark backups include archives, grants, and groups but clear transient sync locks', async () => {
      const backup = require('../src/backup'); const dir = path.join(fixture, 'backups'); fs.mkdirSync(dir); backup.saveSchedule({ dir });
      await api('/bookmark-groups', json({ name: 'Backup group', members: ['bob'] }));
      const share = await (await api('/bookmark-shares', json({ public: true }))).json();
      const saved = await backup.writeBackupFile(['bookmarks']);
      db.prepare('DELETE FROM bookmark_shares WHERE owner_id=?').run(accounts.alice);
      db.prepare("UPDATE bookmarks SET archive_text='', archived_at=NULL WHERE user_id=?").run(accounts.alice);
      await backup.restoreBackup(dir, saved.name, ['bookmarks']);
      assert.equal((await fetch(base + share.url)).status, 200);
      assert.ok(statements.getBookmark.get(bookmark.id, accounts.alice).archive_text);
      assert.equal((await (await api('/bookmark-groups')).json())[0].name, 'Backup group');
      assert.equal(db.prepare('SELECT lock_at FROM bookmark_sync WHERE user_id=?').get(accounts.alice).lock_at, null);
      const accountBackup = await backup.writeBackupFile(['account']);
      await backup.restoreBackup(dir, accountBackup.name, ['account']);
      assert.ok(db.prepare('SELECT 1 FROM bookmark_shares WHERE id=?').get(share.id));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve)); db.close();
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir())); assert.ok(path.basename(fixture).startsWith('syncmark-bookmark-test-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
