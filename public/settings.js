const themeSelect = document.getElementById('theme-select');
const viewSelect = document.getElementById('default-view-select');
const schemePicker = document.getElementById('settings-scheme-picker');
const statTotal = document.getElementById('stat-total');
const statFolders = document.getElementById('stat-folders');
const statContacts = document.getElementById('stat-contacts');
const statEvents = document.getElementById('stat-events');
const statPasswords = document.getElementById('stat-passwords');
const davUrlInput = document.getElementById('dav-url-input');
const clearAllBtn = document.getElementById('clear-all-btn');
const importFile = document.getElementById('import-file');
const importContactsFile = document.getElementById('import-contacts-file-settings');
const importEventsFile = document.getElementById('import-events-file');
const importPasswordsFile = document.getElementById('import-passwords-file-settings');
const sessionDurationSelect = document.getElementById('session-duration-select');
const signOutBtn = document.getElementById('sign-out-btn');
const accountUsernameEl = document.getElementById('account-username');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const deleteAccountModal = document.getElementById('delete-account-modal');
const deleteAccountForm = document.getElementById('delete-account-form');
const deleteAccountPassword = document.getElementById('delete-account-password');
const deleteAccountError = document.getElementById('delete-account-error');
const deleteAccountCancel = document.getElementById('delete-account-cancel');
const featureBookmarksToggle = document.getElementById('feature-bookmarks-toggle');
const featureContactsToggle = document.getElementById('feature-contacts-toggle');
const featureCalendarToggle = document.getElementById('feature-calendar-toggle');
const featureFilesToggle = document.getElementById('feature-files-toggle');
const featurePasswordsToggle = document.getElementById('feature-passwords-toggle');
const featureError = document.getElementById('feature-error');
const statLocations = document.getElementById('stat-locations');
const locationsManageList = document.getElementById('locations-manage-list');
const locationsEmptyHint = document.getElementById('locations-empty-hint');
const newLocationForm = document.getElementById('new-location-form');
const newLocationName = document.getElementById('new-location-name');
const newLocationPath = document.getElementById('new-location-path');
const locationError = document.getElementById('location-error');
const browseServerBtn = document.getElementById('browse-server-btn');
const browseServerModal = document.getElementById('browse-server-modal');
const browseServerCurrentPath = document.getElementById('browse-server-current-path');
const browseServerList = document.getElementById('browse-server-list');
const browseServerError = document.getElementById('browse-server-error');
const browseServerUpBtn = document.getElementById('browse-server-up-btn');
const browseServerCancelBtn = document.getElementById('browse-server-cancel-btn');
const browseServerSelectBtn = document.getElementById('browse-server-select-btn');

const settingsSearchInput = document.getElementById('search-input');

// --- Account tab (folded in from the old standalone account.html) ---
const usernameForm = document.getElementById('username-form');
const newUsernameInput = document.getElementById('new-username-input');
const usernameCurrentPassword = document.getElementById('username-current-password');
const usernameError = document.getElementById('username-error');
const passwordForm = document.getElementById('password-form');
const passwordCurrentInput = document.getElementById('password-current-input');
const passwordNewInput = document.getElementById('password-new-input');
const passwordConfirmInput = document.getElementById('password-confirm-input');
const passwordError = document.getElementById('password-error');
const avatarPreview = document.getElementById('avatar-preview');
const avatarFile = document.getElementById('avatar-file');
const avatarRemoveBtn = document.getElementById('avatar-remove-btn');
const avatarError = document.getElementById('avatar-error');

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

themeSelect.value = localStorage.getItem('syncmark:theme') || 'light';
viewSelect.value = localStorage.getItem('syncmark:view') || 'list';

themeSelect.addEventListener('change', () => {
  localStorage.setItem('syncmark:theme', themeSelect.value);
  document.documentElement.setAttribute('data-theme', themeSelect.value);
});

viewSelect.addEventListener('change', () => {
  localStorage.setItem('syncmark:view', viewSelect.value);
});

function setSelectedScheme(scheme) {
  for (const btn of schemePicker.querySelectorAll('.scheme-swatch')) {
    const selected = btn.dataset.scheme === scheme;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('aria-pressed', String(selected));
  }
}

