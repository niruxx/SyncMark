const state = {
  locations: [],
  currentLocationId: null,
  currentPath: '.', // relative to the location's root, '/'-separated
  entries: [],
  viewingTrash: false,
};

const els = {
  locationList: document.getElementById('location-list'),
  noLocationsHint: document.getElementById('no-locations-hint'),
  breadcrumb: document.getElementById('breadcrumb'),
  resultCount: document.getElementById('result-count'),
  rows: document.getElementById('file-rows'),
  fileTable: document.getElementById('file-list'),
  modifiedHeader: document.getElementById('modified-header'),
  emptyState: document.getElementById('empty-state'),
  selectLocationState: document.getElementById('select-location-state'),
  trashHint: document.getElementById('trash-hint'),
  trashEmptyBtn: document.getElementById('trash-empty-btn'),
  newFolderBtn: document.getElementById('new-folder-btn'),
  uploadInput: document.getElementById('upload-input'),

  mkdirModal: document.getElementById('mkdir-modal'),
  mkdirForm: document.getElementById('mkdir-form'),
  mkdirNameInput: document.getElementById('mkdir-name-input'),
  mkdirError: document.getElementById('mkdir-error'),
  mkdirCancelBtn: document.getElementById('mkdir-cancel-btn'),

  renameModal: document.getElementById('rename-modal'),
  renameForm: document.getElementById('rename-form'),
  renameNameInput: document.getElementById('rename-name-input'),
  renameError: document.getElementById('rename-error'),
  renameCancelBtn: document.getElementById('rename-cancel-btn'),

  previewModal: document.getElementById('preview-modal'),
  previewHeading: document.getElementById('preview-heading'),
  previewMedia: document.getElementById('preview-media'),
  previewCloseBtn: document.getElementById('preview-close-btn'),

  textEditorModal: document.getElementById('text-editor-modal'),
  textEditorHeading: document.getElementById('text-editor-heading'),
  textEditorTextarea: document.getElementById('text-editor-textarea'),
  textEditorError: document.getElementById('text-editor-error'),
  textEditorCancelBtn: document.getElementById('text-editor-cancel-btn'),
  textEditorSaveBtn: document.getElementById('text-editor-save-btn'),

  permissionsModal: document.getElementById('permissions-modal'),
  permissionsName: document.getElementById('permissions-name'),
  permissionsPosix: document.getElementById('permissions-posix'),
  permissionsWindows: document.getElementById('permissions-windows'),
  permissionsReadonlyInput: document.getElementById('permissions-readonly-input'),
  permissionsOctal: document.getElementById('permissions-octal'),
  permissionsError: document.getElementById('permissions-error'),
  permissionsCancelBtn: document.getElementById('permissions-cancel-btn'),
  permissionsSaveBtn: document.getElementById('permissions-save-btn'),
};

let renameTarget = null; // the entry currently being renamed
let permissionsTarget = null;
let permissionsPlatform = 'posix';
let textEditorTarget = null;
let textEditorOriginalContent = '';

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

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatModified(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const EXTENSION_ICONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
  archive: ['zip', 'tar', 'gz', 'rar', '7z'],
  code: ['js', 'ts', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp', 'sh', 'md'],
  pdf: ['pdf'],
};

function fileIcon(entry) {
  if (entry.type === 'dir') return 'folder';
  const ext = entry.name.split('.').pop().toLowerCase();
  for (const [icon, exts] of Object.entries(EXTENSION_ICONS)) {
    if (exts.includes(ext)) return icon === 'pdf' ? 'picture_as_pdf' : icon === 'image' ? 'image' : icon === 'video' ? 'movie' : icon === 'audio' ? 'audio_file' : icon === 'archive' ? 'folder_zip' : 'code';
  }
  return 'description';
}

function joinPath(base, name) {
  return base === '.' || base === '' ? name : `${base}/${name}`;
}

// Matches the server's /files/view MIME allowlist exactly — no point
// offering "View" for something the server will 415 on.
const VIEWABLE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const VIEWABLE_VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'mov'];
const TEXT_EXTENSIONS = [
  'txt', 'md', 'json', 'csv', 'log', 'yml', 'yaml', 'ini', 'conf', 'env', 'xml',
  'css', 'js', 'ts', 'html', 'htm', 'py', 'java', 'c', 'cpp', 'h', 'sh', 'bat', 'ps1',
];

