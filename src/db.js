const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'bookmarks.sqlite3'));
db.pragma('journal_mode = WAL');

// Every data table (bookmarks/folders/contacts/events/passwords/file_locations)
// is scoped to a user_id — SyncMark is multi-tenant: each account's data is
// fully private to it, and an admin account manages the account list itself
// (see role/enabled below) rather than any of this data directly. folders,
// contact_groups, and file_locations use UNIQUE(user_id, name) rather than a
// plain UNIQUE(name) so two different users can each have their own "Work"
// folder without colliding.
db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  -- role: 'user' (has their own private bookmarks/contacts/calendar/passwords/
  -- files) or 'admin' (manages the user list from the Admin Portal, has no
  -- personal data of its own). enabled: a disabled account can't log in and
  -- has its active sessions torn down immediately — see requireAuth.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    enabled INTEGER NOT NULL DEFAULT 1,
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

  -- Instance-wide key/value settings — feature flags, the vault encryption
  -- key, and the backup schedule are genuinely global (server-operation
  -- concerns, not personal data). A few keys (contacts_seq/events_seq/
  -- contacts_dismissed_duplicates) are namespaced per-user instead, e.g.
  -- "contacts_seq:5" — see nextContactsSeq/getDismissedDuplicatePairs below.
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
    user_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_tombstones_seq ON contacts_tombstones(seq);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
    user_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_tombstones_seq ON events_tombstones(seq);

  CREATE TABLE IF NOT EXISTS file_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS contact_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    smart_rules TEXT,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  -- No user_id here: membership is only ever looked up by a group_id or
  -- contact_id that the caller has already verified belongs to the
  -- requesting user via the contact_groups/contacts row itself.
  CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    PRIMARY KEY (group_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS passwords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    site_name TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password_enc TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_passwords_site ON passwords(site_name);
`);

// ---------- Migrations for databases created before these columns/shapes existed ----------

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
const existingContactColumns = db.prepare('PRAGMA table_info(contacts)').all();
const CONTACT_JSON_COLUMNS = ['addresses', 'social_profiles', 'messaging_handles', 'custom_fields', 'key_dates', 'relationships', 'tags'];
if (!existingContactColumns.some((col) => col.name === 'title')) {
  db.exec("ALTER TABLE contacts ADD COLUMN title TEXT NOT NULL DEFAULT ''");
}
for (const column of CONTACT_JSON_COLUMNS) {
  if (!existingContactColumns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE contacts ADD COLUMN ${column} TEXT NOT NULL DEFAULT '[]'`);
  }
}

