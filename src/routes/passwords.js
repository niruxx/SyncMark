// Zero-knowledge: every password_enc/notes value here is ciphertext the
// client already produced with its own DEK (see public/vaultCrypto.js) — the
// server never encrypts, decrypts, or sees a plaintext secret on any of
// these routes. CSV/JSON export and CSV import happen client-side now too
// (see /passwords/export-data below); the one remaining exception is
// src/routes/vault.js's one-time legacy-data bridge for pre-existing accounts.
const express = require('express');
const multer = require('multer');
const { db, statements } = require('../db');
const metadata = require('../utils/passwordMetadata');

const router = express.Router();

const DEFAULT_SORT = 'name-asc';
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES } });

function fieldsFromBody(userId, body, existing) {
  for (const [key, max] of [['siteName', 500], ['url', 4096], ['username', 500], ['passwordEnc', 100000], ['notesEnc', 500000]]) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > max)) metadata.fail(400, `Invalid ${key}`);
  }
  for (const key of ['passwordEnc', 'notesEnc']) if (body[key] && !metadata.encryptedField(body[key], key === 'notesEnc' ? 500000 : 100000)) metadata.fail(400, `${key} must contain encrypted vault data`);
  const siteName = (body.siteName ?? existing?.site_name ?? '').trim();
  const kind = body.kind !== undefined ? (body.kind === 'note' ? 'note' : 'login') : (existing?.kind || 'login');

  return {
    userId,
    siteName,
    url: (body.url ?? existing?.url ?? '').trim(),
    username: (body.username ?? existing?.username ?? '').trim(),
    passwordEnc: body.passwordEnc !== undefined ? String(body.passwordEnc) : (existing?.password_enc || ''),
    notes: body.notesEnc !== undefined ? String(body.notesEnc) : (existing?.notes || ''),
    favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : (existing?.favorite ?? 0),
    kind,
    matchRule: body.matchRule !== undefined ? (String(body.matchRule).trim() || null) : (existing?.match_rule ?? null),
  };
}

function stripSecret(row) {
  const { password_enc, ...rest } = row;
  return rest;
}

router.get('/passwords', (req, res) => {
  const q = (req.query.q || '').trim();
  const qLike = q ? `%${q}%` : '';
  const favorite = req.query.favorite === '1' ? 1 : 0;
  const sort = statements.listPasswordsBySort[req.query.sort] ? req.query.sort : DEFAULT_SORT;
  const folder = typeof req.query.folder === 'string' ? metadata.folder(req.query.folder) : '';
  const tag = typeof req.query.tag === 'string' ? req.query.tag.toLowerCase() : '';
  res.json(statements.listPasswordsBySort[sort].all({ userId: req.user.id, q, qLike, favorite }).filter((row) => (!folder || row.folder === folder || row.folder.startsWith(folder + '/')) && (!tag || metadata.tags(row.tags).includes(tag))));
});

// Bulk ciphertext dump for client-side CSV export and encrypted JSON backup —
// the client decrypts (CSV) or just re-wraps the DEK around these as-is
// (encrypted JSON), never the server. Nothing here is filtered/paginated
// since a vault is personal-scale, same assumption the rest of the app makes.
router.get('/passwords/export-data', (req, res) => {
  res.json(statements.listAllPasswordsRaw.all(req.user.id));
});

// Client has already parsed the CSV and encrypted every entry's password/
// notes under its own DEK; this just inserts the rows.
router.post('/passwords/import', (req, res) => {
  const entries = Array.isArray(req.body.entries) ? req.body.entries : null;
  if (!entries || entries.length === 0) return res.status(422).json({ error: 'No password entries found in the uploaded file' });

  if (entries.length > 10000) return res.status(400).json({ error: 'Import at most 10,000 entries at a time' });
  db.transaction(() => {
    for (const entry of entries) {
      const fields = fieldsFromBody(req.user.id, { ...entry, siteName: entry.siteName || 'Untitled' });
      const result = statements.insertPassword.run(fields);
      metadata.save(req.user.id, result.lastInsertRowid, entry);
    }
  })();
  res.json({ imported: entries.length });
});

