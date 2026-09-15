const state = {
  passwords: [],
  favoritesOnly: false,
  query: '',
  sort: localStorage.getItem('syncmark:passwordsSort') || 'name-asc',
  modalMode: null, // 'add' | 'edit'
  modalPasswordId: null,
  revealedRowId: null,
};

const els = {
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  resultCount: document.getElementById('result-count'),
  rows: document.getElementById('password-rows'),
  emptyState: document.getElementById('empty-state'),
  addPasswordBtn: document.getElementById('add-password-btn'),
  allPasswordsBtn: document.getElementById('all-passwords-btn'),
  favoritesBtn: document.getElementById('favorites-btn'),
  importFile: document.getElementById('import-passwords-file'),

  modal: document.getElementById('password-modal'),
  modalHeading: document.getElementById('password-modal-heading'),
  modalForm: document.getElementById('password-form'),
  siteInput: document.getElementById('modal-site-input'),
  urlInput: document.getElementById('modal-url-input'),
  usernameInput: document.getElementById('modal-username-input'),
  passwordInput: document.getElementById('modal-password-input'),
  passwordToggleBtn: document.getElementById('modal-password-toggle-btn'),
  generateBtn: document.getElementById('modal-generate-btn'),
  notesInput: document.getElementById('modal-notes-input'),
  favoriteInput: document.getElementById('modal-favorite-input'),
  modalError: document.getElementById('modal-error'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
};

async function api(path, options) {
  progress.start();
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } finally {
    progress.done();
  }
  if (res.status === 401) {
    location.reload();
    return new Promise(() => {});
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Google's favicon service — same "best-effort, no server round trip" call
// bookmarks makes for its own row icons, here keyed off each entry's URL.
function faviconUrl(url) {
  const host = hostnameFromUrl(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
}

async function loadPasswords() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.favoritesOnly) params.set('favorite', '1');
  params.set('sort', state.sort);
  state.passwords = await api(`/passwords?${params.toString()}`);
  state.revealedRowId = null;
  renderPasswords();
}

function makeRevealCell(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'password-reveal-cell';

  const valueEl = document.createElement('span');
  valueEl.className = 'password-value';
  valueEl.textContent = '••••••••';

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'icon-btn password-visibility-btn';
  revealBtn.title = 'Show password';
  revealBtn.innerHTML = '<span class="material-symbols-outlined">visibility</span>';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'icon-btn';
  copyBtn.title = 'Copy password';
  copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';

  let revealed = false;
  let plainValue = null;

  revealBtn.addEventListener('click', async () => {
    if (revealed) {
      revealed = false;
      valueEl.textContent = '••••••••';
      revealBtn.title = 'Show password';
      revealBtn.querySelector('.material-symbols-outlined').textContent = 'visibility';
      return;
    }
    try {
      if (plainValue === null) {
        const { password } = await api(`/passwords/${entry.id}/reveal`);
        plainValue = password;
      }
      revealed = true;
      valueEl.textContent = plainValue || '(empty)';
      revealBtn.title = 'Hide password';
      revealBtn.querySelector('.material-symbols-outlined').textContent = 'visibility_off';
    } catch (err) {
      showToast(`Failed to reveal password: ${err.message}`, 'error');
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      if (plainValue === null) {
        const { password } = await api(`/passwords/${entry.id}/reveal`);
        plainValue = password;
      }
      await navigator.clipboard.writeText(plainValue || '');
      showToast('Password copied to clipboard', 'success');
    } catch (err) {
      showToast(`Failed to copy password: ${err.message}`, 'error');
    }
  });

  wrap.append(valueEl, revealBtn, copyBtn);
  return wrap;
}

function renderPasswords() {
  els.rows.innerHTML = '';
  els.emptyState.hidden = state.passwords.length > 0;
  els.resultCount.textContent = state.passwords.length
    ? `${state.passwords.length} password${state.passwords.length === 1 ? '' : 's'}`
    : '';

  for (const entry of state.passwords) {
    const tr = document.createElement('tr');

    const iconTd = document.createElement('td');
    iconTd.className = 'icon-cell';
    const icon = faviconUrl(entry.url);
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.width = 20;
      img.height = 20;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        iconTd.innerHTML = '<span class="material-symbols-outlined">key</span>';
      });
      iconTd.appendChild(img);
    } else {
      iconTd.innerHTML = '<span class="material-symbols-outlined">key</span>';
    }
    tr.appendChild(iconTd);

    const siteTd = document.createElement('td');
    siteTd.dataset.label = 'Site';
    siteTd.textContent = entry.site_name;
    if (entry.url) {
      const sub = document.createElement('div');
      sub.className = 'password-row-subtext';
      sub.textContent = hostnameFromUrl(entry.url) || entry.url;
      siteTd.appendChild(sub);
    }
    tr.appendChild(siteTd);

    const usernameTd = document.createElement('td');
    usernameTd.dataset.label = 'Username';
    usernameTd.textContent = entry.username || '';
    tr.appendChild(usernameTd);

    const passwordTd = document.createElement('td');
    passwordTd.dataset.label = 'Password';
    passwordTd.appendChild(makeRevealCell(entry));
    tr.appendChild(passwordTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = `star-btn${entry.favorite ? ' active' : ''}`;
    starBtn.title = entry.favorite ? 'Unfavorite' : 'Favorite';
    starBtn.innerHTML = '<span class="material-symbols-outlined">star</span>';
    starBtn.addEventListener('click', () => toggleFavorite(entry));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openModal('edit', entry.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deletePassword(entry));

    actionsTd.append(starBtn, editBtn, deleteBtn);
    tr.appendChild(actionsTd);

    els.rows.appendChild(tr);
  }
}

