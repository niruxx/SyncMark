const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { statements } = require('../db');
const { basicAuth } = require('../middleware/basicAuth');
const { requireFeatureDav } = require('../middleware/featureGate');
const { resolveSafePath } = require('../utils/fsPath');
const store = require('../utils/fileStore');
const router = express.Router();
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const methods = 'OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, MKCOL, COPY, MOVE, DELETE';
router.use('/webdav', basicAuth, requireFeatureDav('files'));
router.use('/webdav', (req, res, next) => {
  const user = statements.getUserById.get(req.davUser.id);
  if (user.role === 'admin') return res.status(403).end();
  res.set({ DAV: '1', Allow: methods, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
  next();
});
function resource(req, pathname) {
  const pieces = pathname.replace(/^\/webdav\/?/, '').split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  if (!pieces.length) return { virtual: true };
  if (!/^\d+$/.test(pieces[0]) || pieces.some((p) => p.includes('/') || p.includes('\\') || p === '..' || p.includes('\0'))) store.fail(400, 'Invalid DAV path');
  const location = statements.getFileLocation.get(pieces.shift(), req.davUser.id);
  if (!location) store.fail(404, 'Location not found');
  return { location, target: resolveSafePath(location.path, pieces.join('/')) };
}
function href(location, target, directory) {
  const rel = store.relative(location, target);
  return `/webdav/${location.id}/` + rel.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (directory && rel ? '/' : '');
}
function props(location, target, virtual = false) {
  const stat = virtual ? null : fs.statSync(target);
  const directory = virtual || stat.isDirectory();
  return {
    displayname: escape(virtual ? 'SyncMark Files' : target === path.resolve(location.path) ? location.name : path.basename(target)),
    resourcetype: directory ? '<d:collection/>' : '',
    getcontentlength: directory ? '0' : String(stat.size),
    getcontenttype: directory ? 'httpd/unix-directory' : 'application/octet-stream',
    getlastmodified: virtual ? new Date(0).toUTCString() : stat.mtime.toUTCString(),
    creationdate: virtual ? new Date(0).toISOString() : stat.birthtime.toISOString(),
    getetag: virtual ? '&quot;root&quot;' : escape(store.etag(target)),
    supportedlock: '', lockdiscovery: '',
  };
}
function checkHeaders(req, target) {
  const tag = store.etag(target);
  const match = req.headers['if-match'];
  const none = req.headers['if-none-match'];
  if (req.headers.if) store.fail(412, 'DAV lock conditions are not supported');
  if (match && !(match === '*' ? tag !== null : match.split(',').map((s) => s.trim()).includes(tag))) store.fail(412, 'File changed');
  if (none && (none === '*' ? tag !== null : none.split(',').map((s) => s.trim()).includes(tag))) store.fail(412, 'File already exists or changed');
  return tag;
}
async function readXml(req) {
  let xml = '';
  for await (const chunk of req) {
    xml += chunk;
    if (Buffer.byteLength(xml) > 65536) store.fail(413, 'Property request too large');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) store.fail(400, 'DTD declarations are not supported');
  return xml;
}
function deadPropertyFile(location, target) {
  const key = crypto.createHash('sha256').update(store.relative(location, target)).digest('hex');
  return path.join(store.metadataDir(location, 'properties'), `${key}.json`);
}
function deadProperties(location, target) {
  const file = deadPropertyFile(location, target);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
function emptyProperty(field) {
  return field.namespace ? `<x:${field.local} xmlns:x="${escape(field.namespace)}"/>` : `<${field.local} xmlns=""/>`;
}
function propertyTree(location, target, relative = '') {
  const entries = [{ relative, properties: deadProperties(location, target) }];
  if (fs.lstatSync(target).isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      const child = resolveSafePath(location.path, store.relative(location, path.join(target, name)));
      entries.push(...propertyTree(location, child, path.join(relative, name)));
    }
  }
  return entries;
}
function propertyFields($, node) {
  const namespaces = {};
  for (const ancestor of [...$(node).parents().toArray().reverse(), node]) {
    for (const [key, value] of Object.entries(ancestor.attribs || {})) if (key === 'xmlns' || key.startsWith('xmlns:')) namespaces[key] = value;
  }
  const parts = node.name.split(':');
  return { local: parts.at(-1), namespace: namespaces[parts.length > 1 ? `xmlns:${parts[0]}` : 'xmlns'] || '', namespaces };
}
router.all(/^\/webdav(?:\/.*)?$/, async (req, res, next) => {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    const entry = resource(req, req.path);
    if (req.method === 'PROPFIND') {
      const depth = req.headers.depth || 'infinity';
      if (!['0', '1'].includes(depth)) return res.status(403).type('application/xml').send('<d:error xmlns:d="DAV:"><d:propfind-finite-depth/></d:error>');
      const xml = await readXml(req);
      let requested = null;
      let namesOnly = false;
      if (xml.trim()) {
        const $ = cheerio.load(xml, { xmlMode: true });
        const nodes = $('*').toArray();
        const local = (node) => node.name.split(':').pop();
        const prop = nodes.find((n) => local(n) === 'prop');
        namesOnly = nodes.some((n) => local(n) === 'propname');
        if (prop) requested = $(prop).children().toArray().map((n) => propertyFields($, n));
      }
      const items = [{ ...entry }];
      if (depth === '1') {
        if (entry.virtual) for (const location of statements.listFileLocations.all(req.davUser.id)) items.push({ location, target: path.resolve(location.path) });
        else if (fs.statSync(entry.target).isDirectory()) {
          for (const name of fs.readdirSync(entry.target)) {
            try {
              const target = resolveSafePath(entry.location.path, store.relative(entry.location, path.join(entry.target, name)));
              const stat = fs.lstatSync(target);
              if (stat.isFile() || stat.isDirectory()) items.push({ location: entry.location, target });
            } catch { /* private storage, symlinks, or vanished entries */ }
          }
        }
      }
      const responses = items.map((item) => {
        const values = props(item.location, item.target, item.virtual);
        const dead = item.virtual ? {} : deadProperties(item.location, item.target);
        const url = item.virtual ? '/webdav/' : href(item.location, item.target, fs.statSync(item.target).isDirectory());
        const wanted = requested || [...Object.keys(values).map((local) => ({ local, namespace: 'DAV:' })), ...Object.values(dead)];
        const found = [], missing = [];
        for (const field of wanted) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(field.local)) continue;
          if (field.namespace === 'DAV:' && Object.hasOwn(values, field.local)) found.push(`<d:${field.local}>${namesOnly ? '' : values[field.local]}</d:${field.local}>`);
          else if (dead[`${field.namespace}\0${field.local}`]) found.push(namesOnly ? emptyProperty(field) : dead[`${field.namespace}\0${field.local}`].xml);
          else missing.push(emptyProperty(field));
        }
        const group = (fields, status) => fields.length ? `<d:propstat><d:prop>${fields.join('')}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat>` : '';
        return `<d:response><d:href>${escape(url)}</d:href>${group(found, '200 OK')}${group(missing, '404 Not Found')}</d:response>`;
      });
      return res.status(207).type('application/xml').send(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`);
    }
    if (entry.virtual) store.fail(403, 'The DAV root is read-only; select a location');
    const { location, target } = entry;
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!fs.statSync(target).isFile()) store.fail(405, 'Use PROPFIND to list folders');
      res.set({ ETag: store.etag(target), 'Content-Security-Policy': "default-src 'none'; sandbox" });
      return res.type('application/octet-stream').sendFile(target);
    }
    await store.locked([location], async () => {
      checkHeaders(req, target);
      if (req.method === 'PROPPATCH') {
        if (!fs.existsSync(target)) store.fail(404, 'Resource not found');
        const xml = await readXml(req);
        const $ = cheerio.load(xml, { xmlMode: true });
        const updates = [];
        $('*').each((i, node) => {
          const operation = node.name.split(':').pop();
          if (!['set', 'remove'].includes(operation)) return;
          $(node).children().filter((i, n) => n.name.split(':').pop() === 'prop').children().each((i, property) => {
            const field = propertyFields($, property);
            for (const [key, value] of Object.entries(field.namespaces)) $(property).attr(key, value);
            updates.push({ ...field, operation, xml: $.xml(property) });
          });
        });
        if (!updates.length || updates.length > 100) store.fail(400, 'Specify 1–100 property changes');
        const live = props(location, target);
        const protectedProperty = updates.some((u) => u.namespace === 'DAV:' && Object.hasOwn(live, u.local));
        const dead = deadProperties(location, target);
        if (!protectedProperty) {
          for (const field of updates) {
            const key = `${field.namespace}\0${field.local}`;
            if (field.operation === 'remove') delete dead[key];
            else dead[key] = { local: field.local, namespace: field.namespace, xml: field.xml };
          }
          const file = deadPropertyFile(location, target);
          fs.writeFileSync(file + '.tmp', JSON.stringify(dead));
          fs.renameSync(file + '.tmp', file);
        }
        const response = updates.map((field) => {
          const status = protectedProperty ? (field.namespace === 'DAV:' && Object.hasOwn(live, field.local) ? '403 Forbidden' : '424 Failed Dependency') : '200 OK';
          return `<d:propstat><d:prop>${emptyProperty(field)}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat>`;
        }).join('');
        res.status(207).type('application/xml').send(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${escape(href(location, target, fs.statSync(target).isDirectory()))}</d:href>${response}</d:response></d:multistatus>`);
      } else if (req.method === 'PUT') {
        const staged = store.stagePath(location);
        const expected = store.etag(target);
        try {
          await store.receive(req, staged);
          const tag = store.commit(location, target, staged, expected);
          res.set('ETag', tag).status(expected ? 204 : 201).end();
        } finally { fs.rmSync(staged, { force: true }); }
      } else if (req.method === 'MKCOL') {
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) store.fail(415, 'MKCOL bodies are not supported');
        if (fs.existsSync(target)) store.fail(405, 'Collection already exists');
        if (!fs.existsSync(path.dirname(target))) store.fail(409, 'Parent folder does not exist');
        fs.mkdirSync(target); res.status(201).end();
      } else if (req.method === 'DELETE') {
        store.trash(location, target); res.status(204).end();
      } else if (['COPY', 'MOVE'].includes(req.method)) {
        if (!req.headers.destination) store.fail(400, 'Destination header is required');
        const origin = `${req.protocol}://${req.get('host')}`;
        const url = new URL(req.headers.destination, origin);
        if (url.origin !== origin || !url.pathname.startsWith('/webdav/')) store.fail(403, 'Destination must be on this server');
        const dest = resource(req, url.pathname);
        if (dest.virtual || dest.location.id !== location.id) store.fail(403, 'DAV transfers must stay within one location; use the bulk API for cross-location transfers');
        if (req.method === 'COPY' && req.headers.depth && req.headers.depth !== 'infinity') store.fail(400, 'COPY supports Depth infinity only');
        const exists = fs.existsSync(dest.target);
        const properties = propertyTree(location, target);
        if (exists) {
          if (req.headers.overwrite === 'F') store.fail(412, 'Destination exists');
          if (fs.statSync(target).isDirectory() || fs.statSync(dest.target).isDirectory()) store.fail(409, 'Replacing folders is not supported');
          if (fs.realpathSync(target) === fs.realpathSync(dest.target)) store.fail(403, 'Source and destination are identical');
          const staged = store.stagePath(location);
          try {
            fs.copyFileSync(target, staged);
            store.commit(location, dest.target, staged, store.etag(dest.target));
            if (req.method === 'MOVE') store.trash(location, target);
          } finally { fs.rmSync(staged, { force: true }); }
        } else store.transfer(location, target, location, dest.target, req.method === 'MOVE');
        for (const item of properties) {
          const file = deadPropertyFile(location, path.join(dest.target, item.relative));
          fs.writeFileSync(file, JSON.stringify(item.properties));
          if (req.method === 'MOVE') fs.rmSync(deadPropertyFile(location, path.join(target, item.relative)), { force: true });
        }
        res.status(exists ? 204 : 201).end();
      } else res.status(405).end();
    });
  } catch (err) {
    if (res.headersSent) return next(err);
    const status = err.status || ({ ENOENT: 404, ENOTDIR: 409, EEXIST: 405, EACCES: 403, EPERM: 403 }[err.code]) || 400;
    res.status(status).type('text/plain').send(err.message);
  }
});
module.exports = router;
