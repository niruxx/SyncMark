(function () {
  let ctx, identity = null, privateKey = null, identityTask = null, epoch = 0;
  const modal = document.getElementById('password-tools-modal'), body = document.getElementById('password-tools-body'), status = document.getElementById('password-tools-status');
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  function show(title) { epoch++; document.getElementById('password-tools-heading').textContent = title; body.replaceChildren(); status.textContent = ''; modal.classList.add('is-open'); document.getElementById('password-tools-close').focus(); }
  function close() { epoch++; body.replaceChildren(); status.textContent = ''; modal.classList.remove('is-open'); }
  function send(path, payload, method = 'POST') { return ctx.api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
  function button(text, fn) { const node = el('button', text, 'secondary'); node.type = 'button'; node.addEventListener('click', async () => { node.disabled = true; try { await fn(); } catch (err) { status.textContent = err.message; } finally { node.disabled = false; } }); return node; }
  function field(label, type = 'text', value = '') { const wrapper = el('label', label), input = document.createElement('input'); input.type = type; input.value = value; wrapper.append(input); body.append(wrapper); return input; }
  function needKey() { const key = ctx.getKey(); if (!key) throw new Error('Unlock your vault first'); return key; }
  function fingerprint(value) { return value.match(/.{1,4}/g).join(' '); }
  async function onUnlock() {
    const dek = needKey();
    identityTask = (async () => {
      let record;
      try { record = await ctx.api('/password-sharing/me'); }
      catch (err) {
        if (err.status !== 404) throw err;
        const generated = await VaultSharing.createIdentity(dek);
        try { record = await send('/password-sharing/me', generated); }
        catch (err) { if (err.status !== 409) throw err; record = await ctx.api('/password-sharing/me'); }
      }
      const unlocked = await VaultSharing.unlockIdentity(record, dek);
      if (ctx.getKey() !== dek) throw new Error('Vault was locked');
      identity = record; privateKey = unlocked;
    })();
    identityTask.catch(() => {}); // Sharing errors are shown when a sharing action is opened.
  }
  async function refreshFilters() {
    try {
      const result = await ctx.api('/password-folders');
      for (const [id, values, label] of [['password-folder-filter', result.folders, 'All folders'], ['password-tag-filter', result.tags, 'All tags']]) {
        const select = document.getElementById(id), selected = select.value;
        select.replaceChildren(new Option(label, ''), ...values.map((v) => new Option(v, v)));
        if (selected && !values.includes(selected)) select.append(new Option(selected, selected));
        select.value = selected;
      }
      document.getElementById('password-folder-options').replaceChildren(...result.folders.map((name) => { const option = document.createElement('option'); option.value = name; return option; }));
    } catch { /* Vault items remain usable if optional organization controls fail. */ }
  }
  function liveWarnings() {
    const value = document.getElementById('modal-password-input').value;
    const warnings = VaultClient.warnings(value, { username: document.getElementById('modal-username-input').value, url: document.getElementById('modal-url-input').value });
    const login = !document.getElementById('modal-login-fields').hidden;
    document.getElementById('password-live-warnings').textContent = login ? (warnings.join(' · ') || 'No local warnings. This is not a breach-database check.') : '';
  }
  async function folders() {
    show('Password folders');
    body.append(el('p', 'Folders and tags are visible metadata, like site names. Removing a folder leaves its entries in your vault.'));
    const data = await ctx.api('/password-folders');
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Folder'); select.append(new Option('Create a new folder', ''), ...data.folders.map((name) => new Option(name, name))); body.append(select);
    const name = field('Folder name', 'text'); name.maxLength = 500;
    select.addEventListener('change', () => { name.value = select.value; });
    body.append(button('Save folder', async () => { await send('/password-folders', select.value ? { oldName: select.value, newName: name.value } : { name: name.value }, select.value ? 'PUT' : 'POST'); await ctx.refresh(); await folders(); }), button('Remove selected folder', async () => { if (!select.value || !await confirmDialog('Remove this folder and unfile its entries? Passwords will remain.')) return; await send('/password-folders', { name: select.value }, 'DELETE'); document.getElementById('password-folder-filter').value = ''; await ctx.refresh(); await folders(); }));
  }
  async function audit() {
    show('Local password security check');
    body.append(el('p', 'Checks short, common/predictable, reused passwords, username inclusion, and HTTP sites locally. Passwords and their hashes are not uploaded. This is a heuristic check, not a breach lookup or a guarantee of strength.'));
    const ticket = epoch, dek = needKey(), rows = await ctx.api('/passwords/export-data');
    const results = await VaultClient.audit(rows, dek, () => ticket === epoch && ctx.getKey() === dek);
    if (ticket !== epoch || ctx.getKey() !== dek) return;
    const flagged = results.filter((r) => r.warnings.length);
    status.textContent = `${results.length} logins checked; ${flagged.length} need review.`;
    for (const result of flagged) {
      const row = el('section', undefined, 'password-tool-row'); row.append(el('h3', result.row.site_name), el('p', result.warnings.join(' · ')), button('Review item', () => { close(); ctx.edit(result.row.id); })); body.append(row);
    }
  }
  async function share(entry) {
    show('Share an encrypted copy');
    const key = needKey();
    body.append(el('p', `Share “${entry.site_name}” with another SyncMark account. The recipient receives a separately encrypted snapshot. Editing or deleting your source entry revokes access here; a recipient can retain any copy already decrypted or saved. Attachments are not included.`));
    const username = field('Recipient username'); username.autocomplete = 'off';
    const days = field('Expires in days (1–365)', 'number', '7'); days.min = '1'; days.max = '365';
    const notesLabel = el('label', 'Include the encrypted notes', 'password-check-label'), includeNotes = document.createElement('input'); includeNotes.type = 'checkbox'; notesLabel.prepend(includeNotes); body.append(notesLabel);
    body.append(button('Find recipient', async () => {
      await identityTask;
      if (!identity || ctx.getKey() !== key) throw new Error('Unlock your sharing identity first');
      const recipient = await ctx.api('/password-sharing/directory?' + new URLSearchParams({ username: username.value.trim() }));
      if (recipient.id === identity.userId) throw new Error('Choose another account');
      const panel = el('section', undefined, 'password-tool-row');
      panel.append(el('h3', recipient.username), el('p', 'Verify this fingerprint with the recipient through a separate trusted channel.'), el('p', fingerprint(recipient.fingerprint), 'password-fingerprint'));
      const verifiedLabel = el('label', 'I verified the recipient fingerprint', 'password-check-label'), verified = document.createElement('input'); verified.type = 'checkbox'; verifiedLabel.prepend(verified); panel.append(verifiedLabel);
      panel.append(button('Encrypt and share', async () => {
        if (!verified.checked) throw new Error('Verify the recipient fingerprint before sharing');
        if (ctx.getKey() !== key) throw new Error('Vault was locked');
        const lifetime = Number(days.value); if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 365) throw new Error('Choose 1–365 days');
        const source = await ctx.api(`/passwords/${entry.id}`);
        const item = { siteName: source.site_name, url: source.url, username: source.username, kind: source.kind,
          password: await VaultCrypto.decryptFieldStrict(source.password_enc, key), notes: includeNotes.checked ? await VaultCrypto.decryptFieldStrict(source.notes, key) : '' };
        const envelope = { id: crypto.randomUUID(), senderId: identity.userId, recipientId: recipient.id, recipientFingerprint: recipient.fingerprint };
        const encrypted = await VaultSharing.seal(item, recipient, envelope);
        item.password = ''; item.notes = '';
        if (ctx.getKey() !== key) throw new Error('Vault was locked');
        await send('/password-shares', { ...envelope, ...encrypted, passwordId: entry.id, expiresAt: new Date(Date.now() + lifetime * 86400000).toISOString() });
        close(); showToast('Encrypted copy shared', 'success');
      })); body.append(panel);
    }));
  }
  async function shares() {
    show('Shared passwords');
    const dek = needKey(), ticket = epoch;
    await identityTask;
    if (!identity || !privateKey) throw new Error('Sharing identity is unavailable; unlock the vault again');
    body.append(el('p', 'Your sharing fingerprint'), el('p', fingerprint(identity.fingerprint), 'password-fingerprint'));
    const rows = await ctx.api('/password-shares');
    if (!rows.length) body.append(el('p', 'No active shares. Use Share beside an entry to send an encrypted copy.'));
    for (const share of rows) {
      if (ticket !== epoch || ctx.getKey() !== dek) return;
      const row = el('section', undefined, 'password-tool-row');
      if (share.outgoing) row.append(el('h3', `Shared with ${share.recipient}`), el('p', `Expires ${new Date(share.expires_at).toLocaleString()}`));
      else {
        let item;
        try { item = await VaultSharing.open(share, privateKey); } catch { row.append(el('p', `Could not decrypt the copy from ${share.sender}. Ask them to revoke and share it again.`)); body.append(row); continue; }
        if (ticket !== epoch || ctx.getKey() !== dek) { item.password = ''; item.notes = ''; return; }
        row.append(el('h3', item.siteName || 'Shared item'), el('p', `From ${share.sender} · ${item.username || 'Secure note'} · Expires ${new Date(share.expires_at).toLocaleString()}`));
        row.append(button('Copy secret', async () => { if (ticket !== epoch || ctx.getKey() !== dek) throw new Error('Vault was locked'); await navigator.clipboard.writeText(item.kind === 'note' ? item.notes : item.password); status.textContent = 'Copied'; }), button('Save a private copy', async () => {
          if (ticket !== epoch || ctx.getKey() !== dek) throw new Error('Vault was locked');
          await send('/passwords', { siteName: item.siteName || 'Shared item', url: item.url || '', username: item.username || '', kind: item.kind === 'note' ? 'note' : 'login', passwordEnc: await VaultCrypto.encryptField(item.password || '', dek), notesEnc: await VaultCrypto.encryptField(item.notes || '', dek), folder: 'Shared copies', tags: [] });
          await ctx.refresh(); status.textContent = 'A separate copy was saved in Shared copies';
        }));
      }
      row.append(button(share.outgoing ? 'Revoke' : 'Remove from inbox', async () => { await ctx.api(`/password-shares/${share.id}`, { method: 'DELETE' }); await shares(); })); body.append(row);
    }
  }
  async function clients() {
    show('Browser and mobile access');
    body.append(el('p', 'Create a read-only device credential. It can download your encrypted vault and passphrase-wrapped key, but cannot change entries or access other modules. Your vault passphrase is still required on the device.'));
    const mobile = el('a', 'Open the installable mobile vault'); mobile.href = '/vault-mobile/'; mobile.target = '_blank'; mobile.rel = 'noopener'; body.append(mobile);
    body.append(el('p', 'Browser extension: build clients/browser-extension with node scripts/build-vault-extension.js, then load the generated unpacked folder in your browser. Neither client provides native Android/iOS system-wide autofill.'));
    const name = field('Device name'); name.maxLength = 100;
    const days = field('Lifetime in days (1–90)', 'number', '30'); days.min = '1'; days.max = '90';
    const password = field('Confirm your account login password', 'password'); password.autocomplete = 'current-password';
    body.append(button('Create device credential', async () => {
      let result;
      try { result = await send('/password-clients', { name: name.value, days: Number(days.value), password: password.value }); } finally { password.value = ''; }
      const token = field('Device credential — copy now; shown once', 'password', result.token); token.readOnly = true;
      body.append(button('Copy device credential', async () => { await navigator.clipboard.writeText(result.token); status.textContent = 'Credential copied'; }));
      await list();
    }));
    const listNode = el('section'); body.append(listNode);
    async function list() {
      const rows = await ctx.api('/password-clients'); listNode.replaceChildren(el('h3', 'Connected clients'));
      for (const client of rows) { const row = el('div', undefined, 'password-tool-row'); row.append(el('p', `${client.name} · Expires ${new Date(client.expires_at).toLocaleString()} · Last used ${client.last_used_at ? new Date(client.last_used_at).toLocaleString() : 'never'}`), button('Revoke client', async () => { await ctx.api(`/password-clients/${client.id}`, { method: 'DELETE' }); await list(); })); listNode.append(row); }
    }
    await list();
  }
  window.passwordTools = { onUnlock, refreshFilters, liveWarnings, share: (entry) => share(entry).catch((err) => { status.textContent = err.message; }), lock() { identity = null; privateKey = null; identityTask = null; close(); }, init(config) {
    ctx = config;
    for (const [id, fn] of [['password-folders-btn', folders], ['password-health-btn', audit], ['password-shares-btn', shares], ['password-clients-btn', clients]]) document.getElementById(id).addEventListener('click', () => fn().catch((err) => { status.textContent = err.message; }));
    for (const id of ['password-folder-filter', 'password-tag-filter']) document.getElementById(id).addEventListener('change', () => ctx.refresh());
    for (const id of ['modal-password-input', 'modal-username-input', 'modal-url-input']) document.getElementById(id).addEventListener('input', liveWarnings);
    document.getElementById('generator-apply-btn').addEventListener('click', liveWarnings);
    document.getElementById('password-tools-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  } };
})();
