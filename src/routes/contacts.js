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
  deleteContactGroup,
  mergeContacts,
  getDismissedDuplicatePairs,
  addDismissedDuplicatePairs,
} = require('../db');
const { buildVCard, parseVCard, splitVCards } = require('../utils/vcard');
const { toCsv, parseCsv } = require('../utils/contactsCsv');
const { fuzzyScoreAny } = require('../utils/fuzzySearch');
const { findDuplicateGroups, pairKey } = require('../utils/duplicates');

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
    .map((e) => ({ type: String(e?.type || 'other').slice(0, 30), value: String(e?.value || '').trim() }))
    .filter((e) => e.value);
}

function normalizeAddresses(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({
      type: String(e?.type || 'home').slice(0, 20),
      street: String(e?.street || '').trim(),
      city: String(e?.city || '').trim(),
      state: String(e?.state || '').trim(),
      postalCode: String(e?.postalCode || '').trim(),
      country: String(e?.country || '').trim(),
    }))
    .filter((a) => a.street || a.city || a.state || a.postalCode || a.country);
}

function normalizeCustomFields(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({ label: String(e?.label || '').trim().slice(0, 60), value: String(e?.value || '').trim() }))
    .filter((e) => e.label && e.value);
}

function normalizeKeyDates(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({ label: String(e?.label || '').trim().slice(0, 60), date: String(e?.date || '').trim() }))
    .filter((e) => e.label && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
}

// contactId is trusted as-is here (validated against real rows) — a stale
// reference left behind by a since-deleted contact is already swept up by
// deleteContactById's own cleanup pass, so no extra guarding is needed here.
function normalizeRelationships(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => ({ type: String(e?.type || '').trim().slice(0, 40), contactId: Number(e?.contactId) }))
    .filter((e) => e.type && Number.isInteger(e.contactId) && statements.getContact.get(e.contactId));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = String(raw || '').trim().slice(0, 40);
    if (tag) seen.add(tag);
  }
  return [...seen];
}

function contactFieldsFromBody(body, existing) {
  const firstName = (body.firstName ?? existing?.first_name ?? '').trim();
  const lastName = (body.lastName ?? existing?.last_name ?? '').trim();
  const fullNameInput = body.fullName !== undefined ? String(body.fullName).trim() : '';
  const fullName = fullNameInput || [firstName, lastName].filter(Boolean).join(' ');

  const jsonField = (key, existingColumn, normalizeFn) =>
    JSON.stringify(body[key] !== undefined ? normalizeFn(body[key]) : normalizeFn(JSON.parse(existing?.[existingColumn] || '[]')));

  return {
    fullName,
    firstName,
    lastName,
    organization: (body.organization ?? existing?.organization ?? '').trim(),
    title: (body.title ?? existing?.title ?? '').trim(),
    phones: jsonField('phones', 'phones', normalizeEntries),
    emails: jsonField('emails', 'emails', normalizeEntries),
    addresses: jsonField('addresses', 'addresses', normalizeAddresses),
    socialProfiles: jsonField('socialProfiles', 'social_profiles', normalizeEntries),
    messagingHandles: jsonField('messagingHandles', 'messaging_handles', normalizeEntries),
    customFields: jsonField('customFields', 'custom_fields', normalizeCustomFields),
    keyDates: jsonField('keyDates', 'key_dates', normalizeKeyDates),
    relationships: jsonField('relationships', 'relationships', normalizeRelationships),
    tags: jsonField('tags', 'tags', normalizeTags),
    notes: (body.notes ?? existing?.notes ?? '').trim(),
    favorite: body.favorite !== undefined ? (body.favorite ? 1 : 0) : (existing?.favorite ?? 0),
  };
}