setSelectedScheme(localStorage.getItem('syncmark:colorScheme') || 'blue');

schemePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.scheme-swatch');
  if (!btn) return;
  setSelectedScheme(btn.dataset.scheme);
  document.documentElement.setAttribute('data-scheme', btn.dataset.scheme);
  localStorage.setItem('syncmark:colorScheme', btn.dataset.scheme);
});

async function loadStats() {
  try {
    const stats = await api('/stats');
    statTotal.textContent = stats.total;
    statFolders.textContent = stats.folderCount;
    statContacts.textContent = stats.contactTotal;
    statEvents.textContent = stats.eventTotal;
    statPasswords.textContent = stats.passwordTotal;
  } catch {
    statTotal.textContent = '–';
    statFolders.textContent = '–';
    statContacts.textContent = '–';
    statEvents.textContent = '–';
    statPasswords.textContent = '–';
  }
}

davUrlInput.value = `${location.origin}/dav/`;
davUrlInput.addEventListener('click', () => davUrlInput.select());

function setPressed(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('is-on', on);
}

function isPressed(btn) {
  return btn.getAttribute('aria-pressed') === 'true';
}

async function loadFeatures() {
  try {
    const features = await api('/features');
    setPressed(featureBookmarksToggle, features.bookmarks);
    setPressed(featureContactsToggle, features.contacts);
    setPressed(featureCalendarToggle, features.calendar);
    setPressed(featureFilesToggle, features.files);
    setPressed(featurePasswordsToggle, features.passwords);
  } catch {
    /* leave defaults */
  }
}

