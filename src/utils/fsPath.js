// The one module every File Manager route depends on getting right: every
// location is a sandbox, and nothing this app does on behalf of the browser
// should ever be able to read/write/delete outside the configured root.

const fs = require('fs');
const path = require('path');

class SafePathError extends Error {}

// path.resolve() alone collapses ".."/"." segments but doesn't prove
// containment — "target === base || target.startsWith(base + sep)" (not a
// bare startsWith(base)) is what's needed, since a bare prefix check would
// wrongly let a sibling like "/srv/docs-evil" pass against base "/srv/docs".
function assertContained(base, target, message) {
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new SafePathError(message);
  }
}

// Best-effort symlink defense-in-depth: if the target (or its nearest
// existing ancestor, for a not-yet-created upload/mkdir destination) resolves
// through a symlink to somewhere outside the location, reject it too — a
// plain path.resolve() never follows symlinks, so this catches what that
// can't. Documented as best-effort: the admin who configures a location is
// already the single trusted account on this app, same trust level as
// everywhere else.
function assertRealPathContained(base, target) {
  const baseReal = fs.realpathSync(base);
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return; // hit the filesystem root without finding anything real — nothing to check
    probe = parent;
  }
  const probeReal = fs.realpathSync(probe);
  assertContained(baseReal, probeReal, 'Path escapes the configured location (symlink)');
}

// basePath: a location's configured absolute root. relativePath: an
// (untrusted) path from the request, relative to that root.
function resolveSafePath(basePath, relativePath) {
  const base = path.resolve(basePath);
  const target = path.resolve(base, relativePath || '.');
  assertContained(base, target, 'Path escapes the configured location');
  assertRealPathContained(base, target);
  return target;
}

// For filenames/folder names that are supposed to be a single path segment
// (an upload's filename, a new folder's name, a rename target) rather than a
// path — strips anything that could turn it into one, so a crafted field
// like "../../evil" can't smuggle a traversal in through a non-path input.
function sanitizeName(name) {
  const base = path.basename(String(name || '').trim());
  return base
    .replace(/[\\/]/g, '') // no separators should survive basename, but belt-and-suspenders
    .replace(/[<>:"|?*\x00-\x1f]/g, '') // reserved on Windows; control chars nowhere valid
    .replace(/^\.+$/, ''); // "." / ".." alone would otherwise resolve to "no-op" or "up a level"
}

module.exports = { resolveSafePath, sanitizeName, SafePathError };
