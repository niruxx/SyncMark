const express = require('express');
const cheerio = require('cheerio');
const { statements, currentEventsSeq, deleteEventById, upsertEventFromICal } = require('../db');
const { basicAuth } = require('../middleware/basicAuth');
const { requireFeatureDav } = require('../middleware/featureGate');
const { buildICS, parseICS } = require('../utils/ical');

const router = express.Router();

// Same rationale as carddav.js: both scoped to /dav so they don't affect the
// rest of the app (this router is mounted at the app root). Duplicating them
// here (rather than relying on carddav.js's copies) keeps this router
// self-contained — express.text() safely no-ops on an already-parsed body
// (body-parser checks req._body before re-reading the stream), and basicAuth
// is idempotent, so registering both again is harmless either way.
router.use('/dav', express.text({ type: () => true, limit: '10mb' }));

// Unauthenticated: clients probe this before they have credentials in hand.
router.get('/.well-known/caldav', (req, res) => res.redirect(301, '/dav/'));

router.use('/dav', basicAuth);

// Hard-blocks the calendar itself when Calendar is turned off in Settings —
// carddav.js's shared principal handler separately stops *advertising* it.
router.use('/dav/calendars', requireFeatureDav('calendar'));

// ---------- helpers ----------

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function xmlResponse(href, propsXml, status = 'HTTP/1.1 200 OK') {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${propsXml}</d:prop><d:status>${status}</d:status></d:propstat></d:response>`;
}

function multistatusXml(inner, trailing = '') {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">' +
    inner +
    trailing +
    '</d:multistatus>'
  );
}

function sendMultiStatus(res, inner, trailing = '') {
  res.status(207).type('application/xml; charset=utf-8').send(multistatusXml(inner, trailing));
}

const homeHref = (username) => `/dav/calendars/${encodeURIComponent(username)}/`;
const calendarHref = (username) => `${homeHref(username)}default/`;
const resourceHref = (username, uid) => `${calendarHref(username)}${encodeURIComponent(uid)}.ics`;

function syncTokenValue(seq) {
  return `urn:syncmark:events-sync:${seq}`;
}
function parseSyncToken(token) {
  const m = /^urn:syncmark:events-sync:(\d+)$/.exec(String(token || '').trim());
  return m ? parseInt(m[1], 10) : 0;
}

function calendarCollectionProps() {
  const seq = currentEventsSeq();
  return (
    '<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>' +
    '<d:displayname>SyncMark Calendar</d:displayname>' +
    `<cs:getctag>${seq}</cs:getctag>` +
    `<d:sync-token>${xmlEscape(syncTokenValue(seq))}</d:sync-token>` +
    '<cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>' +
    '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>'
  );
}

function eventResourceProps(meta) {
  return `<d:resourcetype/><d:getetag>"${meta.seq}"</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype>`;
}

function icsDataResponse(username, event) {
  const props = `<d:getetag>"${event.seq}"</d:getetag><cal:calendar-data>${xmlEscape(buildICS(event))}</cal:calendar-data>`;
  return xmlResponse(resourceHref(username, event.uid), props);
}

function fileToUid(file) {
  const decoded = decodeURIComponent(file);
  return decoded.endsWith('.ics') ? decoded.slice(0, -4) : null;
}

// Same namespace-agnostic lookup as carddav.js — cheerio's CSS selector
// engine chokes on "d:"/"cal:" prefixes, so match on local tag name instead.
function elementsByLocalName($, name) {
  const matches = [];
  $('*').each((_, el) => {
    const tag = String(el.tagName || el.name || '').split(':').pop().toLowerCase();
    if (tag === name) matches.push(el);
  });
  return matches;
}

function requireOwnUser(req, res) {
  if (req.params.username !== req.davUser.username) {
    res.status(403).end();
    return false;
  }
  return true;
}

// ---------- discovery ----------
// No OPTIONS or /dav/principals/:username handler here — carddav.js's shared
// versions already cover the whole /dav/ tree (see the notes there) and,
// since it mounts first, would win the route match regardless.

router.propfind(['/dav/calendars/:username', '/dav/calendars/:username/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  const depth = req.headers.depth === '1' ? 1 : 0;
  const homeProps = `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>${xmlEscape(username)}</d:displayname>`;

  let inner = xmlResponse(homeHref(username), homeProps);
  if (depth === 1) inner += xmlResponse(calendarHref(username), calendarCollectionProps());
  sendMultiStatus(res, inner);
});

router.propfind(['/dav/calendars/:username/default', '/dav/calendars/:username/default/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  const depth = req.headers.depth === '1' ? 1 : 0;

  let inner = xmlResponse(calendarHref(username), calendarCollectionProps());
  if (depth === 1) {
    for (const meta of statements.listEventsMeta.all()) {
      inner += xmlResponse(resourceHref(username, meta.uid), eventResourceProps(meta));
    }
  }
  sendMultiStatus(res, inner);
});

// ---------- reports ----------

router.report(['/dav/calendars/:username/default', '/dav/calendars/:username/default/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  const $ = cheerio.load(req.body || '', { xmlMode: true });

  if (elementsByLocalName($, 'sync-collection').length) {
    const tokenEl = elementsByLocalName($, 'sync-token')[0];
    const sinceSeq = tokenEl ? parseSyncToken($(tokenEl).text()) : 0;

    const changed = statements.listEventsMetaSince.all({ seq: sinceSeq });
    const removed = statements.listEventTombstonesSince.all({ seq: sinceSeq });

    let inner = '';
    for (const meta of changed) {
      const event = statements.getEventFullByUid.get(meta.uid);
      if (event) inner += icsDataResponse(username, event);
    }
    for (const tomb of removed) {
      inner += xmlResponse(resourceHref(username, tomb.uid), '', 'HTTP/1.1 404 Not Found');
    }

    const newToken = `<d:sync-token>${xmlEscape(syncTokenValue(currentEventsSeq()))}</d:sync-token>`;
    return sendMultiStatus(res, inner, newToken);
  }

  if (elementsByLocalName($, 'calendar-multiget').length) {
    const hrefs = elementsByLocalName($, 'href').map((el) => $(el).text().trim());
    let inner = '';
    for (const href of hrefs) {
      const uid = fileToUid(href.split('/').pop() || '');
      const event = uid && statements.getEventFullByUid.get(uid);
      inner += event ? icsDataResponse(username, event) : xmlResponse(href, '', 'HTTP/1.1 404 Not Found');
    }
    return sendMultiStatus(res, inner);
  }

  // calendar-query (or anything unrecognized): a single personal calendar is
  // small enough that we just return everything rather than implementing
  // full time-range/filter-matching semantics — same precedent as CardDAV's
  // addressbook-query.
  let inner = '';
  for (const meta of statements.listEventsMeta.all()) {
    const event = statements.getEventFullByUid.get(meta.uid);
    if (event) inner += icsDataResponse(username, event);
  }
  sendMultiStatus(res, inner);
});

// ---------- individual resources ----------

router.get('/dav/calendars/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  const event = uid && statements.getEventFullByUid.get(uid);
  if (!event) return res.status(404).end();

  res.setHeader('ETag', `"${event.seq}"`);
  res.type('text/calendar; charset=utf-8').send(buildICS(event));
});

router.put('/dav/calendars/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  if (!uid) return res.status(400).end();

  const existedBefore = Boolean(statements.getEventByUidId.get(uid));
  const parsed = parseICS(req.body || '');
  if (!parsed.title || !parsed.startAt) return res.status(400).end();

  const { seq } = upsertEventFromICal({
    uid,
    title: parsed.title,
    description: parsed.description || '',
    location: parsed.location || '',
    startAt: parsed.startAt,
    endAt: parsed.endAt || parsed.startAt,
    allDay: parsed.allDay ? 1 : 0,
    recurrence: parsed.recurrence || null,
  });

  res.setHeader('ETag', `"${seq}"`);
  res.status(existedBefore ? 204 : 201).end();
});

router.delete('/dav/calendars/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  const existing = uid && statements.getEventByUidId.get(uid);
  if (!existing) return res.status(404).end();

  deleteEventById(existing.id);
  res.status(204).end();
});

module.exports = router;