async function saveFeatures() {
  featureError.hidden = true;
  const next = {
    bookmarks: isPressed(featureBookmarksToggle),
    contacts: isPressed(featureContactsToggle),
    calendar: isPressed(featureCalendarToggle),
    files: isPressed(featureFilesToggle),
    passwords: isPressed(featurePasswordsToggle),
  };

  if (!next.bookmarks && !next.contacts && !next.calendar && !next.files && !next.passwords) {
    featureError.textContent = 'At least one feature must stay enabled.';
    featureError.hidden = false;
    await loadFeatures(); // revert the button the user just switched off
    return;
  }

  try {
    await api('/features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    showToast('Features updated', 'success');
    await loadLocations(); // files may have just been turned on/off
  } catch (err) {
    showToast(`Failed to update features: ${err.message}`, 'error');
    await loadFeatures();
  }
}

function toggleFeatureBtn(btn) {
  setPressed(btn, !isPressed(btn));
  saveFeatures();
}

featureBookmarksToggle.addEventListener('click', () => toggleFeatureBtn(featureBookmarksToggle));
featureContactsToggle.addEventListener('click', () => toggleFeatureBtn(featureContactsToggle));
featureCalendarToggle.addEventListener('click', () => toggleFeatureBtn(featureCalendarToggle));
featureFilesToggle.addEventListener('click', () => toggleFeatureBtn(featureFilesToggle));
featurePasswordsToggle.addEventListener('click', () => toggleFeatureBtn(featurePasswordsToggle));

// --- File locations ---

async function loadLocations() {
  try {
    const locations = await api('/files/locations');
    renderLocations(locations);
    statLocations.textContent = locations.length;
  } catch {
    locationsManageList.innerHTML = '';
    locationsEmptyHint.textContent = 'Turn on Files in General → Features to manage locations.';
    locationsEmptyHint.hidden = false;
    statLocations.textContent = '–';
  }
}

function renderLocations(locations) {
  locationsManageList.innerHTML = '';
  locationsEmptyHint.textContent = 'No locations configured yet.';
  locationsEmptyHint.hidden = locations.length > 0;

  for (const loc of locations) {
    const li = document.createElement('li');
    li.className = 'folders-manage-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'folders-manage-name';
    nameSpan.textContent = `${loc.name} — ${loc.path}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeLocation(loc));

    li.append(nameSpan, removeBtn);
    locationsManageList.appendChild(li);
  }
}

async function removeLocation(loc) {
  const confirmed = await confirmDialog(
    `Remove the location "${loc.name}"? This only un-registers it here — files on disk are untouched.`,
    { danger: true }
  );
  if (!confirmed) return;

  try {
    await api(`/files/locations/${loc.id}`, { method: 'DELETE' });
    await loadLocations();
    showToast('Location removed', 'success');
  } catch (err) {
    showToast(`Failed to remove location: ${err.message}`, 'error');
  }
}

newLocationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  locationError.hidden = true;

  try {
    await api('/files/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newLocationName.value.trim(), path: newLocationPath.value.trim() }),
    });
    newLocationForm.reset();
    await loadLocations();
    showToast('Location added', 'success');
  } catch (err) {
    locationError.textContent = err.message;
    locationError.hidden = false;
  }
});

// --- Browse a server folder (fills the location path field) ---

let browseCurrentPath = null;

async function loadBrowsePath(targetPath) {
  browseServerError.hidden = true;
  try {
    const params = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
    const result = await api(`/files/browse-server${params}`);
    browseCurrentPath = result.path;
    renderBrowseServer(result);
  } catch (err) {
    if (targetPath) {
      // Whatever was typed/previously shown may not exist anymore — fall
      // back to the root/drive list instead of leaving a dead end.
      return loadBrowsePath(null);
    }
    browseServerError.textContent = err.message;
    browseServerError.hidden = false;
  }
}

function renderBrowseServer(result) {
  browseServerCurrentPath.textContent = result.path || 'This computer';
  browseServerUpBtn.disabled = !result.parent;
  browseServerSelectBtn.disabled = !result.path;
  browseServerUpBtn.onclick = () => loadBrowsePath(result.parent);

  browseServerList.innerHTML = '';
  if (result.entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'folders-manage-empty';
    li.textContent = 'No subfolders here.';
    browseServerList.appendChild(li);
    return;
  }

  for (const entry of result.entries) {
    const li = document.createElement('li');
    li.className = 'browse-server-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'browse-server-item-btn';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'folder';
    btn.append(icon, document.createTextNode(entry.name));
    btn.addEventListener('click', () => loadBrowsePath(entry.path));
    li.appendChild(btn);
    browseServerList.appendChild(li);
  }
}

function openBrowseServerModal() {
  browseServerModal.classList.add('is-open');
  loadBrowsePath(newLocationPath.value.trim() || null);
}

function closeBrowseServerModal() {
  browseServerModal.classList.remove('is-open');
}

browseServerBtn.addEventListener('click', openBrowseServerModal);
browseServerCancelBtn.addEventListener('click', closeBrowseServerModal);
browseServerModal.addEventListener('click', (e) => {
  if (e.target === browseServerModal) closeBrowseServerModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && browseServerModal.classList.contains('is-open')) closeBrowseServerModal();
});
browseServerSelectBtn.addEventListener('click', () => {
  if (browseCurrentPath) newLocationPath.value = browseCurrentPath;
  closeBrowseServerModal();
});

// --- Account ---

function renderAvatarPreview(hasAvatar) {
  avatarPreview.textContent = '';
  avatarRemoveBtn.hidden = !hasAvatar;

  if (hasAvatar) {
    const img = document.createElement('img');
    img.src = `/api/auth/avatar?t=${Date.now()}`;
    img.alt = 'Your profile picture';
    avatarPreview.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'person';
    avatarPreview.appendChild(icon);
  }
}

async function loadAccount() {
  try {
    const data = await api('/auth/me');
    renderAccountBadge(data);
    newUsernameInput.placeholder = data.username;
    renderAvatarPreview(data.hasAvatar);
  } catch {
    /* leave placeholders as-is */
  }
}

avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  avatarError.hidden = true;

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    await api('/auth/avatar', { method: 'POST', body: formData });
    renderAvatarPreview(true);
    renderAccountBadge({ hasAvatar: true });
    showToast('Profile picture updated', 'success');
  } catch (err) {
    avatarError.textContent = err.message;
    avatarError.hidden = false;
  } finally {
    avatarFile.value = '';
  }
});

avatarRemoveBtn.addEventListener('click', async () => {
  const confirmed = await confirmDialog('Remove your profile picture?', { danger: true });
  if (!confirmed) return;
  avatarError.hidden = true;

  try {
    await api('/auth/avatar', { method: 'DELETE' });
    renderAvatarPreview(false);
    renderAccountBadge({ hasAvatar: false });
    showToast('Profile picture removed', 'success');
  } catch (err) {
    avatarError.textContent = err.message;
    avatarError.hidden = false;
  }
});

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  usernameError.hidden = true;

  try {
    const result = await api('/auth/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: newUsernameInput.value.trim(),
        currentPassword: usernameCurrentPassword.value,
      }),
    });
    usernameForm.reset();
    accountUsernameEl.textContent = result.username;
    newUsernameInput.placeholder = result.username;
    showToast('Username updated', 'success');
  } catch (err) {
    usernameError.textContent = err.message;
    usernameError.hidden = false;
  }
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passwordError.hidden = true;

  if (passwordNewInput.value.length < 8) {
    passwordError.textContent = 'New password must be at least 8 characters.';
    passwordError.hidden = false;
    return;
  }
  if (passwordNewInput.value !== passwordConfirmInput.value) {
    passwordError.textContent = 'New passwords do not match.';
    passwordError.hidden = false;
    return;
  }

  try {
    await api('/auth/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newPassword: passwordNewInput.value,
        currentPassword: passwordCurrentInput.value,
      }),
    });
    passwordForm.reset();
    showToast('Password updated', 'success');
  } catch (err) {
    passwordError.textContent = err.message;
    passwordError.hidden = false;
  }
});

// --- Tabs ---

const tabButtons = document.querySelectorAll('.settings-tab');
const tabPanels = document.querySelectorAll('.settings-tab-panel');

function activateTab(tab) {
  const validTabs = [...tabButtons].map((btn) => btn.dataset.tab);
  const resolved = validTabs.includes(tab) ? tab : 'general';

  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === resolved;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== resolved;
  });
  localStorage.setItem('syncmark:settingsTab', resolved);
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

// --- Settings search ---
// Flattens the tabbed view into a flat, filtered list of matching sections
// (by heading/body text) across every tab at once — clearing the search
// restores the normal single-active-tab view.

const settingsTabsBar = document.querySelector('.settings-tabs');
const settingsSearchEmpty = document.getElementById('settings-search-empty');
const allSettingsSections = document.querySelectorAll('.settings-section');

function clearSettingsSearch() {
  settingsSearchEmpty.hidden = true;
  settingsTabsBar.hidden = false;
  allSettingsSections.forEach((section) => {
    section.hidden = false;
  });
  activateTab(localStorage.getItem('syncmark:settingsTab'));
}

function applySettingsSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    clearSettingsSearch();
    return;
  }

  settingsTabsBar.hidden = true;
  let anyPanelVisible = false;

  tabPanels.forEach((panel) => {
    let anyVisible = false;
    panel.querySelectorAll('.settings-section').forEach((section) => {
      const match = section.textContent.toLowerCase().includes(q);
      section.hidden = !match;
      if (match) anyVisible = true;
    });
    panel.hidden = !anyVisible;
    if (anyVisible) anyPanelVisible = true;
  });

  settingsSearchEmpty.hidden = anyPanelVisible;
}

if (settingsSearchInput) {
  settingsSearchInput.addEventListener('input', () => applySettingsSearch(settingsSearchInput.value));
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
    renderAccountBadge(await api('/auth/me'));
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

importContactsFile.addEventListener('change', async () => {
  const file = importContactsFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/contacts/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} contact${result.imported === 1 ? '' : 's'}`, 'success');
    await loadStats();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    importContactsFile.value = '';
  }
});

importEventsFile.addEventListener('change', async () => {
  const file = importEventsFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/events/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} event${result.imported === 1 ? '' : 's'}`, 'success');
    await loadStats();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    importEventsFile.value = '';
  }
});

importPasswordsFile.addEventListener('change', async () => {
  const file = importPasswordsFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/passwords/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} password${result.imported === 1 ? '' : 's'}`, 'success');
    await loadStats();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    importPasswordsFile.value = '';
  }
});

activateTab(new URLSearchParams(location.search).get('tab') || localStorage.getItem('syncmark:settingsTab'));
loadStats();
loadSessionDuration();
loadAccountBadge();
loadFeatures();
loadLocations();
loadAccount();
applyFeatureGate();
