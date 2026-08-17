const cheerio = require('cheerio');

/**
 * Parses the Netscape Bookmark File Format (the HTML export used by Chrome,
 * Firefox, Edge, and Safari). The markup is not well-formed XML — <DT>/<DD>
 * are never closed — so this relies on cheerio's lenient htmlparser2 backend
 * rather than a strict XML/regex parser.
 */
function parseNetscapeHtml(html) {
  const $ = cheerio.load(html);
  const bookmarks = [];

  function walk(dl, folderPath) {
    $(dl)
      .children('dt')
      .each((_, dt) => {
        const $dt = $(dt);
        const h3 = $dt.children('h3').first();
        if (h3.length) {
          const folderName = h3.text().trim();
          const nextDl = $dt.children('dl').first();
          const childDl = nextDl.length ? nextDl : $dt.next('dl');
          if (childDl.length) {
            walk(childDl, folderName ? [...folderPath, folderName] : folderPath);
          }
          return;
        }

        const a = $dt.children('a').first();
        if (a.length) {
          const url = a.attr('href');
          const title = a.text().trim();
          if (url) {
            bookmarks.push({
              title: title || url,
              url,
              folder: folderPath.join('/'),
            });
          }
        }
      });
  }

  const rootDl = $('dl').first();
  if (rootDl.length) {
    walk(rootDl, []);
  }

  return bookmarks;
}

module.exports = { parseNetscapeHtml };
