// Zero-knowledge Passwords tab. The DEK lives only in this module's memory
// (never localStorage/sessionStorage) — a reload always re-locks the vault.
// See public/vaultCrypto.js for the key hierarchy this file drives.

const state = {
  passwords: [],
  favoritesOnly: false,
  query: '',
  sort: localStorage.getItem('syncmark:passwordsSort') || 'name-asc',
  modalMode: null, // 'add' | 'edit'
  modalPasswordId: null,
  modalKind: 'login',
};

let dek = null;
let vaultKeysRow = null; // cached GET /vault/keys response, needed by recovery/passphrase-change

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
  exportCsvBtn: document.getElementById('export-csv-btn'),
  exportJsonBtn: document.getElementById('export-json-btn'),
  vaultLockBtn: document.getElementById('vault-lock-btn'),
  vaultChangePassphraseBtn: document.getElementById('vault-change-passphrase-btn'),

  modal: document.getElementById('password-modal'),
  modalHeading: document.getElementById('password-modal-heading'),
  modalForm: document.getElementById('password-form'),
  kindToggle: document.getElementById('modal-kind-toggle'),
  siteLabel: document.getElementById('modal-site-label'),
  siteInput: document.getElementById('modal-site-input'),
  loginFields: document.getElementById('modal-login-fields'),
  urlInput: document.getElementById('modal-url-input'),
  usernameInput: document.getElementById('modal-username-input'),
  passwordInput: document.getElementById('modal-password-input'),
  passwordToggleBtn: document.getElementById('modal-password-toggle-btn'),
  generateBtn: document.getElementById('modal-generate-btn'),
  notesInput: document.getElementById('modal-notes-input'),
  favoriteInput: document.getElementById('modal-favorite-input'),
  favoriteLabel: document.getElementById('modal-favorite-label'),
  modalError: document.getElementById('modal-error'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),

  attachmentsSection: document.getElementById('modal-attachments-section'),
  attachmentList: document.getElementById('attachment-list'),
  attachmentFileInput: document.getElementById('attachment-file-input'),
  attachmentsSaveHint: document.getElementById('attachments-save-hint'),

  genPopover: document.getElementById('generator-popover'),
  genModeToggle: document.querySelector('.generator-mode-toggle'),
  genRandomOptions: document.getElementById('generator-random-options'),
  genPassphraseOptions: document.getElementById('generator-passphrase-options'),
  genLength: document.getElementById('generator-length'),
  genLengthValue: document.getElementById('generator-length-value'),
  genUpper: document.getElementById('generator-upper'),
  genLower: document.getElementById('generator-lower'),
  genDigits: document.getElementById('generator-digits'),
  genSymbols: document.getElementById('generator-symbols'),
  genExclude: document.getElementById('generator-exclude'),
  genWords: document.getElementById('generator-words'),
  genWordsValue: document.getElementById('generator-words-value'),
  genSeparator: document.getElementById('generator-separator'),
  genCapitalize: document.getElementById('generator-capitalize'),
  genNumber: document.getElementById('generator-number'),
  genApplyBtn: document.getElementById('generator-apply-btn'),

  vaultOverlay: document.getElementById('vault-overlay'),
  vaultViews: {
    unlock: document.getElementById('vault-view-unlock'),
    setup: document.getElementById('vault-view-setup'),
    recoveryKey: document.getElementById('vault-view-recovery-key'),
    recover: document.getElementById('vault-view-recover'),
    migrating: document.getElementById('vault-view-migrating'),
    changePassphrase: document.getElementById('vault-view-change-passphrase'),
  },
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

function faviconUrl(url) {
  const host = hostnameFromUrl(url);
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
}

// ---------------------------------------------------------------------------
// Vault unlock / setup / recovery
// ---------------------------------------------------------------------------

let vaultUnlockedResolve;
const vaultUnlocked = new Promise((resolve) => {
  vaultUnlockedResolve = resolve;
});

function showVaultOverlay(viewName) {
  els.vaultOverlay.classList.add('is-open');
  for (const [name, el] of Object.entries(els.vaultViews)) {
    el.hidden = name !== viewName;
  }
  const active = els.vaultViews[viewName];
  active.classList.remove('step-enter-forward');
  // eslint-disable-next-line no-unused-expressions
  void active.offsetWidth; // restart the entrance animation on repeat views
  active.classList.add('step-enter-forward');
}

