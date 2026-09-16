// Browser port of src/utils/passwordsCsv.js + src/utils/csv.js — CSV import
// now happens client-side (the server never sees plaintext passwords), so
// this is pure string logic with no crypto in it, duplicated here rather
// than shared via a build step. Keep the two copies in sync if the column
// mapping ever changes.
(function (global) {
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text || '')
      .replace(/^﻿/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }

  const HEADER = ['Site', 'URL', 'Username', 'Password', 'Notes', 'Favorite'];
  const BOM = '﻿';

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(passwords) {
    const lines = [HEADER.map(csvEscape).join(',')];
    for (const p of passwords) {
      lines.push(
        [p.siteName || '', p.url || '', p.username || '', p.password || '', p.notes || '', p.favorite ? 'Yes' : '']
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
    email: ['email'],
    password: ['password', 'login_password'],
    notes: ['notes', 'note', 'extra', 'comments'],
    favorite: ['favorite', 'favourite', 'fav', 'starred'],
    folder: ['folder', 'grouping', 'category', 'vault'],
    type: ['type'],
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

      const type = get(row, 'type').toLowerCase();
      if (type && type !== 'login') continue;

      const url = get(row, 'url');
      const email = get(row, 'email');
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

  global.PasswordsCsv = { toCsv, parseCsv };
})(typeof window !== 'undefined' ? window : globalThis);