function extOf(entry) {
  return entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
}
function isViewableImage(entry) {
  return entry.type === 'file' && VIEWABLE_IMAGE_EXTENSIONS.includes(extOf(entry));
}
function isViewableVideo(entry) {
  return entry.type === 'file' && VIEWABLE_VIDEO_EXTENSIONS.includes(extOf(entry));
}
function isViewable(entry) {
  return isViewableImage(entry) || isViewableVideo(entry);
}
function isEditableText(entry) {
  return entry.type === 'file' && TEXT_EXTENSIONS.includes(extOf(entry));
}

// --- Locations ---

async function loadLocations() {
  state.locations = await api('/files/locations');
  renderLocations();
}

function renderLocations() {
  els.locationList.innerHTML = '';
  els.noLocationsHint.hidden = state.locations.length > 0;

  for (const loc of state.locations) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `folder-btn${loc.id === state.currentLocationId && !state.viewingTrash ? ' active' : ''}`;
    btn.innerHTML = `<span class="material-symbols-outlined">folder_open</span><span class="folder-label">${loc.name}</span>`;
    btn.addEventListener('click', () => selectLocation(loc.id));
    li.appendChild(btn);

    // Trash is per-location (it has to live inside that location's own
    // sandbox), so it's shown as a nested entry under its location rather
    // than one shared item — same idea as a Recycle Bin per drive.
    const trashSubList = document.createElement('ul');
    trashSubList.className = 'location-sublist';
    const trashLi = document.createElement('li');
    const trashBtn = document.createElement('button');
    trashBtn.className = `folder-btn folder-btn-nested${loc.id === state.currentLocationId && state.viewingTrash ? ' active' : ''}`;
    trashBtn.innerHTML = '<span class="material-symbols-outlined">delete</span><span class="folder-label">Trash</span>';
    trashBtn.addEventListener('click', () => selectLocationTrash(loc.id));
    trashLi.appendChild(trashBtn);
    trashSubList.appendChild(trashLi);
    li.appendChild(trashSubList);

    els.locationList.appendChild(li);
  }
}

function selectLocation(id) {
  state.currentLocationId = id;
  state.currentPath = '.';
  state.viewingTrash = false;
  renderLocations();
  loadBrowse();
}

function selectLocationTrash(id) {
  state.currentLocationId = id;
  state.viewingTrash = true;
  renderLocations();
  loadTrashView();
}

// --- Browsing ---

async function loadBrowse() {
  if (!state.currentLocationId) {
    els.selectLocationState.hidden = false;
    els.fileTable.hidden = true;
    els.emptyState.hidden = true;
    els.trashHint.hidden = true;
    els.trashEmptyBtn.hidden = true;
    els.breadcrumb.innerHTML = '';
    return;
  }

  els.selectLocationState.hidden = true;
  els.trashHint.hidden = true;
  els.trashEmptyBtn.hidden = true;
  els.modifiedHeader.textContent = 'Modified';
  try {
    state.entries = await api(`/files/browse?location=${state.currentLocationId}&path=${encodeURIComponent(state.currentPath)}`);
  } catch (err) {
    showToast(`Failed to load folder: ${err.message}`, 'error');
    state.entries = [];
  }
  renderBreadcrumb();
  renderFileRows();
}

async function loadTrashView() {
  els.selectLocationState.hidden = true;
  els.trashHint.hidden = false;
  els.modifiedHeader.textContent = 'Deleted';
  try {
    state.entries = await api(`/files/trash?location=${state.currentLocationId}`);
  } catch (err) {
    showToast(`Failed to load trash: ${err.message}`, 'error');
    state.entries = [];
  }
  els.trashEmptyBtn.hidden = state.entries.length === 0;
  renderBreadcrumb();
  renderTrashRows();
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = '';
  const location = state.locations.find((l) => l.id === state.currentLocationId);
  if (!location) return;

  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'breadcrumb-segment';
  rootBtn.textContent = location.name;
  rootBtn.disabled = !state.viewingTrash && state.currentPath === '.';
  rootBtn.addEventListener('click', () => {
    state.currentPath = '.';
    state.viewingTrash = false;
    renderLocations();
    loadBrowse();
  });
  els.breadcrumb.appendChild(rootBtn);

  if (state.viewingTrash) {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '/';
    els.breadcrumb.appendChild(sep);

    const trashBtn = document.createElement('button');
    trashBtn.type = 'button';
    trashBtn.className = 'breadcrumb-segment';
    trashBtn.textContent = 'Trash';
    trashBtn.disabled = true;
    els.breadcrumb.appendChild(trashBtn);
    return;
  }

  const segments = state.currentPath === '.' || state.currentPath === '' ? [] : state.currentPath.split('/');
  let pathSoFar = '';
  segments.forEach((segment, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '/';
    els.breadcrumb.appendChild(sep);

    pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
    const target = pathSoFar;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'breadcrumb-segment';
    btn.textContent = segment;
    if (i === segments.length - 1) btn.disabled = true;
    btn.addEventListener('click', () => {
      state.currentPath = target;
      loadBrowse();
    });
    els.breadcrumb.appendChild(btn);
  });
}

