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
  `);
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
};
