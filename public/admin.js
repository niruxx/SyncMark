const els = {
  userRows: document.getElementById('user-rows'),
  userCount: document.getElementById('user-count'),
  emptyState: document.getElementById('empty-state'),
  addUserBtn: document.getElementById('add-user-btn'),

  userModal: document.getElementById('user-modal'),
  userModalHeading: document.getElementById('user-modal-heading'),
  userForm: document.getElementById('user-form'),
  usernameInput: document.getElementById('user-username-input'),
  passwordInput: document.getElementById('user-password-input'),
  passwordHint: document.getElementById('user-password-hint'),
  userModalDangerBar: document.getElementById('user-modal-danger-bar'),
  userModalError: document.getElementById('user-modal-error'),
  userModalCancelBtn: document.getElementById('user-modal-cancel-btn'),

  detailModal: document.getElementById('user-detail-modal'),
  detailHeading: document.getElementById('user-detail-heading'),
  detailSubtitle: document.getElementById('user-detail-subtitle'),
  detailBody: document.getElementById('user-detail-body'),
  detailCloseBtn: document.getElementById('user-detail-close-btn'),

  resetBtn: document.getElementById('reset-instance-btn'),
  resetModal: document.getElementById('reset-instance-modal'),
  resetForm: document.getElementById('reset-instance-form'),
  resetPassword: document.getElementById('reset-instance-password'),
  resetConfirmInput: document.getElementById('reset-instance-confirm'),
  resetError: document.getElementById('reset-instance-error'),
  resetCancelBtn: document.getElementById('reset-instance-cancel'),
  resetSubmit: document.getElementById('reset-instance-submit'),
};

const state = {
  users: [],
  modalMode: null, // 'add' | 'edit'
  modalUserId: null,
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

function setPressed(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-on', on);
}

function isPressed(btn) {
  return btn.getAttribute('aria-pressed') === 'true';
}

// --- Users ---

async function loadUsers() {
  state.users = await api('/admin/users');
  renderUsers();
}

function summarizeCounts(counts) {
  const parts = [
    [counts.bookmarks, 'bookmark'],
    [counts.contacts, 'contact'],
    [counts.events, 'event'],
    [counts.passwords, 'password'],
    [counts.fileLocations, 'location'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'No data yet';
}

function renderUsers() {
  els.userRows.innerHTML = '';
  els.emptyState.hidden = state.users.length > 0;
  els.userCount.textContent = state.users.length ? `${state.users.length} user${state.users.length === 1 ? '' : 's'}` : '';

  for (const user of state.users) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.dataset.label = 'Username';
    nameTd.textContent = user.username;
    tr.appendChild(nameTd);

    const createdTd = document.createElement('td');
    createdTd.dataset.label = 'Created';
    createdTd.textContent = new Date(`${user.created_at.replace(' ', 'T')}Z`).toLocaleDateString(undefined, {
      year: '2-digit',
      month: 'numeric',
      day: 'numeric',
    });
    tr.appendChild(createdTd);

    const dataTd = document.createElement('td');
    dataTd.dataset.label = 'Data';
    dataTd.textContent = summarizeCounts(user.counts);
    tr.appendChild(dataTd);

    const statusTd = document.createElement('td');
    statusTd.dataset.label = 'Status';
    statusTd.textContent = user.enabled ? 'Enabled' : 'Disabled';
    tr.appendChild(statusTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'secondary';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => openDetail(user));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openModal('edit', user));

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'secondary';
    toggleBtn.textContent = user.enabled ? 'Disable' : 'Enable';
    toggleBtn.addEventListener('click', () => toggleEnabled(user));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteUser(user));

    actionsTd.append(viewBtn, editBtn, toggleBtn, deleteBtn);
    tr.appendChild(actionsTd);

    els.userRows.appendChild(tr);
  }
}

