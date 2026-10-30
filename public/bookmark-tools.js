(function () {
  let ctx, stopChecks = false, widgetRequest = 0;
  const modal = document.getElementById('bookmark-tools-modal');
  const body = document.getElementById('bookmark-tools-body');
  const message = document.getElementById('bookmark-tools-message');
  const heading = document.getElementById('bookmark-tools-heading');
  function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function tell(error) { message.textContent = error.message || String(error); }
  function button(label, fn) {
    const node = element('button', label, 'secondary'); node.type = 'button';
    node.addEventListener('click', async () => { node.disabled = true; try { await fn(); } catch (err) { tell(err); } finally { node.disabled = false; } });
    return node;
  }
  function open(title) { stopChecks = true; heading.textContent = title; body.replaceChildren(); message.textContent = ''; modal.classList.add('is-open'); document.getElementById('bookmark-tools-close').focus(); }
  function close() { stopChecks = true; modal.classList.remove('is-open'); }
  function send(path, payload, method = 'POST') { return ctx.api(path, { method, headers: { 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); }
  function field(label, type = 'text', value = '') { const wrapper = element('label', label); const input = document.createElement('input'); input.type = type; input.value = value; wrapper.append(input); body.append(wrapper); return input; }
  function output(label, value) {
    const input = field(label, 'text', value); input.readOnly = true; input.className = 'bookmark-link-output';
    body.append(button('Copy ' + label.toLowerCase(), async () => { try { await navigator.clipboard.writeText(value); message.textContent = 'Copied'; } catch { input.select(); message.textContent = 'Select and copy the address'; } }));
  }
  function link(bookmark, tracked = true) {
    const a = element('a', bookmark.title || bookmark.url); a.href = bookmark.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (tracked) trackLink(a, bookmark); return a;
  }
  function trackLink(a, bookmark) {
    const track = (event) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      fetch(`/api/bookmarks/${bookmark.id}/visit`, { method: 'POST', keepalive: true }).then((res) => { if (res.ok) refreshWidgets(); }).catch(() => {});
    };
    a.addEventListener('click', track); a.addEventListener('auxclick', track);
  }
  async function refreshWidgets() {
    if (!ctx) return;
    const request = ++widgetRequest;
    try {
      const [stats, tags] = await Promise.all([ctx.api('/bookmarks/dashboard'), ctx.api('/bookmarks/tags')]);
      if (request !== widgetRequest) return;
      const dashboard = document.getElementById('bookmark-dashboard'); dashboard.replaceChildren();
      for (const [title, rows, empty] of [['Recently opened', stats.recent, 'Open a bookmark to build your recent list.'], ['Frequently visited', stats.frequent, 'Your most-used bookmarks will appear here.']]) {
        const card = element('div', undefined, 'bookmark-widget'); card.append(element('h3', title));
        if (!rows.length) card.append(element('p', empty));
        for (const row of rows) { const a = link(row); a.title = `${row.title} · ${row.visit_count} visits`; card.append(a); }
        dashboard.append(card);
      }
      const filter = document.getElementById('bookmark-tag-filter'), selected = filter.value;
      filter.replaceChildren(new Option('All tags', ''), ...tags.map((tag) => new Option(tag, tag)));
      if (selected && !tags.includes(selected)) filter.append(new Option(selected, selected));
      filter.value = selected;
    } catch { /* Keep the library usable when optional widgets fail. */ }
  }
  function metadata(bookmark) {
    const node = element('div', undefined, 'bookmark-metadata');
    const tags = Array.isArray(bookmark.tags) ? bookmark.tags : JSON.parse(bookmark.tags || '[]');
    for (const tag of tags) node.append(element('span', tag, 'bookmark-chip'));
    if (bookmark.has_archive) node.append(element('span', 'Captured', 'bookmark-chip'));
    if (bookmark.check_status) { const status = element('span', bookmark.check_status === 'ok' ? 'Link OK' : bookmark.check_status, 'bookmark-chip'); status.title = `Checked ${new Date(bookmark.checked_at).toLocaleString()}`; node.append(status); }
    if (bookmark.notes) node.append(element('span', bookmark.notes.slice(0, 150) + (bookmark.notes.length > 150 ? '…' : ''), 'bookmark-note'));
    return node;
  }
  function actions(bookmark) {
    const node = button('More', () => {});
    node.setAttribute('aria-label', `More actions for ${bookmark.title}`);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = node.getBoundingClientRect();
      const run = (fn) => async () => { try { await fn(); } catch (err) { showToast(err.message, 'error'); } };
      const items = [
        { label: 'Check link', icon: 'link', onClick: run(async () => { const result = await send(`/bookmarks/${bookmark.id}/check`); showToast(`Link status: ${result.status}`); await ctx.refresh(); }) },
        { label: bookmark.has_archive ? 'Refresh captured page' : 'Capture readable page', icon: 'inventory_2', onClick: run(async () => { showToast('Capturing page…'); await send(`/bookmarks/${bookmark.id}/archive`); showToast('Page captured', 'success'); await ctx.refresh(); }) },
      ];
      if (bookmark.has_archive) {
        items.push({ label: 'Read captured page', icon: 'article', onClick: () => window.open(`/api/bookmarks/${bookmark.id}/archive`, '_blank', 'noopener,noreferrer') });
        items.push({ label: 'Remove captured page', icon: 'delete', danger: true, onClick: run(async () => { if (await confirmDialog('Remove the captured copy? The bookmark will stay.')) { await ctx.api(`/bookmarks/${bookmark.id}/archive`, { method: 'DELETE' }); await ctx.refresh(); } }) });
      }
      showContextMenu(event.clientX || rect.left, event.clientY || rect.bottom, items);
    });
    return node;
  }
  async function review() {
    open('Review library');
    body.append(element('p', 'Duplicate detection ignores URL fragments and normalizes host names. Merging keeps the chosen bookmark and combines notes, tags, favorites, and visit counts.'));
    const groups = await ctx.api('/bookmarks/duplicates');
    if (!groups.length) body.append(element('p', 'No duplicate URLs found.'));
    for (const group of groups) {
      const row = element('section', undefined, 'bookmark-tool-item'); row.append(element('h3', group.url));
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Bookmark to keep');
      for (const item of group.items) select.append(new Option(`${item.title} — ${item.folder || 'Unfiled'}`, item.id));
      row.append(element('p', `${group.items.length} duplicates. Choose the bookmark and folder to keep:`), select);
      row.append(button('Merge duplicates', async () => {
        if (!await confirmDialog(`Merge these ${group.items.length} bookmarks into the selected item?`, { danger: true })) return;
        await send('/bookmarks/duplicates/merge', { keepId: Number(select.value), ids: group.items.map((r) => r.id) });
        row.remove(); await ctx.refresh(); message.textContent = 'Duplicates merged';
      })); body.append(row);
    }
    body.append(element('h3', 'Link health'), element('p', 'Check up to 50 bookmarks in the current folder per batch. Authentication failures and blocked/private addresses are reported separately from broken links.'));
    const folder = ctx.context().folder;
    const rows = await ctx.api('/bookmarks?' + new URLSearchParams({ folder }));
    const listing = element('div');
    function showChecks() {
      listing.replaceChildren();
      for (const row of rows) {
        const item = element('div', undefined, 'bookmark-tool-item');
        item.append(link(row), element('p', row.check_status ? `${row.check_status} · ${new Date(row.checked_at).toLocaleString()}` : 'Not checked'));
        item.append(button('Check link', async () => { const result = await send(`/bookmarks/${row.id}/check`); row.check_status = result.status; row.checked_at = new Date().toISOString(); showChecks(); await ctx.refresh(); })); listing.append(item);
      }
    }
    const controls = element('div', undefined, 'bookmark-tool-actions');
    controls.append(button('Check next 50', async () => {
      stopChecks = false;
      const batch = rows.slice().sort((a, b) => (a.checked_at || '').localeCompare(b.checked_at || '')).slice(0, 50);
      let count = 0;
      for (const row of batch) {
        if (stopChecks) break;
        message.textContent = `Checking ${count + 1} of ${batch.length}: ${row.title}`;
        const result = await send(`/bookmarks/${row.id}/check`);
        row.check_status = result.status; row.checked_at = new Date().toISOString(); count++; showChecks();
      }
      message.textContent = `Checked ${count} links${stopChecks ? ' — stopped' : ''}`; await ctx.refresh();
    }), button('Stop checking', () => { stopChecks = true; message.textContent = 'Stopping after the current request…'; }));
    body.append(controls, listing); showChecks();
  }
  async function sharing() {
    open('Share this collection');
    const folder = ctx.context().folder;
    body.append(element('p', `${folder || 'All bookmarks'} and its subfolders will be shared read-only. Search, tag, and favorite filters do not limit this collection. Personal notes, archived text, and visit history stay private.`));
    const title = field('Collection title', 'text', folder || 'Bookmarks'); title.maxLength = 200;
    const recipients = field('Recipients (comma-separated SyncMark usernames)');
    const groups = await ctx.api('/bookmark-groups');
    const checked = [];
    if (groups.length) body.append(element('h3', 'Sharing groups'));
    for (const group of groups) { const label = element('label', group.name, 'bookmark-check-label'); const input = document.createElement('input'); input.type = 'checkbox'; label.prepend(input); body.append(label); checked.push([input, group.id]); }
    const publicLabel = element('label', 'Create public link and RSS feed', 'bookmark-check-label');
    const publicCheck = document.createElement('input'); publicCheck.type = 'checkbox'; publicLabel.prepend(publicCheck); body.append(publicLabel);
    const password = field('Public link password (optional)', 'password'); password.autocomplete = 'new-password'; password.maxLength = 256;
    const expires = field('Expires at (optional)', 'datetime-local');
    body.append(button('Create share', async () => {
      const result = await send('/bookmark-shares', { folder, title: title.value, users: recipients.value.split(',').map((v) => v.trim()).filter(Boolean), groups: checked.filter(([input]) => input.checked).map(([, id]) => id), public: publicCheck.checked, password: password.value, expiresAt: expires.value ? new Date(expires.value).toISOString() : null });
      password.value = ''; message.textContent = 'Share created. Public addresses are shown only now; copy them before closing.';
      if (result.url) { output('Collection address', new URL(result.url, location.origin).href); output('RSS address', new URL(result.rss, location.origin).href); }
      await ownedShares();
    }));
    body.append(button('Manage sharing groups', manageGroups));
    const owned = element('section'); body.append(owned);
    async function ownedShares() {
      const shares = await ctx.api('/bookmark-shares'); owned.replaceChildren(element('h3', 'Your shares'));
      if (!shares.length) owned.append(element('p', 'No shares yet.'));
      for (const share of shares) {
        const row = element('div', undefined, 'bookmark-tool-item');
        row.append(element('p', `${share.title} · ${share.public ? 'Public link' : 'Accounts/groups'}${share.passwordProtected ? ' · Password protected' : ''}${share.expires_at ? ' · Expires ' + new Date(share.expires_at).toLocaleString() : ''}`));
        row.append(button('Revoke share', async () => { if (!await confirmDialog('Revoke this share and its RSS access?')) return; await ctx.api(`/bookmark-shares/${share.id}`, { method: 'DELETE' }); await ownedShares(); })); owned.append(row);
      }
    }
    await ownedShares();
  }
  async function manageGroups() {
    open('Sharing groups');
    body.append(element('p', 'These groups grant read access to bookmark collections you share. Removing a member immediately removes that group’s access.'));
    const groups = await ctx.api('/bookmark-groups');
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Group to edit'); select.append(new Option('Create a new group', ''), ...groups.map((g) => new Option(g.name, g.id))); body.append(select);
    const name = field('Group name'); name.maxLength = 100;
    const members = field('Members (comma-separated usernames)');
    select.addEventListener('change', () => { const group = groups.find((g) => g.id === Number(select.value)); name.value = group?.name || ''; members.value = group?.members.join(', ') || ''; });
    body.append(button('Save group', async () => { await send(select.value ? `/bookmark-groups/${select.value}` : '/bookmark-groups', { name: name.value, members: members.value.split(',').map((v) => v.trim()).filter(Boolean) }, select.value ? 'PUT' : 'POST'); await manageGroups(); message.textContent = 'Group saved'; }), button('Delete selected group', async () => { if (!select.value || !await confirmDialog('Delete this group and remove its collection grants?', { danger: true })) return; await ctx.api(`/bookmark-groups/${select.value}`, { method: 'DELETE' }); await manageGroups(); }), button('Back to sharing', sharing));
  }
  async function received() {
    open('Shared with me');
    const shares = await ctx.api('/bookmark-shares/received');
    if (!shares.length) body.append(element('p', 'No collections have been shared with your account.'));
    for (const share of shares) {
      const row = element('section', undefined, 'bookmark-tool-item'); row.append(element('h3', share.title), element('p', `Shared by ${share.owner}`));
      row.append(button('Open collection', async () => {
        const data = await ctx.api(`/bookmark-shares/${share.id}/items`); open(data.title);
        for (const item of data.items) { const row = element('article', undefined, 'bookmark-tool-item'); row.append(link(item, false), element('p', item.tags.join(', '))); body.append(row); }
        if (!data.items.length) body.append(element('p', 'This collection is empty.'));
      })); body.append(row);
    }
  }
  function syncHelp() {
    open('Sync browsers with Floccus');
    body.append(element('p', 'Add an “XBEL file in WebDAV” account in Floccus. This endpoint synchronizes your entire SyncMark bookmark library, including folder changes and deletions in both directions.'));
    output('Server address', new URL('/bookmark-sync/', location.origin).href);
    output('Bookmark file', 'bookmarks.xbel');
    body.append(element('p', 'Use your SyncMark username and password. Choose XBEL format and leave Floccus encryption off so SyncMark can read the tree. Keep HTTPS enabled over a network.'));
    body.append(element('p', 'Choose an explicit browser folder, keep Floccus’s deletion safeguard enabled, and use its merge option for the first sync. Disable competing browser-native sync for that folder. Tags, personal notes, captures, and visit counts stay on the server for surviving bookmarks.'));
    body.append(element('p', 'This is the Floccus WebDAV adapter, not the Nextcloud Bookmarks adapter. The protocol is integration-tested; a real Floccus browser session still needs verification.'));
  }
  window.bookmarkTools = { trackLink, metadata, actions, refreshWidgets, init(config) {
    ctx = config;
    document.getElementById('bookmark-tag-filter').addEventListener('change', () => ctx.loadBookmarks());
    for (const [id, fn] of [['bookmark-review-btn', review], ['bookmark-share-btn', sharing], ['bookmark-received-btn', received], ['bookmark-sync-btn', syncHelp]]) document.getElementById(id).addEventListener('click', () => Promise.resolve().then(fn).catch(tell));
    document.getElementById('bookmark-tools-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  } };
})();
