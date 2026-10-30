const extension = typeof browser !== 'undefined' ? browser : chrome;
let dek = null, rows = [], activeTab = null, idleTimer, generation = 0;
const status = document.getElementById('status');
function lock() {
  generation++; dek = null; rows = []; activeTab = null; clearTimeout(idleTimer);
  document.getElementById('matches').replaceChildren(); document.getElementById('items').hidden = true;
  document.getElementById('unlock').hidden = false; document.getElementById('lock').hidden = true;
  document.getElementById('passphrase').value = '';
}
function resetTimer() { clearTimeout(idleTimer); if (dek) idleTimer = setTimeout(() => { lock(); status.textContent = 'Locked after two minutes of inactivity'; }, 120000); }
function action(text, callback) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
  button.addEventListener('click', async () => { resetTimer(); button.disabled = true; try { await callback(); } catch (err) { status.textContent = err.message; } finally { button.disabled = false; } });
  return button;
}
document.getElementById('unlock').addEventListener('submit', async (event) => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true;
  let passphrase = document.getElementById('passphrase').value;
  const ticket = ++generation;
  try {
    const origin = VaultClient.secureOrigin(document.getElementById('server').value);
    const parsed = new URL(origin);
    const permission = `${parsed.protocol}//${parsed.hostname}/*`;
    if (!await extension.permissions.request({ origins: [permission] })) throw new Error('Server-host access is required to download the encrypted vault');
    const token = document.getElementById('token').value.trim();
    if (!/^[\w-]{43}$/.test(token)) throw new Error('Enter the read-only device credential from SyncMark');
    status.textContent = 'Unlocking locally…';
    const [keys, items] = await Promise.all([VaultClient.request(origin, token, 'keys'), VaultClient.request(origin, token, 'items')]);
    const key = await VaultClient.unlock(keys, passphrase);
    passphrase = ''; document.getElementById('passphrase').value = '';
    if (ticket !== generation) throw new Error('Unlock canceled');
    const [tab] = await extension.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error('Open a normal HTTPS login page before using the extension');
    const targetOrigin = VaultClient.secureOrigin(tab.url);
    dek = key; rows = items; activeTab = { id: tab.id, origin: targetOrigin };
    const remember = document.getElementById('remember').checked;
    await extension.storage.local.set({ server: origin, remember, token: remember ? token : '' });
    document.getElementById('token').value = '';
    document.getElementById('unlock').hidden = true; document.getElementById('lock').hidden = false;
    document.getElementById('items').hidden = false; document.getElementById('origin').textContent = targetOrigin;
    const matches = items.filter((row) => VaultClient.matches(row, tab.url));
    const container = document.getElementById('matches'); container.replaceChildren();
    for (const item of matches) {
      const card = document.createElement('article'), heading = document.createElement('h3'), user = document.createElement('p');
      heading.textContent = item.site_name; user.textContent = item.username || 'No username'; card.append(heading, user);
      card.append(action('Fill login', async () => {
        const currentKey = dek, current = activeTab;
        if (!currentKey || !current) throw new Error('Vault is locked');
        const tab = await extension.tabs.get(current.id);
        if (VaultClient.secureOrigin(tab.url) !== current.origin || !VaultClient.matches(item, tab.url)) throw new Error('Page changed; close and reopen the extension');
        let secret = await VaultCrypto.decryptFieldStrict(item.password_enc, currentKey);
        try {
          if (dek !== currentKey || !activeTab) throw new Error('Vault is locked');
          const results = await extension.scripting.executeScript({ target: { tabId: current.id, frameIds: [0] }, func: VaultClient.fillDocument, args: [current.origin, item.username || '', secret] });
          if (!results[0]?.result?.filled) throw new Error('The page did not accept autofill');
          status.textContent = 'Filled. Review the page and submit it yourself.';
        } finally { secret = ''; }
      })); container.append(card);
    }
    status.textContent = matches.length ? `${matches.length} exact-origin login${matches.length === 1 ? '' : 's'}` : 'No logins match this exact origin. Subdomains, protocols, and ports must match.';
    resetTimer();
  } catch (err) { lock(); status.textContent = err.message || 'Could not unlock the vault'; }
  finally { passphrase = ''; document.getElementById('passphrase').value = ''; submit.disabled = false; }
});
document.getElementById('lock').addEventListener('click', () => { lock(); status.textContent = 'Locked'; });
document.getElementById('forget').addEventListener('click', async () => {
  lock(); const settings = await extension.storage.local.get('server');
  if (settings.server) { const url = new URL(settings.server); await extension.permissions.remove({ origins: [`${url.protocol}//${url.hostname}/*`] }); }
  await extension.storage.local.clear(); document.getElementById('server').value = ''; document.getElementById('token').value = ''; document.getElementById('remember').checked = false; status.textContent = 'Saved settings removed. Revoke the device credential in SyncMark if needed.';
});
window.addEventListener('pagehide', lock);
for (const event of ['keydown', 'pointerdown']) document.addEventListener(event, resetTimer);
extension.storage.local.get(['server', 'token', 'remember']).then((settings) => { document.getElementById('server').value = settings.server || ''; document.getElementById('token').value = settings.token || ''; document.getElementById('remember').checked = Boolean(settings.remember); });