// Extracts the text fields fuzzySearch scores against — kept out of the SQL
// list query (which only returns the JSON blobs as raw strings) so both this
// and the smart-group matcher below can share one place that knows how to
// read them.
function contactSearchHaystacks(row) {
  const phones = JSON.parse(row.phones || '[]').map((e) => e.value).join(' ');
  const emails = JSON.parse(row.emails || '[]').map((e) => e.value).join(' ');
  const tags = JSON.parse(row.tags || '[]').join(' ');
  return [row.full_name, row.organization, row.title, phones, emails, tags];
}

router.get('/contacts', (req, res) => {
  const q = (req.query.q || '').trim();
  const favorite = req.query.favorite === '1' ? 1 : 0;
  const tag = (req.query.tag || '').trim();
  const tagLike = tag ? `%"${tag}"%` : '';
  const sort = statements.listContactsBySort[req.query.sort] ? req.query.sort : DEFAULT_SORT;
  const rows = statements.listContactsBySort[sort].all({ favorite, tag, tagLike });

  if (!q) return res.json(rows);

  // Fuzzy relevance ranking replaces the SQL sort entirely once there's a
  // query — fetch-all-and-score-in-JS, same "personal scale" precedent as
  // the DAV routers and the Calendar's client-side recurrence expansion.
  const ranked = rows
    .map((row) => ({ row, score: fuzzyScoreAny(q, contactSearchHaystacks(row)) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);

  res.json(ranked);
});

router.get('/contacts/tags', (req, res) => {
  const rows = statements.listContactsBySort[DEFAULT_SORT].all({ favorite: 0, tag: '', tagLike: '' });
  const tagSet = new Set();
  for (const row of rows) {
    for (const tag of JSON.parse(row.tags || '[]')) tagSet.add(tag);
  }
  res.json([...tagSet].sort((a, b) => a.localeCompare(b)));
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
      title: '',
      phones: JSON.stringify(parsed.phones || []),
      emails: JSON.stringify(parsed.emails || []),
      addresses: '[]',
      socialProfiles: '[]',
      messagingHandles: '[]',
      customFields: '[]',
      keyDates: '[]',
      relationships: '[]',
      tags: '[]',
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

router.get('/contacts/duplicates', (req, res) => {
  const contacts = statements.listContactsForDuplicates.all();
  const dismissed = getDismissedDuplicatePairs();
  const groups = findDuplicateGroups(contacts, dismissed);
  res.json(groups);
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

// ---------- duplicate detection ----------

router.post('/contacts/merge', (req, res) => {
  const primaryId = Number(req.body.primaryId);
  const mergeIds = Array.isArray(req.body.mergeIds) ? req.body.mergeIds.map(Number).filter(Number.isInteger) : [];
  if (!Number.isInteger(primaryId)) return res.status(400).json({ error: 'primaryId is required' });
  if (mergeIds.length === 0) return res.status(400).json({ error: 'mergeIds must be a non-empty array' });

  const merged = mergeContacts(primaryId, mergeIds);
  if (!merged) return res.status(404).json({ error: 'Contact not found' });
  res.json(merged);
});

router.post('/contacts/duplicates/dismiss', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length < 2) return res.status(400).json({ error: 'ids must contain at least two contact ids' });

  const keys = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) keys.push(pairKey(ids[i], ids[j]));
  }
  addDismissedDuplicatePairs(keys);
  res.status(204).end();
});

// ---------- contact groups ----------
// Deliberately constrained, AND-only rule set for smart groups — a full
// query builder isn't warranted for a personal address book. Evaluated in
// JS against every contact (personal-scale precedent, same as fuzzy search
// above and the DAV routers' query REPORTs).
const SMART_FIELDS = ['tag', 'organization', 'title', 'favorite', 'addedWithinDays'];

function normalizeSmartRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((r) => r && SMART_FIELDS.includes(r.field))
    .map((r) => ({ field: r.field, operator: String(r.operator || 'equals'), value: r.value }))
    .slice(0, 10);
}

function matchesSmartRule(contact, rule) {
  switch (rule.field) {
    case 'tag':
      return JSON.parse(contact.tags || '[]').some((t) => t.toLowerCase() === String(rule.value || '').toLowerCase());
    case 'organization':
      return (contact.organization || '').toLowerCase().includes(String(rule.value || '').toLowerCase());
    case 'title':
      return (contact.title || '').toLowerCase().includes(String(rule.value || '').toLowerCase());
    case 'favorite':
      return Boolean(contact.favorite) === Boolean(rule.value);
    case 'addedWithinDays': {
      const days = Number(rule.value) || 0;
      const createdAt = new Date(`${contact.created_at.replace(' ', 'T')}Z`).getTime();
      return createdAt >= Date.now() - days * 24 * 60 * 60 * 1000;
    }
    default:
      return true;
  }
}

router.get('/contact-groups', (req, res) => {
  res.json(statements.listContactGroups.all());
});

router.post('/contact-groups', (req, res) => {
  const name = (req.body.name || '').trim();
  const type = req.body.type === 'smart' ? 'smart' : 'manual';
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const smartRules = type === 'smart' ? JSON.stringify(normalizeSmartRules(req.body.smartRules)) : null;

  try {
    const result = statements.insertContactGroup.run({ name, type, smartRules });
    res.status(201).json(statements.getContactGroup.get(result.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A group with that name already exists' });
    throw err;
  }
});

router.put('/contact-groups/reorder', (req, res) => {
  const existing = statements.getContactGroup.get(req.body.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });

  const before = req.body.beforeId ? statements.getContactGroup.get(req.body.beforeId) : null;
  const after = req.body.afterId ? statements.getContactGroup.get(req.body.afterId) : null;

  let position;
  if (before && after) position = (before.position + after.position) / 2;
  else if (before) position = before.position + 1;
  else if (after) position = after.position - 1;
  else position = 0;

  statements.setContactGroupPosition.run({ id: existing.id, position });
  res.json(statements.getContactGroup.get(existing.id));
});

router.put('/contact-groups/:id', (req, res) => {
  const existing = statements.getContactGroup.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });

  const name = (req.body.name ?? existing.name).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const smartRules =
    existing.type === 'smart'
      ? JSON.stringify(req.body.smartRules !== undefined ? normalizeSmartRules(req.body.smartRules) : JSON.parse(existing.smart_rules || '[]'))
      : null;

  try {
    statements.updateContactGroup.run({ id: existing.id, name, type: existing.type, smartRules });
    res.json(statements.getContactGroup.get(existing.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A group with that name already exists' });
    throw err;
  }
});

router.delete('/contact-groups/:id', (req, res) => {
  const existing = statements.getContactGroup.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });

  deleteContactGroup(existing.id);
  res.status(204).end();
});

router.post('/contact-groups/:id/members/:contactId', (req, res) => {
  const group = statements.getContactGroup.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.type !== 'manual') return res.status(400).json({ error: 'Smart groups have no manual membership' });
  const contact = statements.getContact.get(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  statements.addContactGroupMember.run({ groupId: group.id, contactId: contact.id });
  res.status(204).end();
});

router.delete('/contact-groups/:id/members/:contactId', (req, res) => {
  const group = statements.getContactGroup.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  statements.removeContactGroupMember.run({ groupId: group.id, contactId: req.params.contactId });
  res.status(204).end();
});

router.get('/contact-groups/:id/contacts', (req, res) => {
  const group = statements.getContactGroup.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  if (group.type === 'manual') {
    const ids = statements.listContactGroupMemberIds.all(group.id).map((r) => r.contact_id);
    return res.json(ids.map((id) => statements.getContact.get(id)).filter(Boolean));
  }

  const rules = normalizeSmartRules(JSON.parse(group.smart_rules || '[]'));
  const all = statements.listContactsBySort[DEFAULT_SORT].all({ favorite: 0, tag: '', tagLike: '' });
  res.json(all.filter((contact) => rules.every((rule) => matchesSmartRule(contact, rule))));
});

module.exports = router;
