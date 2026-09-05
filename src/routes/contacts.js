const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const {
  statements,
  createContact,
  updateContactFields,
  setContactFavoriteSeq,
  setContactPhotoSeq,
  clearContactPhotoSeq,
  deleteContactById,
  insertManyContacts,
  bulkContactAction,
} = require('../db');
const { buildVCard, parseVCard, splitVCards } = require('../utils/vcard');
const { toCsv, parseCsv } = require('../utils/contactsCsv');

const router = express.Router();

const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const DEFAULT_SORT = 'name-asc';
const BULK_ACTIONS = ['delete', 'favorite', 'unfavorite'];

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!PHOTO_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Picture must be a PNG, JPEG, GIF, or WebP image'));
    }
    cb(null, true);
  },
});
const contactsFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({ type: String(e?.type || 'other').slice(0, 20), value: String(e?.value || '').trim() }))
    .filter((e) => e.value);
}

function contactFieldsFromBody(body, existing) {
  const firstName = (body.firstName ?? existing?.first_name ?? '').trim();
  const lastName = (body.lastName ?? existing?.last_name ?? '').trim();
  const fullNameInput = body.fullName !== undefined ? String(body.fullName).trim() : '';
  const fullName = fullNameInput || [firstName, lastName].filter(Boolean).join(' ');

  return {
    fullName,
    firstName,
    lastName,
    organization: (body.organization ?? existing?.organization ?? '').trim(),
    phones: JSON.stringify(body.phones !== undefined ? normalizeEntries(body.phones) : normalizeEntries(JSON.parse(existing?.phones || '[]'))),
    emails: JSON.stringify(body.emails !== undefined ? normalizeEntries(body.emails) : normalizeEntries(JSON.parse(existing?.emails || '[]'))),
    notes: (body.notes ?? existing?.notes ?? '').trim(),
    favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : (existing?.favorite ?? 0),
  };
}

router.get('/contacts', (req, res) => {
  const q = (req.query.q || '').trim();
  const favorite = req.query.favorite === '1' ? 1 : 0;
  const sort = statements.listContactsBySort[req.query.sort] ? req.query.sort : DEFAULT_SORT;
  res.json(statements.listContactsBySort[sort].all({ q, qLike: `%${q}%`, favorite }));
});

router.get('/contacts/export', (req, res) => {
  const ids = req.query.ids ? String(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const rows = ids
    ? ids.map((id) => statements.getContactFullById.get(id)).filter(Boolean)
    : statements.listContactsMeta.all().map((m) => statements.getContactFullByUid.get(m.uid));

  if (req.query.format === 'csv') {
    res.setHeader('Content-Disposition', 'attachment; filename="syncmark-contacts.csv"');
    return res.type('text/csv').send(toCsv(rows));
  }

  const vcf = rows.map((contact) => buildVCard(contact)).join('');
  res.setHeader('Content-Disposition', 'attachment; filename="syncmark-contacts.vcf"');
  res.type('text/vcard').send(vcf);
});

// Format is sniffed from the filename first (.csv vs .vcf), falling back to
// content sniffing (a vCard file always starts with "BEGIN:VCARD") since
// browsers don't reliably set a useful multipart Content-Type for either.
function parsedContactsFromUpload(file) {
  const text = file.buffer.toString('utf8');
  const name = (file.originalname || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || (!name.endsWith('.vcf') && !/^\s*BEGIN:VCARD/i.test(text));

  if (isCsv) return parseCsv(text);

  return splitVCards(text)
    .map((block) => parseVCard(block))
    .filter((parsed) => parsed.fullName || parsed.firstName || parsed.lastName);
}

router.post('/contacts/import', contactsFileUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });

  const parsedContacts = parsedContactsFromUpload(req.file);
  const fieldsList = [];
  for (const parsed of parsedContacts) {
    const fullName = parsed.fullName || [parsed.firstName, parsed.lastName].filter(Boolean).join(' ');
    if (!fullName) continue;
    fieldsList.push({
      uid: crypto.randomUUID(),
      fullName,
      firstName: parsed.firstName || '',
      lastName: parsed.lastName || '',
      organization: parsed.organization || '',
      phones: JSON.stringify(parsed.phones || []),
      emails: JSON.stringify(parsed.emails || []),
      notes: parsed.notes || '',
      favorite: parsed.favorite ? 1 : 0,
    });
  }

  if (fieldsList.length === 0) return res.status(422).json({ error: 'No contacts found in the uploaded file' });

  const imported = insertManyContacts(fieldsList);
  res.json({ imported });
});

router.post('/contacts/bulk', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((id) => statements.getContact.get(id)) : [];
  const action = req.body.action;
  if (ids.length === 0) return res.status(400).json({ error: 'No valid contact ids given' });
  if (!BULK_ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid bulk action' });

  bulkContactAction(ids, action);
  res.json({ affected: ids.length });
});

router.get('/contacts/:id', (req, res) => {
  const row = statements.getContact.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Contact not found' });
  res.json(row);
});

router.post('/contacts', (req, res) => {
  const fields = contactFieldsFromBody(req.body, null);
  if (!fields.fullName) return res.status(400).json({ error: 'Name is required' });

  const uid = crypto.randomUUID();
  const id = createContact({ uid, ...fields });
  res.status(201).json(statements.getContact.get(id));
});

router.put('/contacts/:id', (req, res) => {
  const existing = statements.getContact.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  const fields = contactFieldsFromBody(req.body, existing);
  if (!fields.fullName) return res.status(400).json({ error: 'Name is required' });

  updateContactFields(existing.id, fields);
  res.json(statements.getContact.get(existing.id));
});

router.put('/contacts/:id/favorite', (req, res) => {
  const existing = statements.getContact.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  setContactFavoriteSeq(existing.id, req.body.favorite ? 1 : 0);
  res.json(statements.getContact.get(existing.id));
});

router.get('/contacts/:id/photo', (req, res) => {
  const row = statements.getContactPhoto.get(req.params.id);
  if (!row || !row.photo) return res.status(404).json({ error: 'No photo set' });

  const mime = PHOTO_MIME_TYPES.includes(row.photo_mime) ? row.photo_mime : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-cache');
  res.send(row.photo);
});

router.post('/contacts/:id/photo', (req, res) => {
  const existing = statements.getContact.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: tooBig ? 'Picture must be 2 MB or smaller' : err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    if (!PHOTO_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Picture must be a PNG, JPEG, GIF, or WebP image' });
    }

    setContactPhotoSeq(existing.id, req.file.buffer, req.file.mimetype);
    res.status(201).json({ ok: true });
  });
});

router.delete('/contacts/:id/photo', (req, res) => {
  const existing = statements.getContact.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  clearContactPhotoSeq(existing.id);
  res.status(204).end();
});

router.delete('/contacts/all', (req, res) => {
  statements.deleteAllContacts.run();
  res.status(204).end();
});

router.delete('/contacts/:id', (req, res) => {
  const existing = statements.getContact.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  deleteContactById(existing.id);
  res.status(204).end();
});

module.exports = router;
