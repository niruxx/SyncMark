// Minimal iCalendar (RFC 5545) reader/writer for a single VEVENT per resource
// — enough to interoperate with iOS Calendar and DAVx5 for the fields
// SyncMark actually models (title, description, location, start/end, all-day,
// basic RRULE). Unknown properties (VALARM, ATTENDEE, X-*, ...) on an
// incoming event are silently ignored rather than erroring, same precedent
// as ../utils/vcard.js.

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

// RFC 5545 line folding — identical rule to vCard's (75 octets, single-space
// continuation), folded by Unicode code point so multi-byte chars never split.
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

// contact.updated_at-style "YYYY-MM-DD HH:MM:SS" (UTC, from SQLite's
// datetime('now')) → "YYYYMMDDTHHMMSSZ".
function toICalTimestamp(sqliteDatetime) {
  if (!sqliteDatetime) return '';
  return `${sqliteDatetime.replace(' ', 'T').replace(/\.\d+$/, '')}Z`.replace(/[-:]/g, '');
}

// A stored start_at/end_at is always a full ISO datetime (UTC); an all-day
// event's stored value is that date's UTC midnight, and only the date part
// is emitted (DTSTART;VALUE=DATE), which is what makes it timezone-safe
// without a VTIMEZONE component.
function isoToICalDate(iso) {
  return iso.slice(0, 10).replace(/-/g, '');
}
function isoToICalDateTime(iso) {
  return `${new Date(iso).toISOString().replace(/\.\d+Z$/, 'Z')}`.replace(/[-:]/g, '');
}

function buildICS(event) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SyncMark//Calendar//EN', 'BEGIN:VEVENT'];
  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${toICalTimestamp(event.updated_at || event.created_at)}`);

  if (event.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${isoToICalDate(event.start_at)}`);
    lines.push(`DTEND;VALUE=DATE:${isoToICalDate(event.end_at)}`);
  } else {
    lines.push(`DTSTART:${isoToICalDateTime(event.start_at)}`);
    lines.push(`DTEND:${isoToICalDateTime(event.end_at)}`);
  }

  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.recurrence) lines.push(`RRULE:${event.recurrence}`);
  lines.push(`SEQUENCE:${event.seq || 0}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// DTSTART/DTEND value → ISO UTC string + whether it was a bare DATE (all-day).
function parseDateTimeValue(value, params) {
  const isDate = params.some((p) => /^VALUE=DATE$/i.test(p)) || /^\d{8}$/.test(value);
  if (isDate) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return { iso: `${y}-${m}-${d}T00:00:00.000Z`, allDay: true };
  }
  // "YYYYMMDDTHHMMSS[Z]" — treat a floating (no Z, no TZID handling) time as
  // UTC too; full timezone-database support is out of scope for v1.
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(value);
  if (!m) return { iso: new Date().toISOString(), allDay: false };
  const [, y, mo, d, h, mi, s] = m;
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`, allDay: false };
}

function parseICS(text) {
  const unfolded = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/).filter((l) => l.trim());

  const result = { title: '', description: '', location: '', startAt: null, endAt: null, allDay: false, recurrence: null };
  let inEvent = false;

  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      inEvent = true;
      continue;
    }
    if (/^END:VEVENT$/i.test(line)) break; // Only the first VEVENT in the file is used.
    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [rawName, ...paramSegments] = head.split(';');
    const name = rawName.toUpperCase();

    switch (name) {
      case 'SUMMARY':
        result.title = unescapeText(value);
        break;
      case 'DESCRIPTION':
        result.description = unescapeText(value);
        break;
      case 'LOCATION':
        result.location = unescapeText(value);
        break;
      case 'DTSTART': {
        const { iso, allDay } = parseDateTimeValue(value, paramSegments);
        result.startAt = iso;
        result.allDay = allDay;
        break;
      }
      case 'DTEND': {
        const { iso } = parseDateTimeValue(value, paramSegments);
        result.endAt = iso;
        break;
      }
      case 'RRULE':
        result.recurrence = value;
        break;
      default:
        break; // Unmodeled property (VALARM lines, ATTENDEE, X-*, ...) — ignored.
    }
  }

  if (!result.endAt) result.endAt = result.startAt;
  return result;
}

// Splits a multi-event .ics file into individual VCALENDAR-less VEVENT blocks
// (each re-wrapped so parseICS's "first VEVENT" logic works per block) for
// the calendar import feature.
function splitVEvents(text) {
  const matches = String(text || '').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi);
  return matches || [];
}

module.exports = { buildICS, parseICS, splitVEvents };
