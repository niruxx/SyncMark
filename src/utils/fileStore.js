const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { resolveSafePath } = require('./fsPath');

const busy = new Set();
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_UPLOAD = 100 * 1024 ** 3;
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function metadataDir(location, ...segments) {
  let dir = path.resolve(location.path);
  for (const segment of ['.syncmark', ...segments]) {
    if (!/^[a-zA-Z0-9.-]+$/.test(segment) || segment === '..') fail(400, 'Invalid storage key');
    dir = path.join(dir, segment);
    try { fs.mkdirSync(dir); } catch (err) { if (err.code !== 'EEXIST') throw err; }
    if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) fail(403, 'Unsafe storage directory');
  }
  return dir;
}
function etag(target) {
  try {
    const s = fs.statSync(target, { bigint: true });
    return '"' + crypto.createHash('sha256').update(`${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`).digest('hex') + '"';
  } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function precondition(target, expected) {
  if (expected !== undefined && etag(target) !== expected) fail(412, 'File changed on the server; refresh before retrying');
}
function relative(location, target) { return path.relative(path.resolve(location.path), target).split(path.sep).join('/'); }
function isBusy(location) { return busy.has(fs.realpathSync(location.path)); }
async function locked(locations, fn) {
  const keys = [...new Set(locations.map((l) => fs.realpathSync(l.path)))];
  if (keys.some((key) => busy.has(key))) fail(423, 'Location is busy; retry shortly');
  keys.forEach((key) => busy.add(key));
  try { return await fn(); } finally { keys.forEach((key) => busy.delete(key)); }
}
function versionsDir(location, target) {
  const key = crypto.createHash('sha256').update(relative(location, target)).digest('hex');
  return metadataDir(location, 'versions', key);
}
function snapshot(location, target) {
  if (!fs.existsSync(target)) return;
  if (!fs.statSync(target).isFile()) fail(409, 'Target is not a regular file');
  const dir = versionsDir(location, target);
  const id = crypto.randomUUID();
  fs.copyFileSync(target, path.join(dir, id));
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, savedAt: new Date().toISOString(), size: fs.statSync(target).size }));
}
function listVersions(location, target) {
  const dir = versionsDir(location, target);
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
function versionPath(location, target, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) fail(400, 'Invalid version');
  const file = path.join(versionsDir(location, target), id);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) fail(404, 'Version not found');
  return file;
}
// Stage within the same filesystem so the final rename is atomic.
function stagePath(location) { return path.join(metadataDir(location, 'staging'), crypto.randomUUID()); }
function commit(location, target, staged, expected) {
  resolveSafePath(location.path, relative(location, target));
  if (target === path.resolve(location.path)) fail(403, 'Cannot replace a location root');
  precondition(target, expected);
  if (!fs.statSync(path.dirname(target)).isDirectory()) fail(409, 'Parent folder does not exist');
  snapshot(location, target);
  if (fs.existsSync(target)) fs.chmodSync(staged, fs.statSync(target).mode & 0o777);
  fs.renameSync(staged, target);
  return etag(target);
}
async function receive(stream, destination, maxBytes = MAX_UPLOAD) {
  let size = 0;
  const limit = new Transform({ transform(chunk, enc, cb) {
    size += chunk.length;
    cb(size > maxBytes ? Object.assign(new Error('Upload exceeds size limit'), { status: 413 }) : null, chunk);
  } });
  try { await pipeline(stream, limit, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })); }
  catch (err) { fs.rmSync(destination, { force: true }); throw err; }
  return size;
}
function assertTree(location, target) {
  resolveSafePath(location.path, relative(location, target));
  if (target === path.resolve(location.path)) fail(403, 'Cannot operate on a location root');
  const stat = fs.lstatSync(target);
  if (!stat.isFile() && !stat.isDirectory()) fail(403, 'Only regular files and folders are supported');
  if (stat.isDirectory()) for (const name of fs.readdirSync(target)) assertTree(location, path.join(target, name));
}
function transfer(sourceLocation, source, destLocation, destination, move = false) {
  assertTree(sourceLocation, source);
  resolveSafePath(destLocation.path, relative(destLocation, destination));
  const realSource = fs.realpathSync(source);
  const realDestination = path.join(fs.realpathSync(path.dirname(destination)), path.basename(destination));
  if (realDestination === realSource || realDestination.startsWith(realSource + path.sep)) fail(409, 'Cannot transfer an item into itself');
  if (fs.existsSync(destination)) fail(409, 'Destination already exists');
  if (move) {
    try { fs.renameSync(source, destination); return; } catch (err) { if (err.code !== 'EXDEV') throw err; }
  }
  const staged = stagePath(destLocation);
  try {
    fs.cpSync(source, staged, { recursive: true, errorOnExist: true, force: false });
    fs.renameSync(staged, destination);
    if (move) fs.rmSync(source, { recursive: true });
  } finally { fs.rmSync(staged, { recursive: true, force: true }); }
}
function trash(location, target) {
  assertTree(location, target);
  const trashRoot = path.join(location.path, '.trash');
  fs.mkdirSync(trashRoot, { recursive: true });
  if (fs.lstatSync(trashRoot).isSymbolicLink()) fail(403, 'Unsafe trash directory');
  const id = crypto.randomUUID();
  const dir = path.join(trashRoot, id);
  fs.mkdirSync(dir);
  const name = path.basename(target);
  fs.writeFileSync(path.join(dir, '.meta.json'), JSON.stringify({ name, originalRelPath: relative(location, target), deletedAt: new Date().toISOString() }));
  fs.renameSync(target, path.join(dir, name));
}
module.exports = { CHUNK_SIZE, MAX_UPLOAD, fail, metadataDir, etag, precondition, relative, isBusy, locked, snapshot, listVersions, versionPath, stagePath, commit, receive, transfer, trash };
