// AES-256-GCM at rest for the one genuinely secret column in the whole app
// (passwords.password_enc). The key itself lives in app_settings, generated
// on first use — same trust model SyncMark already applies everywhere else
// (session tokens and password hashes sit in the same SQLite file): whoever
// can read the DB file or is signed in as the one account it has can reach
// this data. That's a deliberate, self-hosted-single-admin scope, not an
// end-to-end/zero-knowledge vault — it stops a stray glance at the raw
// bookmarks.sqlite3 file from handing over plaintext passwords, nothing more.
const crypto = require('crypto');
const { statements } = require('../db');

const ALGORITHM = 'aes-256-gcm';
const SETTING_KEY = 'vault_encryption_key';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const row = statements.getSetting.get(SETTING_KEY);
  if (row) {
    cachedKey = Buffer.from(row.value, 'hex');
    return cachedKey;
  }

  const key = crypto.randomBytes(32);
  statements.setSetting.run({ key: SETTING_KEY, value: key.toString('hex') });
  cachedKey = key;
  return cachedKey;
}

// iv:authTag:ciphertext, each base64 — a plain colon-joined string rather
// than a JSON blob, since none of the parts can contain a colon.
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext ?? ''), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return ''; // key rotated/corrupted row — fail closed rather than throw
  }
}

module.exports = { encrypt, decrypt };
