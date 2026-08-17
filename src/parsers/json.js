/**
 * Parses browser bookmark exports in JSON form. Supports:
 *  - Chrome/Edge's `Bookmarks` file (top-level "roots" object)
 *  - Firefox's JSON bookmark backup ("text/x-moz-place[-container]" nodes)
 *  - A generic flat array of {title|name, url} objects
 */
function parseJsonBookmarks(data) {
  if (data && typeof data === 'object' && data.roots) {
    return parseChrome(data);
  }
  if (data && typeof data === 'object' && typeof data.type === 'string' && data.type.startsWith('text/x-moz-place')) {
    return parseFirefox(data);
  }
  if (Array.isArray(data)) {
    return parseGenericArray(data);
  }
  return parseGenericTree(data);
}

function parseChrome(data) {
  const bookmarks = [];
  function walk(node, folderPath) {
    if (!node) return;
    if (node.type === 'url' && node.url) {
      bookmarks.push({ title: node.name || node.url, url: node.url, folder: folderPath.join('/') });
      return;
    }
    if (Array.isArray(node.children)) {
      const nextPath = node.name ? [...folderPath, node.name] : folderPath;
      for (const child of node.children) walk(child, nextPath);
    }
  }
  for (const rootKey of Object.keys(data.roots || {})) {
    const root = data.roots[rootKey];
    if (root && typeof root === 'object') walk(root, []);
  }
  return bookmarks;
}

function parseFirefox(data) {
  const bookmarks = [];
  function walk(node, folderPath) {
    if (!node) return;
    if (node.type === 'text/x-moz-place' && node.uri) {
      bookmarks.push({ title: node.title || node.uri, url: node.uri, folder: folderPath.join('/') });
      return;
    }
    if (Array.isArray(node.children)) {
      const nextPath = node.title ? [...folderPath, node.title] : folderPath;
      for (const child of node.children) walk(child, nextPath);
    }
  }
  walk(data, []);
  return bookmarks;
}

function parseGenericArray(data) {
  return data
    .filter((item) => item && typeof item === 'object' && (item.url || item.href))
    .map((item) => ({
      title: item.title || item.name || item.url || item.href,
      url: item.url || item.href,
      folder: item.folder || '',
    }));
}

function parseGenericTree(data) {
  const bookmarks = [];
  function walk(node, folderPath) {
    if (!node || typeof node !== 'object') return;
    const url = node.url || node.href || node.uri;
    if (url && typeof url === 'string') {
      bookmarks.push({ title: node.title || node.name || url, url, folder: folderPath.join('/') });
      return;
    }
    const children = node.children || node.bookmarks;
    if (Array.isArray(children)) {
      const nextPath = node.title || node.name ? [...folderPath, node.title || node.name] : folderPath;
      for (const child of children) walk(child, nextPath);
    }
  }
  walk(data, []);
  return bookmarks;
}

module.exports = { parseJsonBookmarks };