function hideVaultOverlay() {
  els.vaultOverlay.classList.remove('is-open');
}

async function initVault() {
  try {
    vaultKeysRow = await api('/vault/keys');
    showVaultOverlay('unlock');
  } catch {
    // No vault_keys row yet — either a brand-new vault, or a pre-existing
    // account with legacy server-encrypted passwords that needs upgrading.
    // Either way the setup flow (which always checks for legacy data before
    // finishing) handles it the same way.
    vaultKeysRow = null;
    showVaultOverlay('setup');
  }
  return vaultUnlocked;
}

async function finishUnlock(unlockedDek) {
  dek = unlockedDek;
  hideVaultOverlay();
  vaultUnlockedResolve();
}

document.getElementById('vault-unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('vault-unlock-error');
  errorEl.hidden = true;
  const passphrase = document.getElementById('vault-unlock-passphrase').value;

  try {
    const { key: vk } = await VaultCrypto.deriveKey(passphrase, vaultKeysRow.vaultSalt);
    const unwrapped = await VaultCrypto.unwrapDek(vaultKeysRow.wrappedDekPassphrase, vaultKeysRow.wrappedDekPassphraseIv, vk);
    await finishUnlock(unwrapped);
  } catch {
    errorEl.textContent = 'Incorrect passphrase.';
    errorEl.hidden = false;
  }
});

document.getElementById('vault-goto-recover-btn').addEventListener('click', () => {
  showVaultOverlay('recover');
});

document.getElementById('vault-recover-cancel-btn').addEventListener('click', () => {
  showVaultOverlay('unlock');
});

document.getElementById('vault-recover-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('vault-recover-error');
  errorEl.hidden = true;

  const recoveryKey = VaultCrypto.normalizeRecoveryKey(document.getElementById('vault-recover-key-input').value);
  const newPassphrase = document.getElementById('vault-recover-passphrase').value;
  const confirmPassphrase = document.getElementById('vault-recover-passphrase-confirm').value;

  if (newPassphrase !== confirmPassphrase) {
    errorEl.textContent = 'Passphrases do not match.';
    errorEl.hidden = false;
    return;
  }

  try {
    const { key: rk } = await VaultCrypto.deriveKey(recoveryKey, vaultKeysRow.recoverySalt);
    const recoveredDek = await VaultCrypto.unwrapDek(vaultKeysRow.wrappedDekRecovery, vaultKeysRow.wrappedDekRecoveryIv, rk);

    // The old recovery key is one-time-shown, so recovery mints a new one
    // alongside the new passphrase, replacing both wraps together.
    const { key: newVk, saltB64: vaultSalt } = await VaultCrypto.deriveKey(newPassphrase, null);
    const { wrappedB64: wrappedDekPassphrase, ivB64: wrappedDekPassphraseIv } = await VaultCrypto.wrapDek(recoveredDek, newVk);

    const newRecoveryKey = VaultCrypto.generateRecoveryKey();
    const { key: newRk, saltB64: recoverySalt } = await VaultCrypto.deriveKey(VaultCrypto.normalizeRecoveryKey(newRecoveryKey), null);
    const { wrappedB64: wrappedDekRecovery, ivB64: wrappedDekRecoveryIv } = await VaultCrypto.wrapDek(recoveredDek, newRk);

    await api('/vault/keys/recover', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultSalt, wrappedDekPassphrase, wrappedDekPassphraseIv, recoverySalt, wrappedDekRecovery, wrappedDekRecoveryIv }),
    });

    showRecoveryKey(newRecoveryKey, async () => {
      await finishUnlock(recoveredDek);
      showToast('Vault recovered — passphrase and recovery key updated', 'success');
    });
  } catch (err) {
    errorEl.textContent = err.message && !err.message.includes('unwrap') ? err.message : 'That recovery key is incorrect.';
    errorEl.hidden = false;
  }
});

