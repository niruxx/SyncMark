// Bootstraps the master admin account from data/admin.json, if present.
// Deliberately create-once, never an ongoing sync: once an admin with the
// configured username exists, this never touches its password again, so a
// password changed later through the app isn't silently reverted by a
// stale config file still sitting in data/.
const fs = require('fs');
const path = require('path');
const { statements } = require('./db');
const { hashPassword } = require('./utils/password');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'admin.json');

function ensureAdminFromConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`data/admin.json is not valid JSON — ignoring it (${err.message})`);
    return;
  }

  const username = String(config.username || '').trim();
  const password = String(config.password || '');
  if (!username) {
    console.error('data/admin.json is missing "username" — ignoring it.');
    return;
  }
  if (password.length < 8) {
    console.error('data/admin.json\'s "password" must be at least 8 characters — ignoring it.');
    return;
  }

  const existing = statements.getUserByUsername.get(username);
  if (existing) {
    if (existing.role !== 'admin') {
      console.error(
        `data/admin.json wants "${username}" to be the admin account, but a non-admin account with that ` +
          'username already exists — leaving it alone. Pick a different username in data/admin.json, or ' +
          'rename the existing account first.'
      );
    }
    // Admin already provisioned (or the name collision above) — never overwrite a live password.
    return;
  }

  statements.insertUser.run({ username, passwordHash: hashPassword(password), role: 'admin' });
  console.log(`Created admin account "${username}" from data/admin.json`);
}

module.exports = { ensureAdminFromConfig };
