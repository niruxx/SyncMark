// CSV import/export for the Passwords tab. Chrome/Edge/Brave/Opera, Firefox,
// Safari, Bitwarden, LastPass, Proton Pass, and Dashlane all export a flat
// CSV — the column names differ per service, but lenient header-alias
// matching (same precedent as contactsCsv.js) covers all of them with one
// parser instead of a bespoke detector per service.
const { parseCsvRows } = require('./csv');

const HEADER = ['Site', 'URL', 'Username', 'Password', 'Notes', 'Favorite'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A leading UTF-8 BOM makes Excel auto-detect the encoding instead of
// mis-rendering accented site names — CSV itself carries no encoding signal.
const BOM = '﻿';

function toCsv(passwords) {
  const lines = [HEADER.map(csvEscape).join(',')];
  for (const p of passwords) {
    lines.push(
      [p.site_name || '', p.url || '', p.username || '', p.password || '', p.notes || '', p.favorite ? 'Yes' : '']
        .map(csvEscape)
        .join(',')
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

const HEADER_ALIASES = {
  name: ['name', 'title', 'account name', 'site'],
  url: ['url', 'login_uri', 'uri', 'website', 'web site', 'hostname'],
  username: ['username', 'login_username', 'user name', 'login name', 'login'],
  email: ['email'], // Proton Pass keeps email and username as separate columns
  password: ['password', 'login_password'],
  notes: ['notes', 'note', 'extra', 'comments'],
  favorite: ['favorite', 'favourite', 'fav', 'starred'],
  folder: ['folder', 'grouping', 'category', 'vault'], // "vault" — Proton Pass's term for the same idea
  type: ['type'], // Bitwarden mixes logins/notes/cards/identities in one export
  totp: ['totp', 'login_totp', 'otpauth', 'otp_secret', 'otpsecret'],
};

function findColumn(headerRow, aliases) {
  const lower = headerRow.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Returns {siteName, url, username, password, notes, favorite} objects ready
// for the /passwords/import route — mirrors contactsCsv.parseCsv's shape.
function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const col = {};
  for (const key of Object.keys(HEADER_ALIASES)) col[key] = findColumn(header, HEADER_ALIASES[key]);
  const get = (row, key) => (col[key] !== -1 ? (row[col[key]] || '').trim() : '');

  const results = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (row.every((cell) => !cell.trim())) continue;

    // Bitwarden's single export mixes item types — only "login" rows have a
    // username/password/uri worth importing here.
    const type = get(row, 'type').toLowerCase();
    if (type && type !== 'login') continue;

    const url = get(row, 'url');
    const email = get(row, 'email');
    // Proton Pass logins carry username and email as separate columns —
    // username wins as the primary login field (matching every other
    // service here), with a distinct email kept below rather than dropped.
    const usernameCol = get(row, 'username');
    const username = usernameCol || email;
    const password = get(row, 'password');
    const siteName = get(row, 'name') || hostnameFromUrl(url) || username || 'Untitled';
    if (!siteName && !username && !password) continue;

    const folder = get(row, 'folder');
    let notes = get(row, 'notes');
    const totp = get(row, 'totp');
    if (email && usernameCol && email !== usernameCol) notes = notes ? `${notes}\nEmail: ${email}` : `Email: ${email}`;
    if (folder) notes = notes ? `${notes}\nFolder: ${folder}` : `Folder: ${folder}`;
    if (totp) notes = notes ? `${notes}\nTOTP secret: ${totp}` : `TOTP secret: ${totp}`;

    const favoriteRaw = get(row, 'favorite').toLowerCase();
    results.push({
      siteName,
      url,
      username,
      password,
      notes,
      favorite: ['yes', 'true', '1', 'y'].includes(favoriteRaw),
    });
  }

  return results;
}

module.exports = { toCsv, parseCsv };
