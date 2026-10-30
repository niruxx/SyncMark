const crypto = require('crypto');
const { db, statements } = require('../db');
const { normalizeFolderPath } = require('./folderPath');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function validUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function tags(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = value.split(','); } }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail(400, 'Tags must be a list of strings');
  const result = [...new Set(value.map((v) => v.trim().toLowerCase()).filter(Boolean))];
  if (result.length > 30 || result.some((v) => v.length > 60)) fail(400, 'Use at most 30 tags of 60 characters each');
  return result;
}
function notes(value) { if (typeof value !== 'string' || value.length > 20000) fail(400, 'Notes must be text of at most 20,000 characters'); return value; }
function rowView(row) {
  const { archive_text, ...rest } = row;
  return { ...rest, tags: tags(row.tags || []), has_archive: Boolean(row.archived_at) };
}
function collection(userId, folder = '') {
  folder = normalizeFolderPath(folder);
  return statements.listAllBookmarks.all(userId).filter((r) => !folder || r.folder === folder || r.folder.startsWith(folder + '/'));
}
function publicItems(share) {
  return collection(share.owner_id, share.folder).filter((row) => validUrl(row.url)).map((row) => ({
    title: row.title, url: row.url, tags: tags(row.tags), folder: share.folder ? row.folder.slice(share.folder.length).replace(/^\//, '') : row.folder,
    created_at: row.created_at,
  }));
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])); }
function rss(title, items, collectionUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(title)}</title><description>Shared bookmark collection</description><link>${escape(collectionUrl)}</link>${items.map((b) => `<item><title>${escape(b.title)}</title><link>${escape(b.url)}</link><guid isPermaLink="false">${digest(b.url + '\0' + b.folder)}</guid><description>${escape(b.tags.join(', '))}</description>${b.tags.map((tag) => `<category>${escape(tag)}</category>`).join('')}</item>`).join('')}</channel></rss>`;
}
module.exports = { fail, validUrl, tags, notes, rowView, collection, publicItems, digest, escape, rss };
