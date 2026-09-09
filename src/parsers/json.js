/**
 * Parses browser and third-party bookmark/read-it-later exports in JSON
 * form. Supports:
 *  - Chrome/Edge's `Bookmarks` file (top-level "roots" object)
 *  - Firefox's JSON bookmark backup ("text/x-moz-place[-container]" nodes)
 *  - Linkwarden's full backup ({ collections: [{ links: [...] }] })
 *  - Karakeep/Hoarder's export ({ bookmarks: [{ content: { url } }] })
 *  - Tab Session Manager's session export ([{ windows: [{ tabs: [...] }] }])
 *  - OneTab's "advanced" JSON export ([{ tabLinks: [{ link, title }] }])
 *  - Omnivore's metadata export and other flat arrays of {title|name, url},
 *    via the generic array/tree fallbacks (labels/tags become the folder)
 */
function parseJsonBookmarks(data) {
  if (data && typeof data === 'object' && data.roots) {
    return parseChrome(data);
  }
  if (data && typeof data === 'object' && typeof data.type === 'string' && data.type.startsWith('text/x-moz-place')) {
    return parseFirefox(data);
  }
  if (data && typeof data === 'object' && Array.isArray(data.collections)) {
    return parseLinkwarden(data);
  }
  if (data && typeof data === 'object' && Array.isArray(data.bookmarks)) {
    return parseKarakeep(data);
  }
  if (Array.isArray(data) && data.some((item) => item && Array.isArray(item.windows))) {
    return parseTabSessionManager(data);
  }
  if (Array.isArray(data) && data.some((item) => item && Array.isArray(item.tabLinks))) {
    return parseOneTabJson(data);
  }
  if (Array.isArray(data)) {
    return parseGenericArray(data);
  }
  return parseGenericTree(data);
}

// [{name}] or ["name"] -> "name" (first entry only — a single folder path
// can't represent a multi-label item, so this is necessarily best-effort).
function firstLabel(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const first = list[0];
  return typeof first === 'string' ? first : (first && first.name) || '';
}

function folderFromItem(item) {
  if (item.folder) return item.folder;
  return firstLabel(item.labels) || firstLabel(item.tags);
}

// Linkwarden full backup: { collections: [{ id, name, parentId, links: [{ url|href, name|title }] }] }
function parseLinkwarden(data) {
  const byId = new Map();
  for (const col of data.collections) {
    if (col && col.id != null) byId.set(col.id, col);
  }

  function pathFor(col) {
    const parts = [];
    let current = col;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.name) parts.unshift(current.name);
      current = current.parentId != null ? byId.get(current.parentId) : null;
    }
    return parts.join('/');
  }

  const bookmarks = [];
  for (const col of data.collections) {
    if (!col || !Array.isArray(col.links)) continue;
    const folder = pathFor(col);
    for (const link of col.links) {
      const url = link && (link.url || link.href);
      if (url) bookmarks.push({ title: link.name || link.title || url, url, folder });
    }
  }
  return bookmarks;
}

// Karakeep/Hoarder export: { bookmarks: [{ title, tags, content: { type, url } }] }
function parseKarakeep(data) {
  const bookmarks = [];
  for (const item of data.bookmarks) {
    if (!item) continue;
    const url = item.url || (item.content && item.content.url);
    if (!url) continue;
    bookmarks.push({ title: item.title || url, url, folder: firstLabel(item.tags) });
  }
  return bookmarks;
}

// Tab Session Manager: [{ name, date, windows: [{ tabs: [{ url, title }] }] }]
function parseTabSessionManager(data) {
  const bookmarks = [];
  for (const session of data) {
    if (!session || !Array.isArray(session.windows)) continue;
    const folder = session.name || (session.date ? new Date(session.date).toLocaleString() : '');
    for (const win of session.windows) {
      if (!win || !Array.isArray(win.tabs)) continue;
      for (const tab of win.tabs) {
        if (tab && typeof tab.url === 'string') {
          bookmarks.push({ title: tab.title || tab.url, url: tab.url, folder });
        }
      }
    }
  }
  return bookmarks;
}

// OneTab's alternate JSON export: [{ groupTitle, tabLinks: [{ link, title }] }]
function parseOneTabJson(data) {
  const bookmarks = [];
  for (const group of data) {
    if (!group || !Array.isArray(group.tabLinks)) continue;
    const folder = group.groupTitle || '';
    for (const tab of group.tabLinks) {
      const url = tab && (tab.link || tab.url);
      if (url) bookmarks.push({ title: tab.title || url, url, folder });
    }
  }
  return bookmarks;
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
      folder: folderFromItem(item),
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
