const state = {
  providerId: 'syncmark',
  provider: SyncMarkProviders.get('syncmark'),
  config: {},
  bookmarks: [],
  folders: [],
  lockMode: 'login', // 'login' | 'setup'
  formMode: null, // 'add' | 'edit'
  editingId: null,
};

const els = {
  providerBadge: document.getElementById('provider-badge'),
  optionsBtn: document.getElementById('options-btn'),
  noServerView: document.getElementById('no-server-view'),
  noServerText: document.getElementById('no-server-text'),
  noServerOptionsBtn: document.getElementById('no-server-options-btn'),
  lockView: document.getElementById('lock-view'),
  lockSubtitle: document.getElementById('lock-subtitle'),
  lockForm: document.getElementById('lock-form'),
  lockUsername: document.getElementById('lock-username'),
  lockPassword: document.getElementById('lock-password'),
  lockConfirm: document.getElementById('lock-confirm'),
  lockError: document.getElementById('lock-error'),
  lockSubmit: document.getElementById('lock-submit'),
  mainView: document.getElementById('main-view'),
  addCurrentBtn: document.getElementById('add-current-btn'),
  searchInput: document.getElementById('search-input'),
  folderSelect: document.getElementById('folder-select'),
  bookmarkList: document.getElementById('bookmark-list'),
  emptyState: document.getElementById('empty-state'),
  addBtn: document.getElementById('add-btn'),
  signOutBtn: document.getElementById('sign-out-btn'),
  formView: document.getElementById('form-view'),
  formHeading: document.getElementById('form-heading'),
  bookmarkForm: document.getElementById('bookmark-form'),
  formTitle: document.getElementById('form-title'),
  formUrl: document.getElementById('form-url'),
  formFolderTextLabel: document.getElementById('form-folder-text-label'),
  formFolderText: document.getElementById('form-folder-text'),
  folderDatalist: document.getElementById('folder-datalist'),
  formFolderSelectLabel: document.getElementById('form-folder-select-label'),
  formFolderSelect: document.getElementById('form-folder-select'),
  formFavoriteLabel: document.getElementById('form-favorite-label'),
  formFavorite: document.getElementById('form-favorite'),
  formError: document.getElementById('form-error'),
  formCancel: document.getElementById('form-cancel'),
};

const FALLBACK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2399a1b3" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg>'
  );

function showView(name) {
  for (const view of [els.noServerView, els.lockView, els.mainView, els.formView]) {
    view.hidden = true;
  }
  const target = { noServer: els.noServerView, lock: els.lockView, main: els.mainView, form: els.formView }[name];
  target.hidden = false;
}

function showNoServer(text) {
  els.noServerText.textContent = text;
  showView('noServer');
}

// --- Lock / sign in ---
// Interactive sign-in only makes sense for SyncMark (always) and Linkwarden in password mode —
// Linkwarden's access-token mode and Karakeep are configured entirely from the options page.

function showLock(mode) {
  state.lockMode = mode;
  const isSyncMark = state.providerId === 'syncmark';

  if (mode === 'setup') {
    els.lockSubtitle.textContent = 'First-time setup — create the account that protects your SyncMark server.';
    els.lockConfirm.hidden = false;
    els.lockConfirm.required = true;
    els.lockPassword.minLength = 8;
    els.lockSubmit.textContent = 'Create account & sign in';
  } else {
    els.lockSubtitle.textContent = isSyncMark
      ? 'Sign in to unlock your bookmarks.'
      : `Your saved ${state.provider.label} session expired — sign in again.`;
    els.lockConfirm.hidden = true;
    els.lockConfirm.required = false;
    els.lockPassword.minLength = 0;
    els.lockSubmit.textContent = 'Sign in';
  }
  els.lockError.hidden = true;
  showView('lock');
}

els.lockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.lockError.hidden = true;

  const username = els.lockUsername.value.trim();
  const password = els.lockPassword.value;

  if (state.lockMode === 'setup' && password.length < 8) {
    els.lockError.textContent = 'Password must be at least 8 characters.';
    els.lockError.hidden = false;
    return;
  }
  if (state.lockMode === 'setup' && password !== els.lockConfirm.value) {
    els.lockError.textContent = 'Passwords do not match.';
    els.lockError.hidden = false;
    return;
  }

  els.lockSubmit.disabled = true;
  try {
    if (state.providerId === 'syncmark') {
      if (state.lockMode === 'setup') {
        await state.provider.setup(state.config, { username, password });
      } else {
        await state.provider.login(state.config, { username, password });
      }
    } else {
      // Linkwarden password re-login: persist the freshly minted token for future popup opens.
      const { token } = await state.provider.login(state.config, { username, password });
      state.config.token = token;
      await browser.storage.local.set({ linkwardenToken: token, linkwardenUsername: username });
    }
    els.lockForm.reset();
    await enterApp();
  } catch (err) {
    els.lockError.textContent = err.message;
    els.lockError.hidden = false;
  } finally {
    els.lockSubmit.disabled = false;
  }
});

