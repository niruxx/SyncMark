const { db } = require('../db');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function folder(value) {
  if (typeof value !== 'string' || value.length > 500) fail(400, 'Folder must be text of at most 500 characters');
  const parts = value.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..' || /[\x00-\x1f\\]/.test(p))) fail(400, 'Invalid folder path');
  return parts.join('/');
}
function tags(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { fail(400, 'Invalid tags'); } }
  if (!Array.isArray(value) || value.length > 30 || value.some((v) => typeof v !== 'string' || v.length > 60)) fail(400, 'Use at most 30 text tags of 60 characters each');
  return [...new Set(value.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
function save(user, id, body, existing = {}) {
  const name = folder(body.folder ?? existing.folder ?? '');
  const labels = tags(body.tags ?? existing.tags ?? []);
  db.prepare('UPDATE passwords SET folder=?,tags=? WHERE id=? AND user_id=?').run(name, JSON.stringify(labels), id, user);
  let current = '';
  for (const part of name.split('/').filter(Boolean)) { current = current ? current + '/' + part : part; db.prepare('INSERT OR IGNORE INTO password_folders(user_id,name) VALUES (?,?)').run(user, current); }
}
function encryptedField(value, max = 100000) {
  if (typeof value !== 'string' || value.length > max) return false;
  const parts = value.split(':');
  return parts.length === 2 && /^[A-Za-z0-9+/]+={0,2}$/.test(parts[0]) && /^[A-Za-z0-9+/]+={0,2}$/.test(parts[1]) && Buffer.from(parts[0], 'base64').length === 12 && Buffer.from(parts[1], 'base64').length >= 16;
}
module.exports = { fail, folder, tags, save, encryptedField };