async function toggleEnabled(user) {
  try {
    await api(`/admin/users/${user.id}/enabled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !user.enabled }),
    });
    showToast(user.enabled ? `${user.username} disabled` : `${user.username} enabled`, 'success');
    await loadUsers();
  } catch (err) {
    showToast(`Failed to update: ${err.message}`, 'error');
  }
}

async function deleteUser(user) {
  const confirmed = await confirmDialog(
    `Delete "${user.username}"? This permanently removes their account and every bookmark, contact, event, password, and file location they have.`,
    { danger: true, irreversible: `Deleting "${user.username}" is permanent — their account and everything they own cannot be recovered.` }
  );
  if (!confirmed) return;

  try {
    await api(`/admin/users/${user.id}`, { method: 'DELETE' });
    showToast('User deleted', 'success');
    await loadUsers();
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// --- Add/edit modal ---

function openModal(mode, user) {
  state.modalMode = mode;
  state.modalUserId = user ? user.id : null;
  els.userModalError.hidden = true;
  els.userForm.reset();

  if (mode === 'edit') {
    els.userModalHeading.textContent = `Edit ${user.username}`;
    els.usernameInput.value = user.username;
    els.passwordInput.required = false;
    els.passwordHint.hidden = false;
    els.userModalDangerBar.hidden = false;
  } else {
    els.userModalHeading.textContent = 'Add user';
    els.passwordInput.required = true;
    els.passwordHint.hidden = true;
    els.userModalDangerBar.hidden = true;
  }

  els.userModal.classList.add('is-open');
  els.usernameInput.focus();
}

function closeModal() {
  els.userModal.classList.remove('is-open');
  state.modalMode = null;
  state.modalUserId = null;
}

els.addUserBtn.addEventListener('click', () => openModal('add', null));
els.userModalCancelBtn.addEventListener('click', closeModal);
els.userModal.addEventListener('click', (e) => {
  if (e.target === els.userModal) closeModal();
});

els.userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.userModalError.hidden = true;

  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;
  if (state.modalMode === 'add' && password.length < 8) {
    els.userModalError.textContent = 'Password must be at least 8 characters.';
    els.userModalError.hidden = false;
    return;
  }
  if (password && password.length < 8) {
    els.userModalError.textContent = 'Password must be at least 8 characters.';
    els.userModalError.hidden = false;
    return;
  }

  try {
    if (state.modalMode === 'edit') {
      const body = { username };
      if (password) body.password = password;
      await api(`/admin/users/${state.modalUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      showToast('User updated', 'success');
    } else {
      await api('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      showToast('User created', 'success');
    }
    closeModal();
    await loadUsers();
  } catch (err) {
    els.userModalError.textContent = err.message;
    els.userModalError.hidden = false;
  }
});

// --- Read-only detail view ---

function detailSection(title, rows, emptyLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'contact-card-section';

  const heading = document.createElement('h3');
  heading.textContent = `${title} (${rows.length})`;
  wrap.appendChild(heading);

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'settings-hint';
    p.textContent = emptyLabel;
    wrap.appendChild(p);
    return wrap;
  }

  const ul = document.createElement('ul');
  ul.className = 'folders-manage-list';
  for (const line of rows) {
    const li = document.createElement('li');
    li.className = 'folders-manage-row';
    const span = document.createElement('span');
    span.className = 'folders-manage-name';
    span.textContent = line;
    li.appendChild(span);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

async function openDetail(user) {
  els.detailHeading.textContent = user.username;
  els.detailSubtitle.textContent = user.enabled ? 'Enabled' : 'Disabled';
  els.detailBody.innerHTML = '';
  els.detailModal.classList.add('is-open');

  let detail;
  try {
    detail = await api(`/admin/users/${user.id}`);
  } catch (err) {
    showToast(`Failed to load user: ${err.message}`, 'error');
    closeDetail();
    return;
  }

  els.detailBody.append(
    detailSection(
      'Bookmarks',
      detail.bookmarks.map((b) => `${b.title} — ${b.url}${b.folder ? ` (${b.folder})` : ''}`),
      'No bookmarks.'
    ),
    detailSection(
      'Contacts',
      detail.contacts.map((c) => [c.full_name, c.organization].filter(Boolean).join(' — ')),
      'No contacts.'
    ),
    detailSection(
      'Events',
      detail.events.map((e) => `${e.title} — ${new Date(e.start_at).toLocaleString()}`),
      'No events.'
    ),
    detailSection(
      'File locations',
      detail.fileLocations.map((l) => `${l.name} — ${l.path}`),
      'No file locations.'
    ),
    detailSection(
      'Saved passwords',
      detail.passwords.map((p) => `${p.site_name}${p.username ? ` — ${p.username}` : ''}`),
      'No saved passwords.'
    )
  );

  const passwordNote = document.createElement('p');
  passwordNote.className = 'settings-hint';
  passwordNote.textContent = 'The saved password itself is never shown here — only the site and username.';
  els.detailBody.appendChild(passwordNote);
}

function closeDetail() {
  els.detailModal.classList.remove('is-open');
}

els.detailCloseBtn.addEventListener('click', closeDetail);
els.detailModal.addEventListener('click', (e) => {
  if (e.target === els.detailModal) closeDetail();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.userModal.classList.contains('is-open')) closeModal();
  if (els.detailModal.classList.contains('is-open')) closeDetail();
  if (els.resetModal.classList.contains('is-open')) closeResetModal();
});

// --- Reset SyncMark (factory reset — every account, including this one) ---

els.resetBtn.addEventListener('click', openResetModal);

function openResetModal() {
  els.resetForm.reset();
  els.resetSubmit.disabled = true;
  els.resetError.hidden = true;
  els.resetModal.classList.add('is-open');
  els.resetPassword.focus();
}

function closeResetModal() {
  els.resetModal.classList.remove('is-open');
}

els.resetCancelBtn.addEventListener('click', closeResetModal);
els.resetModal.addEventListener('click', (e) => {
  if (e.target === els.resetModal) closeResetModal();
});

// The confirm button stays disabled until the phrase matches exactly — this
// is the one action in the whole app that destroys every account at once
// (including the admin's own), so it gets a stricter gate than the plain
// password confirmation everything else here uses.
els.resetConfirmInput.addEventListener('input', () => {
  els.resetSubmit.disabled = els.resetConfirmInput.value !== 'RESET';
});

els.resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.resetError.hidden = true;

  try {
    await api('/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: els.resetPassword.value, confirm: els.resetConfirmInput.value }),
    });
    location.href = 'index.html';
  } catch (err) {
    els.resetError.textContent = err.message;
    els.resetError.hidden = false;
  }
});

