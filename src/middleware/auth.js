const { statements } = require('../db');
const { parseCookies } = require('../utils/cookies');

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.session) return null;
  return statements.getValidSession.get({ token: cookies.session, now: new Date().toISOString() }) || null;
}

// Also rejects a session whose account was disabled *after* the session was
// issued — without this, disabling a user from the Admin Portal wouldn't
// take effect until their session happened to expire on its own.
function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const user = statements.getUserById.get(session.user_id);
  if (!user || !user.enabled) return res.status(401).json({ error: 'Not authenticated' });

  req.session = session;
  req.user = user;
  next();
}

// Mounted after requireAuth in front of an admin-only router. Skips straight
// past the router (next(), not a 403) for a non-admin request rather than
// blocking outright — server.js mounts every router at the same generic
// '/api' prefix one after another, and a plain blocking middleware here would
// also swallow every *other* router mounted after this one in the stack for
// any non-admin request, exactly the cross-feature bug gateRouter (see
// featureGate.js) already fixed once for feature toggles. The cost is the
// same as that fix's: a non-admin hitting an admin-only endpoint directly
// gets a plain 404 instead of a friendly "admin access required" message,
// which is fine since the UI never links a non-admin there in the first place.
function gateAdmin(router) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') return next();
    router(req, res, next);
  };
}

module.exports = { requireAuth, gateAdmin, getSession };
