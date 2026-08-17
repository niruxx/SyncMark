const themeSelect = document.getElementById('theme-select');
const viewSelect = document.getElementById('default-view-select');
const statTotal = document.getElementById('stat-total');
const statFolders = document.getElementById('stat-folders');
const clearAllBtn = document.getElementById('clear-all-btn');
const importFile = document.getElementById('import-file');
const sessionDurationSelect = document.getElementById('session-duration-select');
const signOutBtn = document.getElementById('sign-out-btn');
const accountUsernameEl = document.getElementById('account-username');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const deleteAccountModal = document.getElementById('delete-account-modal');
const deleteAccountForm = document.getElementById('delete-account-form');
const deleteAccountPassword = document.getElementById('delete-account-password');
const deleteAccountError = document.getElementById('delete-account-error');
const deleteAccountCancel = document.getElementById('delete-account-cancel');

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
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

themeSelect.value = localStorage.getItem('syncmark:theme') || 'dark';
viewSelect.value = localStorage.getItem('syncmark:view') || 'list';

themeSelect.addEventListener('change', () => {
  localStorage.setItem('syncmark:theme', themeSelect.value);
  document.documentElement.setAttribute('data-theme', themeSelect.value);
});

viewSelect.addEventListener('change', () => {
  localStorage.setItem('syncmark:view', viewSelect.value);
});

async function loadStats() {
  try {
    const stats = await api('/stats');
    statTotal.textContent = stats.total;
    statFolders.textContent = stats.folderCount;
  } catch {
    statTotal.textContent = '–';
    statFolders.textContent = '–';
  }
}

async function loadSessionDuration() {
  try {
    const data = await api('/auth/settings');
    sessionDurationSelect.value = data.sessionDuration;
  } catch {
    /* leave default selection */
  }
}

async function loadAccountBadge() {
  try {
    const data = await api('/auth/me');
    accountUsernameEl.textContent = data.username;
  } catch {
    /* ignore */
  }
}

sessionDurationSelect.addEventListener('change', async () => {
  try {
    await api('/auth/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionDuration: sessionDurationSelect.value }),
    });
    showToast('Session length updated', 'success');
  } catch (err) {
    showToast(`Failed to update session length: ${err.message}`, 'error');
  }
});

signOutBtn.addEventListener('click', async () => {
  const confirmed = await confirmDialog('Sign out of SyncMark now?');
  if (!confirmed) return;
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

clearAllBtn.addEventListener('click', async () => {
  const confirmed = await confirmDialog('Delete every bookmark? This cannot be undone.', { danger: true });
  if (!confirmed) return;
  clearAllBtn.disabled = true;
  try {
    await api('/bookmarks/all', { method: 'DELETE' });
    await loadStats();
    showToast('All bookmarks cleared', 'success');
  } catch (err) {
    showToast(`Failed to clear bookmarks: ${err.message}`, 'error');
  } finally {
    clearAllBtn.disabled = false;
  }
});

deleteAccountBtn.addEventListener('click', () => {
  deleteAccountPassword.value = '';
  deleteAccountError.hidden = true;
  deleteAccountModal.classList.add('is-open');
  deleteAccountPassword.focus();
});

deleteAccountCancel.addEventListener('click', () => {
  deleteAccountModal.classList.remove('is-open');
});

deleteAccountModal.addEventListener('click', (e) => {
  if (e.target === deleteAccountModal) deleteAccountModal.classList.remove('is-open');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && deleteAccountModal.classList.contains('is-open')) {
    deleteAccountModal.classList.remove('is-open');
  }
});

deleteAccountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  deleteAccountError.hidden = true;
  try {
    await api('/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: deleteAccountPassword.value }),
    });
    location.reload();
  } catch (err) {
    deleteAccountError.textContent = err.message;
    deleteAccountError.hidden = false;
  }
});

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} bookmark${result.imported === 1 ? '' : 's'}`, 'success');
    await loadStats();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    importFile.value = '';
  }
});

loadStats();
loadSessionDuration();
loadAccountBadge();