router.get('/passwords/:id', (req, res) => {
  const row = statements.getPassword.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Password not found' });
  res.json(row);
});

// Kept as a lighter-weight fetch than GET /:id for the list view's lazy
// per-row reveal — returns ciphertext only, the client decrypts it.
router.get('/passwords/:id/reveal', (req, res) => {
  const row = statements.getPassword.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Password not found' });
  res.json({ passwordEnc: row.password_enc });
});

router.post('/passwords', (req, res) => {
  const fields = fieldsFromBody(req.user.id, req.body, null);
  if (!fields.siteName) return res.status(400).json({ error: 'Site name is required' });

  const result = db.transaction(() => {
    const inserted = statements.insertPassword.run(fields);
    metadata.save(req.user.id, inserted.lastInsertRowid, req.body);
    return inserted;
  })();
  const row = statements.getPassword.get(result.lastInsertRowid, req.user.id);
  res.status(201).json(row);
});

router.put('/passwords/:id', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  const fields = fieldsFromBody(req.user.id, req.body, existing);
  if (!fields.siteName) return res.status(400).json({ error: 'Site name is required' });

  db.transaction(() => {
    statements.updatePassword.run({ ...fields, id: existing.id });
    metadata.save(req.user.id, existing.id, req.body, existing);
  })();
  const row = statements.getPassword.get(existing.id, req.user.id);
  res.json(row);
});

router.put('/passwords/:id/favorite', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  statements.setPasswordFavorite.run({ id: existing.id, userId: req.user.id, favorite: req.body.favorite ? 1 : 0 });
  res.json(stripSecret(statements.getPassword.get(existing.id, req.user.id)));
});

router.delete('/passwords/all', (req, res) => {
  statements.deleteAllPasswordAttachments.run(req.user.id);
  statements.deleteAllPasswords.run(req.user.id);
  res.status(204).end();
});

router.delete('/passwords/:id', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  statements.deletePasswordAttachmentsForPassword.run(existing.id, req.user.id);
  statements.deletePassword.run(existing.id, req.user.id);
  res.status(204).end();
});

// ---- attachments: ciphertext blobs the client already encrypted with its
// DEK (SSH keys, tax documents, ID scans, ...) — server just stores/streams
// the opaque bytes plus the IV needed to decrypt them, same DB-BLOB pattern
// contacts.photo/users.avatar already use for on-demand binary fetches. ----

router.get('/passwords/:id/attachments', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });
  res.json(statements.listPasswordAttachments.all(existing.id, req.user.id));
});

router.post('/passwords/:id/attachments', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  attachmentUpload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Attachment must be 10 MB or smaller' : err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });
    if (!req.body.iv || !req.body.filename) return res.status(400).json({ error: 'Missing attachment metadata' });

    const result = statements.insertPasswordAttachment.run({
      passwordId: existing.id,
      userId: req.user.id,
      filename: String(req.body.filename).trim() || 'attachment',
      mime: req.body.mime || 'application/octet-stream',
      size: req.file.size,
      iv: req.body.iv,
      ciphertext: req.file.buffer,
    });
    res.status(201).json({ id: result.lastInsertRowid });
  });
});

router.get('/passwords/:id/attachments/:attachmentId', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  const attachment = statements.getPasswordAttachment.get(req.params.attachmentId, existing.id, req.user.id);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  // The bytes are still ciphertext at this point — served as opaque binary
  // with the IV/filename/mime the client needs to decrypt them attached as
  // headers rather than guessed from the (encrypted) content itself.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Attachment-Iv', attachment.iv);
  res.setHeader('X-Attachment-Filename', encodeURIComponent(attachment.filename));
  res.setHeader('X-Attachment-Mime', attachment.mime);
  res.setHeader('Access-Control-Expose-Headers', 'X-Attachment-Iv, X-Attachment-Filename, X-Attachment-Mime');
  res.send(attachment.ciphertext);
});

router.delete('/passwords/:id/attachments/:attachmentId', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  const attachment = statements.getPasswordAttachment.get(req.params.attachmentId, existing.id, req.user.id);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  statements.deletePasswordAttachment.run(attachment.id, existing.id, req.user.id);
  res.status(204).end();
});

module.exports = router;
