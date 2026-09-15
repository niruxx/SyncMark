const express = require('express');
const { statements, listMergedFolders, getFeatureFlags, setFeatureFlags } = require('../db');

const router = express.Router();

router.get('/features', (req, res) => {
  res.json(getFeatureFlags());
});

// Never feature-gated (mounted before the per-feature route gates in
// server.js) — Settings shows every library's stats regardless of which
// tabs are currently enabled.
router.get('/stats', (req, res) => {
  const { count } = statements.countBookmarks.get();
  const { count: contactCount } = statements.countContacts.get();
  const { count: eventCount } = statements.countEvents.get();
  const { count: passwordCount } = statements.countPasswords.get();
  res.json({
    total: count,
    folderCount: listMergedFolders().length,
    contactTotal: contactCount,
    eventTotal: eventCount,
    passwordTotal: passwordCount,
  });
});

router.put('/features', (req, res) => {
  const current = getFeatureFlags();
  const next = {
    bookmarks: req.body.bookmarks !== undefined ? Boolean(req.body.bookmarks) : current.bookmarks,
    contacts: req.body.contacts !== undefined ? Boolean(req.body.contacts) : current.contacts,
    calendar: req.body.calendar !== undefined ? Boolean(req.body.calendar) : current.calendar,
    files: req.body.files !== undefined ? Boolean(req.body.files) : current.files,
    passwords: req.body.passwords !== undefined ? Boolean(req.body.passwords) : current.passwords,
  };

  if (!next.bookmarks && !next.contacts && !next.calendar && !next.files && !next.passwords) {
    return res.status(400).json({ error: 'At least one feature must stay enabled' });
  }

  setFeatureFlags(next);
  res.json(next);
});

module.exports = router;