els.signOutBtn.addEventListener('click', async () => {
  if (state.providerId === 'syncmark') {
    await state.provider.logout(state.config).catch(() => {});
    showLock('login');
  } else if (state.providerId === 'linkwarden') {
    await browser.storage.local.remove('linkwardenToken');
    state.config.token = '';
    showLock('login');
  }
});

// --- Main list ---

async function loadFolders() {
  state.folders = await state.provider.listFolders(state.config);

  els.folderSelect.innerHTML = '<option value="">All folders</option>';
  els.folderDatalist.innerHTML = '';
  els.formFolderSelect.innerHTML = '<option value="">— unfiled —</option>';

  for (const f of state.folders) {
    const label = f.count != null ? `${f.name} (${f.count})` : f.name;

    const filterOption = document.createElement('option');
    filterOption.value = f.id;
    filterOption.textContent = label;
    els.folderSelect.appendChild(filterOption);

    if (state.provider.folderInputType === 'text') {
      const dlOption = document.createElement('option');
      dlOption.value = f.name;
      els.folderDatalist.appendChild(dlOption);
    } else {
      const formOption = document.createElement('option');
      formOption.value = f.id;
      formOption.textContent = label;
      els.formFolderSelect.appendChild(formOption);
    }
  }
}

async function loadBookmarks() {
  state.bookmarks = await state.provider.listBookmarks(state.config, {
    query: els.searchInput.value.trim(),
    folderId: els.folderSelect.value,
  });
  renderBookmarks();
}

function renderBookmarks() {
  els.bookmarkList.innerHTML = '';
  els.emptyState.hidden = state.bookmarks.length > 0;

  for (const bookmark of state.bookmarks) {
    els.bookmarkList.appendChild(renderBookmarkItem(bookmark));
  }
}

function renderBookmarkItem(bookmark) {
  const li = document.createElement('li');
  li.className = 'bookmark-item';

  const icon = document.createElement('img');
  icon.className = 'favicon';
  icon.src = bookmark.icon || SyncMarkProviders.faviconUrl(bookmark.url);
  icon.alt = '';
  icon.addEventListener('error', () => {
    icon.src = FALLBACK_ICON;
  });
  li.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'bookmark-info';
  info.title = bookmark.url;
  const title = document.createElement('span');
  title.className = 'bookmark-title';
  title.textContent = bookmark.title || bookmark.url;
  const url = document.createElement('span');
  url.className = 'bookmark-url';
  url.textContent = bookmark.url;
  info.appendChild(title);
  info.appendChild(url);
  info.addEventListener('click', () => openInNewTab(bookmark.url));
  li.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (state.provider.supports.favorite) {
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'star-btn' + (bookmark.favorite ? ' active' : '');
    starBtn.textContent = bookmark.favorite ? '★' : '☆';
    starBtn.title = bookmark.favorite ? 'Remove from favorites' : 'Add to favorites';
    starBtn.addEventListener('click', () => toggleFavorite(bookmark));
    actions.appendChild(starBtn);
  }

  if (state.provider.supports.edit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', () => openForm('edit', bookmark));
    actions.appendChild(editBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Delete';
  deleteBtn.addEventListener('click', () => deleteBookmark(bookmark));
  actions.appendChild(deleteBtn);

  li.appendChild(actions);
  return li;
}

async function openInNewTab(url) {
  await browser.tabs.create({ url });
  window.close();
}

async function toggleFavorite(bookmark) {
  try {
    await state.provider.toggleFavorite(state.config, bookmark.id, !bookmark.favorite);
    await loadBookmarks();
  } catch (err) {
    handleApiError(err);
  }
}

async function deleteBookmark(bookmark) {
  if (!confirm(`Delete "${bookmark.title || bookmark.url}"?`)) return;
  try {
    await state.provider.deleteBookmark(state.config, bookmark.id);
    await Promise.all([loadBookmarks(), loadFolders()]);
  } catch (err) {
    handleApiError(err);
  }
}

let searchDebounce;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadBookmarks, 200);
});
els.folderSelect.addEventListener('change', loadBookmarks);