// --- Backups (adapted from settings.js's backup tab — same API, same
// module-selection UI, just scoped to admin-only per server.js) ---

const backupEnabledToggle = document.getElementById('backup-enabled-toggle');
const backupFrequencySelect = document.getElementById('backup-frequency-select');
const backupRetentionInput = document.getElementById('backup-retention-input');
const backupDirInput = document.getElementById('backup-dir-input');
const backupScheduleError = document.getElementById('backup-schedule-error');
const backupRunNowBtn = document.getElementById('backup-run-now-btn');
const backupsList = document.getElementById('backups-list');
const backupsEmptyHint = document.getElementById('backups-empty-hint');
const backupModulesGroup = document.getElementById('backup-modules-group');
const restoreBackupModal = document.getElementById('restore-backup-modal');
const restoreBackupSubtitle = document.getElementById('restore-backup-subtitle');
const restoreBackupForm = document.getElementById('restore-backup-form');
const restoreBackupPassword = document.getElementById('restore-backup-password');
const restoreBackupError = document.getElementById('restore-backup-error');
const restoreBackupCancel = document.getElementById('restore-backup-cancel');
const restoreModulesGroup = document.getElementById('restore-modules-group');

const MODULE_LABELS = {
  bookmarks: 'Bookmarks',
  contacts: 'Contacts',
  calendar: 'Calendar',
  files: 'Files',
  passwords: 'Passwords',
  account: 'Accounts & settings',
};

