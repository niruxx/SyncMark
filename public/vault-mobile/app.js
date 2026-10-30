let dek = null, snapshot = null, idleTimer, generation = 0;
const status = document.getElementById('status');
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('syncmark-mobile-vault', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function offline(operation, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('vault', operation === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('vault');
      const request = operation === 'get' ? store.get('snapshot') : operation === 'put' ? store.put(value, 'snapshot') : store.delete('snapshot');
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Offline storage canceled'));
    });
  } finally { db.close(); }
}
async function offlineInfo() {
  const cached = await offline('get');
  document.getElementById('use-offline').disabled = !cached;
  document.getElementById('offline-info').textContent = cached ? `Encrypted copy saved ${new Date(cached.savedAt).toLocaleString()}. It may be out of date.` : 'No encrypted offline copy is saved.';
}
function lock() {
  generation++; clearTimeout(idleTimer); dek = null; snapshot = null;
  document.getElementById('items').replaceChildren(); document.getElementById('vault').hidden = true;
  document.getElementById('unlock').hidden = false; document.getElementById('lock').hidden = true;
  document.getElementById('passphrase').value = ''; document.getElementById('token').value = ''; document.getElementById('search').value = '';
}
function touch() { clearTimeout(idleTimer); if (dek) idleTimer = setTimeout(() => { lock(); status.textContent = 'Locked after two minutes of inactivity'; }, 120000); }
function action(label, fn) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.addEventListener('click', async () => { button.disabled = true; touch(); try { await fn(); } catch (err) { status.textContent = err.message; } finally { button.disabled = false; } }); return button;
}
function render() {
  const container = document.getElementById('items'); container.replaceChildren();
  const query = document.getElementById('search').value.toLowerCase();
  const rows = snapshot.items.filter((row) => [row.site_name, row.url, row.username, row.folder, row.tags].some((v) => String(v || '').toLowerCase().includes(query)));
  if (!rows.length) { const p = document.createElement('p'); p.textContent = 'No matching vault entries.'; container.append(p); }
  for (const row of rows) {
    const article = document.createElement('article'), title = document.createElement('h2'), details = document.createElement('p');
    title.textContent = row.site_name; details.textContent = [row.username, row.folder, ...JSON.parse(row.tags || '[]')].filter(Boolean).join(' · '); article.append(title, details);
    article.append(action(row.kind === 'note' ? 'Copy note' : 'Copy password', async () => {
      const key = dek, ticket = generation; if (!key) throw new Error('Unlock the vault first');
      let plain = await VaultCrypto.decryptFieldStrict(row.kind === 'note' ? row.notes : row.password_enc, key);
      try { if (key !== dek || ticket !== generation) throw new Error('Vault was locked'); await navigator.clipboard.writeText(plain); status.textContent = 'Copied to clipboard'; } finally { plain = ''; }
    }));
    if (row.username) article.append(action('Copy username', async () => { if (!dek) throw new Error('Vault was locked'); await navigator.clipboard.writeText(row.username); status.textContent = 'Username copied'; }));
    container.append(article);
  }
}
document.getElementById('unlock').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  let passphrase = document.getElementById('passphrase').value;
  const ticket = ++generation;
  try {
    let data;
    if (document.getElementById('use-offline').checked) { data = await offline('get'); if (!data) throw new Error('No offline copy is available'); }
    else {
      const token = document.getElementById('token').value.trim();
      if (!/^[\w-]{43}$/.test(token)) throw new Error('Enter the device credential, or choose the saved offline copy');
      const [keys, items] = await Promise.all([VaultClient.request(location.origin, token, 'keys'), VaultClient.request(location.origin, token, 'items')]);
      data = { keys, items, savedAt: new Date().toISOString() };
    }
    status.textContent = 'Unlocking locally…';
    const key = await VaultClient.unlock(data.keys, passphrase);
    passphrase = ''; document.getElementById('passphrase').value = ''; document.getElementById('token').value = '';
    if (ticket !== generation) throw new Error('Unlock canceled');
    dek = key; snapshot = data;
    document.getElementById('unlock').hidden = true; document.getElementById('vault').hidden = false; document.getElementById('lock').hidden = false;
    status.textContent = `${data.items.length} entries unlocked locally${document.getElementById('use-offline').checked ? ' from an offline copy' : ''}`;
    render(); touch();
  } catch (err) { lock(); status.textContent = err.message || 'Unable to unlock'; }
  finally { passphrase = ''; document.getElementById('passphrase').value = ''; button.disabled = false; }
});
document.getElementById('save-offline').addEventListener('click', async () => {
  if (!dek || !snapshot) return;
  try { await offline('put', { keys: snapshot.keys, items: snapshot.items, savedAt: new Date().toISOString() }); await offlineInfo(); status.textContent = 'Encrypted offline copy saved. Device revocation cannot erase a copy already downloaded.'; } catch (err) { status.textContent = err.message; }
});
document.getElementById('delete-offline').addEventListener('click', async () => { try { await offline('delete'); document.getElementById('use-offline').checked = false; await offlineInfo(); status.textContent = 'Offline copy deleted'; } catch (err) { status.textContent = err.message; } });
document.getElementById('lock').addEventListener('click', () => { lock(); status.textContent = 'Locked'; });
document.getElementById('search').addEventListener('input', () => { if (dek) render(); touch(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { lock(); status.textContent = 'Locked when the app moved to the background'; } });
window.addEventListener('pagehide', lock);
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, touch);
document.getElementById('use-offline').addEventListener('change', (event) => { document.getElementById('token').required = !event.target.checked; });
offlineInfo().catch(() => { status.textContent = 'Offline storage is unavailable; online access still works.'; });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('worker.js').catch(() => { status.textContent = 'Offline app shell could not be installed; online access still works.'; });