function renderFileRows() {
  els.rows.innerHTML = '';
  els.fileTable.hidden = state.entries.length === 0;
  els.emptyState.hidden = state.entries.length > 0;
  els.emptyState.textContent = 'This folder is empty.';
  els.resultCount.textContent = state.entries.length ? `${state.entries.length} item${state.entries.length === 1 ? '' : 's'}` : '';

  for (const entry of state.entries) {
    const tr = document.createElement('tr');

    const iconTd = document.createElement('td');
    iconTd.className = 'icon-cell';
    iconTd.innerHTML = `<span class="material-symbols-outlined">${fileIcon(entry)}</span>`;
    tr.appendChild(iconTd);

    const nameTd = document.createElement('td');
    nameTd.dataset.label = 'Name';
    nameTd.textContent = entry.name;
    tr.appendChild(nameTd);

    const sizeTd = document.createElement('td');
    sizeTd.dataset.label = 'Size';
    sizeTd.textContent = entry.type === 'dir' ? '—' : formatBytes(entry.size);
    tr.appendChild(sizeTd);

    const modifiedTd = document.createElement('td');
    modifiedTd.dataset.label = 'Modified';
    modifiedTd.textContent = formatModified(entry.modifiedAt);
    tr.appendChild(modifiedTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';
    if (entry.type === 'file') {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'secondary';
      downloadBtn.textContent = 'Download';
      downloadBtn.addEventListener('click', () => downloadEntry(entry));
      actionsTd.appendChild(downloadBtn);
    }
    tr.appendChild(actionsTd);

    if (entry.type === 'dir') {
      tr.addEventListener('dblclick', () => {
        state.currentPath = joinPath(state.currentPath, entry.name);
        loadBrowse();
      });
    } else if (isViewable(entry)) {
      tr.addEventListener('dblclick', () => openPreviewModal(entry));
    } else if (isEditableText(entry)) {
      tr.addEventListener('dblclick', () => openTextEditorModal(entry));
    } else {
      tr.addEventListener('dblclick', () => downloadEntry(entry));
    }

    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const items = [];
      if (entry.type === 'dir') {
        items.push({
          icon: 'folder_open',
          label: 'Open',
          onClick: () => {
            state.currentPath = joinPath(state.currentPath, entry.name);
            loadBrowse();
          },
        });
      } else {
        items.push({ icon: 'download', label: 'Download', onClick: () => downloadEntry(entry) });
        if (isViewable(entry)) items.push({ icon: 'visibility', label: 'View', onClick: () => openPreviewModal(entry) });
        if (isEditableText(entry)) items.push({ icon: 'edit', label: 'Edit', onClick: () => openTextEditorModal(entry) });
      }
      items.push({ icon: 'drive_file_rename_outline', label: 'Rename', onClick: () => openRenameModal(entry) });
      items.push({ icon: 'lock', label: 'Permissions', onClick: () => openPermissionsModal(entry) });
      items.push({ icon: 'delete', label: 'Move to trash', danger: true, onClick: () => deleteEntry(entry) });
      showContextMenu(e.clientX, e.clientY, items);
    });

    els.rows.appendChild(tr);
  }
}