async function loadBackupSchedule() {
  try {
    const schedule = await api('/backups/schedule');
    setPressed(backupEnabledToggle, schedule.enabled);
    backupFrequencySelect.value = schedule.frequency;
    backupRetentionInput.value = schedule.retentionCount;
    backupDirInput.value = schedule.dir || '';
    backupDirInput.placeholder = `Default: ${schedule.effectiveDir}`;
    for (const btn of backupModulesGroup.querySelectorAll('.feature-toggle-btn')) {
      setPressed(btn, (schedule.modules || []).includes(btn.dataset.module));
    }
  } catch {
    /* leave defaults */
  }
}

async function saveBackupSchedule(patch) {
  backupScheduleError.hidden = true;
  try {
    await api('/backups/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    showToast('Backup settings saved', 'success');
  } catch (err) {
    backupScheduleError.textContent = err.message;
    backupScheduleError.hidden = false;
    await loadBackupSchedule();
  }
}

backupEnabledToggle.addEventListener('click', () => {
  const next = !isPressed(backupEnabledToggle);
  setPressed(backupEnabledToggle, next);
  saveBackupSchedule({ enabled: next });
});
backupFrequencySelect.addEventListener('change', () => saveBackupSchedule({ frequency: backupFrequencySelect.value }));
backupRetentionInput.addEventListener('change', () => saveBackupSchedule({ retentionCount: Number(backupRetentionInput.value) }));
backupDirInput.addEventListener('change', () => saveBackupSchedule({ dir: backupDirInput.value.trim() }));

for (const btn of backupModulesGroup.querySelectorAll('.feature-toggle-btn')) {
  btn.addEventListener('click', () => {
    const nextOn = !isPressed(btn);
    const stillSelected = [...backupModulesGroup.querySelectorAll('.feature-toggle-btn')].filter((b) =>
      b === btn ? nextOn : isPressed(b)
    );
    if (stillSelected.length === 0) {
      backupScheduleError.textContent = 'Select at least one module to back up.';
      backupScheduleError.hidden = false;
      return;
    }
    setPressed(btn, nextOn);
    saveBackupSchedule({ modules: stillSelected.map((b) => b.dataset.module) });
  });
}

function formatBackupSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBackups() {
  try {
    const backups = await api('/backups');
    renderBackups(backups);
  } catch {
    backupsList.innerHTML = '';
    backupsEmptyHint.hidden = false;
  }
}

function renderBackups(backups) {
  backupsList.innerHTML = '';
  backupsEmptyHint.hidden = backups.length > 0;

  for (const backup of backups) {
    const li = document.createElement('li');
    li.className = 'folders-manage-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'folders-manage-name';
    const when = new Date(backup.modifiedAt).toLocaleString();
    const moduleList = (backup.modules || []).map((m) => MODULE_LABELS[m] || m).join(', ') || 'Unknown contents';
    nameSpan.textContent = `${when} — ${formatBackupSize(backup.size)} — ${moduleList}`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const downloadLink = document.createElement('a');
    downloadLink.className = 'button secondary';
    downloadLink.href = `/api/backups/${encodeURIComponent(backup.name)}/download`;
    downloadLink.setAttribute('download', '');
    downloadLink.textContent = 'Download';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'secondary';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => openRestoreBackupModal(backup));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteBackup(backup));

    actions.append(downloadLink, restoreBtn, deleteBtn);
    li.append(nameSpan, actions);
    backupsList.appendChild(li);
  }
}

