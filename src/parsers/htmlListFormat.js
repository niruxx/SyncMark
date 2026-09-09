const cheerio = require('cheerio');

/**
 * Parses the "<h1>Section</h1><ul><li><a href=...>Title</a></li></ul>" HTML
 * shape used by Pocket's ril_export.html and Instapaper's HTML export —
 * distinct from the Netscape Bookmark File Format (<dl>/<dt>) that browsers
 * use, which parseNetscapeHtml already handles. Used as a fallback when the
 * Netscape parser finds nothing in an uploaded HTML file.
 */
function parseHtmlListFormat(html) {
  const $ = cheerio.load(html);
  const bookmarks = [];

  $('ul').each((_, ul) => {
    const $ul = $(ul);

    let folder = '';
    let heading = $ul.prev();
    while (heading.length && !/^h[1-6]$/i.test(heading.prop('tagName') || '')) {
      heading = heading.prev();
    }
    if (heading.length) folder = heading.text().trim();

    $ul.children('li').each((__, li) => {
      const a = $(li).children('a').first();
      if (!a.length) return;
      const url = a.attr('href');
      const title = a.text().trim();
      if (url) bookmarks.push({ title: title || url, url, folder });
    });
  });

  return bookmarks;
}

module.exports = { parseHtmlListFormat };