// --- Add / edit form ---

function openForm(mode, bookmark) {
  state.formMode = mode;
  state.editingId = bookmark && bookmark.id ? bookmark.id : null;
  els.formHeading.textContent = mode === 'edit' ? 'Edit bookmark' : 'Add bookmark';
  els.formTitle.value = bookmark ? bookmark.title || '' : '';
  els.formUrl.value = bookmark ? bookmark.url || '' : '';

  const useSelect = state.provider.folderInputType === 'select';
  els.formFolderTextLabel.hidden = useSelect;
  els.formFolderSelectLabel.hidden = !useSelect;
  if (useSelect) {
    els.formFolderSelect.value = bookmark ? bookmark.folder || '' : '';
  } else {
    els.formFolderText.value = bookmark ? bookmark.folder || '' : '';
  }

  els.formFavoriteLabel.hidden = !state.provider.supports.favorite;
  els.formFavorite.checked = Boolean(bookmark && bookmark.favorite);

  els.formError.hidden = true;
  showView('form');
  els.formTitle.focus();
}

els.addBtn.addEventListener('click', () => openForm('add', null));
els.formCancel.addEventListener('click', () => showView('main'));

els.addCurrentBtn.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) {
    openForm('add', { title: '', url: '', folder: '', favorite: false });
    return;
  }
  openForm('add', { title: tab.title || tab.url, url: tab.url, folder: '', favorite: false });
});

els.bookmarkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const folder =
    state.provider.folderInputType === 'select' ? els.formFolderSelect.value : els.formFolderText.value.trim();
  const payload = {
    title: els.formTitle.value.trim(),
    url: els.formUrl.value.trim(),
    folder,
    favorite: els.formFavorite.checked,
  };

  try {
    if (state.formMode === 'edit') {
      await state.provider.updateBookmark(state.config, state.editingId, payload);
    } else {
      await state.provider.addBookmark(state.config, payload);
    }
    showView('main');
    await Promise.all([loadBookmarks(), loadFolders()]);
  } catch (err) {
    if (err.status === 401) return handleApiError(err);
    els.formError.textContent = err.message;
    els.formError.hidden = false;
  }
});

// --- Errors / auth expiry ---

function handleApiError(err) {
  if (err.status === 401) {
    if (state.providerId === 'syncmark' || (state.providerId === 'linkwarden' && state.config.authMode === 'password')) {
      showLock('login');
    } else {
      showNoServer(`Your saved ${state.provider.label} connection was rejected. Open extension settings to update it.`);
    }
    return;
  }
  els.formError.textContent = err.message;
}

// --- Options ---

els.optionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
els.noServerOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());

// --- Boot ---

async function enterApp() {
  await Promise.all([loadFolders(), loadBookmarks()]);
  els.signOutBtn.hidden =
    !(state.providerId === 'syncmark' || (state.providerId === 'linkwarden' && state.config.authMode === 'password'));
  showView('main');
}

async function init() {
  const raw = await browser.storage.local.get(SyncMarkProviders.STORAGE_KEYS);
  state.providerId = raw.provider || 'syncmark';
  state.provider = SyncMarkProviders.get(state.providerId);
  state.config = SyncMarkProviders.readConfig(state.providerId, raw);

  if (state.providerId === 'syncmark') {
    els.providerBadge.hidden = true;
  } else {
    els.providerBadge.hidden = false;
    els.providerBadge.textContent = state.provider.label;
  }

  if (!state.provider.configured(state.config)) {
    showNoServer(`No ${state.provider.label} connection is configured yet.`);
    return;
  }

  try {
    const status = await state.provider.testAuth(state.config);
    if (status.setupRequired) {
      showLock('setup');
    } else if (!status.authenticated) {
      if (state.providerId === 'syncmark' || (state.providerId === 'linkwarden' && state.config.authMode === 'password')) {
        showLock('login');
      } else {
        showNoServer(`Your saved ${state.provider.label} connection was rejected. Open extension settings to update it.`);
      }
    } else {
      await enterApp();
    }
  } catch {
    showNoServer(`Couldn't reach your ${state.provider.label} server. Check the address in extension settings.`);
  }
}

init();
