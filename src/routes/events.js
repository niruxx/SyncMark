const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { statements, createEvent, updateEventFields, deleteEventById, insertManyEvents } = require('../db');
const { buildICS, parseICS, splitVEvents } = require('../utils/ical');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const RECURRENCE_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY'];

// { freq: 'daily'|'weekly'|'monthly'|'', until: 'YYYY-MM-DD'|'' } -> RRULE value, or null.
function buildRecurrence(recurrence) {
  if (!recurrence || !recurrence.freq) return null;
  const freq = String(recurrence.freq).toUpperCase();
  if (!RECURRENCE_FREQS.includes(freq)) return null;

  let value = `FREQ=${freq}`;
  if (recurrence.until) {
    const until = String(recurrence.until).replace(/-/g, '');
    if (/^\d{8}$/.test(until)) value += `;UNTIL=${until}T000000Z`;
  }
  return value;
}

function eventFieldsFromBody(body, existing) {
  const title = (body.title ?? existing?.title ?? '').trim();
  const allDay = body.allDay !== undefined ? Boolean(body.allDay) : Boolean(existing?.all_day);
  const startAt = body.startAt ?? existing?.start_at;
  const endAt = body.endAt ?? existing?.end_at ?? startAt;
  const recurrence = body.recurrence !== undefined ? buildRecurrence(body.recurrence) : (existing?.recurrence ?? null);

  return {
    title,
    description: (body.description ?? existing?.description ?? '').trim(),
    location: (body.location ?? existing?.location ?? '').trim(),
    startAt,
    endAt,
    allDay: allDay ? 1 : 0,
    recurrence,
  };
}

function isValidIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

router.get('/events', (req, res) => {
  const q = (req.query.q || '').trim();
  res.json(statements.listEvents.all({ q, qLike: `%${q}%` }));
});

router.get('/events/export', (req, res) => {
  const rows = statements.listEventsMeta.all().map((m) => statements.getEventFullByUid.get(m.uid));
  const ics = rows.map((event) => buildICS(event)).join('');
  res.setHeader('Content-Disposition', 'attachment; filename="syncmark-calendar.ics"');
  res.type('text/calendar').send(ics);
});

router.post('/events/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });

  const text = req.file.buffer.toString('utf8');
  const blocks = splitVEvents(text);
  const fieldsList = [];
  for (const block of blocks) {
    const parsed = parseICS(block);
    if (!parsed.title || !parsed.startAt) continue;
    fieldsList.push({
      uid: crypto.randomUUID(),
      title: parsed.title,
      description: parsed.description || '',
      location: parsed.location || '',
      startAt: parsed.startAt,
      endAt: parsed.endAt || parsed.startAt,
      allDay: parsed.allDay ? 1 : 0,
      recurrence: parsed.recurrence || null,
    });
  }

  if (fieldsList.length === 0) return res.status(422).json({ error: 'No events found in the uploaded file' });

  const imported = insertManyEvents(fieldsList);
  res.json({ imported });
});

router.get('/events/:id', (req, res) => {
  const row = statements.getEvent.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  res.json(row);
});

router.post('/events', (req, res) => {
  const fields = eventFieldsFromBody(req.body, null);
  if (!fields.title) return res.status(400).json({ error: 'Title is required' });
  if (!isValidIso(fields.startAt) || !isValidIso(fields.endAt)) {
    return res.status(400).json({ error: 'A valid start and end time are required' });
  }

  const uid = crypto.randomUUID();
  const id = createEvent({ uid, ...fields });
  res.status(201).json(statements.getEvent.get(id));
});

router.put('/events/:id', (req, res) => {
  const existing = statements.getEvent.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  const fields = eventFieldsFromBody(req.body, existing);
  if (!fields.title) return res.status(400).json({ error: 'Title is required' });
  if (!isValidIso(fields.startAt) || !isValidIso(fields.endAt)) {
    return res.status(400).json({ error: 'A valid start and end time are required' });
  }

  updateEventFields(existing.id, fields);
  res.json(statements.getEvent.get(existing.id));
});

router.delete('/events/all', (req, res) => {
  statements.deleteAllEvents.run();
  res.status(204).end();
});

router.delete('/events/:id', (req, res) => {
  const existing = statements.getEvent.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  deleteEventById(existing.id);
  res.status(204).end();
});

module.exports = router;
