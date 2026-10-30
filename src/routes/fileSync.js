const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Readable } = require('stream');
const { statements } = require('../db');
const { resolveSafePath } = require('../utils/fsPath');
const store = require('../utils/fileStore');
const router = express.Router();
const run = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function locationFor(req, id = req.query.location || req.body?.location) {
  const location = statements.getFileLocation.get(id || '', req.user.id);
  if (!location) store.fail(404, 'Location not found');
  return location;
}
function targetFor(req, location) { return resolveSafePath(location.path, req.query.path || req.body?.path || '.'); }
function uploadFor(req, location) {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) store.fail(400, 'Invalid upload ID');
  const dir = path.join(store.metadataDir(location, 'uploads'), req.params.id);
  let meta;
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) store.fail(403, 'Unsafe upload directory');
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch (err) { if (err.status) throw err; store.fail(404, 'Upload not found'); }
  if (meta.userId !== req.user.id) store.fail(404, 'Upload not found');
  if (Date.now() - (meta.updatedAt || meta.createdAt) > 7 * 86400000) store.fail(410, 'Upload expired; cancel it and start again');
  return { dir, meta };
}
function saveMeta(dir, meta) {
  const temp = path.join(dir, 'meta.tmp');
  fs.writeFileSync(temp, JSON.stringify(meta));
  fs.renameSync(temp, path.join(dir, 'meta.json'));
}
router.get('/files/sync-info', (req, res) => {
  const location = locationFor(req);
  res.json({ webdavPath: `/webdav/${location.id}/`, chunkSize: store.CHUNK_SIZE, maxUploadBytes: store.MAX_UPLOAD });
});
router.get('/files/versions', (req, res, next) => {
  try { const location = locationFor(req); res.json(store.listVersions(location, targetFor(req, location))); } catch (err) { next(err); }
});
router.get('/files/versions/:id', (req, res, next) => {
  try {
    const location = locationFor(req);
    const target = targetFor(req, location);
    const file = store.versionPath(location, target, req.params.id);
    res.set({ 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    if (req.query.preview === '1') {
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
      res.type(types[path.extname(target).toLowerCase()] || 'text/plain').sendFile(file);
    }
    else res.download(file, path.basename(target));
  } catch (err) { next(err); }
});
router.post('/files/versions/:id/restore', run(async (req, res) => {
  const location = locationFor(req);
  await store.locked([location], async () => {
    const target = targetFor(req, location);
    const staged = store.stagePath(location);
    try {
      fs.copyFileSync(store.versionPath(location, target, req.params.id), staged);
      const tag = store.commit(location, target, staged, req.headers['if-match']);
      res.json({ etag: tag });
    } finally { fs.rmSync(staged, { force: true }); }
  });
}));
router.post('/files/bulk', run(async (req, res) => {
  const sourceLocation = locationFor(req);
  const { operation, paths, destinationPath = '.' } = req.body;
  if (!['copy', 'move', 'trash'].includes(operation)) store.fail(400, 'Invalid operation');
  if (!Array.isArray(paths) || !paths.length || paths.length > 100 || paths.some((p) => typeof p !== 'string')) store.fail(400, 'Select 1–100 paths');
  const destLocation = operation === 'trash' ? sourceLocation : locationFor(req, req.body.destinationLocation || sourceLocation.id);
  await store.locked([sourceLocation, destLocation], async () => {
    const destination = resolveSafePath(destLocation.path, destinationPath);
    if (operation !== 'trash' && !fs.statSync(destination).isDirectory()) store.fail(409, 'Destination is not a folder');
    const results = [];
    for (const item of [...new Set(paths)]) {
      try {
        const source = resolveSafePath(sourceLocation.path, item);
        if (operation === 'trash') store.trash(sourceLocation, source);
        else store.transfer(sourceLocation, source, destLocation, path.join(destination, path.basename(source)), operation === 'move');
        results.push({ path: item, ok: true });
      } catch (err) { results.push({ path: item, ok: false, error: err.message }); }
    }
    res.json({ results });
  });
}));
router.post('/files/uploads', run(async (req, res) => {
  const location = locationFor(req);
  await store.locked([location], async () => {
    const target = targetFor(req, location);
    if (target === path.resolve(location.path)) store.fail(400, 'A filename is required');
    const size = req.body.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > store.MAX_UPLOAD) store.fail(400, 'Invalid upload size (maximum 100 GiB)');
    if (!fs.statSync(path.dirname(target)).isDirectory()) store.fail(409, 'Parent folder does not exist');
    const expected = store.etag(target);
    if (expected !== null && req.body.overwrite !== true) store.fail(409, 'File already exists');
    const root = store.metadataDir(location, 'uploads');
    // Reap expired sessions when starting another transfer.
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id);
      if (!/^[a-f0-9-]{36}$/.test(id) || fs.lstatSync(dir).isSymbolicLink()) continue;
      if (Date.now() - fs.statSync(dir).mtimeMs > 7 * 86400000) fs.rmSync(dir, { recursive: true });
    }
    if (fs.readdirSync(root).length >= 20) store.fail(429, 'Too many unfinished uploads; cancel one first');
    const id = crypto.randomUUID();
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    saveMeta(dir, { userId: req.user.id, path: store.relative(location, target), size, offset: 0, expected, createdAt: Date.now(), chunks: [] });
    res.status(201).json({ id, offset: 0, chunkSize: store.CHUNK_SIZE });
  });
}));
router.get('/files/uploads/:id', (req, res, next) => {
  try { const { meta } = uploadFor(req, locationFor(req)); res.json({ offset: meta.offset, size: meta.size, path: meta.path, chunkSize: store.CHUNK_SIZE }); } catch (err) { next(err); }
});
router.put('/files/uploads/:id', run(async (req, res) => {
  const location = locationFor(req);
  await store.locked([location], async () => {
    const { dir, meta } = uploadFor(req, location);
    if (!/^\d+$/.test(req.headers['upload-offset'] || '') || Number(req.headers['upload-offset']) !== meta.offset) store.fail(409, 'Upload offset mismatch; query upload status');
    const chunk = crypto.randomUUID();
    const chunkPath = path.join(dir, chunk);
    try {
      const bytes = await store.receive(req, chunkPath, Math.min(store.CHUNK_SIZE, meta.size - meta.offset));
      if (!bytes) store.fail(400, 'Empty chunk');
      meta.offset += bytes;
      meta.updatedAt = Date.now();
      meta.chunks.push(chunk);
      saveMeta(dir, meta);
      res.json({ offset: meta.offset });
    } catch (err) { fs.rmSync(chunkPath, { force: true }); throw err; }
  });
}));
router.post('/files/uploads/:id/complete', run(async (req, res) => {
  const location = locationFor(req);
  await store.locked([location], async () => {
    const { dir, meta } = uploadFor(req, location);
    if (meta.offset !== meta.size) store.fail(409, 'Upload is incomplete');
    const staged = store.stagePath(location);
    try {
      async function* chunks() { for (const chunk of meta.chunks) yield* fs.createReadStream(path.join(dir, chunk)); }
      await store.receive(Readable.from(chunks()), staged, meta.size);
      const target = resolveSafePath(location.path, meta.path);
      const tag = store.commit(location, target, staged, meta.expected);
      fs.rmSync(dir, { recursive: true });
      res.status(201).json({ etag: tag });
    } finally { fs.rmSync(staged, { force: true }); }
  });
}));
router.delete('/files/uploads/:id', run(async (req, res) => {
  const location = locationFor(req);
  await store.locked([location], async () => {
    // Cancellation also works on expired sessions.
    if (!/^[a-f0-9-]{36}$/.test(req.params.id)) store.fail(400, 'Invalid upload ID');
    const dir = path.join(store.metadataDir(location, 'uploads'), req.params.id);
    if (fs.existsSync(dir)) {
      if (fs.lstatSync(dir).isSymbolicLink()) store.fail(403, 'Unsafe upload directory');
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      if (meta.userId !== req.user.id) store.fail(404, 'Upload not found');
      fs.rmSync(dir, { recursive: true });
    }
    res.status(204).end();
  });
}));
module.exports = router;
