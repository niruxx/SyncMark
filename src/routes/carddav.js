const express = require('express');
const cheerio = require('cheerio');
const { statements, isFeatureEnabled, currentContactsSeq, deleteContactById, upsertContactFromVCard } = require('../db');
const { basicAuth } = require('../middleware/basicAuth');
const { requireFeatureDav } = require('../middleware/featureGate');
const { buildVCard, parseVCard } = require('../utils/vcard');

const router = express.Router();

// PROPFIND/REPORT bodies are XML, PUT bodies are vCard text — neither is
// application/json, so express.json() upstream in server.js leaves them
// untouched and this reads the raw text itself. Scoped to /dav so it doesn't
// swallow the request body for the rest of the app (this router is mounted
// at the app root, ahead of express.json()).
router.use('/dav', express.text({ type: () => true, limit: '10mb' }));

// Unauthenticated: clients probe this before they have credentials in hand.
router.get('/.well-known/carddav', (req, res) => res.redirect(301, '/dav/'));

// Scoped to /dav — otherwise this gates every request to the whole app (the
// browser's native Basic-Auth prompt instead of the SyncMark sign-in page).
router.use('/dav', basicAuth);

// Hard-blocks the address book itself when Contacts is turned off in
// Settings — the shared principal handler below separately stops
// *advertising* it, so a disabled feature isn't even discoverable.
router.use('/dav/addressbooks', requireFeatureDav('contacts'));

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
    '<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" ' +
    'xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">' +
    inner +
    trailing +
    '</d:multistatus>'
  );
}

function sendMultiStatus(res, inner, trailing = '') {
  res.status(207).type('application/xml; charset=utf-8').send(multistatusXml(inner, trailing));
}

const principalHref = (username) => `/dav/principals/${encodeURIComponent(username)}/`;
const homeHref = (username) => `/dav/addressbooks/${encodeURIComponent(username)}/`;
const addressbookHref = (username) => `${homeHref(username)}default/`;
const resourceHref = (username, uid) => `${addressbookHref(username)}${encodeURIComponent(uid)}.vcf`;
// A CalDAV+CardDAV client discovers both from the same principal resource
// (see the note on the principal PROPFIND handler below) — kept here rather
// than duplicated in caldav.js since only one router can own this route.
const calendarHomeHref = (username) => `/dav/calendars/${encodeURIComponent(username)}/`;

function syncTokenValue(seq) {
  return `urn:syncmark:contacts-sync:${seq}`;
}
function parseSyncToken(token) {
  const m = /^urn:syncmark:contacts-sync:(\d+)$/.exec(String(token || '').trim());
  return m ? parseInt(m[1], 10) : 0;
}

function addressbookCollectionProps() {
  const seq = currentContactsSeq();
  return (
    '<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>' +
    '<d:displayname>SyncMark Contacts</d:displayname>' +
    `<cs:getctag>${seq}</cs:getctag>` +
    `<d:sync-token>${xmlEscape(syncTokenValue(seq))}</d:sync-token>` +
    '<card:supported-address-data><card:address-data-type content-type="text/vcard" version="3.0"/></card:supported-address-data>' +
    '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>'
  );
}

function vcardResourceProps(meta) {
  return `<d:resourcetype/><d:getetag>"${meta.seq}"</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype>`;
}

function vcardDataResponse(username, contact) {
  const props = `<d:getetag>"${contact.seq}"</d:getetag><card:address-data>${xmlEscape(buildVCard(contact))}</card:address-data>`;
  return xmlResponse(resourceHref(username, contact.uid), props);
}

function fileToUid(file) {
  const decoded = decodeURIComponent(file);
  return decoded.endsWith('.vcf') ? decoded.slice(0, -4) : null;
}

// Namespace-agnostic element lookup — cheerio's CSS selector engine chokes on
// the "d:"/"card:" prefixes DAV clients send, so match on local tag name instead.
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

// Shared across CardDAV and CalDAV — the whole /dav/ tree advertises both
// capabilities, since caldav.js has no OPTIONS handler of its own (this one,
// registered first, would win the route match anyway).
router.options(/^\/dav(\/.*)?$/, (req, res) => {
  res.setHeader('DAV', '1, 3, addressbook, calendar-access');
  res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT');
  res.status(200).end();
});

router.propfind(['/dav', '/dav/'], (req, res) => {
  const { username } = req.davUser;
  const props =
    '<d:resourcetype><d:collection/></d:resourcetype>' +
    `<d:current-user-principal><d:href>${xmlEscape(principalHref(username))}</d:href></d:current-user-principal>`;
  sendMultiStatus(res, xmlResponse('/dav/', props));
});

// Owns calendar-home-set too (not just addressbook-home-set): a combined
// CalDAV+CardDAV client discovers both collection types from this one
// principal resource, and Express only ever reaches the first router whose
// route matches — so caldav.js does not (and must not) define this route.
router.propfind(['/dav/principals/:username', '/dav/principals/:username/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  let props =
    '<d:resourcetype><d:principal/></d:resourcetype>' +
    `<d:displayname>${xmlEscape(username)}</d:displayname>` +
    `<d:current-user-principal><d:href>${xmlEscape(principalHref(username))}</d:href></d:current-user-principal>` +
    `<d:principal-URL><d:href>${xmlEscape(principalHref(username))}</d:href></d:principal-URL>`;
  // A disabled feature isn't just blocked below — it's not advertised here
  // either, so a DAV client never discovers a collection it can't use.
  if (isFeatureEnabled('contacts')) {
    props += `<card:addressbook-home-set><d:href>${xmlEscape(homeHref(username))}</d:href></card:addressbook-home-set>`;
  }
  if (isFeatureEnabled('calendar')) {
    props += `<cal:calendar-home-set><d:href>${xmlEscape(calendarHomeHref(username))}</d:href></cal:calendar-home-set>`;
  }
  sendMultiStatus(res, xmlResponse(principalHref(username), props));
});

