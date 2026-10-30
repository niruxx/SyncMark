const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const express = require('express');
const nodeCrypto = require('crypto');
Object.defineProperty(globalThis, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'syncmark-password-test-'));
process.env.SYNCMARK_DATA_DIR = path.join(fixture, 'data');
const { db, statements, setFeatureFlags, wipeUserData } = require('../src/db');
const { hashPassword } = require('../src/utils/password');
require('../public/vaultCrypto'); require('../public/vaultShareCrypto'); require('../public/vaultClient');
const extras = require('../src/routes/passwordExtras');

test('encrypted password organization, sharing, checks, and device access', async (t) => {
  const accounts = {};
  for (const name of ['alice', 'bob', 'carol']) {
    accounts[name] = Number(statements.insertUser.run({ username: name, passwordHash: hashPassword('account-password'), role: 'user' }).lastInsertRowid);
    db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run(name + '-token', accounts[name], '2099-01-01T00:00:00Z');
  }
  setFeatureFlags({ passwords: true });
  const app = express(); app.use(express.json()); app.use(extras.clientRouter);
  for (const router of [extras.router, require('../src/routes/passwords'), require('../src/routes/vault')]) app.use('/api', require('../src/middleware/auth').requireAuth, require('../src/middleware/featureGate').gateRouter('passwords', router));
  app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 400).json({ error: err.message }); });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, options = {}, user = 'alice') => fetch(base + '/api' + url, { ...options, headers: { Cookie: `session=${user}-token`, ...options.headers } });
  const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const client = (token, suffix, options = {}) => fetch(base + '/api/password-client/' + suffix, { ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers } });
  const deks = {}, identities = {}, privateKeys = {};
  let entry, shareId, device;
  async function setup(name) {
    deks[name] = await VaultCrypto.generateDek();
    const { key, saltB64 } = await VaultCrypto.deriveKey('vault-passphrase-' + name);
    const wrap = await VaultCrypto.wrapDek(deks[name], key);
    assert.equal((await api('/vault/keys', json({ vaultSalt: saltB64, wrappedDekPassphrase: wrap.wrappedB64, wrappedDekPassphraseIv: wrap.ivB64, recoverySalt: saltB64, wrappedDekRecovery: wrap.wrappedB64, wrappedDekRecoveryIv: wrap.ivB64 }, 'PUT'), name)).status, 201);
  }
  async function makeShare(expiresAt = new Date(Date.now() + 86400000).toISOString()) {
    const id = nodeCrypto.randomUUID();
    const context = { id, senderId: accounts.alice, recipientId: accounts.bob, recipientFingerprint: identities.bob.fingerprint };
    const sealed = await VaultSharing.seal({ siteName: 'Shared secret', url: 'https://example.com/login', username: 'alice', password: 'correct horse violet moon', notes: 'private shared note', kind: 'login' }, identities.bob, context);
    const response = await api('/password-shares', json({ ...context, ...sealed, passwordId: entry.id, expiresAt }));
    assert.equal(response.status, 201); return id;
  }
  try {
    await setup('alice'); await setup('bob');
    await t.test('folders/tags persist without exposing secrets and filter by exact subtree/tag', async () => {
      const secret = await VaultCrypto.encryptField('correct horse violet moon', deks.alice);
      const notes = await VaultCrypto.encryptField('private note', deks.alice);
      const response = await api('/passwords', json({ siteName: 'Example', url: 'https://example.com/login', username: 'alice', passwordEnc: secret, notesEnc: notes, folder: ' Work / Servers ', tags: [' Work ', 'work', 'infra'] }));
      assert.equal(response.status, 201); entry = await response.json(); assert.equal(entry.folder, 'Work/Servers'); assert.deepEqual(JSON.parse(entry.tags), ['work', 'infra']);
      const filtered = await (await api('/passwords?folder=Work&tag=work')).json(); assert.equal(filtered.length, 1); assert.equal('password_enc' in filtered[0], false);
      assert.equal((await (await api('/passwords?folder=Wor')).json()).length, 0);
      assert.equal((await (await api('/passwords?q=infra')).json()).length, 1);
      const stored = statements.getPassword.get(entry.id, accounts.alice); assert.notEqual(stored.password_enc, 'correct horse violet moon'); assert.notEqual(stored.notes, 'private note');
      assert.equal(await VaultCrypto.decryptFieldStrict(stored.password_enc, deks.alice), 'correct horse violet moon');
      assert.equal((await api('/passwords', json({ siteName: 'Bad', passwordEnc: 'plaintext' }))).status, 400);
      assert.equal((await api('/passwords', json({ siteName: 'Bad tags', passwordEnc: secret, tags: [123] }))).status, 400);
    });
    await t.test('folder rename/delete scope stays within the owner and never deletes entries', async () => {
      assert.equal((await api('/password-folders', json({ oldName: 'Work', newName: 'Office' }, 'PUT'))).status, 200);
      assert.equal((await (await api(`/passwords/${entry.id}`)).json()).folder, 'Office/Servers');
      assert.equal((await api('/password-folders', json({ oldName: 'Office', newName: 'Office/Nested' }, 'PUT'))).status, 400);
      assert.equal((await api('/password-folders', json({ name: 'Office' }, 'DELETE'), 'bob')).status, 204);
      assert.equal((await (await api(`/passwords/${entry.id}`)).json()).folder, 'Office/Servers');
      await api('/password-folders', json({ name: 'Office' }, 'DELETE'));
      assert.equal((await (await api(`/passwords/${entry.id}`)).json()).folder, '');
      assert.equal((await api('/password-folders', json({ name: '../escape' }))).status, 400);
    });
    await t.test('import/export preserves organization and rejects malformed imports atomically', async () => {
      const rows = await (await api('/passwords/export-data')).json(); assert.equal(rows.length, 1);
      assert.equal((await api('/passwords/import', json({ entries: [{ siteName: 'Import', passwordEnc: rows[0].password_enc, notesEnc: rows[0].notes, folder: 'Import/Folder', tags: ['restored'] }] }))).status, 200);
      const before = statements.countPasswords.get(accounts.alice).count;
      assert.equal((await api('/passwords/import', json({ entries: [{ siteName: 'Valid', folder: 'Valid', tags: [] }, { siteName: 'Invalid', tags: [123] }] }))).status, 400);
      assert.equal(statements.countPasswords.get(accounts.alice).count, before);
    });
    await t.test('local checks flag weak/common/contextual passwords without composition rules', () => {
      assert.ok(VaultClient.warnings('password123').some((v) => v.includes('Common')));
      assert.ok(VaultClient.warnings('aaaa').some((v) => v.includes('Short')));
      assert.ok(VaultClient.warnings('1234567890123456').some((v) => v.includes('predictable')));
      assert.ok(VaultClient.warnings('Alice-long-phrase', { username: 'alice@example.com' }).some((v) => v.includes('username')));
      assert.ok(VaultClient.warnings('lengthy uncommon violet river', { url: 'http://example.com' }).some((v) => v.includes('HTTP')));
      assert.deepEqual(VaultClient.warnings('violet glacier orbit lantern meadow'), []);
    });
    await t.test('local vault audit detects reuse, skips notes, flags damaged ciphertext, and cancels on lock', async () => {
      const ciphertext = await VaultCrypto.encryptField('violet glacier orbit lantern meadow', deks.alice);
      const rows = [{ id: 1, kind: 'login', password_enc: ciphertext }, { id: 2, kind: 'login', password_enc: ciphertext }, { id: 3, kind: 'note', password_enc: ciphertext }, { id: 4, kind: 'login', password_enc: 'broken' }];
      const result = await VaultClient.audit(rows, deks.alice); assert.equal(result.length, 3);
      assert.ok(result[0].warnings.some((v) => v.includes('Reused across 2'))); assert.ok(result[1].warnings.some((v) => v.includes('Reused across 2'))); assert.ok(result[2].warnings.some((v) => v.includes('could not be read')));
      assert.doesNotMatch(JSON.stringify(result), /violet glacier/);
      let checks = 0; await assert.rejects(VaultClient.audit(rows, deks.alice, () => ++checks < 2));
    });
    await t.test('sharing identities are vault-encrypted, fingerprinted, and cannot be overwritten', async () => {
      for (const name of ['alice', 'bob']) {
        const identity = await VaultSharing.createIdentity(deks[name]);
        const response = await api('/password-sharing/me', json(identity), name); assert.equal(response.status, 201);
        identities[name] = await response.json(); privateKeys[name] = await VaultSharing.unlockIdentity(identities[name], deks[name]);
        assert.equal(identities[name].fingerprint, await VaultSharing.fingerprint(identities[name].publicKey));
        assert.notEqual(identities[name].privateEnc, await VaultCrypto.decryptFieldStrict(identities[name].privateEnc, deks[name]));
        assert.equal((await api('/password-sharing/me', json(identity), name)).status, 409);
      }
      const directory = await (await api('/password-sharing/directory?username=bob')).json(); assert.equal(directory.fingerprint, identities.bob.fingerprint); assert.equal('privateEnc' in directory, false);
      assert.equal((await api('/password-sharing/directory?username=carol')).status, 404);
      await assert.rejects(VaultSharing.unlockIdentity(identities.bob, deks.alice));
    });
    await t.test('hybrid encrypted shares bind recipient and sender context and reject tampering', async () => {
      shareId = await makeShare();
      const incoming = await (await api('/password-shares', {}, 'bob')).json(); assert.equal(incoming.length, 1);
      const plain = await VaultSharing.open(incoming[0], privateKeys.bob); assert.equal(plain.password, 'correct horse violet moon');
      assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM password_shares WHERE id=?').get(shareId)), /correct horse|private shared note/);
      await assert.rejects(VaultSharing.open(incoming[0], privateKeys.alice));
      await assert.rejects(VaultSharing.open({ ...incoming[0], sender_id: accounts.carol }, privateKeys.bob));
      const [iv, encrypted] = incoming[0].payload.split(':'); const bytes = VaultCrypto.fromB64(encrypted); bytes[0] ^= 1;
      await assert.rejects(VaultSharing.open({ ...incoming[0], payload: iv + ':' + VaultCrypto.toB64(bytes) }, privateKeys.bob));
      const outgoing = await (await api('/password-shares')).json(); assert.equal(outgoing[0].outgoing, true); assert.equal('payload' in outgoing[0], false);
      assert.deepEqual(await (await api('/password-shares', {}, 'carol')).json(), []);
      assert.equal((await api(`/password-shares/${shareId}`, { method: 'DELETE' }, 'carol')).status, 404);
    });
    await t.test('source edits revoke shares; expiration, disabled recipients, and removals block access', async () => {
      await api(`/passwords/${entry.id}`, json({ passwordEnc: await VaultCrypto.encryptField('replacement secret', deks.alice) }, 'PUT'));
      assert.deepEqual(await (await api('/password-shares', {}, 'bob')).json(), []);
      shareId = await makeShare(); db.prepare('UPDATE password_shares SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', shareId);
      assert.deepEqual(await (await api('/password-shares', {}, 'bob')).json(), []);
      shareId = await makeShare();
      db.prepare('UPDATE users SET enabled=0 WHERE id=?').run(accounts.bob);
      assert.deepEqual(await (await api('/password-shares')).json(), []);
      db.prepare('UPDATE users SET enabled=1 WHERE id=?').run(accounts.bob);
      assert.equal((await api(`/password-shares/${shareId}`, { method: 'DELETE' }, 'bob')).status, 204);
      assert.equal((await api(`/password-shares/${shareId}`, { method: 'DELETE' })).status, 404);
    });
    await t.test('device credentials require reauthentication, are hash-only, and grant only own read-only ciphertext', async () => {
      assert.equal((await api('/password-clients', json({ name: 'Browser', days: 30, password: 'wrong' }))).status, 403);
      const response = await api('/password-clients', json({ name: 'Browser', days: 30, password: 'account-password' })); assert.equal(response.status, 201); device = await response.json();
      const stored = db.prepare('SELECT * FROM password_clients WHERE id=?').get(device.id); assert.notEqual(stored.token_hash, device.token); assert.equal(stored.token_hash.length, 64);
      const items = await client(device.token, 'items'); assert.equal(items.status, 200); assert.equal(items.headers.get('cache-control'), 'no-store');
      const rows = await items.json(); assert.ok(rows.every((row) => row.user_id === accounts.alice));
      const keys = await (await client(device.token, 'keys')).json(); assert.equal('wrappedDekRecovery' in keys, false);
      const key = await VaultClient.unlock(keys, 'vault-passphrase-alice');
      assert.equal(await VaultCrypto.decryptFieldStrict(rows.find((r) => r.id === entry.id).password_enc, key), 'replacement secret');
      assert.equal((await client(device.token, 'items', json({ siteName: 'forbidden' }))).status, 405);
      assert.equal((await fetch(base + '/api/passwords', { headers: { Authorization: 'Bearer ' + device.token } })).status, 401);
      assert.equal((await fetch(base + '/api/password-client/items', { headers: { Cookie: 'session=alice-token' } })).status, 401);
      assert.equal((await api(`/password-clients/${device.id}`, { method: 'DELETE' }, 'bob')).status, 404);
    });
    await t.test('device access observes expiry, account disablement, feature disablement, and revocation', async () => {
      db.prepare('UPDATE users SET enabled=0 WHERE id=?').run(accounts.alice); assert.equal((await client(device.token, 'items')).status, 401);
      db.prepare('UPDATE users SET enabled=1 WHERE id=?').run(accounts.alice);
      setFeatureFlags({ passwords: false }); assert.equal((await client(device.token, 'items')).status, 403); assert.equal((await api('/password-shares')).status, 404); setFeatureFlags({ passwords: true });
      db.prepare('UPDATE password_clients SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', device.id); assert.equal((await client(device.token, 'items')).status, 401);
      await api(`/password-clients/${device.id}`, { method: 'DELETE' }); assert.equal((await client(device.token, 'keys')).status, 401);
    });
    await t.test('login password changes revoke device credentials without changing vault ciphertext', async () => {
      const issued = await (await api('/password-clients', json({ name: 'Old login', days: 1, password: 'account-password' }))).json();
      const before = statements.getPassword.get(entry.id, accounts.alice).password_enc;
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('new-account-password'), accounts.alice);
      assert.equal((await client(issued.token, 'items')).status, 401);
      assert.equal(statements.getPassword.get(entry.id, accounts.alice).password_enc, before);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('account-password'), accounts.alice);
    });
    await t.test('origin policy rejects insecure sites, lookalike domains, subdomains, ports, and credentialed URLs', () => {
      const row = { kind: 'login', url: 'https://example.com/login' };
      assert.equal(VaultClient.matches(row, 'https://example.com/other'), true);
      for (const url of ['https://evil.example.com/', 'https://example.com.evil.test/', 'http://example.com/', 'https://example.com:444/', 'https://example.com@evil.test/', 'javascript:alert(1)']) assert.equal(VaultClient.matches(row, url), false, url);
      assert.throws(() => VaultClient.secureOrigin('http://remote.example/'));
      assert.equal(VaultClient.secureOrigin('http://localhost:3000/'), 'http://localhost:3000');
    });
    await t.test('autofill checks the live top-frame origin, form destination, visibility, and never submits', () => {
      class Input {
        constructor(type, name, form) { this.type = type; this.name = name; this.form = form; this.autocomplete = ''; this.disabled = false; this.readOnly = false; this.events = []; }
        getClientRects() { return [{}]; } dispatchEvent(event) { this.events.push(event.type); }
      }
      Object.defineProperty(Input.prototype, 'value', { set(value) { this.saved = value; } });
      const form = { action: 'https://example.com/login', querySelectorAll() { return [user, secret]; }, submit() { throw new Error('Must not submit'); } };
      const user = new Input('email', 'email', form), secret = new Input('password', 'password', form);
      const window = {}; window.self = window; window.top = window;
      const context = { window, location: { origin: 'https://example.com', href: 'https://example.com/login' }, URL, HTMLInputElement: Input, Event: class { constructor(type) { this.type = type; } }, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), document: { querySelectorAll: () => [secret] } };
      const fill = (expected = 'https://example.com') => vm.runInNewContext(`(${VaultClient.fillDocument.toString()})(${JSON.stringify(expected)},'alice','secret')`, context);
      assert.equal(fill().filled, true); assert.equal(secret.saved, 'secret'); assert.equal(user.saved, 'alice'); assert.deepEqual(secret.events, ['input', 'change']);
      assert.throws(() => fill('https://other.example'));
      form.action = 'https://evil.example/'; assert.throws(() => fill()); form.action = 'https://example.com/login';
      context.window.top = {}; assert.throws(() => fill()); context.window.top = window;
      secret.readOnly = true; assert.throws(() => fill()); secret.readOnly = false;
      context.document.querySelectorAll = () => [secret, new Input('password', 'other', form)]; assert.throws(() => fill());
    });
    await t.test('vault backups round-trip wrapped keys, encrypted attachments, identities, and shares while revoking clients', async () => {
      shareId = await makeShare();
      const encrypted = await VaultCrypto.encryptBytes(new TextEncoder().encode('private attachment'), deks.alice);
      statements.insertPasswordAttachment.run({ passwordId: entry.id, userId: accounts.alice, filename: 'test.txt', mime: 'text/plain', size: encrypted.ciphertext.length, iv: encrypted.ivB64, ciphertext: Buffer.from(encrypted.ciphertext) });
      const issued = await (await api('/password-clients', json({ name: 'Temporary', days: 1, password: 'account-password' }))).json();
      const backup = require('../src/backup'), dir = path.join(fixture, 'backups'); fs.mkdirSync(dir); backup.saveSchedule({ dir });
      const saved = await backup.writeBackupFile(['passwords']);
      db.prepare('DELETE FROM password_sharing_keys').run(); db.prepare('DELETE FROM vault_keys').run(); db.prepare('DELETE FROM password_shares').run(); db.prepare('DELETE FROM password_attachments').run();
      await backup.restoreBackup(dir, saved.name, ['passwords']);
      assert.equal((await client(issued.token, 'keys')).status, 401);
      const restored = statements.getVaultKeys.get(accounts.alice); const key = await VaultClient.unlock({ vaultSalt: restored.vault_salt, wrappedDekPassphrase: restored.wrapped_dek_passphrase, wrappedDekPassphraseIv: restored.wrapped_dek_passphrase_iv }, 'vault-passphrase-alice');
      const attachment = db.prepare('SELECT * FROM password_attachments WHERE user_id=?').get(accounts.alice);
      assert.equal(new TextDecoder().decode(await VaultCrypto.decryptBytes(attachment.ciphertext, attachment.iv, key)), 'private attachment');
      const inbox = await (await api('/password-shares', {}, 'bob')).json(); assert.equal((await VaultSharing.open(inbox.find((s) => s.id === shareId), privateKeys.bob)).password, 'correct horse violet moon');
    });
    await t.test('account deletion removes sharing identities, grants, organization, and client credentials', () => {
      wipeUserData(accounts.bob);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM password_shares WHERE recipient_id=? OR sender_id=?').get(accounts.bob, accounts.bob).n, 0);
      assert.equal(db.prepare('SELECT * FROM password_sharing_keys WHERE user_id=?').get(accounts.bob), undefined);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve)); db.close();
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir())); assert.ok(path.basename(fixture).startsWith('syncmark-password-test-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
