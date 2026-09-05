const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'bookmarks.sqlite3'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar BLOB,
    avatar_mime TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    phones TEXT NOT NULL DEFAULT '[]',
    emails TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    photo BLOB,
    photo_mime TEXT,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_seq ON contacts(seq);

  CREATE TABLE IF NOT EXISTS contacts_tombstones (
    uid TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_tombstones_seq ON contacts_tombstones(seq);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
  CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);

  CREATE TABLE IF NOT EXISTS events_tombstones (
    uid TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_tombstones_seq ON events_tombstones(seq);
`);

// Migrations for databases created before these columns existed.
const existingColumns = db.prepare('PRAGMA table_info(bookmarks)').all();
if (!existingColumns.some((col) => col.name === 'favorite')) {
  db.exec('ALTER TABLE bookmarks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
}
if (!existingColumns.some((col) => col.name === 'position')) {
  db.exec('ALTER TABLE bookmarks ADD COLUMN position REAL NOT NULL DEFAULT 0');
}
const existingFolderColumns = db.prepare('PRAGMA table_info(folders)').all();
if (!existingFolderColumns.some((col) => col.name === 'position')) {
  db.exec('ALTER TABLE folders ADD COLUMN position REAL NOT NULL DEFAULT 0');
}
const existingUserColumns = db.prepare('PRAGMA table_info(users)').all();
if (!existingUserColumns.some((col) => col.name === 'avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar BLOB');
}
if (!existingUserColumns.some((col) => col.name === 'avatar_mime')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
}

const SORT_CLAUSES = {
  'title-asc': 'title COLLATE NOCASE ASC',
  'title-desc': 'title COLLATE NOCASE DESC',
  'created-desc': 'created_at DESC, id DESC',
  'created-asc': 'created_at ASC, id ASC',
  custom: 'position ASC, id ASC',
};

// @folder = '' matches every folder; otherwise matches the folder itself and any subfolder ("Work/%").
// @favorite = 0 matches everything; @favorite = 1 restricts to favorited bookmarks.
const listBookmarksBySort = {};
const listBookmarksExactFolderBySort = {};
for (const [key, clause] of Object.entries(SORT_CLAUSES)) {
  listBookmarksBySort[key] = db.prepare(`
    SELECT * FROM bookmarks
    WHERE (@q = '' OR title LIKE @qLike OR url LIKE @qLike)
      AND (@folder = '' OR folder = @folder OR folder LIKE @folderPrefix)
      AND (@favorite = 0 OR favorite = 1)
    ORDER BY ${clause}
  `);
  listBookmarksExactFolderBySort[key] = db.prepare(`
    SELECT * FROM bookmarks
    WHERE (@q = '' OR title LIKE @qLike OR url LIKE @qLike)
      AND folder = @folder
      AND (@favorite = 0 OR favorite = 1)
    ORDER BY ${clause}
  `);
}

const CONTACT_SORT_CLAUSES = {
  'name-asc': 'full_name COLLATE NOCASE ASC',
  'name-desc': 'full_name COLLATE NOCASE DESC',
  'created-desc': 'created_at DESC, id DESC',
  'created-asc': 'created_at ASC, id ASC',
};

const listContactsBySort = {};
for (const [key, clause] of Object.entries(CONTACT_SORT_CLAUSES)) {
  listContactsBySort[key] = db.prepare(`
    SELECT id, uid, full_name, first_name, last_name, organization, phones, emails, notes, favorite,
           (photo IS NOT NULL) AS has_photo, seq, created_at, updated_at
    FROM contacts
    WHERE (@q = '' OR full_name LIKE @qLike OR organization LIKE @qLike OR phones LIKE @qLike OR emails LIKE @qLike)
      AND (@favorite = 0 OR favorite = 1)
    ORDER BY ${clause}
  `);
}

const statements = {
  // New bookmarks are appended after the current highest custom-order position.
  insertBookmark: db.prepare(
    `INSERT INTO bookmarks (title, url, folder, position)
     VALUES (@title, @url, @folder, COALESCE((SELECT MAX(position) FROM bookmarks), 0) + 1)`
  ),
  listBookmarksBySort,
  listBookmarksExactFolderBySort,
  listAllBookmarks: db.prepare(
    `SELECT * FROM bookmarks ORDER BY folder ASC, title COLLATE NOCASE ASC`
  ),
  getBookmark: db.prepare('SELECT * FROM bookmarks WHERE id = ?'),
  updateBookmark: db.prepare(
    `UPDATE bookmarks SET title = @title, url = @url, folder = @folder, favorite = @favorite, updated_at = datetime('now')
     WHERE id = @id`
  ),
  setFavorite: db.prepare(
    `UPDATE bookmarks SET favorite = @favorite, updated_at = datetime('now') WHERE id = @id`
  ),
  setPosition: db.prepare(
    `UPDATE bookmarks SET position = @position, updated_at = datetime('now') WHERE id = @id`
  ),
  deleteBookmark: db.prepare('DELETE FROM bookmarks WHERE id = ?'),
  deleteAllBookmarks: db.prepare('DELETE FROM bookmarks'),
  countBookmarks: db.prepare('SELECT COUNT(*) as count FROM bookmarks'),
  listFolders: db.prepare(
    `SELECT folder, COUNT(*) as count FROM bookmarks
     WHERE folder != ''
     GROUP BY folder ORDER BY folder ASC`
  ),

  // New folders are appended after the current highest sidebar position.
  insertFolder: db.prepare(
    `INSERT OR IGNORE INTO folders (name, position)
     VALUES (@name, COALESCE((SELECT MAX(position) FROM folders), 0) + 1)`
  ),
  listFolderNames: db.prepare('SELECT name, position FROM folders ORDER BY name ASC'),
  getFolderByName: db.prepare('SELECT * FROM folders WHERE name = ?'),
  setFolderPosition: db.prepare('UPDATE folders SET position = @position WHERE name = @name'),

  deleteFolderExact: db.prepare('DELETE FROM folders WHERE name = @name'),
  deleteFolderDescendants: db.prepare('DELETE FROM folders WHERE name LIKE @prefix'),
  unassignBookmarksExact: db.prepare(
    `UPDATE bookmarks SET folder = '', updated_at = datetime('now') WHERE folder = @name`
  ),
  unassignBookmarksDescendants: db.prepare(
    `UPDATE bookmarks SET folder = '', updated_at = datetime('now') WHERE folder LIKE @prefix`
  ),

  renameFolderExact: db.prepare('UPDATE folders SET name = @newName WHERE name = @oldName'),
  renameFolderDescendants: db.prepare(
    `UPDATE folders SET name = @newName || substr(name, @oldLen + 1) WHERE name LIKE @prefix`
  ),
  renameBookmarksExact: db.prepare(
    `UPDATE bookmarks SET folder = @newName, updated_at = datetime('now') WHERE folder = @oldName`
  ),
  renameBookmarksDescendants: db.prepare(
    `UPDATE bookmarks SET folder = @newName || substr(folder, @oldLen + 1), updated_at = datetime('now')
     WHERE folder LIKE @prefix`
  ),

  countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
  // Columns are listed explicitly so the avatar BLOB isn't loaded on every
  // authenticated request — it's fetched only by getAvatar, on demand.
  getUserByUsername: db.prepare(
    `SELECT id, username, password_hash, created_at, (avatar IS NOT NULL) AS has_avatar
     FROM users WHERE username = ?`
  ),
  getUserById: db.prepare(
    `SELECT id, username, password_hash, created_at, (avatar IS NOT NULL) AS has_avatar
     FROM users WHERE id = ?`
  ),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash) VALUES (@username, @passwordHash)'
  ),
  updateUser: db.prepare(
    'UPDATE users SET username = @username, password_hash = @passwordHash WHERE id = @id'
  ),
  getAvatar: db.prepare('SELECT avatar, avatar_mime FROM users WHERE id = ?'),
  setAvatar: db.prepare(
    'UPDATE users SET avatar = @avatar, avatar_mime = @mime WHERE id = @id'
  ),
  clearAvatar: db.prepare('UPDATE users SET avatar = NULL, avatar_mime = NULL WHERE id = @id'),

  insertSession: db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (@token, @userId, @expiresAt)'
  ),
  getValidSession: db.prepare(
    `SELECT * FROM sessions WHERE token = @token AND (expires_at IS NULL OR expires_at > @now)`
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare(
    `DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= @now`
  ),

  getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
  setSetting: db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ),

  // Columns are listed explicitly so the photo BLOB isn't loaded for every
  // row in a list — it's fetched only by getContactPhoto, on demand.
  insertContact: db.prepare(
    `INSERT INTO contacts (uid, full_name, first_name, last_name, organization, phones, emails, notes, favorite, seq)
     VALUES (@uid, @fullName, @firstName, @lastName, @organization, @phones, @emails, @notes, @favorite, @seq)`
  ),
  getContact: db.prepare(
    `SELECT id, uid, full_name, first_name, last_name, organization, phones, emails, notes, favorite,
            (photo IS NOT NULL) AS has_photo, seq, created_at, updated_at
     FROM contacts WHERE id = ?`
  ),
  getContactByUidId: db.prepare('SELECT id, favorite FROM contacts WHERE uid = ?'),
  getContactFullByUid: db.prepare('SELECT * FROM contacts WHERE uid = ?'),
  getContactFullById: db.prepare('SELECT * FROM contacts WHERE id = ?'),
  listContactsBySort,
  listContactsMeta: db.prepare('SELECT uid, seq FROM contacts ORDER BY id ASC'),
  listContactsMetaSince: db.prepare('SELECT uid, seq FROM contacts WHERE seq > @seq ORDER BY seq ASC'),
  listTombstonesSince: db.prepare('SELECT uid, seq FROM contacts_tombstones WHERE seq > @seq ORDER BY seq ASC'),
  updateContact: db.prepare(
    `UPDATE contacts SET full_name = @fullName, first_name = @firstName, last_name = @lastName,
       organization = @organization, phones = @phones, emails = @emails, notes = @notes,
       favorite = @favorite, seq = @seq, updated_at = datetime('now')
     WHERE id = @id`
  ),
  setContactFavorite: db.prepare(
    `UPDATE contacts SET favorite = @favorite, seq = @seq, updated_at = datetime('now') WHERE id = @id`
  ),
  deleteContactRow: db.prepare('DELETE FROM contacts WHERE id = ?'),
  deleteAllContacts: db.prepare('DELETE FROM contacts'),
  countContacts: db.prepare('SELECT COUNT(*) as count FROM contacts'),
  getContactPhoto: db.prepare('SELECT photo, photo_mime FROM contacts WHERE id = ?'),
  setContactPhoto: db.prepare(
    `UPDATE contacts SET photo = @photo, photo_mime = @mime, seq = @seq, updated_at = datetime('now') WHERE id = @id`
  ),
  clearContactPhoto: db.prepare(
    `UPDATE contacts SET photo = NULL, photo_mime = NULL, seq = @seq, updated_at = datetime('now') WHERE id = @id`
  ),
  insertTombstone: db.prepare(
    `INSERT INTO contacts_tombstones (uid, seq) VALUES (@uid, @seq)
     ON CONFLICT(uid) DO UPDATE SET seq = @seq, deleted_at = datetime('now')`
  ),

  insertEvent: db.prepare(
    `INSERT INTO events (uid, title, description, location, start_at, end_at, all_day, recurrence, seq)
     VALUES (@uid, @title, @description, @location, @startAt, @endAt, @allDay, @recurrence, @seq)`
  ),
  getEvent: db.prepare('SELECT * FROM events WHERE id = ?'),
  getEventByUidId: db.prepare('SELECT id FROM events WHERE uid = ?'),
  getEventFullByUid: db.prepare('SELECT * FROM events WHERE uid = ?'),
  listEvents: db.prepare(
    `SELECT * FROM events
     WHERE (@q = '' OR title LIKE @qLike OR location LIKE @qLike OR description LIKE @qLike)
     ORDER BY start_at ASC`
  ),
  listEventsMeta: db.prepare('SELECT uid, seq FROM events ORDER BY id ASC'),
  listEventsMetaSince: db.prepare('SELECT uid, seq FROM events WHERE seq > @seq ORDER BY seq ASC'),
  listEventTombstonesSince: db.prepare('SELECT uid, seq FROM events_tombstones WHERE seq > @seq ORDER BY seq ASC'),
  updateEvent: db.prepare(
    `UPDATE events SET title = @title, description = @description, location = @location,
       start_at = @startAt, end_at = @endAt, all_day = @allDay, recurrence = @recurrence,
       seq = @seq, updated_at = datetime('now')
     WHERE id = @id`
  ),
  deleteEventRow: db.prepare('DELETE FROM events WHERE id = ?'),
  deleteAllEvents: db.prepare('DELETE FROM events'),
  countEvents: db.prepare('SELECT COUNT(*) as count FROM events'),
  insertEventTombstone: db.prepare(
    `INSERT INTO events_tombstones (uid, seq) VALUES (@uid, @seq)
     ON CONFLICT(uid) DO UPDATE SET seq = @seq, deleted_at = datetime('now')`
  ),
};

// Ensures every path segment leading up to (and including) a folder has its own
// row in `folders` — e.g. "Work/Projects/Alpha" also gets "Work" and "Work/Projects" —
// so every node visible in the sidebar tree has a place to store a custom position.
function ensureFolderAncestors(folderPath) {
  if (!folderPath) return;
  let path = '';
  for (const segment of folderPath.split('/')) {
    path = path ? `${path}/${segment}` : segment;
    statements.insertFolder.run({ name: path });
  }
}

const insertManyBookmarks = db.transaction((bookmarks) => {
  for (const bookmark of bookmarks) {
    const folder = bookmark.folder || '';
    statements.insertBookmark.run({
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      folder,
    });
    ensureFolderAncestors(folder);
  }
  return bookmarks.length;
});

const deleteFolder = db.transaction((name) => {
  const prefix = `${name}/%`;
  statements.unassignBookmarksExact.run({ name });
  statements.unassignBookmarksDescendants.run({ prefix });
  statements.deleteFolderExact.run({ name });
  statements.deleteFolderDescendants.run({ prefix });
});

const renameFolder = db.transaction((oldName, newName) => {
  const prefix = `${oldName}/%`;
  const oldLen = oldName.length;
  statements.renameBookmarksExact.run({ oldName, newName });
  statements.renameBookmarksDescendants.run({ prefix, newName, oldLen });
  statements.renameFolderExact.run({ oldName, newName });
  statements.renameFolderDescendants.run({ prefix, newName, oldLen });
  ensureFolderAncestors(newName);
});

// Deletes every bookmark, folder, user, session, and setting — a full factory reset,
// used when the account is deleted. The caller is responsible for clearing the session cookie.
const wipeDatabase = db.transaction(() => {
  db.exec(`
    DELETE FROM bookmarks;
    DELETE FROM folders;
    DELETE FROM sessions;
    DELETE FROM app_settings;
    DELETE FROM users;
    DELETE FROM contacts;
    DELETE FROM contacts_tombstones;
    DELETE FROM events;
    DELETE FROM events_tombstones;
  `);
});

// Monotonic counter (persisted in app_settings) driving contact ETags and the
// CardDAV sync-token/ctag — every contact mutation bumps it once, so
// "seq > token" answers a sync-collection REPORT directly.
function nextContactsSeq() {
  const next = currentContactsSeq() + 1;
  statements.setSetting.run({ key: 'contacts_seq', value: String(next) });
  return next;
}

function currentContactsSeq() {
  const row = statements.getSetting.get('contacts_seq');
  return row ? parseInt(row.value, 10) || 0 : 0;
}

const createContact = db.transaction((fields) => {
  const seq = nextContactsSeq();
  const result = statements.insertContact.run({ ...fields, seq });
  return result.lastInsertRowid;
});

const updateContactFields = db.transaction((id, fields) => {
  const seq = nextContactsSeq();
  statements.updateContact.run({ ...fields, id, seq });
  return seq;
});

const setContactFavoriteSeq = db.transaction((id, favorite) => {
  const seq = nextContactsSeq();
  statements.setContactFavorite.run({ id, favorite, seq });
  return seq;
});

const setContactPhotoSeq = db.transaction((id, photo, mime) => {
  const seq = nextContactsSeq();
  statements.setContactPhoto.run({ id, photo, mime, seq });
  return seq;
});

const clearContactPhotoSeq = db.transaction((id) => {
  const seq = nextContactsSeq();
  statements.clearContactPhoto.run({ id, seq });
  return seq;
});

const deleteContactById = db.transaction((id) => {
  const row = statements.getContact.get(id);
  if (!row) return;
  const seq = nextContactsSeq();
  statements.deleteContactRow.run(id);
  statements.insertTombstone.run({ uid: row.uid, seq });
});

// Bulk import (.vcf with many vCards): each contact gets a fresh uid and its
// own seq bump, same as a normal create, just looped in one transaction.
const insertManyContacts = db.transaction((contactsFields) => {
  let imported = 0;
  for (const fields of contactsFields) {
    const seq = nextContactsSeq();
    statements.insertContact.run({ ...fields, seq });
    imported += 1;
  }
  return imported;
});

// Multi-select bulk actions from the Contacts UI — reuses the same
// per-contact transactions so seq bumps/tombstones stay correct for CardDAV.
function bulkContactAction(ids, action) {
  for (const id of ids) {
    if (action === 'delete') deleteContactById(id);
    else if (action === 'favorite') setContactFavoriteSeq(id, 1);
    else if (action === 'unfavorite') setContactFavoriteSeq(id, 0);
  }
}

// Applied from an incoming CardDAV PUT: creates the contact if its UID is new,
// otherwise updates it in place — either way in a single seq bump/transaction.
const upsertContactFromVCard = db.transaction((fields) => {
  const existing = statements.getContactByUidId.get(fields.uid);
  const seq = nextContactsSeq();

  if (existing) {
    statements.updateContact.run({
      id: existing.id,
      fullName: fields.fullName,
      firstName: fields.firstName,
      lastName: fields.lastName,
      organization: fields.organization,
      phones: fields.phones,
      emails: fields.emails,
      notes: fields.notes,
      favorite: existing.favorite,
      seq,
    });
    if (fields.photo) statements.setContactPhoto.run({ id: existing.id, photo: fields.photo, mime: fields.photoMime, seq });
    return { id: existing.id, seq, created: false };
  }

  const result = statements.insertContact.run({
    uid: fields.uid,
    fullName: fields.fullName,
    firstName: fields.firstName,
    lastName: fields.lastName,
    organization: fields.organization,
    phones: fields.phones,
    emails: fields.emails,
    notes: fields.notes,
    favorite: 0,
    seq,
  });
  const id = result.lastInsertRowid;
  if (fields.photo) statements.setContactPhoto.run({ id, photo: fields.photo, mime: fields.photoMime, seq });
  return { id, seq, created: true };
});

// Same pattern as the contacts seq counter above, kept independent so contact
// and event mutations don't share (and skew) a single sync-token space.
function nextEventsSeq() {
  const next = currentEventsSeq() + 1;
  statements.setSetting.run({ key: 'events_seq', value: String(next) });
  return next;
}

function currentEventsSeq() {
  const row = statements.getSetting.get('events_seq');
  return row ? parseInt(row.value, 10) || 0 : 0;
}

const createEvent = db.transaction((fields) => {
  const seq = nextEventsSeq();
  const result = statements.insertEvent.run({ ...fields, seq });
  return result.lastInsertRowid;
});

const updateEventFields = db.transaction((id, fields) => {
  const seq = nextEventsSeq();
  statements.updateEvent.run({ ...fields, id, seq });
  return seq;
});

const deleteEventById = db.transaction((id) => {
  const row = statements.getEvent.get(id);
  if (!row) return;
  const seq = nextEventsSeq();
  statements.deleteEventRow.run(id);
  statements.insertEventTombstone.run({ uid: row.uid, seq });
});

// Bulk import (.ics with many VEVENTs): each event gets a fresh uid and its
// own seq bump, same shape as insertManyContacts.
const insertManyEvents = db.transaction((eventsFields) => {
  let imported = 0;
  for (const fields of eventsFields) {
    const seq = nextEventsSeq();
    statements.insertEvent.run({ ...fields, seq });
    imported += 1;
  }
  return imported;
});

// Applied from an incoming CalDAV PUT: creates the event if its UID is new,
// otherwise updates it in place — either way in a single seq bump/transaction.
const upsertEventFromICal = db.transaction((fields) => {
  const existing = statements.getEventByUidId.get(fields.uid);
  const seq = nextEventsSeq();

  if (existing) {
    statements.updateEvent.run({ ...fields, id: existing.id, seq });
    return { id: existing.id, seq, created: false };
  }

  const result = statements.insertEvent.run({ ...fields, seq });
  return { id: result.lastInsertRowid, seq, created: true };
});

function listMergedFolders() {
  const counts = new Map();
  for (const row of statements.listFolders.all()) counts.set(row.folder, row.count);

  const positions = new Map();
  for (const row of statements.listFolderNames.all()) {
    if (!counts.has(row.name)) counts.set(row.name, 0);
    positions.set(row.name, row.position);
  }

  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count, position: positions.get(folder) ?? 0 }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

module.exports = {
  db,
  statements,
  insertManyBookmarks,
  deleteFolder,
  renameFolder,
  ensureFolderAncestors,
  listMergedFolders,
  wipeDatabase,
  SORT_CLAUSES,
  currentContactsSeq,
  createContact,
  updateContactFields,
  setContactFavoriteSeq,
  setContactPhotoSeq,
  clearContactPhotoSeq,
  deleteContactById,
  upsertContactFromVCard,
  insertManyContacts,
  bulkContactAction,
  currentEventsSeq,
  createEvent,
  updateEventFields,
  deleteEventById,
  insertManyEvents,
  upsertEventFromICal,
};