function showRecoveryKey(recoveryKey, onContinue) {
  document.getElementById('recovery-key-display').textContent = recoveryKey;
  const checkbox = document.getElementById('recovery-key-confirm-checkbox');
  const continueBtn = document.getElementById('recovery-key-continue-btn');
  checkbox.checked = false;
  continueBtn.disabled = true;

  const onCheck = () => {
    continueBtn.disabled = !checkbox.checked;
  };
  checkbox.addEventListener('change', onCheck);

  const onContinueClick = async () => {
    checkbox.removeEventListener('change', onCheck);
    continueBtn.removeEventListener('click', onContinueClick);
    await onContinue();
  };
  continueBtn.addEventListener('click', onContinueClick);

  document.getElementById('recovery-key-copy-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      showToast('Recovery key copied to clipboard', 'success');
    } catch {
      /* clipboard access denied — the key is still shown on screen */
    }
  };

  showVaultOverlay('recoveryKey');
}

document.getElementById('vault-setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('vault-setup-error');
  errorEl.hidden = true;

  const passphrase = document.getElementById('vault-setup-passphrase').value;
  const confirmPassphrase = document.getElementById('vault-setup-passphrase-confirm').value;
  if (passphrase !== confirmPassphrase) {
    errorEl.textContent = 'Passphrases do not match.';
    errorEl.hidden = false;
    return;
  }

  const newDek = await VaultCrypto.generateDek();
  const { key: vk, saltB64: vaultSalt } = await VaultCrypto.deriveKey(passphrase, null);
  const { wrappedB64: wrappedDekPassphrase, ivB64: wrappedDekPassphraseIv } = await VaultCrypto.wrapDek(newDek, vk);

  const recoveryKey = VaultCrypto.generateRecoveryKey();
  const { key: rk, saltB64: recoverySalt } = await VaultCrypto.deriveKey(VaultCrypto.normalizeRecoveryKey(recoveryKey), null);
  const { wrappedB64: wrappedDekRecovery, ivB64: wrappedDekRecoveryIv } = await VaultCrypto.wrapDek(newDek, rk);

  showRecoveryKey(recoveryKey, async () => {
    showVaultOverlay('migrating');
    try {
      await migrateLegacyPasswords(newDek);
      await api('/vault/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultSalt, wrappedDekPassphrase, wrappedDekPassphraseIv, recoverySalt, wrappedDekRecovery, wrappedDekRecoveryIv }),
      });
      await finishUnlock(newDek);
      showToast('Password vault ready', 'success');
    } catch (err) {
      showVaultOverlay('setup');
      document.getElementById('vault-setup-error').textContent = `Vault setup failed: ${err.message}`;
      document.getElementById('vault-setup-error').hidden = false;
    }
  });
});

