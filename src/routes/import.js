const express = require('express');
const multer = require('multer');
const { insertManyBookmarks } = require('../db');
const { parseNetscapeHtml } = require('../parsers/netscapeHtml');
const { parseHtmlListFormat } = require('../parsers/htmlListFormat');
const { parseJsonBookmarks } = require('../parsers/json');
const { parseCsvBookmarks, looksLikeCsv } = require('../parsers/csvBookmarks');
const { parseOneTab, looksLikeOneTab } = require('../parsers/oneTab');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();

// Format is sniffed from content, not the filename or an explicit selector —
// every supported export (browser HTML, Chrome/Firefox JSON, Linkwarden,
// Karakeep, Tab Session Manager, OneTab JSON, Omnivore, Pocket, Instapaper,
// Readwise Reader, Matter, mymind CSV, OneTab plain text) has a distinct
// enough shape that this can pick the right parser without asking the user
// which service it came from.
function detectAndParse(text) {
  try {
    return parseJsonBookmarks(JSON.parse(text));
  } catch {
    // Not JSON — fall through to the other formats below.
  }

  if (looksLikeOneTab(text)) return parseOneTab(text);
  if (looksLikeCsv(text)) return parseCsvBookmarks(text);

  // Netscape Bookmark File Format (browsers, Linkwarden's HTML export) uses
  // <dl>/<dt>; Pocket's ril_export.html and Instapaper's HTML export use a
  // <h1> + <ul>/<li> shape instead — try the former first, fall back to the
  // latter only if it found nothing.
  const netscape = parseNetscapeHtml(text);
  return netscape.length > 0 ? netscape : parseHtmlListFormat(text);
}

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected form field "file")' });
  }

  const text = req.file.buffer.toString('utf8');
  const bookmarks = detectAndParse(text);
  const valid = bookmarks.filter((b) => b.url && /^https?:\/\//i.test(b.url));

  if (valid.length === 0) {
    return res.status(422).json({ error: 'No bookmarks found in the uploaded file' });
  }

  const imported = insertManyBookmarks(valid);
  res.json({ imported });
});

module.exports = router;
