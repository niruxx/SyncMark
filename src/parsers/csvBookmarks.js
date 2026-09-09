const { parseCsvRows } = require('../utils/csv');

// Lenient header matching (same approach as contactsCsv.js) so exports from
// several read-it-later services line up onto one parser without needing to
// know which service produced the file:
//  - Instapaper / Readwise Reader: URL, Title, Selection, Folder, Timestamp
//  - Pocket (new CSV export): title, url, time_added, tags, status
//  - Matter, mymind ("cards.csv"), and similar: title/url + a tag-ish column
const ALIASES = {
  url: ['url', 'link', 'href'],
  title: ['title', 'name'],
  folder: ['folder', 'category', 'location', 'status', 'tags', 'labels'],
};

function findColumn(headerRow, aliases) {
  const lower = headerRow.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function looksLikeCsv(text) {
  const firstLine = String(text || '').split(/\r\n|\n/, 1)[0] || '';
  const header = parseCsvRows(firstLine)[0] || [];
  return findColumn(header, ALIASES.url) !== -1;
}

function parseCsvBookmarks(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];

  const header = rows[0];
  const col = {};
  for (const key of Object.keys(ALIASES)) col[key] = findColumn(header, ALIASES[key]);
  if (col.url === -1) return [];

  const get = (row, key) => (col[key] !== -1 ? (row[col[key]] || '').trim() : '');

  const bookmarks = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const url = get(row, 'url');
    if (!url) continue;
    // A tags/labels cell can hold several comma-or-semicolon-separated
    // values — only the first is usable as a single folder path.
    const folder = get(row, 'folder').split(/[,;]/)[0].trim();
    bookmarks.push({ title: get(row, 'title') || url, url, folder });
  }
  return bookmarks;
}

module.exports = { parseCsvBookmarks, looksLikeCsv };