// Re-encrypts any passwords still under the old server-held key (see
// src/routes/vault.js) with the freshly created DEK. A no-op — the server
// simply returns an empty array — for an account with nothing to migrate.
async function migrateLegacyPasswords(newDek) {
  const legacy = await api('/vault/legacy-passwords');
  for (const entry of legacy) {
    const passwordEnc = await VaultCrypto.encryptField(entry.password, newDek);
    const notesEnc = await VaultCrypto.encryptField(entry.notes, newDek);
    await api(`/passwords/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteName: entry.siteName, url: entry.url, username: entry.username,
        passwordEnc, notesEnc, favorite: Boolean(entry.favorite),
      }),
    });
  }
}

els.vaultLockBtn.addEventListener('click', () => {
  dek = null;
  location.reload();
});

els.vaultChangePassphraseBtn.addEventListener('click', () => {
  document.getElementById('vault-change-current').value = '';
  document.getElementById('vault-change-new').value = '';
  document.getElementById('vault-change-confirm').value = '';
  document.getElementById('vault-change-error').hidden = true;
  showVaultOverlay('changePassphrase');
});

document.getElementById('vault-change-cancel-btn').addEventListener('click', hideVaultOverlay);

document.getElementById('vault-change-passphrase-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('vault-change-error');
  errorEl.hidden = true;

  const current = document.getElementById('vault-change-current').value;
  const next = document.getElementById('vault-change-new').value;
  const confirmNext = document.getElementById('vault-change-confirm').value;
  if (next !== confirmNext) {
    errorEl.textContent = 'New passphrases do not match.';
    errorEl.hidden = false;
    return;
  }

  try {
    const { key: currentVk } = await VaultCrypto.deriveKey(current, vaultKeysRow.vaultSalt);
    await VaultCrypto.unwrapDek(vaultKeysRow.wrappedDekPassphrase, vaultKeysRow.wrappedDekPassphraseIv, currentVk);
  } catch {
    errorEl.textContent = 'Current passphrase is incorrect.';
    errorEl.hidden = false;
    return;
  }

  const { key: newVk, saltB64: vaultSalt } = await VaultCrypto.deriveKey(next, null);
  const { wrappedB64: wrappedDekPassphrase, ivB64: wrappedDekPassphraseIv } = await VaultCrypto.wrapDek(dek, newVk);

  try {
    await api('/vault/keys/passphrase', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultSalt, wrappedDekPassphrase, wrappedDekPassphraseIv }),
    });
    vaultKeysRow = { ...vaultKeysRow, vaultSalt, wrappedDekPassphrase, wrappedDekPassphraseIv };
    hideVaultOverlay();
    showToast('Vault passphrase changed', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

// ---------------------------------------------------------------------------
// Password list
// ---------------------------------------------------------------------------

async function loadPasswords() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.favoritesOnly) params.set('favorite', '1');
  params.set('sort', state.sort);
  state.passwords = await api(`/passwords?${params.toString()}`);
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

  async function ensurePlainValue() {
    if (plainValue === null) {
      const { passwordEnc } = await api(`/passwords/${entry.id}/reveal`);
      plainValue = await VaultCrypto.decryptField(passwordEnc, dek);
    }
    return plainValue;
  }

  revealBtn.addEventListener('click', async () => {
    if (revealed) {
      revealed = false;
      valueEl.textContent = '••••••••';
      revealBtn.title = 'Show password';
      revealBtn.querySelector('.material-symbols-outlined').textContent = 'visibility';
      return;
    }
    try {
      const value = await ensurePlainValue();
      revealed = true;
      valueEl.textContent = value || '(empty)';
      revealBtn.title = 'Hide password';
      revealBtn.querySelector('.material-symbols-outlined').textContent = 'visibility_off';
    } catch (err) {
      showToast(`Failed to reveal password: ${err.message}`, 'error');
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      const value = await ensurePlainValue();
      await navigator.clipboard.writeText(value || '');
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
    ? `${state.passwords.length} item${state.passwords.length === 1 ? '' : 's'}`
    : '';

  for (const entry of state.passwords) {
    const tr = document.createElement('tr');
    const isNote = entry.kind === 'note';

    const iconTd = document.createElement('td');
    iconTd.className = 'icon-cell';
    const icon = !isNote && faviconUrl(entry.url);
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
      iconTd.innerHTML = `<span class="material-symbols-outlined">${isNote ? 'sticky_note_2' : 'key'}</span>`;
    }
    tr.appendChild(iconTd);

    const siteTd = document.createElement('td');
    siteTd.dataset.label = 'Site';
    siteTd.textContent = entry.site_name;
    if (!isNote && entry.url) {
      const sub = document.createElement('div');
      sub.className = 'password-row-subtext';
      sub.textContent = hostnameFromUrl(entry.url) || entry.url;
      siteTd.appendChild(sub);
    }
    tr.appendChild(siteTd);

    const usernameTd = document.createElement('td');
    usernameTd.dataset.label = 'Username';
    usernameTd.textContent = isNote ? 'Secure note' : (entry.username || '');
    tr.appendChild(usernameTd);

    const passwordTd = document.createElement('td');
    passwordTd.dataset.label = 'Password';
    if (!isNote) passwordTd.appendChild(makeRevealCell(entry));
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
  const confirmed = await confirmDialog(`Delete "${entry.site_name}"? This cannot be undone.`, {
    danger: true,
    irreversible: true,
  });
  if (!confirmed) return;

  try {
    await api(`/passwords/${entry.id}`, { method: 'DELETE' });
    showToast('Deleted', 'success');
    await loadPasswords();
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Add/edit modal
// ---------------------------------------------------------------------------

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

function setModalKind(kind) {
  state.modalKind = kind;
  for (const btn of els.kindToggle.querySelectorAll('.kind-toggle-btn')) {
    btn.classList.toggle('active', btn.dataset.kind === kind);
  }
  const isNote = kind === 'note';
  els.siteLabel.textContent = isNote ? 'Title' : 'Site name';
  els.siteInput.placeholder = isNote ? 'e.g. Wi-Fi password' : 'e.g. GitHub';
  els.loginFields.hidden = isNote;
  els.favoriteLabel.hidden = false;
  els.genPopover.hidden = true;
}

for (const btn of els.kindToggle.querySelectorAll('.kind-toggle-btn')) {
  btn.addEventListener('click', () => setModalKind(btn.dataset.kind));
}

// ---- generator ----

let wordlistPromise = null;
function loadWordlist() {
  if (!wordlistPromise) wordlistPromise = fetch('wordlists/wordlist.json').then((r) => r.json());
  return wordlistPromise;
}

function randomInt(max) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

// Every selected character class guaranteed at least once, rest filled from
// the combined pool and shuffled — avoids the common weak-generator bug
// where a fixed per-class ordering (all uppercase first, etc.) leaks structure.
function generateRandomPassword({ length, upper, lower, digits, symbols, exclude }) {
  const pools = [];
  if (upper) pools.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (lower) pools.push('abcdefghijkmnpqrstuvwxyz');
  if (digits) pools.push('23456789');
  if (symbols) pools.push('!@#$%^&*()-_=+');
  if (pools.length === 0) pools.push('abcdefghijkmnpqrstuvwxyz');

  const excludeSet = new Set((exclude || '').split(''));
  const filtered = pools.map((pool) => [...pool].filter((c) => !excludeSet.has(c)).join('')).filter((p) => p.length > 0);
  const usablePools = filtered.length > 0 ? filtered : pools;
  const all = usablePools.join('');
  const pick = (pool) => pool[randomInt(pool.length)];

  const chars = usablePools.map(pick);
  while (chars.length < length) chars.push(pick(all));
  chars.length = Math.max(chars.length, length);

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
}

async function generatePassphrase({ words, separator, capitalize, appendNumber }) {
  const wordlist = await loadWordlist();
  const picked = [];
  for (let i = 0; i < words; i += 1) {
    let w = wordlist[randomInt(wordlist.length)];
    if (capitalize) w = w[0].toUpperCase() + w.slice(1);
    picked.push(w);
  }
  if (appendNumber) picked.push(String(randomInt(90) + 10));
  return picked.join(separator || '-');
}

els.generateBtn.addEventListener('click', () => {
  els.genPopover.hidden = !els.genPopover.hidden;
});

if (els.genModeToggle) {
  els.genModeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-gen-mode]');
    if (!btn) return;
    for (const b of els.genModeToggle.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    const isPassphrase = btn.dataset.genMode === 'passphrase';
    els.genRandomOptions.hidden = isPassphrase;
    els.genPassphraseOptions.hidden = !isPassphrase;
  });
}

els.genLength.addEventListener('input', () => {
  els.genLengthValue.textContent = els.genLength.value;
});
els.genWords.addEventListener('input', () => {
  els.genWordsValue.textContent = els.genWords.value;
});

els.genApplyBtn.addEventListener('click', async () => {
  const isPassphrase = !els.genPassphraseOptions.hidden;
  let value;
  if (isPassphrase) {
    value = await generatePassphrase({
      words: Number(els.genWords.value),
      separator: els.genSeparator.value,
      capitalize: els.genCapitalize.checked,
      appendNumber: els.genNumber.checked,
    });
  } else {
    value = generateRandomPassword({
      length: Number(els.genLength.value),
      upper: els.genUpper.checked,
      lower: els.genLower.checked,
      digits: els.genDigits.checked,
      symbols: els.genSymbols.checked,
      exclude: els.genExclude.value,
    });
  }
  els.passwordInput.type = 'text';
  els.passwordToggleBtn.title = 'Hide password';
  els.passwordToggleBtn.querySelector('.material-symbols-outlined').textContent = 'visibility_off';
  els.passwordInput.value = value;
  els.genPopover.hidden = true;
});

// ---- attachments ----

function renderAttachments(list) {
  els.attachmentList.innerHTML = '';
  for (const att of list) {
    const li = document.createElement('li');
    li.className = 'attachment-row';
    li.innerHTML = `
      <span class="material-symbols-outlined">draft</span>
      <span class="attachment-name">${att.filename}</span>
      <button type="button" class="icon-btn" title="Download"><span class="material-symbols-outlined">download</span></button>
      <button type="button" class="icon-btn" title="Delete"><span class="material-symbols-outlined">delete</span></button>
    `;
    const [downloadBtn, deleteBtn] = li.querySelectorAll('button');
    downloadBtn.addEventListener('click', () => downloadAttachment(att));
    deleteBtn.addEventListener('click', () => deleteAttachment(att));
    els.attachmentList.appendChild(li);
  }
}

async function loadAttachments(passwordId) {
  const list = await api(`/passwords/${passwordId}/attachments`);
  renderAttachments(list);
}

async function downloadAttachment(att) {
  try {
    const res = await fetch(`/api/passwords/${state.modalPasswordId}/attachments/${att.id}`);
    if (!res.ok) throw new Error('Download failed');
    const iv = res.headers.get('X-Attachment-Iv');
    const filename = decodeURIComponent(res.headers.get('X-Attachment-Filename') || att.filename);
    const ciphertext = new Uint8Array(await res.arrayBuffer());
    const plainBytes = await VaultCrypto.decryptBytes(ciphertext, iv, dek);

    const blob = new Blob([plainBytes], { type: att.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    showToast(`Failed to download attachment: ${err.message}`, 'error');
  }
}

async function deleteAttachment(att) {
  const confirmed = await confirmDialog(`Delete attachment "${att.filename}"?`, { danger: true, irreversible: true });
  if (!confirmed) return;
  try {
    await api(`/passwords/${state.modalPasswordId}/attachments/${att.id}`, { method: 'DELETE' });
    await loadAttachments(state.modalPasswordId);
  } catch (err) {
    showToast(`Failed to delete attachment: ${err.message}`, 'error');
  }
}

els.attachmentFileInput.addEventListener('change', async () => {
  const file = els.attachmentFileInput.files[0];
  if (!file) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ivB64, ciphertext } = await VaultCrypto.encryptBytes(bytes, dek);

    const formData = new FormData();
    formData.append('iv', ivB64);
    formData.append('filename', file.name);
    formData.append('mime', file.type || 'application/octet-stream');
    formData.append('file', new Blob([ciphertext]));

    await api(`/passwords/${state.modalPasswordId}/attachments`, { method: 'POST', body: formData });
    await loadAttachments(state.modalPasswordId);
    showToast('Attachment added', 'success');
  } catch (err) {
    showToast(`Failed to add attachment: ${err.message}`, 'error');
  } finally {
    els.attachmentFileInput.value = '';
  }
});

// ---- open/save ----

async function openModal(mode, passwordId) {
  state.modalMode = mode;
  state.modalPasswordId = passwordId;
  els.modalError.hidden = true;
  els.genPopover.hidden = true;
  resetPasswordVisibility();

  if (mode === 'edit') {
    els.modalHeading.textContent = 'Edit item';
    let entry;
    try {
      entry = await api(`/passwords/${passwordId}`);
    } catch (err) {
      showToast(`Failed to load: ${err.message}`, 'error');
      return;
    }
    setModalKind(entry.kind || 'login');
    els.siteInput.value = entry.site_name || '';
    els.urlInput.value = entry.url || '';
    els.usernameInput.value = entry.username || '';
    els.passwordInput.value = await VaultCrypto.decryptField(entry.password_enc, dek);
    els.notesInput.value = await VaultCrypto.decryptField(entry.notes, dek);
    els.favoriteInput.checked = Boolean(entry.favorite);

    els.attachmentsSection.hidden = false;
    els.attachmentsSaveHint.hidden = true;
    await loadAttachments(passwordId);
  } else {
    els.modalHeading.textContent = 'Add item';
    els.modalForm.reset();
    setModalKind('login');
    els.attachmentsSection.hidden = true;
    els.attachmentsSaveHint.hidden = false;
  }

  els.modal.classList.add('is-open');
  els.siteInput.focus();
}

function closeModal() {
  els.modal.classList.remove('is-open');
  els.modalForm.reset();
  els.genPopover.hidden = true;
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

  const isNote = state.modalKind === 'note';

  try {
    const passwordEnc = isNote ? '' : await VaultCrypto.encryptField(els.passwordInput.value, dek);
    const notesEnc = await VaultCrypto.encryptField(els.notesInput.value.trim(), dek);

    const payload = {
      siteName: els.siteInput.value.trim(),
      url: isNote ? '' : els.urlInput.value.trim(),
      username: isNote ? '' : els.usernameInput.value.trim(),
      passwordEnc,
      notesEnc,
      favorite: els.favoriteInput.checked,
      kind: state.modalKind,
    };

    if (state.modalMode === 'edit') {
      await api(`/passwords/${state.modalPasswordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('Saved', 'success');
    } else {
      await api('/passwords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('Saved', 'success');
    }
    closeModal();
    await loadPasswords();
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Export / import — all client-side; the server only ever sees ciphertext.
// ---------------------------------------------------------------------------

els.exportCsvBtn.addEventListener('click', async () => {
  try {
    const rows = await api('/passwords/export-data');
    const decrypted = [];
    for (const row of rows) {
      decrypted.push({
        siteName: row.site_name,
        url: row.url,
        username: row.username,
        password: await VaultCrypto.decryptField(row.password_enc, dek),
        notes: await VaultCrypto.decryptField(row.notes, dek),
        favorite: row.favorite,
      });
    }
    downloadBlob(PasswordsCsv.toCsv(decrypted), 'text/csv', 'syncmark-passwords.csv');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
});

els.exportJsonBtn.addEventListener('click', async () => {
  const exportPassword = prompt('Set a password to protect this backup file (you’ll need it to restore the backup):');
  if (!exportPassword) return;

  try {
    const rows = await api('/passwords/export-data');
    const { key: exportKey, saltB64: exportSalt } = await VaultCrypto.deriveKey(exportPassword, null);
    const { wrappedB64: wrappedDekExport, ivB64: wrappedDekExportIv } = await VaultCrypto.wrapDek(dek, exportKey);

    const backup = {
      format: 'syncmark-vault-v1',
      exportedAt: new Date().toISOString(),
      exportSalt,
      wrappedDekExport,
      wrappedDekExportIv,
      entries: rows,
    };
    downloadBlob(JSON.stringify(backup, null, 2), 'application/json', 'syncmark-vault-backup.json');
    showToast('Encrypted backup downloaded', 'success');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
});

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function importCsv(text) {
  const parsed = PasswordsCsv.parseCsv(text);
  if (parsed.length === 0) throw new Error('No password entries found in the uploaded file');

  const entries = [];
  for (const entry of parsed) {
    entries.push({
      siteName: entry.siteName,
      url: entry.url,
      username: entry.username,
      passwordEnc: await VaultCrypto.encryptField(entry.password || '', dek),
      notesEnc: await VaultCrypto.encryptField(entry.notes || '', dek),
      favorite: entry.favorite,
    });
  }
  return api('/passwords/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
}

async function importEncryptedBackup(text) {
  const backup = JSON.parse(text);
  if (backup.format !== 'syncmark-vault-v1') throw new Error('Unrecognized backup file format');

  const exportPassword = prompt('Enter the password that protects this backup file:');
  if (!exportPassword) throw new Error('Import cancelled');

  const { key: exportKey } = await VaultCrypto.deriveKey(exportPassword, backup.exportSalt);
  const originalDek = await VaultCrypto.unwrapDek(backup.wrappedDekExport, backup.wrappedDekExportIv, exportKey);

  const entries = [];
  for (const row of backup.entries) {
    const password = await VaultCrypto.decryptField(row.password_enc, originalDek);
    const notes = await VaultCrypto.decryptField(row.notes, originalDek);
    entries.push({
      siteName: row.site_name,
      url: row.url,
      username: row.username,
      passwordEnc: await VaultCrypto.encryptField(password, dek),
      notesEnc: await VaultCrypto.encryptField(notes, dek),
      favorite: row.favorite,
      kind: row.kind,
      matchRule: row.match_rule,
    });
  }
  return api('/passwords/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
}

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const result = file.name.toLowerCase().endsWith('.json') ? await importEncryptedBackup(text) : await importCsv(text);
    showToast(`Imported ${result.imported} item${result.imported === 1 ? '' : 's'}`, 'success');
    await loadPasswords();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    els.importFile.value = '';
  }
});

// ---------------------------------------------------------------------------

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

(async function init() {
  loadAccountBadge();
  applyFeatureGate();
  await initVault();
  await loadPasswords();
})();
