const express = require('express');
const multer = require('multer');
const { insertManyBookmarks } = require('../db');
const { parseNetscapeHtml } = require('../parsers/netscapeHtml');
const { parseJsonBookmarks } = require('../parsers/json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });
  }

  const text = req.file.buffer.toString('utf8');
  let bookmarks;

  try {
    const json = JSON.parse(text);
    bookmarks = parseJsonBookmarks(json);
  } catch {
    bookmarks = parseNetscapeHtml(text);
  }

  const valid = bookmarks.filter((b) => b.url && /^https?:\/\//i.test(b.url));

  if (valid.length === 0) {
    return res.status(422).json({ error: 'No bookmarks found in the uploaded file' });
  }

  const imported = insertManyBookmarks(valid);
  res.json({ imported });
});

module.exports = router;
