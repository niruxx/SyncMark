const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');
const { fail, validUrl } = require('./bookmarkLibrary');
function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
      (a === 192 && b === 88 && c === 99) || (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    // Only global unicast, excluding documentation and transition mechanisms.
    const a = address.toLowerCase();
    return /^[23][0-9a-f]{0,3}:/.test(a) && !/^2002:|^2001:(?:0+|0*db8|0*1[0-9a-f]|0*2[0-9a-f]?):|^3fff:/i.test(a);
  }
  return false;
}
async function fetchPage(input, { method = 'GET', lookup = (host) => dns.lookup(host, { all: true, verbatim: true }) } = {}) {
  let url = new URL(input);
  const deadline = Date.now() + 12000;
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!validUrl(url.href) || (url.port && !['80', '443'].includes(url.port))) fail(400, 'Only HTTP(S) pages on standard web ports can be fetched');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let timer;
    const remaining = () => Math.max(1, deadline - Date.now());
    const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await Promise.race([
      lookup(hostname), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), remaining()); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) fail(403, 'Private, local, and reserved network addresses cannot be fetched');
    const address = addresses[0];
    if (Date.now() >= deadline) fail(504, 'Request timed out');
    const response = await new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method, agent: false,
        lookup: (host, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
        headers: { 'User-Agent': 'SyncMark/1.2 bookmark checker', Accept: 'text/html,text/plain;q=0.9', 'Accept-Encoding': 'identity' },
      }, (res) => {
        const chunks = []; let bytes = 0;
        const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
        if (method === 'HEAD' || isRedirect) { res.destroy(); clearTimeout(timeout); resolve({ status: res.statusCode, headers: res.headers, body: '' }); return; }
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) res.destroy(Object.assign(new Error('Page exceeds the 2 MiB capture limit'), { status: 413 }));
          else chunks.push(chunk);
        });
        res.on('error', (err) => { clearTimeout(timeout); reject(err); });
        res.on('end', () => { clearTimeout(timeout); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      const timeout = setTimeout(() => req.destroy(Object.assign(new Error('Page request timed out'), { status: 504 })), remaining());
      req.on('error', (err) => { clearTimeout(timeout); reject(err); });
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
      url = new URL(response.headers.location, url); continue;
    }
    return { ...response, url: url.href };
  }
  fail(502, 'Too many redirects');
}
function extractText(response) {
  const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') fail(415, 'Server returned unsupported compressed content');
  if (type === 'text/plain') return response.body;
  if (!['text/html', 'application/xhtml+xml'].includes(type)) fail(415, 'Only HTML and plain-text pages can be archived');
  const $ = cheerio.load(response.body);
  $('script,style,noscript,iframe,object,embed,svg,form,nav,footer').remove();
  $('br,p,div,article,section,h1,h2,h3,li').each((i, node) => $(node).append('\n'));
  return ($('title').text() + '\n\n' + $('body').text()).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
module.exports = { isPublicAddress, fetchPage, extractText };