// Trash entries reuse the same table/row shell as a normal listing (so
// Trash reads as "a folder you're browsing," not a different UI) but with
// Restore/Delete-permanently actions instead of Download/context-menu, and
// no drilling into folders — you restore first, then browse normally.
function renderTrashRows() {
  els.rows.innerHTML = '';
  els.fileTable.hidden = state.entries.length === 0;
  els.emptyState.hidden = state.entries.length > 0;
  els.emptyState.textContent = 'Trash is empty.';
  els.resultCount.textContent = state.entries.length ? `${state.entries.length} item${state.entries.length === 1 ? '' : 's'}` : '';

  for (const item of state.entries) {
    const tr = document.createElement('tr');

    const iconTd = document.createElement('td');
    iconTd.className = 'icon-cell';
    iconTd.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    tr.appendChild(iconTd);

    const nameTd = document.createElement('td');
    nameTd.dataset.label = 'Name';
    nameTd.textContent = item.originalRelPath;
    tr.appendChild(nameTd);

    const sizeTd = document.createElement('td');
    sizeTd.dataset.label = 'Size';
    sizeTd.textContent = item.size ? formatBytes(item.size) : '—';
    tr.appendChild(sizeTd);

    const deletedTd = document.createElement('td');
    deletedTd.dataset.label = 'Deleted';
    deletedTd.textContent = formatModified(item.deletedAt);
    tr.appendChild(deletedTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'secondary';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreTrashItem(item));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete permanently';
    deleteBtn.addEventListener('click', () => deleteTrashItemPermanently(item));
    actionsTd.append(restoreBtn, deleteBtn);
    tr.appendChild(actionsTd);

    els.rows.appendChild(tr);
  }
}

async function restoreTrashItem(item) {
  try {
    await api(`/files/trash/${item.id}/restore?location=${state.currentLocationId}`, { method: 'POST' });
    showToast('Restored', 'success');
    await loadTrashView();
  } catch (err) {
    showToast(`Failed to restore: ${err.message}`, 'error');
  }
}

async function deleteTrashItemPermanently(item) {
  const confirmed = await confirmDialog(`Permanently delete "${item.name}"? This cannot be undone.`, { danger: true });
  if (!confirmed) return;
  try {
    await api(`/files/trash/${item.id}?location=${state.currentLocationId}`, { method: 'DELETE' });
    showToast('Permanently deleted', 'success');
    await loadTrashView();
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

els.trashEmptyBtn.addEventListener('click', async () => {
  const confirmed = await confirmDialog('Permanently delete everything in trash? This cannot be undone.', { danger: true });
  if (!confirmed) return;
  try {
    await api(`/files/trash?location=${state.currentLocationId}`, { method: 'DELETE' });
    showToast('Trash emptied', 'success');
    await loadTrashView();
  } catch (err) {
    showToast(`Failed to empty trash: ${err.message}`, 'error');
  }
});

els.fileTable.addEventListener('contextmenu', (e) => {
  if (e.target.closest('tr')) return; // row's own handler already fired
  e.preventDefault();
  if (!state.currentLocationId || state.viewingTrash) return;
  showContextMenu(e.clientX, e.clientY, [{ icon: 'create_new_folder', label: 'New folder here', onClick: openMkdirModal }]);
});

function downloadEntry(entry) {
  const p = joinPath(state.currentPath, entry.name);
  const link = document.createElement('a');
  link.href = `/api/files/download?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`;
  link.download = entry.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function deleteEntry(entry) {
  const message =
    entry.type === 'dir'
      ? `Move the folder "${entry.name}" and everything inside it to trash?`
      : `Move "${entry.name}" to trash?`;
  const confirmed = await confirmDialog(message);
  if (!confirmed) return;

  const p = joinPath(state.currentPath, entry.name);
  try {
    await api(`/files/item?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`, { method: 'DELETE' });
    showToast('Moved to trash', 'success');
    await loadBrowse();
  } catch (err) {
    showToast(`Failed to move to trash: ${err.message}`, 'error');
  }
}

// --- Upload ---

els.uploadInput.addEventListener('change', async () => {
  const files = els.uploadInput.files;
  if (!files || files.length === 0 || !state.currentLocationId) return;
  if (state.viewingTrash) {
    showToast("Can't upload into Trash", 'error');
    els.uploadInput.value = '';
    return;
  }

  const formData = new FormData();
  for (const file of files) formData.append('files', file);

  try {
    const result = await api(`/files/upload?location=${state.currentLocationId}&path=${encodeURIComponent(state.currentPath)}`, {
      method: 'POST',
      body: formData,
    });
    showToast(`Uploaded ${result.uploaded} file${result.uploaded === 1 ? '' : 's'}`, 'success');
    await loadBrowse();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    els.uploadInput.value = '';
  }
});

// --- New folder ---

function openMkdirModal() {
  els.mkdirNameInput.value = '';
  els.mkdirError.hidden = true;
  els.mkdirModal.classList.add('is-open');
  els.mkdirNameInput.focus();
}

function closeMkdirModal() {
  els.mkdirModal.classList.remove('is-open');
}

els.newFolderBtn.addEventListener('click', () => {
  if (!state.currentLocationId) {
    showToast('Choose a location first', 'error');
    return;
  }
  if (state.viewingTrash) {
    showToast("Can't create a folder in Trash", 'error');
    return;
  }
  openMkdirModal();
});
els.mkdirCancelBtn.addEventListener('click', closeMkdirModal);
els.mkdirModal.addEventListener('click', (e) => {
  if (e.target === els.mkdirModal) closeMkdirModal();
});

els.mkdirForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.mkdirError.hidden = true;
  try {
    await api('/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: state.currentLocationId, path: state.currentPath, name: els.mkdirNameInput.value.trim() }),
    });
    closeMkdirModal();
    await loadBrowse();
    showToast('Folder created', 'success');
  } catch (err) {
    els.mkdirError.textContent = err.message;
    els.mkdirError.hidden = false;
  }
});

