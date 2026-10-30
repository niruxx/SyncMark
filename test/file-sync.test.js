const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmark-file-test-'));
process.env.SYNCMARK_DATA_DIR = path.join(fixture, 'data');
const { db, statements, setFeatureFlags } = require('../src/db');
const { hashPassword } = require('../src/utils/password');
const store = require('../src/utils/fileStore');
const { resolveSafePath } = require('../src/utils/fsPath');

test('file synchronization, recovery, and isolation', async (t) => {
  const root = path.join(fixture, 'files');
  const otherRoot = path.join(fixture, 'other');
  fs.mkdirSync(root); fs.mkdirSync(otherRoot);
  const user = Number(statements.insertUser.run({ username: 'alice', passwordHash: hashPassword('test-password'), role: 'user' }).lastInsertRowid);
  const other = Number(statements.insertUser.run({ username: 'bob', passwordHash: hashPassword('other-password'), role: 'user' }).lastInsertRowid);
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run('alice-token', user, '2099-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run('bob-token', other, '2099-01-01T00:00:00.000Z');
  const location = Number(statements.insertFileLocation.run({ userId: user, name: 'Files', path: root }).lastInsertRowid);
  const destination = Number(statements.insertFileLocation.run({ userId: user, name: 'Other', path: otherRoot }).lastInsertRowid);
  setFeatureFlags({ files: true });
  const app = express();
  app.use(require('../src/routes/webdav'));
  app.use(express.json());
  app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('files', require('../src/routes/files')));
  app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('files', require('../src/routes/fileSync')));
  app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || (err.code === 'ENOENT' ? 404 : 400)).json({ error: err.message }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = 'Basic ' + Buffer.from('alice:test-password').toString('base64');
  const api = (url, options = {}) => fetch(base + '/api' + url, { ...options, headers: { Cookie: 'session=alice-token', ...options.headers } });
  const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dav = (rel = '', options = {}) => fetch(`${base}/webdav/${location}/${rel}`, { ...options, headers: { Authorization: auth, ...options.headers } });
  const file = path.join(root, 'hello.txt');
  try {
    await t.test('DAV requires authentication and honors disabled Files', async () => {
      assert.equal((await fetch(`${base}/webdav/`)).status, 401);
      setFeatureFlags({ files: false });
      assert.equal((await dav('', { method: 'OPTIONS' })).status, 403);
      assert.equal((await api('/files/sync-info?location=' + location)).status, 404);
      setFeatureFlags({ files: true });
    });
    await t.test('DAV discovery returns owned locations and handles properties', async () => {
      const response = await fetch(base + '/webdav/', { method: 'PROPFIND', headers: { Authorization: auth, Depth: '1' } });
      assert.equal(response.status, 207);
      assert.match(await response.text(), new RegExp(`/webdav/${location}/`));
      const prop = await dav('', { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><x:missing xmlns:x="urn:test"/></d:prop></d:propfind>' });
      const text = await prop.text();
      assert.match(text, /200 OK/); assert.match(text, /404 Not Found/); assert.match(text, /urn:test/);
      assert.equal((await dav('', { method: 'PROPFIND', headers: { Depth: 'infinity' } })).status, 403);
    });
    await t.test('DAV PUT/GET/HEAD/Range and conditional writes', async () => {
      const response = await dav('hello.txt', { method: 'PUT', headers: { 'If-None-Match': '*' }, body: 'original' });
      assert.equal(response.status, 201);
      const tag = response.headers.get('etag');
      assert.ok(tag);
      assert.equal(await (await dav('hello.txt')).text(), 'original');
      assert.equal((await dav('hello.txt', { method: 'HEAD' })).headers.get('content-length'), '8');
      const range = await dav('hello.txt', { headers: { Range: 'bytes=0-2' } });
      assert.equal(range.status, 206); assert.equal(await range.text(), 'ori');
      assert.equal((await dav('hello.txt', { method: 'PUT', headers: { 'If-Match': '"stale"' }, body: 'lost' })).status, 412);
      assert.equal((await dav('hello.txt', { method: 'PUT', headers: { 'If-None-Match': '*' }, body: 'lost' })).status, 412);
      assert.equal((await dav('hello.txt', { method: 'PUT', headers: { 'If-Match': tag }, body: 'updated' })).status, 204);
    });
    await t.test('DAV properties round-trip namespaces and protected changes are atomic', async () => {
      const update = '<d:propertyupdate xmlns:d="DAV:" xmlns:t="urn:test"><d:set><d:prop><t:label>Notes &amp; files</t:label></d:prop></d:set></d:propertyupdate>';
      const set = await dav('hello.txt', { method: 'PROPPATCH', headers: { 'Content-Type': 'application/xml' }, body: update });
      assert.equal(set.status, 207); assert.match(await set.text(), /200 OK/);
      const read = await dav('hello.txt', { method: 'PROPFIND', headers: { Depth: '0' }, body: '<d:propfind xmlns:d="DAV:" xmlns:t="urn:test"><d:prop><t:label/></d:prop></d:propfind>' });
      assert.match(await read.text(), /Notes &amp; files/);
      const protect = await dav('hello.txt', { method: 'PROPPATCH', body: '<d:propertyupdate xmlns:d="DAV:" xmlns:t="urn:test"><d:set><d:prop><d:getetag>fake</d:getetag><t:label>changed</t:label></d:prop></d:set></d:propertyupdate>' });
      const result = await protect.text(); assert.match(result, /403 Forbidden/); assert.match(result, /424 Failed Dependency/);
      const unchanged = await dav('hello.txt', { method: 'PROPFIND', headers: { Depth: '0' } });
      assert.match(await unchanged.text(), /Notes &amp; files/);
    });
    await t.test('history preview, restore, and stale restore rejection', async () => {
      const versions = await (await api(`/files/versions?location=${location}&path=hello.txt`)).json();
      assert.equal(versions.length, 1);
      const version = versions[0].id;
      assert.equal(await (await api(`/files/versions/${version}?location=${location}&path=hello.txt&preview=1`)).text(), 'original');
      assert.equal((await api(`/files/versions/${version}/restore?location=${location}&path=hello.txt`, { method: 'POST', headers: { 'If-Match': '"stale"' } })).status, 412);
      assert.equal((await api(`/files/versions/${version}/restore?location=${location}&path=hello.txt`, { method: 'POST', headers: { 'If-Match': store.etag(file) } })).status, 200);
      assert.equal(fs.readFileSync(file, 'utf8'), 'original');
      assert.equal((await (await api(`/files/versions?location=${location}&path=hello.txt`)).json()).length, 2);
    });
    await t.test('browser text saves capture history and prevent lost edits', async () => {
      const loaded = await (await api(`/files/text?location=${location}&path=hello.txt`)).json();
      assert.equal((await api(`/files/text?location=${location}&path=hello.txt`, { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'If-Match': loaded.etag }, body: 'browser' })).status, 200);
      assert.equal((await api(`/files/text?location=${location}&path=hello.txt`, { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'If-Match': loaded.etag }, body: 'stale' })).status, 412);
      assert.equal(fs.readFileSync(file, 'utf8'), 'browser');
    });
    await t.test('resumable upload persists offsets and commits only when complete', async () => {
      const session = await (await api('/files/uploads', json({ location, path: 'large.bin', size: 6 }))).json();
      const url = `/files/uploads/${session.id}?location=${location}`;
      assert.equal((await api(url.replace('?', '/complete?'), { method: 'POST' })).status, 409);
      assert.equal((await api(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': '0' }, body: 'abc' })).status, 200);
      assert.equal((await (await api(url)).json()).offset, 3);
      assert.equal((await api(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': '0' }, body: 'xyz' })).status, 409);
      assert.equal(fs.existsSync(path.join(root, 'large.bin')), false);
      assert.equal((await api(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': '3' }, body: 'def' })).status, 200);
      assert.equal((await api(url.replace('?', '/complete?'), { method: 'POST' })).status, 201);
      assert.equal(fs.readFileSync(path.join(root, 'large.bin'), 'utf8'), 'abcdef');
      assert.equal((await api(url)).status, 404);
    });
    await t.test('resumable overwrite detects changes and cancellation removes chunks', async () => {
      const session = await (await api('/files/uploads', json({ location, path: 'hello.txt', size: 3, overwrite: true }))).json();
      const url = `/files/uploads/${session.id}?location=${location}`;
      await api(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': '0' }, body: 'new' });
      fs.writeFileSync(file, 'external');
      assert.equal((await api(url.replace('?', '/complete?'), { method: 'POST' })).status, 412);
      assert.equal(fs.readFileSync(file, 'utf8'), 'external');
      assert.equal((await api(url, { method: 'DELETE' })).status, 204);
      assert.equal((await api(url)).status, 404);
    });
    await t.test('empty uploads complete and existing filenames require consent', async () => {
      assert.equal((await api('/files/uploads', json({ location, path: 'hello.txt', size: 0 }))).status, 409);
      const session = await (await api('/files/uploads', json({ location, path: 'empty', size: 0 }))).json();
      assert.equal((await api(`/files/uploads/${session.id}/complete?location=${location}`, { method: 'POST' })).status, 201);
      assert.equal(fs.statSync(path.join(root, 'empty')).size, 0);
    });
    await t.test('account isolation applies to browser APIs and DAV', async () => {
      const headers = { Cookie: 'session=bob-token' };
      assert.equal((await api(`/files/versions?location=${location}&path=hello.txt`, { headers })).status, 404);
      assert.equal((await api('/files/uploads', { ...json({ location, path: 'evil', size: 1 }), headers: { ...headers, 'Content-Type': 'application/json' } })).status, 404);
      assert.equal((await dav('hello.txt', { headers: { Authorization: 'Basic ' + Buffer.from('bob:other-password').toString('base64') } })).status, 404);
    });
    await t.test('reserved paths, traversal, and location-root mutation are rejected', async () => {
      for (const name of ['.syncmark/versions', '.trash', '.SYNCMARK/test', '../outside']) assert.throws(() => resolveSafePath(root, name));
      assert.equal((await dav('.syncmark/', { method: 'PROPFIND', headers: { Depth: '1' } })).status, 400);
      assert.equal((await dav('', { method: 'DELETE' })).status, 403);
      assert.equal((await dav('', { method: 'PUT', body: 'bad' })).status, 403);
      const entries = await (await api(`/files/browse?location=${location}`)).json();
      assert.equal(entries.some((e) => ['.syncmark', '.trash'].includes(e.name)), false);
    });
    await t.test('bulk copy/move across locations and per-item collision errors', async () => {
      fs.mkdirSync(path.join(root, 'folder')); fs.writeFileSync(path.join(root, 'folder', 'child.txt'), 'child');
      const result = await (await api('/files/bulk', json({ location, operation: 'copy', paths: ['folder', 'missing'], destinationLocation: destination }))).json();
      assert.equal(result.results[0].ok, true); assert.equal(result.results[1].ok, false);
      assert.equal(fs.readFileSync(path.join(otherRoot, 'folder', 'child.txt'), 'utf8'), 'child');
      const collision = await (await api('/files/bulk', json({ location, operation: 'move', paths: ['folder'], destinationLocation: destination }))).json();
      assert.equal(collision.results[0].ok, false); assert.ok(fs.existsSync(path.join(root, 'folder')));
      const move = await (await api('/files/bulk', json({ location, operation: 'move', paths: ['large.bin'], destinationLocation: destination }))).json();
      assert.equal(move.results[0].ok, true); assert.equal(fs.existsSync(path.join(root, 'large.bin')), false);
      const nested = await (await api('/files/bulk', json({ location, operation: 'copy', paths: ['folder'], destinationPath: 'folder' }))).json();
      assert.equal(nested.results[0].ok, false);
    });
    await t.test('DAV collection creation, COPY/MOVE, overwrite protection, and Trash deletion', async () => {
      assert.equal((await dav('dav-folder', { method: 'MKCOL' })).status, 201);
      assert.equal((await dav('hello.txt', { method: 'COPY', headers: { Destination: `${base}/webdav/${location}/dav-folder/copied.txt`, Overwrite: 'F' } })).status, 201);
      assert.equal((await dav('hello.txt', { method: 'COPY', headers: { Destination: `${base}/webdav/${location}/dav-folder/copied.txt`, Overwrite: 'F' } })).status, 412);
      assert.equal((await dav('dav-folder/copied.txt', { method: 'MOVE', headers: { Destination: `${base}/webdav/${location}/moved.txt` } })).status, 201);
      assert.equal((await dav('moved.txt', { method: 'DELETE' })).status, 204);
      const trash = await (await api(`/files/trash?location=${location}`)).json();
      assert.equal(trash.some((item) => item.name === 'moved.txt'), true);
      assert.equal((await dav('hello.txt', { method: 'COPY', headers: { Destination: 'https://evil.example/stolen' } })).status, 403);
    });
    await t.test('multipart overwrites save a version and never write directly to live files', async () => {
      const data = new FormData(); data.append('files', new Blob(['multipart']), 'hello.txt');
      assert.equal((await api(`/files/upload?location=${location}&overwrite=1`, { method: 'POST', body: data })).status, 201);
      assert.equal(fs.readFileSync(file, 'utf8'), 'multipart');
      assert.ok(store.listVersions({ path: root }, file).length >= 4);
    });
    await t.test('interrupted DAV upload retains original data and releases writer lock', async () => {
      await new Promise((resolve) => {
        const req = http.request(`${base}/webdav/${location}/hello.txt`, { method: 'PUT', headers: { Authorization: auth, 'Content-Length': '100' } });
        req.on('error', () => resolve());
        req.write('partial');
        setTimeout(() => { req.destroy(); resolve(); }, 80);
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(fs.readFileSync(file, 'utf8'), 'multipart');
      assert.equal((await dav('after-abort.txt', { method: 'PUT', body: 'ok' })).status, 201);
    });
    await t.test('symlinks cannot expose or copy data outside a location', async (st) => {
      const link = path.join(root, 'escape');
      try { fs.symlinkSync(otherRoot, link, process.platform === 'win32' ? 'junction' : 'dir'); }
      catch (err) { if (['EPERM', 'EACCES'].includes(err.code)) return st.skip('Host does not permit symlinks'); throw err; }
      assert.throws(() => resolveSafePath(root, 'escape/folder/child.txt'));
      const result = await (await api('/files/bulk', json({ location, operation: 'copy', paths: ['escape'], destinationLocation: destination }))).json();
      assert.equal(result.results[0].ok, false);
    });
    await t.test('full file backup restores live files and protected version history', async () => {
      const backup = require('../src/backup');
      const backupDir = path.join(fixture, 'backups');
      fs.mkdirSync(backupDir);
      backup.saveSchedule({ dir: backupDir });
      const before = store.listVersions({ path: root }, file);
      assert.ok(before.length);
      const saved = await backup.writeBackupFile(['files']);
      fs.writeFileSync(file, 'after backup');
      const versionFile = store.versionPath({ path: root }, file, before[0].id);
      const oldVersion = fs.readFileSync(versionFile, 'utf8');
      fs.unlinkSync(versionFile);
      await backup.restoreBackup(backupDir, saved.name, ['files']);
      assert.equal(fs.readFileSync(file, 'utf8'), 'multipart');
      assert.equal(fs.readFileSync(versionFile, 'utf8'), oldVersion);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    // Only remove this test's verified, freshly allocated temporary root.
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('syncmark-file-test-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
