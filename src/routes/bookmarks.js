const express = require('express');
const { statements, ensureFolderAncestors, SORT_CLAUSES } = require('../db');
const { normalizeFolderPath } = require('../utils/folderPath');
const { toNetscapeHtml, toGenericJson } = require('../utils/exportBookmarks');

const router = express.Router();

const isValidUrl = (url) => /^https?:\/\/.+/i.test(url);
const DEFAULT_SORT = 'title-asc';

router.get('/bookmarks', (req, res) => {
  const q = (req.query.q || '').trim();
  const folder = (req.query.folder || '').trim();
  const favorite = req.query.favorite === '1' ? 1 : 0;
  const sort = SORT_CLAUSES[req.query.sort] ? req.query.sort : DEFAULT_SORT;
  const params = { userId: req.user.id, q, qLike: `%${q}%`, folder, favorite };

  const rows = req.query.exact === '1'
    ? statements.listBookmarksExactFolderBySort[sort].all(params)
    : statements.listBookmarksBySort[sort].all({ ...params, folderPrefix: `${folder}/%` });

  res.json(rows);
});

router.get('/export', (req, res) => {
  const bookmarks = statements.listAllBookmarks.all(req.user.id);
  if (req.query.format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="syncmark-export.json"');
    res.type('application/json').send(toGenericJson(bookmarks));
  } else {
    res.setHeader('Content-Disposition', 'attachment; filename="syncmark-export.html"');
    res.type('text/html').send(toNetscapeHtml(bookmarks));
  }
});

router.post('/bookmarks', (req, res) => {
  const title = (req.body.title || '').trim();
  const url = (req.body.url || '').trim();
  const folder = normalizeFolderPath(req.body.folder);

  if (!title || !url) {
    return res.status(400).json({ error: 'Title and URL are required' });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  const result = statements.insertBookmark.run({ userId: req.user.id, title, url, folder });
  if (req.body.favorite) {
    statements.setFavorite.run({ id: result.lastInsertRowid, userId: req.user.id, favorite: 1 });
  }
  ensureFolderAncestors(req.user.id, folder);
  res.status(201).json(statements.getBookmark.get(result.lastInsertRowid, req.user.id));
});

router.get('/bookmarks/:id', (req, res) => {
  const row = statements.getBookmark.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Bookmark not found' });
  res.json(row);
});

router.put('/bookmarks/:id/favorite', (req, res) => {
  const existing = statements.getBookmark.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bookmark not found' });

  const favorite = req.body.favorite ? 1 : 0;
  statements.setFavorite.run({ id: req.params.id, userId: req.user.id, favorite });
  res.json(statements.getBookmark.get(req.params.id, req.user.id));
});

// Drag-and-drop reordering (used with sort=custom). beforeId/afterId are the
// bookmark's new neighbors; the new position is placed between them.
router.put('/bookmarks/:id/reorder', (req, res) => {
  const existing = statements.getBookmark.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bookmark not found' });

  const before = req.body.beforeId ? statements.getBookmark.get(req.body.beforeId, req.user.id) : null;
  const after = req.body.afterId ? statements.getBookmark.get(req.body.afterId, req.user.id) : null;

  let position;
  if (before && after) {
    position = (before.position + after.position) / 2;
  } else if (before) {
    position = before.position + 1;
  } else if (after) {
    position = after.position - 1;
  } else {
    position = 0;
  }

  statements.setPosition.run({ id: req.params.id, userId: req.user.id, position });
  res.json(statements.getBookmark.get(req.params.id, req.user.id));
});

router.put('/bookmarks/:id', (req, res) => {
  const existing = statements.getBookmark.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bookmark not found' });

  const title = (req.body.title ?? existing.title).trim();
  const url = (req.body.url ?? existing.url).trim();
  const folder = normalizeFolderPath(req.body.folder ?? existing.folder);
  const favorite = req.body.favorite !== undefined ? (req.body.favorite ? 1 : 0) : existing.favorite;

  if (!title || !url) {
    return res.status(400).json({ error: 'Title and URL are required' });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  statements.updateBookmark.run({ id: req.params.id, userId: req.user.id, title, url, folder, favorite });
  ensureFolderAncestors(req.user.id, folder);
  res.json(statements.getBookmark.get(req.params.id, req.user.id));
});

router.delete('/bookmarks/all', (req, res) => {
  statements.deleteAllBookmarks.run(req.user.id);
  res.status(204).end();
});

router.delete('/bookmarks/:id', (req, res) => {
  const existing = statements.getBookmark.get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bookmark not found' });

  statements.deleteBookmark.run(req.params.id, req.user.id);
  res.status(204).end();
});

module.exports = router;