// --- Rename ---

function openRenameModal(entry) {
  renameTarget = entry;
  els.renameNameInput.value = entry.name;
  els.renameError.hidden = true;
  els.renameModal.classList.add('is-open');
  els.renameNameInput.focus();
  els.renameNameInput.select();
}

function closeRenameModal() {
  els.renameModal.classList.remove('is-open');
  renameTarget = null;
}

els.renameCancelBtn.addEventListener('click', closeRenameModal);
els.renameModal.addEventListener('click', (e) => {
  if (e.target === els.renameModal) closeRenameModal();
});

els.renameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!renameTarget) return;
  els.renameError.hidden = true;

  const p = joinPath(state.currentPath, renameTarget.name);
  try {
    await api('/files/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: state.currentLocationId, path: p, newName: els.renameNameInput.value.trim() }),
    });
    closeRenameModal();
    await loadBrowse();
    showToast('Renamed', 'success');
  } catch (err) {
    els.renameError.textContent = err.message;
    els.renameError.hidden = false;
  }
});

// --- Preview (image/video) ---

function openPreviewModal(entry) {
  const p = joinPath(state.currentPath, entry.name);
  const url = `/api/files/view?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`;
  els.previewHeading.textContent = entry.name;
  els.previewMedia.innerHTML = '';

  if (isViewableVideo(entry)) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    els.previewMedia.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = entry.name;
    els.previewMedia.appendChild(img);
  }
  els.previewModal.classList.add('is-open');
}

function closePreviewModal() {
  els.previewModal.classList.remove('is-open');
  els.previewMedia.innerHTML = ''; // stop any playing video
}

els.previewCloseBtn.addEventListener('click', closePreviewModal);
els.previewModal.addEventListener('click', (e) => {
  if (e.target === els.previewModal) closePreviewModal();
});

// --- Text editor ---

async function openTextEditorModal(entry) {
  textEditorTarget = entry;
  els.textEditorHeading.textContent = entry.name;
  els.textEditorError.hidden = true;
  els.textEditorTextarea.value = '';
  els.textEditorTextarea.disabled = true;
  els.textEditorModal.classList.add('is-open');

  const p = joinPath(state.currentPath, entry.name);
  try {
    const result = await api(`/files/text?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`);
    textEditorOriginalContent = result.content;
    els.textEditorTextarea.value = result.content;
  } catch (err) {
    els.textEditorError.textContent = err.message;
    els.textEditorError.hidden = false;
  } finally {
    els.textEditorTextarea.disabled = false;
  }
}

async function closeTextEditorModal() {
  if (els.textEditorTextarea.value !== textEditorOriginalContent) {
    const confirmed = await confirmDialog('Discard unsaved changes?', { danger: true });
    if (!confirmed) return;
  }
  els.textEditorModal.classList.remove('is-open');
  textEditorTarget = null;
}

els.textEditorCancelBtn.addEventListener('click', closeTextEditorModal);
els.textEditorModal.addEventListener('click', (e) => {
  if (e.target === els.textEditorModal) closeTextEditorModal();
});