async function deleteBackup(backup) {
  const confirmed = await confirmDialog(`Delete the backup from ${new Date(backup.modifiedAt).toLocaleString()}?`, { danger: true });
  if (!confirmed) return;

  try {
    await api(`/backups/${encodeURIComponent(backup.name)}`, { method: 'DELETE' });
    await loadBackups();
    showToast('Backup deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete backup: ${err.message}`, 'error');
  }
}

backupRunNowBtn.addEventListener('click', async () => {
  backupRunNowBtn.disabled = true;
  try {
    await api('/backups/run', { method: 'POST' });
    await loadBackups();
    showToast('Backup created', 'success');
  } catch (err) {
    showToast(`Backup failed: ${err.message}`, 'error');
  } finally {
    backupRunNowBtn.disabled = false;
  }
});

let pendingRestoreBackup = null;

function openRestoreBackupModal(backup) {
  pendingRestoreBackup = backup;
  restoreBackupSubtitle.textContent = `This replaces the selected modules' data — for every user — with the backup from ${new Date(backup.modifiedAt).toLocaleString()}. If Accounts & settings is included, everyone will need to sign in again afterward. There is no undo. Enter your password to confirm.`;

  restoreModulesGroup.innerHTML = '';
  const modules = backup.modules && backup.modules.length ? backup.modules : Object.keys(MODULE_LABELS);
  for (const key of modules) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'feature-toggle-btn is-on';
    btn.dataset.module = key;
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = MODULE_LABELS[key] || key;
    btn.addEventListener('click', () => {
      const nextOn = !isPressed(btn);
      const stillSelected = [...restoreModulesGroup.querySelectorAll('.feature-toggle-btn')].filter((b) =>
        b === btn ? nextOn : isPressed(b)
      );
      if (stillSelected.length === 0) {
        restoreBackupError.textContent = 'Select at least one module to restore.';
        restoreBackupError.hidden = false;
        return;
      }
      restoreBackupError.hidden = true;
      setPressed(btn, nextOn);
    });
    restoreModulesGroup.appendChild(btn);
  }

  restoreBackupPassword.value = '';
  restoreBackupError.hidden = true;
  restoreBackupModal.classList.add('is-open');
  restoreBackupPassword.focus();
}

function closeRestoreBackupModal() {
  restoreBackupModal.classList.remove('is-open');
  pendingRestoreBackup = null;
}

restoreBackupCancel.addEventListener('click', closeRestoreBackupModal);
restoreBackupModal.addEventListener('click', (e) => {
  if (e.target === restoreBackupModal) closeRestoreBackupModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && restoreBackupModal.classList.contains('is-open')) closeRestoreBackupModal();
});

restoreBackupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  restoreBackupError.hidden = true;
  if (!pendingRestoreBackup) return;

  const selectedModules = [...restoreModulesGroup.querySelectorAll('.feature-toggle-btn')]
    .filter((b) => isPressed(b))
    .map((b) => b.dataset.module);
  if (selectedModules.length === 0) {
    restoreBackupError.textContent = 'Select at least one module to restore.';
    restoreBackupError.hidden = false;
    return;
  }

  try {
    await api(`/backups/${encodeURIComponent(pendingRestoreBackup.name)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: restoreBackupPassword.value, modules: selectedModules }),
    });
    location.reload();
  } catch (err) {
    restoreBackupError.textContent = err.message;
    restoreBackupError.hidden = false;
  }
});

// --- Tabs ---

const tabButtons = document.querySelectorAll('.settings-tab');
const tabPanels = document.querySelectorAll('.settings-tab-panel');

function activateTab(tab) {
  const validTabs = [...tabButtons].map((btn) => btn.dataset.tab);
  const resolved = validTabs.includes(tab) ? tab : 'users';

  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === resolved;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== resolved;
  });
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

async function loadAccountBadge() {
  try {
    renderAccountBadge(await api('/auth/me'));
  } catch {
    /* ignore */
  }
}

activateTab('users');
loadUsers();
loadBackupSchedule();
loadBackups();
loadAccountBadge();
