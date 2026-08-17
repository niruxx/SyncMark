const { statements } = require('../db');
const { parseCookies } = require('../utils/cookies');

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.session) return null;
  return statements.getValidSession.get({ token: cookies.session, now: new Date().toISOString() }) || null;
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.session = session;
  next();
}

module.exports = { requireAuth, getSession };