els.textEditorSaveBtn.addEventListener('click', async () => {
  if (!textEditorTarget) return;
  els.textEditorError.hidden = true;

  const p = joinPath(state.currentPath, textEditorTarget.name);
  try {
    await api(`/files/text?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: els.textEditorTextarea.value,
    });
    textEditorOriginalContent = els.textEditorTextarea.value;
    showToast('Saved', 'success');
    await loadBrowse();
  } catch (err) {
    els.textEditorError.textContent = err.message;
    els.textEditorError.hidden = false;
  }
});

// --- Permissions ---

const PERMISSION_BITS = [
  ['owner-r', 0o400], ['owner-w', 0o200], ['owner-x', 0o100],
  ['group-r', 0o040], ['group-w', 0o020], ['group-x', 0o010],
  ['other-r', 0o004], ['other-w', 0o002], ['other-x', 0o001],
];

function permCheckbox(key) {
  return document.querySelector(`[data-perm="${key}"]`);
}

function setPermissionCheckboxesFromMode(mode) {
  for (const [key, bit] of PERMISSION_BITS) permCheckbox(key).checked = (mode & bit) !== 0;
  updateOctalDisplay();
}

function computeModeFromCheckboxes() {
  let mode = 0;
  for (const [key, bit] of PERMISSION_BITS) {
    if (permCheckbox(key).checked) mode |= bit;
  }
  return mode;
}

function updateOctalDisplay() {
  els.permissionsOctal.textContent = computeModeFromCheckboxes().toString(8).padStart(3, '0');
}

for (const [key] of PERMISSION_BITS) permCheckbox(key).addEventListener('change', updateOctalDisplay);

async function openPermissionsModal(entry) {
  permissionsTarget = entry;
  els.permissionsName.textContent = entry.name;
  els.permissionsError.hidden = true;
  els.permissionsModal.classList.add('is-open');

  const p = joinPath(state.currentPath, entry.name);
  try {
    const result = await api(`/files/permissions?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`);
    permissionsPlatform = result.platform;
    els.permissionsPosix.hidden = result.platform !== 'posix';
    els.permissionsWindows.hidden = result.platform === 'posix';
    if (result.platform === 'posix') {
      setPermissionCheckboxesFromMode(result.mode);
    } else {
      // Node reports ~0o444 for a read-only file on Windows, ~0o666 otherwise.
      els.permissionsReadonlyInput.checked = (result.mode & 0o200) === 0;
    }
  } catch (err) {
    els.permissionsError.textContent = err.message;
    els.permissionsError.hidden = false;
  }
}

function closePermissionsModal() {
  els.permissionsModal.classList.remove('is-open');
  permissionsTarget = null;
}

els.permissionsCancelBtn.addEventListener('click', closePermissionsModal);
els.permissionsModal.addEventListener('click', (e) => {
  if (e.target === els.permissionsModal) closePermissionsModal();
});

els.permissionsSaveBtn.addEventListener('click', async () => {
  if (!permissionsTarget) return;
  els.permissionsError.hidden = true;

  const mode = permissionsPlatform === 'posix' ? computeModeFromCheckboxes() : els.permissionsReadonlyInput.checked ? 0o444 : 0o666;

  const p = joinPath(state.currentPath, permissionsTarget.name);
  try {
    await api('/files/permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: state.currentLocationId, path: p, mode }),
    });
    closePermissionsModal();
    showToast('Permissions updated', 'success');
  } catch (err) {
    els.permissionsError.textContent = err.message;
    els.permissionsError.hidden = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isContextMenuOpen()) closeContextMenu();
  else if (els.mkdirModal.classList.contains('is-open')) closeMkdirModal();
  else if (els.renameModal.classList.contains('is-open')) closeRenameModal();
  else if (els.previewModal.classList.contains('is-open')) closePreviewModal();
  else if (els.textEditorModal.classList.contains('is-open')) closeTextEditorModal();
  else if (els.permissionsModal.classList.contains('is-open')) closePermissionsModal();
});

async function loadAccountBadge() {
  try {
    renderAccountBadge(await api('/auth/me'));
  } catch {
    /* ignore */
  }
}

loadLocations().then(() => {
  if (state.locations.length === 1) selectLocation(state.locations[0].id);
  else loadBrowse();
});
loadAccountBadge();
applyFeatureGate();
