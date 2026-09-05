const state = {
  locations: [],
  currentLocationId: null,
  currentPath: '.', // relative to the location's root, '/'-separated
  entries: [],
};

const els = {
  locationList: document.getElementById('location-list'),
  noLocationsHint: document.getElementById('no-locations-hint'),
  breadcrumb: document.getElementById('breadcrumb'),
  resultCount: document.getElementById('result-count'),
  rows: document.getElementById('file-rows'),
  fileTable: document.getElementById('file-list'),
  emptyState: document.getElementById('empty-state'),
  selectLocationState: document.getElementById('select-location-state'),
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
};

let renameTarget = null; // the entry currently being renamed

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
    btn.className = `folder-btn${loc.id === state.currentLocationId ? ' active' : ''}`;
    btn.innerHTML = `<span class="material-symbols-outlined">folder_open</span><span class="folder-label">${loc.name}</span>`;
    btn.addEventListener('click', () => selectLocation(loc.id));
    li.appendChild(btn);
    els.locationList.appendChild(li);
  }
}

function selectLocation(id) {
  state.currentLocationId = id;
  state.currentPath = '.';
  renderLocations();
  loadBrowse();
}

// --- Browsing ---

async function loadBrowse() {
  if (!state.currentLocationId) {
    els.selectLocationState.hidden = false;
    els.fileTable.hidden = true;
    els.emptyState.hidden = true;
    els.breadcrumb.innerHTML = '';
    return;
  }

  els.selectLocationState.hidden = true;
  try {
    state.entries = await api(`/files/browse?location=${state.currentLocationId}&path=${encodeURIComponent(state.currentPath)}`);
  } catch (err) {
    showToast(`Failed to load folder: ${err.message}`, 'error');
    state.entries = [];
  }
  renderBreadcrumb();
  renderRows();
}

function renderBreadcrumb() {
  els.breadcrumb.innerHTML = '';
  const location = state.locations.find((l) => l.id === state.currentLocationId);
  if (!location) return;

  const segments = state.currentPath === '.' || state.currentPath === '' ? [] : state.currentPath.split('/');

  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'breadcrumb-segment';
  rootBtn.textContent = location.name;
  rootBtn.addEventListener('click', () => {
    state.currentPath = '.';
    loadBrowse();
  });
  els.breadcrumb.appendChild(rootBtn);

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

function renderRows() {
  els.rows.innerHTML = '';
  els.fileTable.hidden = state.entries.length === 0;
  els.emptyState.hidden = state.entries.length > 0;
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
      }
      items.push({ icon: 'drive_file_rename_outline', label: 'Rename', onClick: () => openRenameModal(entry) });
      items.push({ icon: 'delete', label: 'Delete', danger: true, onClick: () => deleteEntry(entry) });
      showContextMenu(e.clientX, e.clientY, items);
    });

    els.rows.appendChild(tr);
  }
}

els.fileTable.addEventListener('contextmenu', (e) => {
  if (e.target.closest('tr')) return; // row's own handler already fired
  e.preventDefault();
  if (!state.currentLocationId) return;
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
      ? `Delete the folder "${entry.name}" and everything inside it? This cannot be undone.`
      : `Delete "${entry.name}"? This cannot be undone.`;
  const confirmed = await confirmDialog(message, { danger: true });
  if (!confirmed) return;

  const p = joinPath(state.currentPath, entry.name);
  try {
    await api(`/files/item?location=${state.currentLocationId}&path=${encodeURIComponent(p)}`, { method: 'DELETE' });
    showToast('Deleted', 'success');
    await loadBrowse();
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// --- Upload ---

els.uploadInput.addEventListener('change', async () => {
  const files = els.uploadInput.files;
  if (!files || files.length === 0 || !state.currentLocationId) return;

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

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (isContextMenuOpen()) closeContextMenu();
  else if (els.mkdirModal.classList.contains('is-open')) closeMkdirModal();
  else if (els.renameModal.classList.contains('is-open')) closeRenameModal();
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
