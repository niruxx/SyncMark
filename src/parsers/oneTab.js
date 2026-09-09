// OneTab's default export is plain text: one "URL | Title" line per tab,
// with blank lines separating tab groups (each group becomes a folder).

function looksLikeOneTab(text) {
  const firstLine = String(text || '')
    .split(/\r\n|\n/)
    .find((line) => line.trim());
  return !!firstLine && /^https?:\/\/\S+(\s*\|.*)?$/i.test(firstLine.trim());
}

function parseOneTab(text) {
  const lines = String(text || '').split(/\r\n|\n/);
  const groups = [[]];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (groups[groups.length - 1].length > 0) groups.push([]);
      continue;
    }
    const sepIndex = trimmed.indexOf('|');
    const url = (sepIndex === -1 ? trimmed : trimmed.slice(0, sepIndex)).trim();
    const title = (sepIndex === -1 ? url : trimmed.slice(sepIndex + 1)).trim();
    if (/^https?:\/\//i.test(url)) {
      groups[groups.length - 1].push({ title: title || url, url });
    }
  }

  const nonEmptyGroups = groups.filter((g) => g.length > 0);
  const multipleGroups = nonEmptyGroups.length > 1;
  const bookmarks = [];
  nonEmptyGroups.forEach((group, i) => {
    const folder = multipleGroups ? `Tab group ${i + 1}` : '';
    for (const item of group) bookmarks.push({ ...item, folder });
  });
  return bookmarks;
}

module.exports = { parseOneTab, looksLikeOneTab };
