// Minimal streaming USTAR (tar) writer/reader, gzip'd — used only by
// src/backup.js. Hand-rolled rather than a dependency: the format is small
// and well-documented, and a real tar.gz means a backup is inspectable with
// any standard tool, not just something this app can open. Both directions
// stream file content rather than buffering it, since File Manager locations
// have no size cap by design — a backup could be many GB.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const BLOCK_SIZE = 512;

function octalField(buf, offset, length, value) {
  const str = Math.floor(value).toString(8).padStart(length - 1, '0');
  buf.write(str, offset, length - 1, 'ascii');
  buf[offset + length - 1] = 0;
}

// USTAR's name field is 100 bytes; a longer relative path needs to be split
// across it and the 155-byte prefix field at the last "/" that makes both
// halves fit. Returns null if even that isn't enough (extremely deep path).
function splitName(name) {
  if (Buffer.byteLength(name, 'utf8') <= 100) return { prefix: '', name };
  for (let i = name.length - 1; i >= 0; i -= 1) {
    if (name[i] !== '/') continue;
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(rest, 'utf8') <= 100) {
      return { prefix, name: rest };
    }
  }
  return null;
}

function buildHeader({ name, size, mtimeSec }) {
  const split = splitName(name);
  if (!split) return null;

  const buf = Buffer.alloc(BLOCK_SIZE);
  buf.write(split.name, 0, 100, 'utf8');
  octalField(buf, 100, 8, 0o644); // mode
  octalField(buf, 108, 8, 0); // uid
  octalField(buf, 116, 8, 0); // gid
  octalField(buf, 124, 12, size);
  octalField(buf, 136, 12, mtimeSec);
  buf.fill(0x20, 148, 156); // checksum field = 8 spaces while computing it
  buf[156] = 0x30; // typeflag '0' — regular file; this writer never emits others
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write(split.prefix, 345, 155, 'utf8');

  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i += 1) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;

  return buf;
}

class TarWriter {
  constructor(destPath) {
    this.gzip = zlib.createGzip();
    this.pipeDone = pipeline(this.gzip, fs.createWriteStream(destPath));
  }

  async _write(buf) {
    if (buf.length && !this.gzip.write(buf)) {
      await new Promise((resolve) => this.gzip.once('drain', resolve));
    }
  }

  async _pad(size) {
    const pad = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
    if (pad) await this._write(Buffer.alloc(pad));
  }

  async addBuffer(name, content, mtimeSec = Math.floor(Date.now() / 1000)) {
    const header = buildHeader({ name, size: content.length, mtimeSec });
    if (!header) {
      console.warn(`tar: skipping entry with an unworkable path length: ${name}`);
      return;
    }
    await this._write(header);
    await this._write(content);
    await this._pad(content.length);
  }

  // Streams the source file's content rather than reading it fully into
  // memory first. `size`/`mtimeSec` are captured by the caller up front (a
  // stat taken before this runs) — content is truncated or zero-padded to
  // exactly that many bytes if the source changes size while being read
  // (a live personal server can have a file mid-write), since the header's
  // declared size has already been committed to the stream and must match.
  async addFile(name, sourcePath, size, mtimeSec) {
    const header = buildHeader({ name, size, mtimeSec });
    if (!header) {
      console.warn(`tar: skipping entry with an unworkable path length: ${name}`);
      return;
    }
    await this._write(header);

    let remaining = size;
    const readStream = fs.createReadStream(sourcePath);
    try {
      for await (const chunk of readStream) {
        if (remaining <= 0) break;
        const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        await this._write(slice);
        remaining -= slice.length;
      }
    } finally {
      readStream.destroy();
    }
    if (remaining > 0) await this._write(Buffer.alloc(remaining));
    await this._pad(size);
  }

  async finish() {
    await this._write(Buffer.alloc(BLOCK_SIZE * 2)); // two all-zero blocks = tar EOF
    this.gzip.end();
    await this.pipeDone;
  }
}

function parseOctal(buf, offset, length) {
  let str = buf.toString('ascii', offset, offset + length);
  const nul = str.indexOf('\0');
  if (nul !== -1) str = str.slice(0, nul);
  str = str.trim();
  return str ? parseInt(str, 8) : 0;
}

function readHeaderName(header) {
  const name = header.toString('ascii', 0, 100).replace(/\0.*$/s, '');
  const prefix = header.toString('ascii', 345, 500).replace(/\0.*$/s, '');
  return prefix ? `${prefix}/${name}` : name;
}

// options: { onJson: async (obj) => void, resolveDest: (entryName) => string|null,
//            stopAfterJson: boolean }
// `onJson` fires for the single "db.json" entry (buffered in memory — it's
// the same size class as the DB snapshot already was, no size-cap concern).
// `resolveDest` maps every other entry to a destination path, or a falsy
// value to skip it — the file's bytes are still consumed either way so the
// stream stays aligned for the next header. `stopAfterJson` stops reading
// (and decompressing) right after db.json — since it's always written
// first, this makes "what modules does this backup contain" cheap even for
// a large archive, without ever touching the (often much bigger) file
// portion that follows it.
async function extractTarGz(archivePath, { onJson, resolveDest, stopAfterJson = false } = {}) {
  const sourceStream = fs.createReadStream(archivePath);
  const gunzip = zlib.createGunzip();
  const source = pipeline(sourceStream, gunzip).catch(() => {
    /* surfaced instead via the read loop below hitting a stream error, or
       swallowed on purpose below when stopAfterJson destroys the streams */
  });
  const iterator = gunzip[Symbol.asyncIterator]();

  let buffered = Buffer.alloc(0);

  async function readBytes(n) {
    while (buffered.length < n) {
      const { value, done } = await iterator.next();
      if (done) break;
      buffered = buffered.length ? Buffer.concat([buffered, value]) : value;
    }
    if (buffered.length < n) return buffered.length ? buffered : null;
    const result = buffered.subarray(0, n);
    buffered = buffered.subarray(n);
    return result;
  }

  async function readExact(n) {
    if (n <= 0) return Buffer.alloc(0);
    let out = Buffer.alloc(0);
    let remaining = n;
    while (remaining > 0) {
      const chunk = await readBytes(Math.min(remaining, 65536));
      if (!chunk) break;
      out = out.length ? Buffer.concat([out, chunk]) : chunk;
      remaining -= chunk.length;
    }
    return out;
  }

  let sawDbJson = false;
  let zeroBlocks = 0;

  while (true) {
    const header = await readBytes(BLOCK_SIZE);
    if (!header || header.length < BLOCK_SIZE) break;
    if (header.every((b) => b === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;

    const name = readHeaderName(header);
    const size = parseOctal(header, 124, 12);
    const padOnly = (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;

    if (name === 'db.json') {
      const content = await readExact(size);
      await readExact(padOnly);
      sawDbJson = true;
      if (onJson) await onJson(JSON.parse(content.toString('utf8')));
      if (stopAfterJson) {
        sourceStream.destroy();
        gunzip.destroy();
        break;
      }
      continue;
    }

    const destPath = resolveDest ? resolveDest(name) : null;
    if (!destPath) {
      await readExact(size);
      await readExact(padOnly);
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath);
    let remaining = size;
    while (remaining > 0) {
      const chunk = await readBytes(Math.min(remaining, 65536));
      if (!chunk) break;
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      remaining -= chunk.length;
    }
    await new Promise((resolve, reject) => {
      out.once('finish', resolve);
      out.once('error', reject);
      out.end();
    });
    await readExact(padOnly);
  }

  await source;
  return { sawDbJson };
}

module.exports = { TarWriter, extractTarGz };
