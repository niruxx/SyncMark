const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { statements } = require('../db');
const { resolveSafePath, sanitizeName } = require('../utils/fsPath');

const router = express.Router();

function getLocationOrNull(id) {
  return id ? statements.getFileLocation.get(id) : null;
}

function validateLocationPath(p) {
  if (!p || !path.isAbsolute(p)) return 'Path must be an absolute directory path';
  if (!fs.existsSync(p)) return 'Path does not exist on this server';
  if (!fs.statSync(p).isDirectory()) return 'Path is not a directory';
  return null;
}

// ---------- trash (soft delete) ----------
// Each location gets its own hidden .trash/<uuid>/ holding the moved item
// plus a .meta.json recording where it came from — trash has to live inside
// the location's own sandbox, since it can't reach across locations. A
// same-volume fs.renameSync moves items in and out instantly regardless of
// size, same as the existing rename route.

function trashDir(location) {
  return path.join(location.path, '.trash');
}

// Reserves ".trash" at a location's root so an upload/mkdir/rename can never
// collide with (and silently vanish behind) the reserved folder.
function isTrashRootPath(location, absPath) {
  return absPath === path.resolve(trashDir(location));
}

function readTrashEntries(location) {
  const dir = trashDir(location);
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const id of fs.readdirSync(dir)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, id, '.meta.json'), 'utf8'));
      let size = 0;
      try {
        const stat = fs.statSync(path.join(dir, id, meta.name));
        size = stat.isDirectory() ? 0 : stat.size;
      } catch {
        /* item itself vanished — meta still lets it show up so it can be cleaned up */
      }
      results.push({ id, name: meta.name, originalRelPath: meta.originalRelPath, deletedAt: meta.deletedAt, size });
    } catch {
      continue; // missing/corrupt sidecar — skip rather than fail the whole list
    }
  }
  results.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  return results;
}

// ---------- locations ----------

// Lists directories at an arbitrary server path — deliberately unsandboxed,
// unlike every other /files route: this exists only so the admin (the one
// account this whole app trusts) can browse to a folder while *choosing*
// what to sandbox, rather than typing an absolute path blind. It never
// returns file contents or non-directory entries, only names/paths.
function browseServerDir(dir) {
  const parent = path.dirname(dir);
  let entries = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .map((dirent) => {
        if (dirent.name.startsWith('.')) return null;
        const full = path.join(dir, dirent.name);
        let isDir = dirent.isDirectory();
        if (!isDir && dirent.isSymbolicLink()) {
          try {
            isDir = fs.statSync(full).isDirectory();
          } catch {
            return null;
          }
        }
        return isDir ? { name: dirent.name, path: full } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch {
    /* permission-denied directories etc. — show nothing rather than failing the whole browse */
  }
  return { path: dir, parent: parent !== dir ? parent : null, entries };
}

router.get('/files/browse-server', (req, res) => {
  const requested = String(req.query.path || '').trim();

  if (!requested) {
    // No path yet: Windows has no single filesystem root, so list drive
    // letters instead; everywhere else, start at "/".
    if (process.platform === 'win32') {
      const drives = [];
      for (let i = 65; i <= 90; i += 1) {
        const drive = `${String.fromCharCode(i)}:\\`;
        if (fs.existsSync(drive)) drives.push({ name: drive, path: drive });
      }
      return res.json({ path: null, parent: null, entries: drives });
    }
    return res.json(browseServerDir('/'));
  }

  const target = path.resolve(requested);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'Folder not found' });
  }
  res.json(browseServerDir(target));
});

router.get('/files/locations', (req, res) => {
  res.json(statements.listFileLocations.all());
});

