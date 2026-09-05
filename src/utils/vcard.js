// Minimal vCard 3.0 reader/writer — enough to interoperate with iOS Contacts
// and DAVx5 for the fields SyncMark actually models (name, org, phones,
// emails, notes, photo). Unknown properties (ADR, BDAY, IMPP, ...) on an
// incoming vCard are silently ignored rather than erroring.

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function unescapeText(value) {
  return String(value ?? '').replace(/\\(.)/g, (_, ch) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

// Splits on unescaped ';' or ',' — used for N/ORG components and TYPE lists.
function splitUnescaped(value, sep) {
  const out = [];
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      current += value[i] + value[i + 1];
      i += 1;
    } else if (value[i] === sep) {
      out.push(current);
      current = '';
    } else {
      current += value[i];
    }
  }
  out.push(current);
  return out;
}

// RFC 2426 line folding: continuation lines start with a single space.
// Folds by Unicode code point so multi-byte characters never get split.
function foldLine(line) {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  let out = chars.slice(0, 75).join('');
  let rest = chars.slice(75);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, 74).join('')}`;
    rest = rest.slice(74);
  }
  return out;
}

function mimeToVCardType(mime) {
  const subtype = String(mime || '').split('/')[1] || 'jpeg';
  return subtype.toUpperCase();
}

function vcardTypeToMime(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'png') return 'image/png';
  if (t === 'gif') return 'image/gif';
  if (t === 'webp') return 'image/webp';
  return 'image/jpeg';
}

// SQLite's datetime('now') → "YYYY-MM-DD HH:MM:SS" (UTC) → vCard REV format.
function toVCardTimestamp(sqliteDatetime) {
  if (!sqliteDatetime) return '';
  return `${sqliteDatetime.replace(' ', 'T').replace(/\.\d+$/, '')}Z`.replace(/[-:]/g, '');
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildVCard(contact) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${contact.uid}`];

  const fullName = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed';
  lines.push(`FN:${escapeText(fullName)}`);
  lines.push(`N:${escapeText(contact.last_name)};${escapeText(contact.first_name)};;;`);
  if (contact.organization) lines.push(`ORG:${escapeText(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${escapeText(contact.title)}`);

  for (const { type, value } of parseJsonArray(contact.phones)) {
    if (!value) continue;
    lines.push(`TEL;TYPE=${(type || 'cell').toUpperCase()}:${escapeText(value)}`);
  }
  for (const { type, value } of parseJsonArray(contact.emails)) {
    if (!value) continue;
    lines.push(`EMAIL;TYPE=${(type || 'home').toUpperCase()}:${escapeText(value)}`);
  }
  // Only the fields with a real vCard equivalent round-trip — messaging
  // handles, custom fields, relationships, and key dates other than a
  // "Birthday" entry are SyncMark-only (see README).
  for (const addr of parseJsonArray(contact.addresses)) {
    const parts = [addr.street, addr.city, addr.state, addr.postalCode, addr.country].map((p) => escapeText(p || ''));
    lines.push(`ADR;TYPE=${(addr.type || 'home').toUpperCase()}:;;${parts.join(';')}`);
  }
  for (const { type, value } of parseJsonArray(contact.social_profiles)) {
    if (!value) continue;
    lines.push(`X-SOCIALPROFILE;TYPE=${(type || 'other').toUpperCase()}:${escapeText(value)}`);
  }
  const birthday = parseJsonArray(contact.key_dates).find((d) => /birthday/i.test(d.label || ''));
  if (birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday.date)) lines.push(`BDAY:${birthday.date}`);
  const tags = parseJsonArray(contact.tags);
  if (tags.length) lines.push(`CATEGORIES:${tags.map(escapeText).join(',')}`);
  if (contact.notes) lines.push(`NOTE:${escapeText(contact.notes)}`);
  if (contact.photo && contact.photo_mime) {
    const base64 = Buffer.isBuffer(contact.photo) ? contact.photo.toString('base64') : Buffer.from(contact.photo).toString('base64');
    lines.push(`PHOTO;ENCODING=b;TYPE=${mimeToVCardType(contact.photo_mime)}:${base64}`);
  }
  if (contact.updated_at) lines.push(`REV:${toVCardTimestamp(contact.updated_at)}`);

  lines.push('END:VCARD');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

const PHONE_TYPE_PRIORITY = ['cell', 'mobile', 'iphone', 'home', 'work', 'main'];
const EMAIL_TYPE_PRIORITY = ['home', 'work'];

function pickType(paramTokens, priority) {
  const tokens = paramTokens.map((t) => t.toLowerCase()).filter((t) => t !== 'pref' && t !== 'voice');
  for (const candidate of priority) {
    if (tokens.includes(candidate)) return candidate;
  }
  return tokens[0] || 'other';
}

function parseVCard(text) {
  const unfolded = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/).filter((l) => l.trim());

  const result = { fullName: '', firstName: '', lastName: '', organization: '', phones: [], emails: [], notes: '', photo: null, photoMime: null };
  const noteParts = [];

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [rawName, ...paramSegments] = head.split(';');
    const name = rawName.split('.').pop().toUpperCase();

    const paramTokens = [];
    let encoding = null;
    let photoTypeParam = null;
    for (const seg of paramSegments) {
      const eqIdx = seg.indexOf('=');
      if (eqIdx === -1) {
        paramTokens.push(seg);
        continue;
      }
      const key = seg.slice(0, eqIdx).toUpperCase();
      const val = seg.slice(eqIdx + 1);
      if (key === 'ENCODING') encoding = val.toUpperCase();
      else if (key === 'TYPE') {
        const tokens = splitUnescaped(val, ',');
        paramTokens.push(...tokens);
        if (name === 'PHOTO') photoTypeParam = tokens[0];
      }
    }

    switch (name) {
      case 'FN':
        result.fullName = unescapeText(value);
        break;
      case 'N': {
        const parts = splitUnescaped(value, ';');
        result.lastName = unescapeText(parts[0] || '');
        result.firstName = unescapeText(parts[1] || '');
        break;
      }
      case 'ORG':
        result.organization = unescapeText(splitUnescaped(value, ';')[0] || '');
        break;
      case 'TEL':
        if (value.trim()) result.phones.push({ type: pickType(paramTokens, PHONE_TYPE_PRIORITY), value: unescapeText(value) });
        break;
      case 'EMAIL':
        if (value.trim()) result.emails.push({ type: pickType(paramTokens, EMAIL_TYPE_PRIORITY), value: unescapeText(value) });
        break;
      case 'NOTE':
        noteParts.push(unescapeText(value));
        break;
      case 'PHOTO':
        if (encoding === 'B' || encoding === 'BASE64') {
          result.photo = Buffer.from(value.replace(/\s+/g, ''), 'base64');
          result.photoMime = vcardTypeToMime(photoTypeParam);
        }
        break;
      default:
        break; // Unmodeled property (ADR, BDAY, IMPP, X-*, ...) — ignored.
    }
  }

  result.notes = noteParts.join('\n');
  return result;
}

// Splits a multi-contact .vcf export into individual vCard blocks (each
// still folded/escaped as-is) so each can go through parseVCard separately.
function splitVCards(text) {
  const matches = String(text || '').match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi);
  return matches || [];
}

module.exports = { buildVCard, parseVCard, splitVCards };
