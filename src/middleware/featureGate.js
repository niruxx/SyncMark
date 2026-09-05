const { isFeatureEnabled } = require('../db');

const FEATURE_LABELS = { bookmarks: 'Bookmarks', contacts: 'Contacts', calendar: 'Calendar' };

// Gates /api routes — hidden behind requireAuth already, so a plain JSON 403
// matches the rest of the API's error shape.
function requireFeature(name) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) {
      return res.status(403).json({ error: `${FEATURE_LABELS[name] || name} is disabled on this server` });
    }
    next();
  };
}

// Gates a /dav sub-path (after basicAuth) — matches the plain, bodyless 403
// carddav.js/caldav.js already use for requireOwnUser, since DAV clients
// don't parse JSON error bodies anyway.
function requireFeatureDav(name) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) return res.status(403).end();
    next();
  };
}

module.exports = { requireFeature, requireFeatureDav };
