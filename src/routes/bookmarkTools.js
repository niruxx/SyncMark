const express = require('express');
const { db, statements } = require('../db');
const lib = require('../utils/bookmarkLibrary');
const { fetchPage, extractText } = require('../utils/bookmarkFetch');
const router = express.Router();
const pending = new Set();
const run = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function owned(req) { const row = statements.getBookmark.get(req.params.id, req.user.id); if (!row) lib.fail(404, 'Bookmark not found'); return row; }
function canonical(url) { try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; } }
router.get('/bookmarks/tags', (req, res) => res.json([...new Set(statements.listAllBookmarks.all(req.user.id).flatMap((row) => lib.tags(row.tags)))].sort()));
router.get('/bookmarks/dashboard', (req, res) => {
  const rows = statements.listAllBookmarks.all(req.user.id);
  res.json({ total: rows.length, visits: rows.reduce((n, r) => n + r.visit_count, 0),
    recent: rows.filter((r) => r.last_visited_at).sort((a, b) => b.last_visited_at.localeCompare(a.last_visited_at)).slice(0, 5).map(lib.rowView),
    frequent: rows.filter((r) => r.visit_count).sort((a, b) => b.visit_count - a.visit_count || a.id - b.id).slice(0, 5).map(lib.rowView) });
});
router.get('/bookmarks/duplicates', (req, res) => {
  const groups = new Map();
  for (const row of statements.listAllBookmarks.all(req.user.id)) { const key = canonical(row.url); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(lib.rowView(row)); }
  res.json([...groups.entries()].filter(([, items]) => items.length > 1).map(([url, items]) => ({ url, items })));
});
router.post('/bookmarks/duplicates/merge', require('./bookmarkSync').guard, (req, res, next) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100 || ids.some((id) => !Number.isSafeInteger(id)) || !ids.includes(req.body.keepId)) lib.fail(400, 'Select 2–100 bookmark IDs and a keeper');
    db.transaction(() => {
      const rows = [...new Set(ids)].map((id) => statements.getBookmark.get(id, req.user.id));
      if (rows.some((r) => !r)) lib.fail(404, 'Bookmark not found');
      if (new Set(rows.map((r) => canonical(r.url))).size !== 1) lib.fail(400, 'Only duplicate URLs can be merged');
      const keep = rows.find((r) => r.id === req.body.keepId);
      const tags = [...new Set(rows.flatMap((r) => lib.tags(r.tags)))];
      const notes = [...new Set(rows.map((r) => r.notes).filter(Boolean))].join('\n\n');
      if (tags.length > 30 || notes.length > 20000) lib.fail(400, 'Combined metadata exceeds limits; edit the bookmarks before merging');
      const archive = rows.find((r) => r.archive_text);
      db.prepare('UPDATE bookmarks SET tags=?, notes=?, favorite=?, visit_count=?, last_visited_at=?, archive_text=?, archived_at=? WHERE id=? AND user_id=?').run(JSON.stringify(tags), notes, Math.max(...rows.map((r) => r.favorite)), rows.reduce((n, r) => n + r.visit_count, 0), rows.map((r) => r.last_visited_at).filter(Boolean).sort().at(-1) || null, keep.archive_text || archive?.archive_text || '', keep.archived_at || archive?.archived_at || null, keep.id, req.user.id);
      for (const row of rows) if (row.id !== keep.id) statements.deleteBookmark.run(row.id, req.user.id);
    })();
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.post('/bookmarks/:id/visit', (req, res, next) => {
  try { owned(req); db.prepare("UPDATE bookmarks SET visit_count=visit_count+1, last_visited_at=? WHERE id=? AND user_id=?").run(new Date().toISOString(), req.params.id, req.user.id); res.status(204).end(); } catch (err) { next(err); }
});
for (const action of ['check', 'archive']) router.post(`/bookmarks/:id/${action}`, run(async (req, res) => {
  const row = owned(req);
  if (pending.has(req.user.id)) lib.fail(429, 'A page request is already running; retry shortly');
  pending.add(req.user.id);
  try {
    if (action === 'check') {
      let result, status;
      try {
        result = await fetchPage(row.url, { method: 'HEAD' });
        if ([405, 501].includes(result.status)) result = await fetchPage(row.url);
        status = result.status < 400 ? 'ok' : [404, 410].includes(result.status) ? 'broken' : `http:${result.status}`;
      } catch (err) { status = err.status === 403 ? 'blocked' : 'unreachable'; }
      const updated = db.prepare('UPDATE bookmarks SET check_status=?, checked_at=? WHERE id=? AND user_id=? AND url=?').run(status, new Date().toISOString(), row.id, req.user.id, row.url);
      if (!updated.changes) lib.fail(409, 'Bookmark changed during the request');
      res.json({ status, httpStatus: result?.status || null });
    } else {
      const response = await fetchPage(row.url);
      if (response.status >= 400) lib.fail(422, `Page returned HTTP ${response.status}; previous capture was kept`);
      const text = extractText(response);
      if (!text) lib.fail(422, 'No readable content found; previous capture was kept');
      const result = db.prepare('UPDATE bookmarks SET archive_text=?, archived_at=? WHERE id=? AND user_id=? AND url=?').run(text, new Date().toISOString(), row.id, req.user.id, row.url);
      if (!result.changes) lib.fail(409, 'Bookmark changed during capture');
      res.json({ captured: true, characters: text.length });
    }
  } finally { pending.delete(req.user.id); }
}));
router.get('/bookmarks/:id/archive', (req, res, next) => {
  try { const row = owned(req); if (!row.archived_at) lib.fail(404, 'No captured page'); res.set({ 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).type('text/plain').send(row.archive_text); } catch (err) { next(err); }
});
router.delete('/bookmarks/:id/archive', (req, res, next) => {
  try { owned(req); db.prepare("UPDATE bookmarks SET archive_text='', archived_at=NULL WHERE id=? AND user_id=?").run(req.params.id, req.user.id); res.status(204).end(); } catch (err) { next(err); }
});
module.exports = router;