router.propfind(['/dav/addressbooks/:username', '/dav/addressbooks/:username/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  const depth = req.headers.depth === '1' ? 1 : 0;
  const homeProps = `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>${xmlEscape(username)}</d:displayname>`;

  let inner = xmlResponse(homeHref(username), homeProps);
  if (depth === 1) inner += xmlResponse(addressbookHref(username), addressbookCollectionProps());
  sendMultiStatus(res, inner);
});

router.propfind(['/dav/addressbooks/:username/default', '/dav/addressbooks/:username/default/'], (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const { username } = req.davUser;
  const depth = req.headers.depth === '1' ? 1 : 0;

  let inner = xmlResponse(addressbookHref(username), addressbookCollectionProps());
  if (depth === 1) {
    for (const meta of statements.listContactsMeta.all()) {
      inner += xmlResponse(resourceHref(username, meta.uid), vcardResourceProps(meta));
    }
  }
  sendMultiStatus(res, inner);
});

// ---------- reports ----------

router.report(
  ['/dav/addressbooks/:username/default', '/dav/addressbooks/:username/default/'],
  (req, res) => {
    if (!requireOwnUser(req, res)) return;
    const { username } = req.davUser;
    const $ = cheerio.load(req.body || '', { xmlMode: true });

    if (elementsByLocalName($, 'sync-collection').length) {
      const tokenEl = elementsByLocalName($, 'sync-token')[0];
      const sinceSeq = tokenEl ? parseSyncToken($(tokenEl).text()) : 0;

      const changed = statements.listContactsMetaSince.all({ seq: sinceSeq });
      const removed = statements.listTombstonesSince.all({ seq: sinceSeq });

      let inner = '';
      for (const meta of changed) {
        const contact = statements.getContactFullByUid.get(meta.uid);
        if (contact) inner += vcardDataResponse(username, contact);
      }
      for (const tomb of removed) {
        inner += xmlResponse(resourceHref(username, tomb.uid), '', 'HTTP/1.1 404 Not Found');
      }

      const newToken = `<d:sync-token>${xmlEscape(syncTokenValue(currentContactsSeq()))}</d:sync-token>`;
      return sendMultiStatus(res, inner, newToken);
    }

    if (elementsByLocalName($, 'addressbook-multiget').length) {
      const hrefs = elementsByLocalName($, 'href').map((el) => $(el).text().trim());
      let inner = '';
      for (const href of hrefs) {
        const uid = fileToUid(href.split('/').pop() || '');
        const contact = uid && statements.getContactFullByUid.get(uid);
        inner += contact ? vcardDataResponse(username, contact) : xmlResponse(href, '', 'HTTP/1.1 404 Not Found');
      }
      return sendMultiStatus(res, inner);
    }

    // addressbook-query (or anything unrecognized): a single personal address
    // book is small enough that we just return everything rather than
    // implementing full filter-matching semantics.
    let inner = '';
    for (const meta of statements.listContactsMeta.all()) {
      const contact = statements.getContactFullByUid.get(meta.uid);
      if (contact) inner += vcardDataResponse(username, contact);
    }
    sendMultiStatus(res, inner);
  }
);

// ---------- individual resources ----------

router.get('/dav/addressbooks/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  const contact = uid && statements.getContactFullByUid.get(uid);
  if (!contact) return res.status(404).end();

  res.setHeader('ETag', `"${contact.seq}"`);
  res.type('text/vcard; charset=utf-8').send(buildVCard(contact));
});

router.put('/dav/addressbooks/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  if (!uid) return res.status(400).end();

  const existedBefore = Boolean(statements.getContactByUidId.get(uid));
  const parsed = parseVCard(req.body || '');
  const fullName = parsed.fullName || [parsed.firstName, parsed.lastName].filter(Boolean).join(' ') || uid;

  const { seq } = upsertContactFromVCard({
    uid,
    fullName,
    firstName: parsed.firstName || '',
    lastName: parsed.lastName || '',
    organization: parsed.organization || '',
    phones: JSON.stringify(parsed.phones || []),
    emails: JSON.stringify(parsed.emails || []),
    notes: parsed.notes || '',
    photo: parsed.photo,
    photoMime: parsed.photoMime,
  });

  res.setHeader('ETag', `"${seq}"`);
  res.status(existedBefore ? 204 : 201).end();
});

router.delete('/dav/addressbooks/:username/default/:file', (req, res) => {
  if (!requireOwnUser(req, res)) return;
  const uid = fileToUid(req.params.file);
  const existing = uid && statements.getContactByUidId.get(uid);
  if (!existing) return res.status(404).end();

  deleteContactById(existing.id);
  res.status(204).end();
});

module.exports = router;
