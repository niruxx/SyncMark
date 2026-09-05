// Minimal RFC 4180 CSV reader/writer for contacts — SyncMark's own flat
// schema (multiple phones/emails packed into one semicolon-separated cell,
// "type:value" per entry), with lenient header matching on import so a
// column named "Phone"/"Given Name"/"Company"/etc. (common in exports from
// other address books) is still picked up.

const HEADER = ['First Name', 'Last Name', 'Organization', 'Phones', 'Emails', 'Notes', 'Favorite'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function packEntries(entries) {
  return (entries || []).map((e) => `${e.type || 'other'}:${e.value}`).join('; ');
}

function toCsv(contacts) {
  const lines = [HEADER.map(csvEscape).join(',')];
  for (const contact of contacts) {
    const phones = packEntries(JSON.parse(contact.phones || '[]'));
    const emails = packEntries(JSON.parse(contact.emails || '[]'));
    lines.push(
      [
        contact.first_name || '',
        contact.last_name || '',
        contact.organization || '',
        phones,
        emails,
        contact.notes || '',
        contact.favorite ? 'Yes' : '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Character-by-character RFC 4180 parse (handles quoted fields containing
// commas/newlines/escaped "" quotes) — returns an array of raw string rows.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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

// "cell:555-1234; work:555-5678" -> [{type,value}]. Also tolerates entries
// with no "type:" prefix (plain "555-1234; 555-5678"), using defaultType.
function unpackEntries(raw, defaultType) {
  if (!raw) return [];
  return raw
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx === -1) return { type: defaultType, value: part };
      return { type: part.slice(0, idx).trim() || defaultType, value: part.slice(idx + 1).trim() };
    })
    .filter((e) => e.value);
}

function splitFullName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

const HEADER_ALIASES = {
  firstName: ['first name', 'given name'],
  lastName: ['last name', 'family name', 'surname'],
  fullName: ['name', 'full name'],
  organization: ['organization', 'organization name', 'company'],
  phones: ['phones', 'phone', 'phone 1 - value', 'mobile phone', 'primary phone'],
  emails: ['emails', 'email', 'e-mail 1 - value', 'email 1 - value', 'e-mail address'],
  notes: ['notes', 'note'],
  favorite: ['favorite', 'favourite', 'starred'],
};

function findColumn(headerRow, aliases) {
  const lower = headerRow.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

// Returns contact-fields objects shaped like vcard.js's parseVCard output
// ({fullName, firstName, lastName, organization, phones, emails, notes}) so
// the import route can treat both formats the same way.
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

    let firstName = get(row, 'firstName');
    let lastName = get(row, 'lastName');
    const fullNameCell = get(row, 'fullName');
    const fullName = fullNameCell || [firstName, lastName].filter(Boolean).join(' ');
    if (!fullName) continue;

    if (!firstName && !lastName && fullNameCell) {
      const split = splitFullName(fullNameCell);
      firstName = split.firstName;
      lastName = split.lastName;
    }

    const favoriteRaw = get(row, 'favorite').toLowerCase();
    results.push({
      fullName,
      firstName,
      lastName,
      organization: get(row, 'organization'),
      phones: unpackEntries(get(row, 'phones'), 'cell'),
      emails: unpackEntries(get(row, 'emails'), 'home'),
      notes: get(row, 'notes'),
      favorite: ['yes', 'true', '1', 'y'].includes(favoriteRaw),
    });
  }

  return results;
}

module.exports = { toCsv, parseCsv };
