const fs = require('fs');
const path = require('path');
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
  if (fs.existsSync(destination)) return res.status(409).json({ error: 'A file or folder with that name already exists' });

  try {
    fs.renameSync(source, destination);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

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

  try {
    fs.rmSync(target, { recursive: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(204).end();
});

module.exports = router;
