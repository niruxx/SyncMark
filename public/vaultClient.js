(function (global) {
  function secureOrigin(value) {
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or localhost for development');
    return url.origin;
  }
  function matches(entry, target) {
    try { return entry.kind !== 'note' && secureOrigin(entry.url) === secureOrigin(target); } catch { return false; }
  }
  function warnings(password, entry = {}) {
    const value = String(password || '');
    const lower = value.toLowerCase();
    const result = [];
    if (!value) result.push('Empty password');
    else {
      if ([...value].length < 12) result.push('Short password (under 12 characters)');
      if (/^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|football|changeme|secret|abc123|123456|test)(?:[0-9!@#$]*)$/i.test(value) || /^(.)\1+$/u.test(value) || /^\d{1,20}$/.test(value) || /^(?:1234567890|abcdefgh|qwertyuiop|asdfghjkl)/i.test(value)) result.push('Common or predictable pattern');
      const username = String(entry.username || '').split('@')[0].toLowerCase();
      if (username.length >= 4 && lower.includes(username)) result.push('Contains the username');
    }
    if (entry.url && /^http:/i.test(entry.url)) result.push('Site uses unencrypted HTTP');
    return result;
  }
  async function audit(rows, dek, active = () => true) {
    const results = [], reused = new Map();
    for (const row of rows.filter((item) => item.kind !== 'note')) {
      if (!active()) throw new Error('Vault was locked or the check was closed');
      let plain = '';
      try {
        plain = await VaultCrypto.decryptFieldStrict(row.password_enc, dek);
        const result = { row, warnings: warnings(plain, row) };
        if (plain) {
          const hash = VaultCrypto.toB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain)));
          if (!reused.has(hash)) reused.set(hash, []);
          reused.get(hash).push(result);
        }
        results.push(result);
      } catch { results.push({ row, warnings: ['Encrypted password could not be read; recover it before editing'] }); }
      finally { plain = ''; }
    }
    if (!active()) throw new Error('Vault was locked or the check was closed');
    for (const group of reused.values()) if (group.length > 1) group.forEach((item) => item.warnings.push(`Reused across ${group.length} vault entries`));
    reused.clear(); return results;
  }
  async function request(origin, token, endpoint) {
    const server = secureOrigin(origin);
    if (!['keys', 'items'].includes(endpoint)) throw new Error('Unsupported client endpoint');
    const response = await fetch(`${server}/api/password-client/${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', credentials: 'omit' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Client credential expired or revoked' : `Client request failed (${response.status})`);
    return response.json();
  }
  async function unlock(keys, passphrase) {
    const { key } = await VaultCrypto.deriveKey(passphrase, keys.vaultSalt);
    return VaultCrypto.unwrapDek(keys.wrappedDekPassphrase, keys.wrappedDekPassphraseIv, key);
  }
  // Serialized into an isolated top-frame script by the browser extension.
  function fillDocument(expectedOrigin, username, password) {
    if (window.top !== window.self || location.origin !== expectedOrigin) throw new Error('Page origin changed; unlock and choose the login again');
    const visible = (el) => !el.disabled && !el.readOnly && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const fields = [...document.querySelectorAll('input[type="password"]')].filter((el) => visible(el) && !el.autocomplete.split(/\s+/).includes('new-password'));
    if (fields.length !== 1) throw new Error('Choose a page with one visible login password field');
    const secret = fields[0], form = secret.form;
    if (form && new URL(form.action, location.href).origin !== expectedOrigin) throw new Error('Login form submits to another origin');
    const scope = form || document;
    const names = [...scope.querySelectorAll('input')].filter((el) => visible(el) && ['text', 'email', 'tel'].includes(el.type));
    const login = names.find((el) => el.autocomplete.split(/\s+/).includes('username')) || names.find((el) => el.type === 'email') || names.find((el) => /user|login|email/i.test(el.name || el.id));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    function assign(el, value) { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    if (login) assign(login, username);
    assign(secret, password);
    return { filled: true }; // Never submit the form.
  }
  global.VaultClient = { secureOrigin, matches, warnings, audit, request, unlock, fillDocument };
})(typeof window !== 'undefined' ? window : globalThis);
