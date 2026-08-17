function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTree(bookmarks) {
  const root = { children: new Map(), bookmarks: [] };
  for (const bookmark of bookmarks) {
    if (!bookmark.folder) {
      root.bookmarks.push(bookmark);
      continue;
    }
    let node = root;
    for (const segment of bookmark.folder.split('/')) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), bookmarks: [] });
      }
      node = node.children.get(segment);
    }
    node.bookmarks.push(bookmark);
  }
  return root;
}

function renderNode(node, indent) {
  let html = '';
  for (const bookmark of node.bookmarks) {
    html += `${indent}<DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>\n`;
  }
  for (const [name, child] of [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    html += `${indent}<DT><H3>${escapeHtml(name)}</H3>\n${indent}<DL><p>\n`;
    html += renderNode(child, `${indent}    `);
    html += `${indent}</DL><p>\n`;
  }
  return html;
}

function toNetscapeHtml(bookmarks) {
  const body = renderNode(buildTree(bookmarks), '    ');
  return (
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n' +
    '<H1>Bookmarks</H1>\n' +
    '<DL><p>\n' +
    body +
    '</DL><p>\n'
  );
}

function toGenericJson(bookmarks) {
  return JSON.stringify(
    bookmarks.map((b) => ({ title: b.title, url: b.url, folder: b.folder })),
    null,
    2
  );
}

module.exports = { toNetscapeHtml, toGenericJson };