router.post('/files/locations', (req, res) => {
  const name = (req.body.name || '').trim();
  const locPath = (req.body.path || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const error = validateLocationPath(locPath);
  if (error) return res.status(400).json({ error });

  try {
    const result = statements.insertFileLocation.run({ name, path: locPath });
    res.status(201).json(statements.getFileLocation.get(result.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A location with that name already exists' });
    throw err;
  }
});

router.put('/files/locations/:id', (req, res) => {
  const existing = statements.getFileLocation.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });

  const name = (req.body.name ?? existing.name).trim();
  const locPath = (req.body.path ?? existing.path).trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const error = validateLocationPath(locPath);
  if (error) return res.status(400).json({ error });

  try {
    statements.updateFileLocation.run({ id: existing.id, name, path: locPath });
    res.json(statements.getFileLocation.get(existing.id));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A location with that name already exists' });
    throw err;
  }
});

// Only un-registers the location — never touches anything on disk.
router.delete('/files/locations/:id', (req, res) => {
  const existing = statements.getFileLocation.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Location not found' });
  statements.deleteFileLocation.run(existing.id);
  res.status(204).end();
});

// ---------- browsing ----------

router.get('/files/browse', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let dir;
  try {
    dir = resolveSafePath(location.path, req.query.path || '.');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(dir)) {
    return res.status(404).json({ error: "This location's configured path no longer exists on disk" });
  }
  if (!fs.statSync(dir).isDirectory()) {
    return res.status(400).json({ error: 'Not a folder' });
  }

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== '.trash')
    .map((entry) => {
      let stat;
      try {
        stat = fs.statSync(path.join(dir, entry.name));
      } catch {
        return null; // e.g. a broken symlink target — skip rather than fail the whole listing
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .filter(Boolean);

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  res.json(entries);
});

router.get('/files/download', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(target);
});

// Deliberately mirrors GET /contacts/:id/photo's inline-serving pattern:
// a strict extension allowlist (never trust the client), nosniff, and a
// locked-down CSP — the same stored-XSS-safe recipe for serving
// user-controlled binary content inline instead of forcing a download.
const VIEWABLE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
};

router.get('/files/view', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  const mime = VIEWABLE_MIME[path.extname(target).toLowerCase()];
  if (!mime) return res.status(415).json({ error: "This file type can't be viewed inline" });

  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-cache');
  // sendFile (not download/plain send) — gets Range-request support for
  // free, which video playback needs in order to seek.
  res.sendFile(target);
});

// ---------- text file editing ----------

const TEXT_MAX_BYTES = 5 * 1024 * 1024;

router.get('/files/text', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }
  if (fs.statSync(target).size > TEXT_MAX_BYTES) {
    return res.status(413).json({ error: 'File is too large to edit in the browser (5 MB limit)' });
  }

  try {
    res.json({ content: fs.readFileSync(target, 'utf8') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Raw text/plain body (not JSON — no escaping overhead for large content)
// with its own scoped size limit, since express.json()'s app-wide default
// in server.js is far smaller than a text file can reasonably be — same
// "scope the parser, don't touch the global default" precedent
// carddav.js/caldav.js already set for their own body parsing.
router.put('/files/text', express.text({ type: 'text/plain', limit: '6mb' }), (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  const content = req.body || '';
  if (Buffer.byteLength(content, 'utf8') > TEXT_MAX_BYTES) {
    return res.status(413).json({ error: 'Content is too large to save (5 MB limit)' });
  }

  try {
    fs.writeFileSync(target, content, 'utf8');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

// ---------- permissions ----------
// fs.chmod is fully meaningful on POSIX but only really controls the
// read-only attribute on Windows — the response reports which platform
// this server is on so the client can show the right UI instead of
// pretending Windows has real owner/group/other bits.

router.get('/files/permissions', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });

  const stat = fs.statSync(target);
  res.json({
    mode: stat.mode & 0o777,
    platform: process.platform === 'win32' ? 'win32' : 'posix',
    isDirectory: stat.isDirectory(),
  });
});

router.put('/files/permissions', (req, res) => {
  const location = getLocationOrNull(req.body.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.body.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });

  const mode = Number(req.body.mode);
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    return res.status(400).json({ error: 'Invalid permissions value' });
  }

  try {
    fs.chmodSync(target, mode);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

// ---------- upload ----------
// diskStorage (not memoryStorage, unlike the avatar/photo/import routes) —
// this is the one upload path meant for large files, so nothing should
// buffer in RAM. No limits.fileSize cap either: disk space is the natural
// limit for a personal file server, a deliberate departure from the
// conservative caps used elsewhere in the app for a different purpose.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const location = getLocationOrNull(req.query.location);
        if (!location) return cb(new Error('Location not found'));
        const dir = resolveSafePath(location.path, req.query.path || '.');
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return cb(new Error('Destination folder not found'));
        }
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      try {
        const location = getLocationOrNull(req.query.location);
        const dir = resolveSafePath(location.path, req.query.path || '.');
        const name = sanitizeName(file.originalname);
        if (!name) return cb(new Error('Invalid filename'));
        if (name === '.trash' && dir === path.resolve(location.path)) return cb(new Error('RESERVED'));
        if (req.query.overwrite !== '1' && fs.existsSync(path.join(dir, name))) {
          return cb(new Error('EEXIST'));
        }
        cb(null, name);
      } catch (err) {
        cb(err);
      }
    },
  }),
});