// --- Multi-user migration ---
// role/enabled take a constant default, so a plain ADD COLUMN is enough.
if (!existingUserColumns.some((col) => col.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}
if (!existingUserColumns.some((col) => col.name === 'enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
}

// The pre-multi-user account (if any) becomes the owner of record for every
// pre-existing row below — there's only ever been one account before this
// migration, so this is unambiguous. Fresh installs have no users yet and
// nothing to backfill (every one of these tables is necessarily empty too).
const bootstrapUserId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id ?? null;

// user_id has no sensible constant default (it has to come from the one
// pre-existing account, if any), so it's added nullable and backfilled —
// enforced as "always present" at the application layer rather than a DB
// NOT NULL constraint, same pragmatic looseness this file already applies
// to a few other columns.
function addUserIdColumn(table) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((col) => col.name === 'user_id')) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`);
  if (bootstrapUserId !== null) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(bootstrapUserId);
  }
}
for (const table of ['bookmarks', 'contacts', 'contacts_tombstones', 'events', 'events_tombstones', 'passwords']) {
  addUserIdColumn(table);
}

// user_id is guaranteed to exist on these by now (freshly created with it
// above, or just migrated onto it), so these indexes are safe to create here.
db.exec('CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_passwords_user ON passwords(user_id)');

// folders/contact_groups/file_locations each had a plain UNIQUE(name) —
// SQLite can't widen a constraint in place, so these three get the standard
// rebuild (new table with the right shape, copy rows across, swap in).
function rebuildWithUserId(table, columns) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((col) => col.name === 'user_id')) return;

  const tmpTable = `${table}_migrating`;
  db.exec(`ALTER TABLE ${table} RENAME TO ${tmpTable}`);
  db.exec(createTableSql(table));
  const colList = columns.join(', ');
  db.prepare(`INSERT INTO ${table} (user_id, ${colList}) SELECT ?, ${colList} FROM ${tmpTable}`).run(bootstrapUserId);
  db.exec(`DROP TABLE ${tmpTable}`);
}

// Re-declares just the one table being rebuilt, matching the shape already
// created above for a fresh install — kept in one place so the "new install"
// and "migrated install" schemas can never drift apart.
function createTableSql(table) {
  if (table === 'folders') {
    return `CREATE TABLE folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    )`;
  }
  if (table === 'contact_groups') {
    return `CREATE TABLE contact_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual',
      smart_rules TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    )`;
  }
  if (table === 'file_locations') {
    return `CREATE TABLE file_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    )`;
  }
  throw new Error(`No rebuild schema registered for ${table}`);
}

rebuildWithUserId('folders', ['id', 'name', 'position', 'created_at']);
rebuildWithUserId('contact_groups', ['id', 'name', 'type', 'smart_rules', 'position', 'created_at']);
rebuildWithUserId('file_locations', ['id', 'name', 'path', 'created_at']);

// contacts_seq/events_seq/contacts_dismissed_duplicates used to be single
// global app_settings keys; they're namespaced per-user now (see
// nextContactsSeq etc. below). Carry the pre-existing account's counters
// forward once so its CardDAV/CalDAV sync token doesn't reset to zero.
if (bootstrapUserId !== null) {
  for (const oldKey of ['contacts_seq', 'events_seq', 'contacts_dismissed_duplicates']) {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(oldKey);
    if (row) {
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(`${oldKey}:${bootstrapUserId}`, row.value);
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(oldKey);
    }
  }
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
    WHERE user_id = @userId
      AND (@q = '' OR title LIKE @qLike OR url LIKE @qLike)
      AND (@folder = '' OR folder = @folder OR folder LIKE @folderPrefix)
      AND (@favorite = 0 OR favorite = 1)
    ORDER BY ${clause}
  `);
  listBookmarksExactFolderBySort[key] = db.prepare(`
    SELECT * FROM bookmarks
    WHERE user_id = @userId
      AND (@q = '' OR title LIKE @qLike OR url LIKE @qLike)
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

// q/text search moved out of SQL entirely — the route fetches this (already
// filtered by favorite/tag) and, when a query string is present, re-ranks it
// in JS with fuzzySearch.js instead of a SQL LIKE, so it can score name,
// org, title, phones, emails, and tags together as one relevance signal.
const listContactsBySort = {};
for (const [key, clause] of Object.entries(CONTACT_SORT_CLAUSES)) {
  listContactsBySort[key] = db.prepare(`
    SELECT id, uid, full_name, first_name, last_name, organization, title, phones, emails, tags, favorite,
           (photo IS NOT NULL) AS has_photo, seq, created_at, updated_at
    FROM contacts
    WHERE user_id = @userId
      AND (@favorite = 0 OR favorite = 1)
      AND (@tag = '' OR tags LIKE @tagLike)
    ORDER BY ${clause}
  `);
}

const PASSWORD_SORT_CLAUSES = {
  'name-asc': 'site_name COLLATE NOCASE ASC',
  'name-desc': 'site_name COLLATE NOCASE DESC',
  'created-desc': 'created_at DESC, id DESC',
  'created-asc': 'created_at ASC, id ASC',
};

// Lite list columns deliberately exclude password_enc/notes — same
// on-demand-fetch precedent as contacts' photo and getContact vs.
// listContactsBySort, just applied to the encrypted secret instead of a BLOB.
const listPasswordsBySort = {};
for (const [key, clause] of Object.entries(PASSWORD_SORT_CLAUSES)) {
  listPasswordsBySort[key] = db.prepare(`
    SELECT id, site_name, url, username, favorite, created_at, updated_at
    FROM passwords
    WHERE user_id = @userId
      AND (@q = '' OR site_name LIKE @qLike OR url LIKE @qLike OR username LIKE @qLike)
      AND (@favorite = 0 OR favorite = 1)
    ORDER BY ${clause}
  `);
}

const statements = {
  // New bookmarks are appended after the current highest custom-order position (per user).
  insertBookmark: db.prepare(
    `INSERT INTO bookmarks (user_id, title, url, folder, position)
     VALUES (@userId, @title, @url, @folder, COALESCE((SELECT MAX(position) FROM bookmarks WHERE user_id = @userId), 0) + 1)`
  ),
  listBookmarksBySort,
  listBookmarksExactFolderBySort,
  listAllBookmarks: db.prepare(
    `SELECT * FROM bookmarks WHERE user_id = ? ORDER BY folder ASC, title COLLATE NOCASE ASC`
  ),
  getBookmark: db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?'),
  updateBookmark: db.prepare(
    `UPDATE bookmarks SET title = @title, url = @url, folder = @folder, favorite = @favorite, updated_at = datetime('now')
     WHERE id = @id AND user_id = @userId`
  ),
  setFavorite: db.prepare(
    `UPDATE bookmarks SET favorite = @favorite, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  setPosition: db.prepare(
    `UPDATE bookmarks SET position = @position, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  deleteBookmark: db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?'),
  deleteAllBookmarks: db.prepare('DELETE FROM bookmarks WHERE user_id = ?'),
  countBookmarks: db.prepare('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?'),
  listFolders: db.prepare(
    `SELECT folder, COUNT(*) as count FROM bookmarks
     WHERE folder != '' AND user_id = ?
     GROUP BY folder ORDER BY folder ASC`
  ),

  // New folders are appended after the current highest sidebar position (per user).
  insertFolder: db.prepare(
    `INSERT OR IGNORE INTO folders (user_id, name, position)
     VALUES (@userId, @name, COALESCE((SELECT MAX(position) FROM folders WHERE user_id = @userId), 0) + 1)`
  ),
  listFolderNames: db.prepare('SELECT name, position FROM folders WHERE user_id = ? ORDER BY name ASC'),
  getFolderByName: db.prepare('SELECT * FROM folders WHERE name = ? AND user_id = ?'),
  setFolderPosition: db.prepare('UPDATE folders SET position = @position WHERE name = @name AND user_id = @userId'),

  deleteFolderExact: db.prepare('DELETE FROM folders WHERE name = @name AND user_id = @userId'),
  deleteFolderDescendants: db.prepare('DELETE FROM folders WHERE name LIKE @prefix AND user_id = @userId'),
  unassignBookmarksExact: db.prepare(
    `UPDATE bookmarks SET folder = '', updated_at = datetime('now') WHERE folder = @name AND user_id = @userId`
  ),
  unassignBookmarksDescendants: db.prepare(
    `UPDATE bookmarks SET folder = '', updated_at = datetime('now') WHERE folder LIKE @prefix AND user_id = @userId`
  ),

  renameFolderExact: db.prepare('UPDATE folders SET name = @newName WHERE name = @oldName AND user_id = @userId'),
  renameFolderDescendants: db.prepare(
    `UPDATE folders SET name = @newName || substr(name, @oldLen + 1) WHERE name LIKE @prefix AND user_id = @userId`
  ),
  renameBookmarksExact: db.prepare(
    `UPDATE bookmarks SET folder = @newName, updated_at = datetime('now') WHERE folder = @oldName AND user_id = @userId`
  ),
  renameBookmarksDescendants: db.prepare(
    `UPDATE bookmarks SET folder = @newName || substr(folder, @oldLen + 1), updated_at = datetime('now')
     WHERE folder LIKE @prefix AND user_id = @userId`
  ),

  countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
  // Columns are listed explicitly so the avatar BLOB isn't loaded on every
  // authenticated request — it's fetched only by getAvatar, on demand.
  getUserByUsername: db.prepare(
    `SELECT id, username, password_hash, role, enabled, created_at, (avatar IS NOT NULL) AS has_avatar
     FROM users WHERE username = ?`
  ),
  getUserById: db.prepare(
    `SELECT id, username, password_hash, role, enabled, created_at, (avatar IS NOT NULL) AS has_avatar
     FROM users WHERE id = ?`
  ),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (@username, @passwordHash, @role)'
  ),
  updateUser: db.prepare(
    'UPDATE users SET username = @username, password_hash = @passwordHash WHERE id = @id'
  ),
  getAvatar: db.prepare('SELECT avatar, avatar_mime FROM users WHERE id = ?'),
  setAvatar: db.prepare(
    'UPDATE users SET avatar = @avatar, avatar_mime = @mime WHERE id = @id'
  ),
  clearAvatar: db.prepare('UPDATE users SET avatar = NULL, avatar_mime = NULL WHERE id = @id'),

  // ---- admin: managing role='user' accounts ----
  listRegularUsers: db.prepare(
    `SELECT id, username, enabled, created_at FROM users WHERE role = 'user' ORDER BY created_at ASC, id ASC`
  ),
  getRegularUserById: db.prepare(`SELECT id, username, enabled, created_at FROM users WHERE id = ? AND role = 'user'`),
  setUserEnabled: db.prepare('UPDATE users SET enabled = @enabled WHERE id = @id'),
  deleteUserRow: db.prepare('DELETE FROM users WHERE id = ?'),

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
  deleteSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),

  getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
  setSetting: db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ),

  // Columns are listed explicitly so the photo BLOB isn't loaded for every
  // row in a list — it's fetched only by getContactPhoto, on demand.
  insertContact: db.prepare(
    `INSERT INTO contacts (user_id, uid, full_name, first_name, last_name, organization, title, phones, emails,
       addresses, social_profiles, messaging_handles, custom_fields, key_dates, relationships, tags,
       notes, favorite, seq)
     VALUES (@userId, @uid, @fullName, @firstName, @lastName, @organization, @title, @phones, @emails,
       @addresses, @socialProfiles, @messagingHandles, @customFields, @keyDates, @relationships, @tags,
       @notes, @favorite, @seq)`
  ),
  // The full-detail fetch (Contact Card + edit modal) — everything except the
  // raw photo bytes, same has_photo-flag precedent as the list query below.
  getContact: db.prepare(
    `SELECT id, uid, full_name, first_name, last_name, organization, title, phones, emails,
            addresses, social_profiles, messaging_handles, custom_fields, key_dates, relationships, tags,
            notes, favorite, (photo IS NOT NULL) AS has_photo, seq, created_at, updated_at
     FROM contacts WHERE id = ? AND user_id = ?`
  ),
  getContactByUidId: db.prepare('SELECT id, favorite FROM contacts WHERE uid = ? AND user_id = ?'),
  getContactFullByUid: db.prepare('SELECT * FROM contacts WHERE uid = ? AND user_id = ?'),
  getContactFullById: db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?'),
  listContactsBySort,
  listContactsMeta: db.prepare('SELECT uid, seq FROM contacts WHERE user_id = ? ORDER BY id ASC'),
  listContactsMetaSince: db.prepare('SELECT uid, seq FROM contacts WHERE user_id = @userId AND seq > @seq ORDER BY seq ASC'),
  listTombstonesSince: db.prepare('SELECT uid, seq FROM contacts_tombstones WHERE user_id = @userId AND seq > @seq ORDER BY seq ASC'),
  updateContact: db.prepare(
    `UPDATE contacts SET full_name = @fullName, first_name = @firstName, last_name = @lastName,
       organization = @organization, title = @title, phones = @phones, emails = @emails,
       addresses = @addresses, social_profiles = @socialProfiles, messaging_handles = @messagingHandles,
       custom_fields = @customFields, key_dates = @keyDates, relationships = @relationships, tags = @tags,
       notes = @notes, favorite = @favorite, seq = @seq, updated_at = datetime('now')
     WHERE id = @id AND user_id = @userId`
  ),
  clearRelationshipsTo: db.prepare(
    `UPDATE contacts SET relationships = @relationships WHERE id = @id AND user_id = @userId`
  ),
  listContactsWithRelationships: db.prepare(
    `SELECT id, relationships FROM contacts WHERE relationships != '[]' AND user_id = ?`
  ),
  setContactFavorite: db.prepare(
    `UPDATE contacts SET favorite = @favorite, seq = @seq, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  deleteContactRow: db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?'),
  deleteAllContacts: db.prepare('DELETE FROM contacts WHERE user_id = ?'),
  countContacts: db.prepare('SELECT COUNT(*) as count FROM contacts WHERE user_id = ?'),
  getContactPhoto: db.prepare('SELECT photo, photo_mime FROM contacts WHERE id = ? AND user_id = ?'),
  setContactPhoto: db.prepare(
    `UPDATE contacts SET photo = @photo, photo_mime = @mime, seq = @seq, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  clearContactPhoto: db.prepare(
    `UPDATE contacts SET photo = NULL, photo_mime = NULL, seq = @seq, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  insertTombstone: db.prepare(
    `INSERT INTO contacts_tombstones (uid, user_id, seq) VALUES (@uid, @userId, @seq)
     ON CONFLICT(uid) DO UPDATE SET seq = @seq, deleted_at = datetime('now')`
  ),

  // ---- contact groups ----
  listContactGroups: db.prepare('SELECT * FROM contact_groups WHERE user_id = ? ORDER BY position ASC, id ASC'),
  getContactGroup: db.prepare('SELECT * FROM contact_groups WHERE id = ? AND user_id = ?'),
  insertContactGroup: db.prepare(
    `INSERT INTO contact_groups (user_id, name, type, smart_rules, position)
     VALUES (@userId, @name, @type, @smartRules, COALESCE((SELECT MAX(position) FROM contact_groups WHERE user_id = @userId), 0) + 1)`
  ),
  updateContactGroup: db.prepare(
    'UPDATE contact_groups SET name = @name, type = @type, smart_rules = @smartRules WHERE id = @id AND user_id = @userId'
  ),
  setContactGroupPosition: db.prepare('UPDATE contact_groups SET position = @position WHERE id = @id AND user_id = @userId'),
  deleteContactGroup: db.prepare('DELETE FROM contact_groups WHERE id = ? AND user_id = ?'),
  deleteContactGroupMemberships: db.prepare('DELETE FROM contact_group_members WHERE group_id = ?'),
  deleteContactGroupMembershipsForContact: db.prepare('DELETE FROM contact_group_members WHERE contact_id = ?'),
  addContactGroupMember: db.prepare(
    'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (@groupId, @contactId)'
  ),
  removeContactGroupMember: db.prepare(
    'DELETE FROM contact_group_members WHERE group_id = @groupId AND contact_id = @contactId'
  ),
  listContactGroupMemberIds: db.prepare('SELECT contact_id FROM contact_group_members WHERE group_id = ?'),
  countContactGroupMembers: db.prepare('SELECT COUNT(*) as count FROM contact_group_members WHERE group_id = ?'),
  listContactGroupMembershipsForContact: db.prepare('SELECT group_id FROM contact_group_members WHERE contact_id = ?'),

  // Lighter columns than getContact's full set — just enough to compare
  // candidates and render a merge-preview card, same has_photo-flag precedent.
  listContactsForDuplicates: db.prepare(
    `SELECT id, uid, full_name, first_name, last_name, organization, title, phones, emails, tags, favorite,
            (photo IS NOT NULL) AS has_photo, created_at
     FROM contacts WHERE user_id = ?`
  ),

  insertEvent: db.prepare(
    `INSERT INTO events (user_id, uid, title, description, location, start_at, end_at, all_day, recurrence, seq)
     VALUES (@userId, @uid, @title, @description, @location, @startAt, @endAt, @allDay, @recurrence, @seq)`
  ),
  getEvent: db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?'),
  getEventByUidId: db.prepare('SELECT id FROM events WHERE uid = ? AND user_id = ?'),
  getEventFullByUid: db.prepare('SELECT * FROM events WHERE uid = ? AND user_id = ?'),
  listEvents: db.prepare(
    `SELECT * FROM events
     WHERE user_id = @userId
       AND (@q = '' OR title LIKE @qLike OR location LIKE @qLike OR description LIKE @qLike)
     ORDER BY start_at ASC`
  ),
  listEventsMeta: db.prepare('SELECT uid, seq FROM events WHERE user_id = ? ORDER BY id ASC'),
  listEventsMetaSince: db.prepare('SELECT uid, seq FROM events WHERE user_id = @userId AND seq > @seq ORDER BY seq ASC'),
  listEventTombstonesSince: db.prepare('SELECT uid, seq FROM events_tombstones WHERE user_id = @userId AND seq > @seq ORDER BY seq ASC'),
  updateEvent: db.prepare(
    `UPDATE events SET title = @title, description = @description, location = @location,
       start_at = @startAt, end_at = @endAt, all_day = @allDay, recurrence = @recurrence,
       seq = @seq, updated_at = datetime('now')
     WHERE id = @id AND user_id = @userId`
  ),
  deleteEventRow: db.prepare('DELETE FROM events WHERE id = ? AND user_id = ?'),
  deleteAllEvents: db.prepare('DELETE FROM events WHERE user_id = ?'),
  countEvents: db.prepare('SELECT COUNT(*) as count FROM events WHERE user_id = ?'),
  insertEventTombstone: db.prepare(
    `INSERT INTO events_tombstones (uid, user_id, seq) VALUES (@uid, @userId, @seq)
     ON CONFLICT(uid) DO UPDATE SET seq = @seq, deleted_at = datetime('now')`
  ),

  // ---- passwords ----
  insertPassword: db.prepare(
    `INSERT INTO passwords (user_id, site_name, url, username, password_enc, notes, favorite)
     VALUES (@userId, @siteName, @url, @username, @passwordEnc, @notes, @favorite)`
  ),
  listPasswordsBySort,
  getPassword: db.prepare('SELECT * FROM passwords WHERE id = ? AND user_id = ?'),
  updatePassword: db.prepare(
    `UPDATE passwords SET site_name = @siteName, url = @url, username = @username,
       password_enc = @passwordEnc, notes = @notes, favorite = @favorite, updated_at = datetime('now')
     WHERE id = @id AND user_id = @userId`
  ),
  setPasswordFavorite: db.prepare(
    `UPDATE passwords SET favorite = @favorite, updated_at = datetime('now') WHERE id = @id AND user_id = @userId`
  ),
  deletePassword: db.prepare('DELETE FROM passwords WHERE id = ? AND user_id = ?'),
  deleteAllPasswords: db.prepare('DELETE FROM passwords WHERE user_id = ?'),
  countPasswords: db.prepare('SELECT COUNT(*) as count FROM passwords WHERE user_id = ?'),

  listFileLocations: db.prepare('SELECT * FROM file_locations WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC'),
  getFileLocation: db.prepare('SELECT * FROM file_locations WHERE id = ? AND user_id = ?'),
  getFileLocationByName: db.prepare('SELECT * FROM file_locations WHERE name = ? AND user_id = ?'),
  insertFileLocation: db.prepare('INSERT INTO file_locations (user_id, name, path) VALUES (@userId, @name, @path)'),
  updateFileLocation: db.prepare('UPDATE file_locations SET name = @name, path = @path WHERE id = @id AND user_id = @userId'),
  deleteFileLocation: db.prepare('DELETE FROM file_locations WHERE id = ? AND user_id = ?'),
  countFileLocations: db.prepare('SELECT COUNT(*) as count FROM file_locations WHERE user_id = ?'),
};

// Ensures every path segment leading up to (and including) a folder has its own
// row in `folders` — e.g. "Work/Projects/Alpha" also gets "Work" and "Work/Projects" —
// so every node visible in the sidebar tree has a place to store a custom position.
function ensureFolderAncestors(userId, folderPath) {
  if (!folderPath) return;
  let path = '';
  for (const segment of folderPath.split('/')) {
    path = path ? `${path}/${segment}` : segment;
    statements.insertFolder.run({ userId, name: path });
  }
}

const insertManyBookmarks = db.transaction((userId, bookmarks) => {
  for (const bookmark of bookmarks) {
    const folder = bookmark.folder || '';
    statements.insertBookmark.run({
      userId,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      folder,
    });
    ensureFolderAncestors(userId, folder);
  }
  return bookmarks.length;
});

const deleteFolder = db.transaction((userId, name) => {
  const prefix = `${name}/%`;
  statements.unassignBookmarksExact.run({ name, userId });
  statements.unassignBookmarksDescendants.run({ prefix, userId });
  statements.deleteFolderExact.run({ name, userId });
  statements.deleteFolderDescendants.run({ prefix, userId });
});

const renameFolder = db.transaction((userId, oldName, newName) => {
  const prefix = `${oldName}/%`;
  const oldLen = oldName.length;
  statements.renameBookmarksExact.run({ oldName, newName, userId });
  statements.renameBookmarksDescendants.run({ prefix, newName, oldLen, userId });
  statements.renameFolderExact.run({ oldName, newName, userId });
  statements.renameFolderDescendants.run({ prefix, newName, oldLen, userId });
  ensureFolderAncestors(userId, newName);
});

// Deletes one user's account and every row of data it owns — used by both
// self-service "delete my account" and the admin's "delete this user".
// Group memberships are cleared before their owning contacts/groups so
// nothing references an id that's about to stop existing.
const wipeUserData = db.transaction((userId) => {
  db.prepare('DELETE FROM contact_group_members WHERE contact_id IN (SELECT id FROM contacts WHERE user_id = ?)').run(userId);
  db.prepare('DELETE FROM contact_group_members WHERE group_id IN (SELECT id FROM contact_groups WHERE user_id = ?)').run(userId);
  statements.deleteAllBookmarks.run(userId);
  db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId);
  statements.deleteAllContacts.run(userId);
  db.prepare('DELETE FROM contacts_tombstones WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM contact_groups WHERE user_id = ?').run(userId);
  statements.deleteAllEvents.run(userId);
  db.prepare('DELETE FROM events_tombstones WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM file_locations WHERE user_id = ?').run(userId);
  statements.deleteAllPasswords.run(userId);
  statements.deleteSessionsForUser.run(userId);
  db.prepare('DELETE FROM app_settings WHERE key IN (?, ?, ?)').run(
    `contacts_seq:${userId}`,
    `events_seq:${userId}`,
    `contacts_dismissed_duplicates:${userId}`
  );
  statements.deleteUserRow.run(userId);
});

// Full factory reset: every account (admin included) and everything anyone
// owns — used only by the admin's "Reset SyncMark" danger-zone action, which
// puts the instance back to a fresh install (the next visit sees the
// first-run setup wizard again, same as a brand-new data/bookmarks.sqlite3).
// Unlike wipeUserData this needs no id to scope by, so it's a single
// unparameterized DELETE per table rather than a loop over one user's rows.
// File Manager locations are just unregistered here, same as deleting one
// normally — actual files on disk, and any backups already written to
// data/backups, are never touched by this.
const wipeDatabase = db.transaction(() => {
  db.exec(`
    DELETE FROM bookmarks;
    DELETE FROM folders;
    DELETE FROM contacts;
    DELETE FROM contacts_tombstones;
    DELETE FROM contact_groups;
    DELETE FROM contact_group_members;
    DELETE FROM events;
    DELETE FROM events_tombstones;
    DELETE FROM file_locations;
    DELETE FROM passwords;
    DELETE FROM sessions;
    DELETE FROM app_settings;
    DELETE FROM users;
  `);
});

const deleteContactGroup = db.transaction((userId, id) => {
  statements.deleteContactGroupMemberships.run(id);
  statements.deleteContactGroup.run(id, userId);
});

// Monotonic counter (persisted in app_settings, namespaced per user) driving
// contact ETags and the CardDAV sync-token/ctag — every contact mutation
// bumps it once, so "seq > token" answers a sync-collection REPORT directly.
function nextContactsSeq(userId) {
  const next = currentContactsSeq(userId) + 1;
  statements.setSetting.run({ key: `contacts_seq:${userId}`, value: String(next) });
  return next;
}

function currentContactsSeq(userId) {
  const row = statements.getSetting.get(`contacts_seq:${userId}`);
  return row ? parseInt(row.value, 10) || 0 : 0;
}

const createContact = db.transaction((userId, fields) => {
  const seq = nextContactsSeq(userId);
  const result = statements.insertContact.run({ ...fields, userId, seq });
  return result.lastInsertRowid;
});

const updateContactFields = db.transaction((userId, id, fields) => {
  const seq = nextContactsSeq(userId);
  statements.updateContact.run({ ...fields, id, userId, seq });
  return seq;
});

const setContactFavoriteSeq = db.transaction((userId, id, favorite) => {
  const seq = nextContactsSeq(userId);
  statements.setContactFavorite.run({ id, userId, favorite, seq });
  return seq;
});

const setContactPhotoSeq = db.transaction((userId, id, photo, mime) => {
  const seq = nextContactsSeq(userId);
  statements.setContactPhoto.run({ id, userId, photo, mime, seq });
  return seq;
});

const clearContactPhotoSeq = db.transaction((userId, id) => {
  const seq = nextContactsSeq(userId);
  statements.clearContactPhoto.run({ id, userId, seq });
  return seq;
});

// Relationships reference another contact by id in a JSON column rather than
// a real foreign key, so deleting a contact needs its own cleanup pass —
// the personal-scale equivalent of an ON DELETE cascade.
function pruneRelationshipsTo(userId, deletedId) {
  for (const row of statements.listContactsWithRelationships.all(userId)) {
    let relationships;
    try {
      relationships = JSON.parse(row.relationships);
    } catch {
      continue;
    }
    const filtered = relationships.filter((r) => r.contactId !== deletedId);
    if (filtered.length !== relationships.length) {
      statements.clearRelationshipsTo.run({ id: row.id, userId, relationships: JSON.stringify(filtered) });
    }
  }
}

const deleteContactById = db.transaction((userId, id) => {
  const row = statements.getContact.get(id, userId);
  if (!row) return;
  const seq = nextContactsSeq(userId);
  statements.deleteContactRow.run(id, userId);
  statements.insertTombstone.run({ uid: row.uid, userId, seq });
  statements.deleteContactGroupMembershipsForContact.run(id);
  pruneRelationshipsTo(userId, id);
});

// Same idea as pruneRelationshipsTo, but redirects references instead of
// dropping them — used by mergeContacts so a relationship that pointed at a
// now-merged-away contact follows it to the surviving one. Also catches the
// primary's own relationship list (it's scanned like any other row here),
// so a relationship that pointed at one of the merged-away contacts becomes
// a self-reference and is dropped rather than left dangling.
function repointRelationshipsTo(userId, oldIds, newId) {
  const oldIdSet = new Set(oldIds);
  for (const row of statements.listContactsWithRelationships.all(userId)) {
    let relationships;
    try {
      relationships = JSON.parse(row.relationships);
    } catch {
      continue;
    }
    let changed = false;
    const seen = new Set();
    const result = [];
    for (const r of relationships) {
      let contactId = r.contactId;
      if (oldIdSet.has(contactId)) {
        contactId = newId;
        changed = true;
      }
      if (contactId === row.id) {
        changed = true;
        continue;
      }
      const key = `${r.type}:${contactId}`;
      if (seen.has(key)) {
        changed = true;
        continue;
      }
      seen.add(key);
      result.push({ type: r.type, contactId });
    }
    if (changed) statements.clearRelationshipsTo.run({ id: row.id, userId, relationships: JSON.stringify(result) });
  }
}

// Manual group membership is a join-table row, not a JSON reference, so
// merging just needs to move each row (INSERT OR IGNORE already dedupes
// against a membership the surviving contact already has).
function repointContactGroupMembers(oldIds, newId) {
  for (const oldId of oldIds) {
    for (const { group_id: groupId } of statements.listContactGroupMembershipsForContact.all(oldId)) {
      statements.addContactGroupMember.run({ groupId, contactId: newId });
    }
    statements.deleteContactGroupMembershipsForContact.run(oldId);
  }
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// One-click duplicate merge: unions every multi-value field into the primary
// contact, keeps the primary's scalar fields (falling back to the first
// merged-away contact that has a value), repoints relationships/group
// membership so nothing dangles, then deletes the merged-away contacts
// through the normal delete path (tombstones/seq/group-cleanup unchanged).
const mergeContacts = db.transaction((userId, primaryId, mergeIds) => {
  const primary = statements.getContactFullById.get(primaryId, userId);
  if (!primary) return null;

  const mergeRows = [...new Set(mergeIds)]
    .map((id) => statements.getContactFullById.get(id, userId))
    .filter((row) => row && row.id !== primaryId);
  if (mergeRows.length === 0) return null;

  const all = [primary, ...mergeRows];
  const parseArr = (row, col) => {
    try {
      return JSON.parse(row[col] || '[]');
    } catch {
      return [];
    }
  };

  const entryKey = (e) => `${(e.type || '').toLowerCase()}:${(e.value || '').toLowerCase()}`;
  const phones = dedupeBy(all.flatMap((r) => parseArr(r, 'phones')), entryKey);
  const emails = dedupeBy(all.flatMap((r) => parseArr(r, 'emails')), entryKey);
  const socialProfiles = dedupeBy(all.flatMap((r) => parseArr(r, 'social_profiles')), entryKey);
  const messagingHandles = dedupeBy(all.flatMap((r) => parseArr(r, 'messaging_handles')), entryKey);
  const addresses = dedupeBy(all.flatMap((r) => parseArr(r, 'addresses')), (a) =>
    JSON.stringify(Object.values(a).map((v) => String(v).toLowerCase()))
  );
  const customFields = dedupeBy(all.flatMap((r) => parseArr(r, 'custom_fields')), (c) =>
    `${(c.label || '').toLowerCase()}:${(c.value || '').toLowerCase()}`
  );
  const keyDates = dedupeBy(all.flatMap((r) => parseArr(r, 'key_dates')), (d) => `${(d.label || '').toLowerCase()}:${d.date}`);
  const tags = dedupeBy(
    all.flatMap((r) => parseArr(r, 'tags').map((tag) => ({ tag }))),
    (t) => t.tag.toLowerCase()
  ).map((t) => t.tag);
  const relationships = dedupeBy(
    all.flatMap((r) => parseArr(r, 'relationships')).filter((rel) => rel.contactId !== primaryId),
    (rel) => `${(rel.type || '').toLowerCase()}:${rel.contactId}`
  );

  const firstNonEmpty = (col) => {
    const primaryVal = (primary[col] || '').trim();
    if (primaryVal) return primaryVal;
    for (const row of mergeRows) {
      const val = (row[col] || '').trim();
      if (val) return val;
    }
    return '';
  };

  const fields = {
    fullName: firstNonEmpty('full_name'),
    firstName: firstNonEmpty('first_name'),
    lastName: firstNonEmpty('last_name'),
    organization: firstNonEmpty('organization'),
    title: firstNonEmpty('title'),
    notes: firstNonEmpty('notes'),
    phones: JSON.stringify(phones),
    emails: JSON.stringify(emails),
    addresses: JSON.stringify(addresses),
    socialProfiles: JSON.stringify(socialProfiles),
    messagingHandles: JSON.stringify(messagingHandles),
    customFields: JSON.stringify(customFields),
    keyDates: JSON.stringify(keyDates),
    relationships: JSON.stringify(relationships),
    tags: JSON.stringify(tags),
    favorite: all.some((r) => r.favorite) ? 1 : 0,
  };

  updateContactFields(userId, primaryId, fields);

  if (!primary.photo) {
    const withPhoto = mergeRows.find((r) => r.photo);
    if (withPhoto) setContactPhotoSeq(userId, primaryId, withPhoto.photo, withPhoto.photo_mime);
  }

  const mergeIdList = mergeRows.map((r) => r.id);
  repointRelationshipsTo(userId, mergeIdList, primaryId);
  repointContactGroupMembers(mergeIdList, primaryId);
  for (const id of mergeIdList) deleteContactById(userId, id);

  return statements.getContact.get(primaryId, userId);
});

// Dismissed "not duplicates" pairs, persisted the same way as the seq
// counters/feature flags above — a JSON array tucked into app_settings
// (namespaced per user) rather than a dedicated table for something this small.
function getDismissedDuplicatePairs(userId) {
  const row = statements.getSetting.get(`contacts_dismissed_duplicates:${userId}`);
  if (!row) return new Set();
  try {
    return new Set(JSON.parse(row.value));
  } catch {
    return new Set();
  }
}

function addDismissedDuplicatePairs(userId, keys) {
  const current = getDismissedDuplicatePairs(userId);
  for (const key of keys) current.add(key);
  statements.setSetting.run({ key: `contacts_dismissed_duplicates:${userId}`, value: JSON.stringify([...current]) });
}

// Bulk import (.vcf with many vCards): each contact gets a fresh uid and its
// own seq bump, same as a normal create, just looped in one transaction.
const insertManyContacts = db.transaction((userId, contactsFields) => {
  let imported = 0;
  for (const fields of contactsFields) {
    const seq = nextContactsSeq(userId);
    statements.insertContact.run({ ...fields, userId, seq });
    imported += 1;
  }
  return imported;
});

// Multi-select bulk actions from the Contacts UI — reuses the same
// per-contact transactions so seq bumps/tombstones stay correct for CardDAV.
function bulkContactAction(userId, ids, action) {
  for (const id of ids) {
    if (action === 'delete') deleteContactById(userId, id);
    else if (action === 'favorite') setContactFavoriteSeq(userId, id, 1);
    else if (action === 'unfavorite') setContactFavoriteSeq(userId, id, 0);
  }
}

// Applied from an incoming CardDAV PUT: creates the contact if its UID is new,
// otherwise updates it in place — either way in a single seq bump/transaction.
// A CardDAV PUT only ever carries the fields vCard models — title/tags/
// addresses/etc. are SyncMark-only, so an update preserves whatever the
// contact already had for them instead of wiping them back to empty.
const upsertContactFromVCard = db.transaction((userId, fields) => {
  const existing = statements.getContactFullByUid.get(fields.uid, userId);
  const seq = nextContactsSeq(userId);

  if (existing) {
    statements.updateContact.run({
      id: existing.id,
      userId,
      fullName: fields.fullName,
      firstName: fields.firstName,
      lastName: fields.lastName,
      organization: fields.organization,
      title: existing.title,
      phones: fields.phones,
      emails: fields.emails,
      addresses: existing.addresses,
      socialProfiles: existing.social_profiles,
      messagingHandles: existing.messaging_handles,
      customFields: existing.custom_fields,
      keyDates: existing.key_dates,
      relationships: existing.relationships,
      tags: existing.tags,
      notes: fields.notes,
      favorite: existing.favorite,
      seq,
    });
    if (fields.photo) statements.setContactPhoto.run({ id: existing.id, userId, photo: fields.photo, mime: fields.photoMime, seq });
    return { id: existing.id, seq, created: false };
  }

  const result = statements.insertContact.run({
    userId,
    uid: fields.uid,
    fullName: fields.fullName,
    firstName: fields.firstName,
    lastName: fields.lastName,
    organization: fields.organization,
    title: '',
    phones: fields.phones,
    emails: fields.emails,
    addresses: '[]',
    socialProfiles: '[]',
    messagingHandles: '[]',
    customFields: '[]',
    keyDates: '[]',
    relationships: '[]',
    tags: '[]',
    notes: fields.notes,
    favorite: 0,
    seq,
  });
  const id = result.lastInsertRowid;
  if (fields.photo) statements.setContactPhoto.run({ id, userId, photo: fields.photo, mime: fields.photoMime, seq });
  return { id, seq, created: true };
});

// Same pattern as the contacts seq counter above, kept independent so contact
// and event mutations don't share (and skew) a single sync-token space.
function nextEventsSeq(userId) {
  const next = currentEventsSeq(userId) + 1;
  statements.setSetting.run({ key: `events_seq:${userId}`, value: String(next) });
  return next;
}

function currentEventsSeq(userId) {
  const row = statements.getSetting.get(`events_seq:${userId}`);
  return row ? parseInt(row.value, 10) || 0 : 0;
}

const createEvent = db.transaction((userId, fields) => {
  const seq = nextEventsSeq(userId);
  const result = statements.insertEvent.run({ ...fields, userId, seq });
  return result.lastInsertRowid;
});

const updateEventFields = db.transaction((userId, id, fields) => {
  const seq = nextEventsSeq(userId);
  statements.updateEvent.run({ ...fields, id, userId, seq });
  return seq;
});

const deleteEventById = db.transaction((userId, id) => {
  const row = statements.getEvent.get(id, userId);
  if (!row) return;
  const seq = nextEventsSeq(userId);
  statements.deleteEventRow.run(id, userId);
  statements.insertEventTombstone.run({ uid: row.uid, userId, seq });
});

// Bulk import (.ics with many VEVENTs): each event gets a fresh uid and its
// own seq bump, same shape as insertManyContacts.
const insertManyEvents = db.transaction((userId, eventsFields) => {
  let imported = 0;
  for (const fields of eventsFields) {
    const seq = nextEventsSeq(userId);
    statements.insertEvent.run({ ...fields, userId, seq });
    imported += 1;
  }
  return imported;
});

// Applied from an incoming CalDAV PUT: creates the event if its UID is new,
// otherwise updates it in place — either way in a single seq bump/transaction.
const upsertEventFromICal = db.transaction((userId, fields) => {
  const existing = statements.getEventByUidId.get(fields.uid, userId);
  const seq = nextEventsSeq(userId);

  if (existing) {
    statements.updateEvent.run({ ...fields, id: existing.id, userId, seq });
    return { id: existing.id, seq, created: false };
  }

  const result = statements.insertEvent.run({ ...fields, userId, seq });
  return { id: result.lastInsertRowid, seq, created: true };
});

// bookmarks/contacts/calendar default to enabled — that's what keeps every
// install that predates feature toggles working with nothing turned off, no
// migration step required. files/passwords default to *disabled*: neither
// existed before, so there's no "always worked" expectation to preserve, and
// files is the one feature that reads/writes the host filesystem directly
// rather than just app data — turning either on should be a deliberate choice.
// Feature flags are instance-wide (which tabs exist at all for every regular
// user), not per-user — a server-operation concern, not personal data.
const FEATURE_DEFAULTS = { bookmarks: true, contacts: true, calendar: true, files: false, passwords: false };
const FEATURE_NAMES = Object.keys(FEATURE_DEFAULTS);

function isFeatureEnabled(name) {
  const row = statements.getSetting.get(`feature_${name}`);
  return row ? row.value === '1' : FEATURE_DEFAULTS[name];
}

function getFeatureFlags() {
  const flags = {};
  for (const name of FEATURE_NAMES) flags[name] = isFeatureEnabled(name);
  return flags;
}

function setFeatureFlags(flags) {
  for (const name of FEATURE_NAMES) {
    if (flags[name] === undefined) continue;
    statements.setSetting.run({ key: `feature_${name}`, value: flags[name] ? '1' : '0' });
  }
}

function listMergedFolders(userId) {
  const counts = new Map();
  for (const row of statements.listFolders.all(userId)) counts.set(row.folder, row.count);

  const positions = new Map();
  for (const row of statements.listFolderNames.all(userId)) {
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
  wipeUserData,
  wipeDatabase,
  SORT_CLAUSES,
  isFeatureEnabled,
  getFeatureFlags,
  setFeatureFlags,
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
  deleteContactGroup,
  mergeContacts,
  getDismissedDuplicatePairs,
  addDismissedDuplicatePairs,
  currentEventsSeq,
  createEvent,
  updateEventFields,
  deleteEventById,
  insertManyEvents,
  upsertEventFromICal,
};
