const express = require('express');
const multer = require('multer');
const { statements } = require('../db');
const { encrypt, decrypt } = require('../utils/vault');
const { toCsv, parseCsv } = require('../utils/passwordsCsv');

const router = express.Router();

const DEFAULT_SORT = 'name-asc';
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function fieldsFromBody(userId, body, existing) {
  const siteName = (body.siteName ?? existing?.site_name ?? '').trim();
  const passwordPlain = body.password !== undefined ? String(body.password) : null;

  return {
    userId,
    siteName,
    url: (body.url ?? existing?.url ?? '').trim(),
    username: (body.username ?? existing?.username ?? '').trim(),
    passwordEnc: passwordPlain !== null ? encrypt(passwordPlain) : existing?.password_enc || encrypt(''),
    notes: (body.notes ?? existing?.notes ?? '').trim(),
    favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : (existing?.favorite ?? 0),
  };
}

router.get('/passwords', (req, res) => {
  const q = (req.query.q || '').trim();
  const qLike = q ? `%${q}%` : '';
  const favorite = req.query.favorite === '1' ? 1 : 0;
  const sort = statements.listPasswordsBySort[req.query.sort] ? req.query.sort : DEFAULT_SORT;
  res.json(statements.listPasswordsBySort[sort].all({ userId: req.user.id, q, qLike, favorite }));
});

router.get('/passwords/export', (req, res) => {
  const all = statements.listPasswordsBySort[DEFAULT_SORT]
    .all({ userId: req.user.id, q: '', qLike: '', favorite: 0 })
    .map((row) => statements.getPassword.get(row.id, req.user.id));
  const decrypted = all.map((row) => ({ ...row, password: decrypt(row.password_enc) }));

  res.setHeader('Content-Disposition', 'attachment; filename="syncmark-passwords.csv"');
  res.type('text/csv').send(toCsv(decrypted));
});

router.post('/passwords/import', importUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });

  const parsed = parseCsv(req.file.buffer.toString('utf8'));
  if (parsed.length === 0) return res.status(422).json({ error: 'No password entries found in the uploaded file' });

  let imported = 0;
  for (const entry of parsed) {
    statements.insertPassword.run({
      userId: req.user.id,
      siteName: entry.siteName,
      url: entry.url || '',
      username: entry.username || '',
      passwordEnc: encrypt(entry.password || ''),
      notes: entry.notes || '',
      favorite: entry.favorite ? 1 : 0,
    });
    imported += 1;
  }

  res.json({ imported });
});

router.get('/passwords/:id', (req, res) => {
  const row = statements.getPassword.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Password not found' });
  res.json({ ...row, password: decrypt(row.password_enc), password_enc: undefined });
});

router.get('/passwords/:id/reveal', (req, res) => {
  const row = statements.getPassword.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Password not found' });
  res.json({ password: decrypt(row.password_enc) });
});

router.post('/passwords', (req, res) => {
  const fields = fieldsFromBody(req.user.id, req.body, null);
  if (!fields.siteName) return res.status(400).json({ error: 'Site name is required' });

  const result = statements.insertPassword.run(fields);
  const row = statements.getPassword.get(result.lastInsertRowid, req.user.id);
  res.status(201).json({ ...row, password: decrypt(row.password_enc), password_enc: undefined });
});

router.put('/passwords/:id', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  const fields = fieldsFromBody(req.user.id, req.body, existing);
  if (!fields.siteName) return res.status(400).json({ error: 'Site name is required' });

  statements.updatePassword.run({ ...fields, id: existing.id });
  const row = statements.getPassword.get(existing.id, req.user.id);
  res.json({ ...row, password: decrypt(row.password_enc), password_enc: undefined });
});

router.put('/passwords/:id/favorite', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  statements.setPasswordFavorite.run({ id: existing.id, userId: req.user.id, favorite: req.body.favorite ? 1 : 0 });
  const row = statements.getPassword.get(existing.id, req.user.id);
  res.json({ ...row, password_enc: undefined });
});

router.delete('/passwords/all', (req, res) => {
  statements.deleteAllPasswords.run(req.user.id);
  res.status(204).end();
});

router.delete('/passwords/:id', (req, res) => {
  const existing = statements.getPassword.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Password not found' });

  statements.deletePassword.run(existing.id, req.user.id);
  res.status(204).end();
});

module.exports = router;