router.post('/files/upload', (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      if (err.message === 'EEXIST') return res.status(409).json({ error: 'A file with that name already exists' });
      if (err.message === 'RESERVED') return res.status(409).json({ error: '".trash" is a reserved name at a location\'s root' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    res.status(201).json({ uploaded: (req.files || []).length });
  });
});

// ---------- mkdir / rename / delete ----------

router.post('/files/mkdir', (req, res) => {
  const location = getLocationOrNull(req.body.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const name = sanitizeName(req.body.name);
  if (!name) return res.status(400).json({ error: 'A valid folder name is required' });

  let target;
  try {
    target = resolveSafePath(location.path, path.join(req.body.path || '.', name));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (isTrashRootPath(location, target)) {
    return res.status(409).json({ error: '".trash" is a reserved name at a location\'s root' });
  }
  if (fs.existsSync(target)) return res.status(409).json({ error: 'A file or folder with that name already exists' });

  try {
    fs.mkdirSync(target);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(201).json({ ok: true });
});

router.put('/files/rename', (req, res) => {
  const location = getLocationOrNull(req.body.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const newName = sanitizeName(req.body.newName);
  if (!newName) return res.status(400).json({ error: 'A valid new name is required' });

  let source;
  let destination;
  try {
    source = resolveSafePath(location.path, req.body.path || '');
    destination = resolveSafePath(location.path, path.join(path.dirname(req.body.path || '.'), newName));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(source)) return res.status(404).json({ error: 'Not found' });
  if (isTrashRootPath(location, destination)) {
    return res.status(409).json({ error: '".trash" is a reserved name at a location\'s root' });
  }
  if (fs.existsSync(destination)) return res.status(409).json({ error: 'A file or folder with that name already exists' });

  try {
    fs.renameSync(source, destination);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

// Moves to .trash rather than permanently deleting — see the trash section
// above. Permanent removal only happens via the trash routes below.
router.delete('/files/item', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  let target;
  try {
    target = resolveSafePath(location.path, req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (target === path.resolve(location.path)) {
    return res.status(400).json({ error: "Can't delete the location's root folder itself — remove the location instead" });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });

  const relPath = path.relative(location.path, target).split(path.sep).join('/');
  const name = path.basename(target);
  const itemDir = path.join(trashDir(location), crypto.randomUUID());

  try {
    fs.mkdirSync(itemDir, { recursive: true });
    fs.renameSync(target, path.join(itemDir, name));
    fs.writeFileSync(
      path.join(itemDir, '.meta.json'),
      JSON.stringify({ name, originalRelPath: relPath, deletedAt: new Date().toISOString() })
    );
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(204).end();
});

// ---------- trash management ----------

router.get('/files/trash', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  res.json(readTrashEntries(location));
});

router.post('/files/trash/:id/restore', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid trash item id' });

  const itemDir = path.join(trashDir(location), req.params.id);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(itemDir, '.meta.json'), 'utf8'));
  } catch {
    return res.status(404).json({ error: 'Trash item not found' });
  }

  let destination;
  try {
    destination = resolveSafePath(location.path, meta.originalRelPath);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (fs.existsSync(destination)) {
    return res.status(409).json({ error: 'Something already exists at the original location — move or rename it first' });
  }

  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(path.join(itemDir, meta.name), destination);
    fs.rmSync(itemDir, { recursive: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.delete('/files/trash/:id', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid trash item id' });

  const itemDir = path.join(trashDir(location), req.params.id);
  if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Trash item not found' });

  try {
    fs.rmSync(itemDir, { recursive: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(204).end();
});

router.delete('/files/trash', (req, res) => {
  const location = getLocationOrNull(req.query.location);
  if (!location) return res.status(404).json({ error: 'Location not found' });

  try {
    fs.rmSync(trashDir(location), { recursive: true, force: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(204).end();
});

module.exports = router;
