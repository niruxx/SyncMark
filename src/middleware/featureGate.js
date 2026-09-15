const { isFeatureEnabled } = require('../db');

// Gates a /dav sub-path (after basicAuth) — matches the plain, bodyless 403
// carddav.js/caldav.js already use for requireOwnUser, since DAV clients
// don't parse JSON error bodies anyway.
function requireFeatureDav(name) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) return res.status(403).end();
    next();
  };
}

// server.js mounts every feature's router at the same generic '/api' prefix,
// one after another. requireFeature (used as a plain preceding middleware,
// e.g. `app.use('/api', requireFeature('x'), xRouter)`) can't tell those
// apart: when its feature is off it 403s the request outright, which also
// swallows every *other* feature's router mounted after it in the stack —
// disabling Bookmarks silently broke Contacts, Calendar, Files, and
// Passwords too, since they're all mounted later. gateRouter fixes that by
// skipping straight past a disabled feature's router (next(), not a 403) so
// the request keeps falling through the stack to whichever router actually
// owns the path — the cost is a disabled feature's own endpoints now 404
// instead of returning a friendly "X is disabled" message, which is the
// right trade since the UI already steers people away from a disabled
// feature's pages before they'd ever hit its API directly.
function gateRouter(name, router) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) return next();
    router(req, res, next);
  };
}

module.exports = { requireFeatureDav, gateRouter };
