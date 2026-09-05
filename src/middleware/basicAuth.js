const { statements } = require('../db');
const { verifyPassword } = require('../utils/password');

// CardDAV clients (iOS, DAVx5) authenticate with HTTP Basic Auth against the
// same account username/password used for the web UI — there's no session
// cookie in play here, so this is deliberately separate from ../middleware/auth.
function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  const decoded = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  const sepIndex = decoded.indexOf(':');

  if (sepIndex === -1) return unauthorized(res);

  const username = decoded.slice(0, sepIndex);
  const password = decoded.slice(sepIndex + 1);
  const user = statements.getUserByUsername.get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return unauthorized(res);
  }

  req.davUser = { id: user.id, username: user.username };
  next();
}

function unauthorized(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="SyncMark"');
  res.status(401).send('Unauthorized');
}

module.exports = { basicAuth };
