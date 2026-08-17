const state = {
  serverUrl: '',
  bookmarks: [],
  folders: [],
  lockMode: 'login', // 'login' | 'setup'
  formMode: null, // 'add' | 'edit'
  editingId: null,
};

const els = {
  optionsBtn: document.getElementById('options-btn'),
  noServerView: document.getElementById('no-server-view'),
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
  formFolder: document.getElementById('form-folder'),
  folderDatalist: document.getElementById('folder-datalist'),
  formFavorite: document.getElementById('form-favorite'),
  formError: document.getElementById('form-error'),
  formCancel: document.getElementById('form-cancel'),
};

const FALLBACK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2399a1b3" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg>'
  );

function faviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  } catch {
    return FALLBACK_ICON;
  }
}

function showView(name) {
  for (const view of [els.noServerView, els.lockView, els.mainView, els.formView]) {
    view.hidden = true;
  }
  const target = { noServer: els.noServerView, lock: els.lockView, main: els.mainView, form: els.formView }[name];
  target.hidden = false;
}

async function api(path, options = {}) {
  const res = await fetch(`${state.serverUrl}${path}`, { ...options, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Lock / sign in ---

function showLock(mode) {
  state.lockMode = mode;
  if (mode === 'setup') {
    els.lockSubtitle.textContent = 'First-time setup — create the account that protects your SyncMark server.';
    els.lockConfirm.hidden = false;
    els.lockConfirm.required = true;
    els.lockPassword.minLength = 8;
    els.lockSubmit.textContent = 'Create account & sign in';
  } else {
    els.lockSubtitle.textContent = 'Sign in to unlock your bookmarks.';
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

  if (state.lockMode === 'setup') {
    if (password.length < 8) {
      els.lockError.textContent = 'Password must be at least 8 characters.';
      els.lockError.hidden = false;
      return;
    }
    if (password !== els.lockConfirm.value) {
      els.lockError.textContent = 'Passwords do not match.';
      els.lockError.hidden = false;
      return;
    }
  }

  els.lockSubmit.disabled = true;
  try {
    await api(`/api/auth/${state.lockMode === 'setup' ? 'setup' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
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
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  showLock('login');
});

// --- Main list ---

async function loadFolders() {
  state.folders = await api('/api/folders');
  els.folderSelect.innerHTML = '<option value="">All folders</option>';
  els.folderDatalist.innerHTML = '';
  for (const { folder, count } of state.folders) {
    const option = document.createElement('option');
    option.value = folder;
    option.textContent = `${folder} (${count})`;
    els.folderSelect.appendChild(option);

    const dlOption = document.createElement('option');
    dlOption.value = folder;
    els.folderDatalist.appendChild(dlOption);
  }
}

async function loadBookmarks() {
  const params = new URLSearchParams();
  if (els.searchInput.value.trim()) params.set('q', els.searchInput.value.trim());
  if (els.folderSelect.value) params.set('folder', els.folderSelect.value);
  params.set('sort', 'title-asc');
  state.bookmarks = await api(`/api/bookmarks?${params.toString()}`);
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
  icon.src = faviconUrl(bookmark.url);
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
  title.textContent = bookmark.title;
  const url = document.createElement('span');
  url.className = 'bookmark-url';
  url.textContent = bookmark.url;
  info.appendChild(title);
  info.appendChild(url);
  info.addEventListener('click', () => openInNewTab(bookmark.url));
  li.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'star-btn' + (bookmark.favorite ? ' active' : '');
  starBtn.textContent = bookmark.favorite ? '★' : '☆';
  starBtn.title = bookmark.favorite ? 'Remove from favorites' : 'Add to favorites';
  starBtn.addEventListener('click', () => toggleFavorite(bookmark));
  actions.appendChild(starBtn);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit';
  editBtn.addEventListener('click', () => openForm('edit', bookmark));
  actions.appendChild(editBtn);

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
  await chrome.tabs.create({ url });
  window.close();
}

async function toggleFavorite(bookmark) {
  try {
    await api(`/api/bookmarks/${bookmark.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !bookmark.favorite }),
    });
    await loadBookmarks();
  } catch (err) {
    handleApiError(err);
  }
}

async function deleteBookmark(bookmark) {
  if (!confirm(`Delete "${bookmark.title}"?`)) return;
  try {
    await api(`/api/bookmarks/${bookmark.id}`, { method: 'DELETE' });
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
  els.formFolder.value = bookmark ? bookmark.folder || '' : '';
  els.formFavorite.checked = Boolean(bookmark && bookmark.favorite);
  els.formError.hidden = true;
  showView('form');
  els.formTitle.focus();
}

els.addBtn.addEventListener('click', () => openForm('add', null));
els.formCancel.addEventListener('click', () => showView('main'));

els.addCurrentBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) {
    els.formError.textContent = '';
    openForm('add', { title: '', url: '', folder: '', favorite: false });
    return;
  }
  openForm('add', { title: tab.title || tab.url, url: tab.url, folder: '', favorite: false });
});

els.bookmarkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: els.formTitle.value.trim(),
    url: els.formUrl.value.trim(),
    folder: els.formFolder.value.trim(),
    favorite: els.formFavorite.checked,
  };

  try {
    if (state.formMode === 'edit') {
      await api(`/api/bookmarks/${state.editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
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
    showLock('login');
    return;
  }
  els.formError.textContent = err.message;
}

// --- Options ---

els.optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.noServerOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// --- Boot ---

async function enterApp() {
  await Promise.all([loadFolders(), loadBookmarks()]);
  showView('main');
}

async function init() {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  if (!serverUrl) {
    showView('noServer');
    return;
  }
  state.serverUrl = serverUrl.replace(/\/+$/, '');

  try {
    const status = await api('/api/auth/status');
    if (status.setupRequired) {
      showLock('setup');
    } else if (!status.authenticated) {
      showLock('login');
    } else {
      await enterApp();
    }
  } catch {
    showView('noServer');
  }
}

init();