async function toggleFavorite(entry) {
  try {
    await api(`/passwords/${entry.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !entry.favorite }),
    });
    await loadPasswords();
  } catch (err) {
    showToast(`Failed to update favorite: ${err.message}`, 'error');
  }
}

async function deletePassword(entry) {
  const confirmed = await confirmDialog(`Delete the saved password for "${entry.site_name}"? This cannot be undone.`, {
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api(`/passwords/${entry.id}`, { method: 'DELETE' });
    showToast('Password deleted', 'success');
    await loadPasswords();
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// --- Add/edit modal ---

function resetPasswordVisibility() {
  els.passwordInput.type = 'password';
  els.passwordToggleBtn.title = 'Show password';
  els.passwordToggleBtn.querySelector('.material-symbols-outlined').textContent = 'visibility';
}

els.passwordToggleBtn.addEventListener('click', () => {
  const showing = els.passwordInput.type === 'text';
  els.passwordInput.type = showing ? 'password' : 'text';
  els.passwordToggleBtn.title = showing ? 'Show password' : 'Hide password';
  els.passwordToggleBtn.querySelector('.material-symbols-outlined').textContent = showing ? 'visibility' : 'visibility_off';
});

// Every character class guaranteed at least once, rest filled from the full
// pool and shuffled — avoids the common weak-generator bug where a fixed
// per-class ordering (all uppercase first, etc.) leaks structure.
function generatePassword(length = 20) {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnpqrstuvwxyz',
    '23456789',
    '!@#$%^&*()-_=+',
  ];
  const all = sets.join('');
  const pick = (pool) => pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];

  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

els.generateBtn.addEventListener('click', () => {
  els.passwordInput.type = 'text';
  els.passwordToggleBtn.title = 'Hide password';
  els.passwordToggleBtn.querySelector('.material-symbols-outlined').textContent = 'visibility_off';
  els.passwordInput.value = generatePassword();
});

async function openModal(mode, passwordId) {
  state.modalMode = mode;
  state.modalPasswordId = passwordId;
  els.modalError.hidden = true;
  resetPasswordVisibility();

  if (mode === 'edit') {
    els.modalHeading.textContent = 'Edit password';
    let entry;
    try {
      entry = await api(`/passwords/${passwordId}`);
    } catch (err) {
      showToast(`Failed to load password: ${err.message}`, 'error');
      return;
    }
    els.siteInput.value = entry.site_name || '';
    els.urlInput.value = entry.url || '';
    els.usernameInput.value = entry.username || '';
    els.passwordInput.value = entry.password || '';
    els.notesInput.value = entry.notes || '';
    els.favoriteInput.checked = Boolean(entry.favorite);
  } else {
    els.modalHeading.textContent = 'Add password';
    els.modalForm.reset();
  }

  els.modal.classList.add('is-open');
  els.siteInput.focus();
}

function closeModal() {
  els.modal.classList.remove('is-open');
  els.modalForm.reset();
  state.modalMode = null;
  state.modalPasswordId = null;
}

els.addPasswordBtn.addEventListener('click', () => openModal('add', null));
els.modalCancelBtn.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});

els.modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.modalError.hidden = true;

  const payload = {
    siteName: els.siteInput.value.trim(),
    url: els.urlInput.value.trim(),
    username: els.usernameInput.value.trim(),
    password: els.passwordInput.value,
    notes: els.notesInput.value.trim(),
    favorite: els.favoriteInput.checked,
  };

  try {
    if (state.modalMode === 'edit') {
      await api(`/passwords/${state.modalPasswordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('Password updated', 'success');
    } else {
      await api('/passwords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('Password saved', 'success');
    }
    closeModal();
    await loadPasswords();
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

// --- Filters ---

els.allPasswordsBtn.addEventListener('click', () => {
  state.favoritesOnly = false;
  els.allPasswordsBtn.classList.add('active');
  els.favoritesBtn.classList.remove('active');
  loadPasswords();
});

els.favoritesBtn.addEventListener('click', () => {
  state.favoritesOnly = true;
  els.favoritesBtn.classList.add('active');
  els.allPasswordsBtn.classList.remove('active');
  loadPasswords();
});

let searchDebounce;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = els.searchInput.value.trim();
    loadPasswords();
  }, 200);
});

els.sortSelect.value = state.sort;
els.sortSelect.addEventListener('change', () => {
  state.sort = els.sortSelect.value;
  localStorage.setItem('syncmark:passwordsSort', state.sort);
  loadPasswords();
});

// --- Import ---

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/passwords/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} password${result.imported === 1 ? '' : 's'}`, 'success');
    await loadPasswords();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    els.importFile.value = '';
  }
});

document.addEventListener('keydown', (e) => {
  if (els.modal.classList.contains('is-open')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === '/') {
    e.preventDefault();
    els.searchInput.focus();
  } else if (e.key === 'n') {
    openModal('add', null);
  }
});

async function loadAccountBadge() {
  try {
    renderAccountBadge(await api('/auth/me'));
  } catch {
    /* ignore */
  }
}

loadPasswords();
loadAccountBadge();
applyFeatureGate();
