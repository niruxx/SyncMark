const state = {
  bookmarks: [],
  folders: [],
  currentFolder: '',
  favoritesOnly: false,
  query: '',
  sort: localStorage.getItem('syncmark:sort') || 'title-asc',
  view: localStorage.getItem('syncmark:view') || 'list',
  modalMode: null, // 'add' | 'edit'
  modalBookmarkId: null,
  expandedFolders: new Set(),
  folderBookmarksCache: new Map(),
};

const els = {
  folderList: document.getElementById('folder-list'),
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  resultCount: document.getElementById('result-count'),
  listView: document.getElementById('list-view'),
  rows: document.getElementById('bookmark-rows'),
  gridView: document.getElementById('grid-view'),
  emptyState: document.getElementById('empty-state'),
  addBookmarkBtn: document.getElementById('add-bookmark-btn'),
  viewListBtn: document.getElementById('view-list-btn'),
  viewGridBtn: document.getElementById('view-grid-btn'),
  modal: document.getElementById('bookmark-modal'),
  modalHeading: document.getElementById('modal-heading'),
  modalForm: document.getElementById('bookmark-form'),
  modalTitleInput: document.getElementById('modal-title-input'),
  modalUrlInput: document.getElementById('modal-url-input'),
  modalFolderInput: document.getElementById('modal-folder-input'),
  modalFavoriteInput: document.getElementById('modal-favorite-input'),
  folderDatalist: document.getElementById('folder-datalist'),
  modalError: document.getElementById('modal-error'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  manageFoldersBtn: document.getElementById('manage-folders-btn'),
  foldersModal: document.getElementById('folders-modal'),
  newFolderForm: document.getElementById('new-folder-form'),
  newFolderInput: document.getElementById('new-folder-input'),
  foldersManageList: document.getElementById('folders-manage-list'),
  foldersModalCloseBtn: document.getElementById('folders-modal-close-btn'),
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

function makeFaviconImg(url) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.src = faviconUrl(url);
  img.alt = '';
  img.width = 20;
  img.height = 20;
  img.addEventListener('error', () => {
    img.src = FALLBACK_ICON;
  });
  return img;
}

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

async function loadFolders() {
  state.folders = await api('/folders');
  state.folderBookmarksCache.clear();
  renderFolders();
  renderFolderDatalist();
}

async function loadBookmarks() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (!state.favoritesOnly && state.currentFolder) params.set('folder', state.currentFolder);
  if (state.favoritesOnly) params.set('favorite', '1');
  params.set('sort', state.sort);
  state.bookmarks = await api(`/bookmarks?${params.toString()}`);
  renderBookmarks();
}

function renderFolderDatalist() {
  els.folderDatalist.innerHTML = '';
  for (const { folder } of state.folders) {
    const option = document.createElement('option');
    option.value = folder;
    els.folderDatalist.appendChild(option);
  }
}

// --- Folder tree (sidebar) ---

function buildFolderTree(folders) {
  const byPath = new Map(folders.map((f) => [f.folder, f]));
  const root = { name: '', path: '', count: 0, position: 0, children: new Map() };
  for (const { folder, count } of folders) {
    let node = root;
    let path = '';
    for (const segment of folder.split('/')) {
      path = path ? `${path}/${segment}` : segment;
      if (!node.children.has(segment)) {
        const meta = byPath.get(path);
        node.children.set(segment, {
          name: segment,
          path,
          count: 0,
          position: meta ? meta.position : 0,
          children: new Map(),
        });
      }
      node = node.children.get(segment);
    }
    node.count = count;
  }
  return root;
}

function aggregateCount(node) {
  let total = node.count;
  for (const child of node.children.values()) total += aggregateCount(child);
  return total;
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

// Material Symbols glyph — the icon font renders the ligature name as the icon.
function makeIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = name;
  return icon;
}

// Sidebar pill: [icon] label [count]
function fillFolderButton(btn, iconName, label, count) {
  btn.textContent = '';
  btn.appendChild(makeIcon(iconName));
  const labelEl = document.createElement('span');
  labelEl.className = 'folder-label';
  labelEl.textContent = label;
  btn.appendChild(labelEl);
  if (count !== undefined) {
    const countEl = document.createElement('span');
    countEl.className = 'folder-count';
    countEl.textContent = count;
    btn.appendChild(countEl);
  }
}

function renderFolders() {
  els.folderList.innerHTML = '';

  const allLi = document.createElement('li');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'folder-btn' + (!state.favoritesOnly && state.currentFolder === '' ? ' active' : '');
  fillFolderButton(allBtn, 'bookmarks', 'All bookmarks');
  allBtn.addEventListener('click', () => selectFolder(''));
  makeDropTarget(allBtn, (id) => moveBookmarkToFolder(id, ''));
  allLi.appendChild(allBtn);
  els.folderList.appendChild(allLi);

  const favLi = document.createElement('li');
  favLi.className = 'favorites-entry';
  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.id = 'favorites-btn';
  favBtn.className = 'folder-btn' + (state.favoritesOnly ? ' active' : '');
  fillFolderButton(favBtn, 'star', 'Favorites');
  favBtn.addEventListener('click', selectFavorites);
  makeDropTarget(favBtn, addBookmarkToFavorites);
  favLi.appendChild(favBtn);
  els.folderList.appendChild(favLi);

  const tree = buildFolderTree(state.folders);
  const topLevel = sortedChildren(tree);
  for (const child of topLevel) {
    els.folderList.appendChild(renderFolderNode(child, 0, topLevel));
  }
}

function renderFolderNode(node, depth, siblings) {
  const li = document.createElement('li');
  li.className = 'folder-node';
  li.style.paddingLeft = `${depth * 14}px`;

  const row = document.createElement('div');
  row.className = 'folder-row';

  const expandable = node.children.size > 0 || node.count > 0;
  const expanded = state.expandedFolders.has(node.path);
  const chevron = document.createElement('button');
  chevron.className = 'folder-chevron' + (expanded ? ' open' : '');
  chevron.type = 'button';
  if (expandable) chevron.appendChild(makeIcon('chevron_right'));
  if (!expandable) chevron.disabled = true;
  chevron.title = expandable ? 'Show contents' : '';
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFolderExpanded(node.path);
  });
  row.appendChild(chevron);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'folder-btn' + (!state.favoritesOnly && state.currentFolder === node.path ? ' active' : '');
  fillFolderButton(btn, 'folder', node.name, aggregateCount(node));
  btn.title = `${node.path} — double-click to rename`;
  btn.addEventListener('click', () => selectFolder(node.path));
  btn.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startInlineFolderRename(row, btn, node);
  });
  makeDropTarget(btn, (id) => moveBookmarkToFolder(id, node.path));
  row.appendChild(btn);

  li.appendChild(row);
  makeFolderDraggable(li, node, siblings);

  if (expanded) {
    li.appendChild(renderFolderContents(node, depth));
  }

  return li;
}

function renderFolderContents(node, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'folder-contents';

  if (node.count > 0) {
    wrap.appendChild(renderFolderBookmarkList(node.path));
  }

  if (node.children.size > 0) {
    const childUl = document.createElement('ul');
    childUl.className = 'folder-children';
    const siblings = sortedChildren(node);
    for (const child of siblings) {
      childUl.appendChild(renderFolderNode(child, depth + 1, siblings));
    }
    wrap.appendChild(childUl);
  }

  return wrap;
}

function renderFolderBookmarkList(path) {
  const list = document.createElement('ul');
  list.className = 'folder-bookmark-list';

  const cached = state.folderBookmarksCache.get(path);
  if (cached === undefined) {
    const li = document.createElement('li');
    li.className = 'folder-bookmark-loading';
    li.textContent = 'Loading…';
    list.appendChild(li);
    loadFolderBookmarks(path);
    return list;
  }

  for (const bookmark of cached) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = bookmark.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.draggable = false;
    link.textContent = bookmark.title;
    li.appendChild(link);
    makeFolderBookmarkDraggable(li, bookmark, cached, path);
    list.appendChild(li);
  }
  return list;
}

function makeFolderBookmarkDraggable(li, bookmark, siblings, path) {
  li.draggable = true;

  li.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(bookmark.id));
    li.classList.add('dragging');
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearDropIndicators();
  });

  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    const isAfter = e.clientY - li.getBoundingClientRect().top > li.offsetHeight / 2;
    li.classList.toggle('drop-after', isAfter);
    li.classList.toggle('drop-before', !isAfter);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drop-before', 'drop-after');
  });

  li.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    clearDropIndicators();
    if (!draggedId || draggedId === bookmark.id) return;
    if (!siblings.some((b) => b.id === draggedId)) return; // only reorder within this folder's own list

    const isAfter = e.clientY - li.getBoundingClientRect().top > li.offsetHeight / 2;
    const others = siblings.filter((b) => b.id !== draggedId);
    const targetIndex = others.findIndex((b) => b.id === bookmark.id);
    const before = isAfter ? others[targetIndex] : others[targetIndex - 1];
    const after = isAfter ? others[targetIndex + 1] : others[targetIndex];

    await reorderFolderBookmark(draggedId, before ? before.id : null, after ? after.id : null, path);
  });
}

async function reorderFolderBookmark(id, beforeId, afterId, path) {
  try {
    await api(`/bookmarks/${id}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeId, afterId }),
    });
    state.folderBookmarksCache.delete(path);
    await Promise.all([loadBookmarks(), loadFolderBookmarks(path)]);
  } catch (err) {
    showToast(`Failed to reorder: ${err.message}`, 'error');
  }
}

async function loadFolderBookmarks(path) {
  try {
    const params = new URLSearchParams({ folder: path, exact: '1', sort: 'custom' });
    const bookmarks = await api(`/bookmarks?${params.toString()}`);
    state.folderBookmarksCache.set(path, bookmarks);
  } catch {
    state.folderBookmarksCache.set(path, []);
  }
  renderFolders();
}

function toggleFolderExpanded(path) {
  if (state.expandedFolders.has(path)) {
    state.expandedFolders.delete(path);
  } else {
    state.expandedFolders.add(path);
    state.folderBookmarksCache.delete(path);
  }
  renderFolders();
}

function selectFolder(folder) {
  state.favoritesOnly = false;
  state.currentFolder = folder;
  loadBookmarks();
  renderFolders();
}

function selectFavorites() {
  state.favoritesOnly = true;
  state.currentFolder = '';
  loadBookmarks();
  renderFolders();
}

// --- View mode ---

function setView(view) {
  state.view = view;
  localStorage.setItem('syncmark:view', view);
  els.viewListBtn.classList.toggle('active', view === 'list');
  els.viewGridBtn.classList.toggle('active', view === 'grid');
  els.listView.hidden = view !== 'list';
  els.gridView.hidden = view !== 'grid';
}

// --- Bookmark list / grid ---

function renderBookmarks() {
  els.resultCount.textContent = `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}`;
  els.emptyState.hidden = state.bookmarks.length > 0;

  els.rows.innerHTML = '';
  els.gridView.innerHTML = '';

  state.bookmarks.forEach((bookmark, index) => {
    const delay = `${Math.min(index * 25, 300)}ms`;
    const row = renderRow(bookmark);
    row.style.animationDelay = delay;
    els.rows.appendChild(row);

    const card = renderCard(bookmark);
    card.style.animationDelay = delay;
    els.gridView.appendChild(card);
  });
}

function renderRow(bookmark) {
  const tr = document.createElement('tr');

  const iconTd = document.createElement('td');
  iconTd.className = 'icon-cell';
  iconTd.appendChild(makeFaviconImg(bookmark.url));
  tr.appendChild(iconTd);

  const titleTd = document.createElement('td');
  titleTd.textContent = bookmark.title;
  titleTd.title = 'Double-click to rename';
  titleTd.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startInlineBookmarkRename(titleTd, bookmark);
  });
  tr.appendChild(titleTd);

  const urlTd = document.createElement('td');
  const link = document.createElement('a');
  link.href = bookmark.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.draggable = false;
  link.textContent = bookmark.url;
  urlTd.appendChild(link);
  tr.appendChild(urlTd);

  const folderTd = document.createElement('td');
  folderTd.className = 'folder-cell';
  folderTd.textContent = bookmark.folder;
  tr.appendChild(folderTd);

  const actionsTd = document.createElement('td');
  actionsTd.className = 'actions';
  actionsTd.appendChild(makeStarButton(bookmark));
  actionsTd.appendChild(makeEditButton(bookmark));
  actionsTd.appendChild(makeDeleteButton(bookmark));
  tr.appendChild(actionsTd);

  makeDraggable(tr, bookmark);
  return tr;
}

function renderCard(bookmark) {
  const card = document.createElement('div');
  card.className = 'bookmark-card';

  const header = document.createElement('div');
  header.className = 'card-header';
  header.appendChild(makeFaviconImg(bookmark.url));

  const title = document.createElement('h3');
  title.textContent = bookmark.title;
  title.title = 'Double-click to rename';
  title.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startInlineBookmarkRename(title, bookmark);
  });
  header.appendChild(title);
  header.appendChild(makeStarButton(bookmark));
  card.appendChild(header);

  const link = document.createElement('a');
  link.href = bookmark.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.draggable = false;
  link.className = 'card-url';
  link.textContent = bookmark.url;
  card.appendChild(link);

  if (bookmark.folder) {
    const folderBadge = document.createElement('span');
    folderBadge.className = 'folder-badge';
    folderBadge.appendChild(makeIcon('folder'));
    folderBadge.appendChild(document.createTextNode(bookmark.folder));
    card.appendChild(folderBadge);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.appendChild(makeEditButton(bookmark));
  actions.appendChild(makeDeleteButton(bookmark));
  card.appendChild(actions);

  makeDraggable(card, bookmark);
  return card;
}

// --- Drag and drop reorganizing ---
// Every row/card is draggable so it can be dropped onto a sidebar folder (or
// "Favorites") to move it, or dropped onto another row/card (in either list or
// grid view) to reorder it — regardless of the current sort, since dropping
// somewhere new switches the view to "Custom order" so the drop actually sticks.

function makeDraggable(el, bookmark) {
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(bookmark.id));
    el.classList.add('dragging');
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    clearDropIndicators();
  });

  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    const isAfter = e.clientY - el.getBoundingClientRect().top > el.offsetHeight / 2;
    el.classList.toggle('drop-after', isAfter);
    el.classList.toggle('drop-before', !isAfter);
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-before', 'drop-after');
  });

  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    clearDropIndicators();
    if (!draggedId || draggedId === bookmark.id) return;

    const isAfter = e.clientY - el.getBoundingClientRect().top > el.offsetHeight / 2;
    const others = state.bookmarks.filter((b) => b.id !== draggedId);
    const targetIndex = others.findIndex((b) => b.id === bookmark.id);
    const before = isAfter ? others[targetIndex] : others[targetIndex - 1];
    const after = isAfter ? others[targetIndex + 1] : others[targetIndex];

    await reorderBookmark(draggedId, before ? before.id : null, after ? after.id : null);
  });
}

function clearDropIndicators() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function switchToCustomSort() {
  if (state.sort === 'custom') return;
  state.sort = 'custom';
  localStorage.setItem('syncmark:sort', state.sort);
  els.sortSelect.value = 'custom';
}

async function reorderBookmark(id, beforeId, afterId) {
  try {
    await api(`/bookmarks/${id}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeId, afterId }),
    });
    switchToCustomSort();
    await loadBookmarks();
  } catch (err) {
    showToast(`Failed to reorder: ${err.message}`, 'error');
  }
}

function makeDropTarget(el, onDrop) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    el.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) await onDrop(id);
  });
}

// --- Sidebar folder reordering (drag siblings within the same parent) ---

const FOLDER_DRAG_TYPE = 'application/x-syncmark-folder';

function makeFolderDraggable(li, node, siblings) {
  li.draggable = true;

  li.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(FOLDER_DRAG_TYPE, node.path);
    li.classList.add('dragging');
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearFolderDropIndicators();
  });

  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const isAfter = e.clientY - li.getBoundingClientRect().top > li.offsetHeight / 2;
    li.classList.toggle('drop-after', isAfter);
    li.classList.toggle('drop-before', !isAfter);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drop-before', 'drop-after');
  });

  li.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const draggedPath = e.dataTransfer.getData(FOLDER_DRAG_TYPE);
    clearFolderDropIndicators();
    if (!draggedPath || draggedPath === node.path) return;
    if (!siblings.some((s) => s.path === draggedPath)) return; // only reorder within the same parent

    const isAfter = e.clientY - li.getBoundingClientRect().top > li.offsetHeight / 2;
    const others = siblings.filter((s) => s.path !== draggedPath);
    const targetIndex = others.findIndex((s) => s.path === node.path);
    const before = isAfter ? others[targetIndex] : others[targetIndex - 1];
    const after = isAfter ? others[targetIndex + 1] : others[targetIndex];

    await reorderFolder(draggedPath, before ? before.path : null, after ? after.path : null);
  });
}

function clearFolderDropIndicators() {
  document.querySelectorAll('.folder-node.drop-before, .folder-node.drop-after').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

async function reorderFolder(name, beforeName, afterName) {
  try {
    await api('/folders/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, beforeName, afterName }),
    });
    await loadFolders();
  } catch (err) {
    showToast(`Failed to reorder folder: ${err.message}`, 'error');
  }
}

// --- Quick inline rename (double-click a folder name in the sidebar) ---

function startInlineFolderRename(row, btn, node) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-rename-input';
  input.value = node.name;
  row.replaceChild(input, btn);
  input.focus();
  input.select();

  let settled = false;

  function finish(commit) {
    if (settled) return;
    settled = true;
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKeydown);

    if (commit) {
      const newSegment = input.value.trim();
      if (newSegment && newSegment !== node.name) {
        const parentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
        const newPath = parentPath ? `${parentPath}/${newSegment}` : newSegment;
        renameFolderQuick(node.path, newPath);
        return;
      }
    }
    renderFolders();
  }

  function onBlur() {
    finish(true);
  }
  function onKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  }

  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);
}

async function renameFolderQuick(oldName, newName) {
  try {
    await api('/folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName }),
    });
    if (state.currentFolder === oldName || state.currentFolder.startsWith(`${oldName}/`)) {
      state.currentFolder = newName + state.currentFolder.slice(oldName.length);
    }
    await Promise.all([loadFolders(), loadBookmarks()]);
    showToast('Folder renamed', 'success');
  } catch (err) {
    showToast(`Failed to rename folder: ${err.message}`, 'error');
    renderFolders();
  }
}

async function moveBookmarkToFolder(id, folder) {
  try {
    await api(`/bookmarks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    await Promise.all([loadBookmarks(), loadFolders()]);
    showToast(folder ? `Moved to "${folder}"` : 'Removed from folder', 'success');
  } catch (err) {
    showToast(`Failed to move bookmark: ${err.message}`, 'error');
  }
}

async function addBookmarkToFavorites(id) {
  try {
    await api(`/bookmarks/${id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    });
    await loadBookmarks();
    showToast('Added to favorites', 'success');
  } catch (err) {
    showToast(`Failed to update favorite: ${err.message}`, 'error');
  }
}

function makeStarButton(bookmark) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'star-btn' + (bookmark.favorite ? ' active' : '');
  btn.title = bookmark.favorite ? 'Remove from favorites' : 'Add to favorites';
  btn.appendChild(makeIcon('star'));
  btn.addEventListener('click', () => toggleFavorite(bookmark));
  return btn;
}

function makeEditButton(bookmark) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Edit';
  btn.addEventListener('click', () => openModal('edit', bookmark));
  return btn;
}

function makeDeleteButton(bookmark) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Delete';
  btn.className = 'danger';
  btn.addEventListener('click', () => deleteBookmark(bookmark));
  return btn;
}

async function toggleFavorite(bookmark) {
  try {
    await api(`/bookmarks/${bookmark.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !bookmark.favorite }),
    });
    await loadBookmarks();
  } catch (err) {
    showToast(`Failed to update favorite: ${err.message}`, 'error');
  }
}

async function deleteBookmark(bookmark) {
  const confirmed = await confirmDialog(`Delete "${bookmark.title}"?`, { danger: true });
  if (!confirmed) return;
  try {
    await api(`/bookmarks/${bookmark.id}`, { method: 'DELETE' });
    await Promise.all([loadBookmarks(), loadFolders()]);
    showToast('Bookmark deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete: ${err.message}`, 'error');
  }
}

// --- Quick inline rename (double-click a bookmark's title, list or grid view) ---

function startInlineBookmarkRename(container, bookmark) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = bookmark.title;
  container.textContent = '';
  container.appendChild(input);
  input.focus();
  input.select();

  let settled = false;

  function finish(commit) {
    if (settled) return;
    settled = true;
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKeydown);

    if (commit) {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== bookmark.title) {
        renameBookmarkQuick(bookmark.id, newTitle);
        return;
      }
    }
    renderBookmarks();
  }

  function onBlur() {
    finish(true);
  }
  function onKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  }

  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);
}

async function renameBookmarkQuick(id, title) {
  try {
    await api(`/bookmarks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    await loadBookmarks();
    showToast('Bookmark renamed', 'success');
  } catch (err) {
    showToast(`Failed to rename: ${err.message}`, 'error');
    renderBookmarks();
  }
}

// --- Add / edit bookmark modal ---

function openModal(mode, bookmark) {
  state.modalMode = mode;
  state.modalBookmarkId = bookmark ? bookmark.id : null;
  els.modalHeading.textContent = mode === 'edit' ? 'Edit bookmark' : 'Add bookmark';
  els.modalTitleInput.value = bookmark ? bookmark.title : '';
  els.modalUrlInput.value = bookmark ? bookmark.url : '';
  els.modalFolderInput.value = bookmark ? bookmark.folder : state.currentFolder;
  els.modalFavoriteInput.checked = bookmark ? Boolean(bookmark.favorite) : false;
  els.modalError.hidden = true;
  els.modal.classList.add('is-open');
  els.modalTitleInput.focus();
}

function closeModal() {
  els.modal.classList.remove('is-open');
  state.modalMode = null;
  state.modalBookmarkId = null;
}

els.addBookmarkBtn.addEventListener('click', () => openModal('add', null));
els.modalCancelBtn.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (els.modal.classList.contains('is-open')) closeModal();
  if (els.foldersModal.classList.contains('is-open')) closeFoldersModal();
});

els.modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: els.modalTitleInput.value.trim(),
    url: els.modalUrlInput.value.trim(),
    folder: els.modalFolderInput.value.trim(),
    favorite: els.modalFavoriteInput.checked,
  };

  try {
    if (state.modalMode === 'edit') {
      await api(`/bookmarks/${state.modalBookmarkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api('/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    const wasEdit = state.modalMode === 'edit';
    closeModal();
    await Promise.all([loadBookmarks(), loadFolders()]);
    showToast(wasEdit ? 'Bookmark updated' : 'Bookmark added', 'success');
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

// --- Manage folders modal ---

function openFoldersModal() {
  els.foldersModal.classList.add('is-open');
  els.newFolderInput.value = '';
  renderFoldersManageList();
}

function closeFoldersModal() {
  els.foldersModal.classList.remove('is-open');
}

function renderFoldersManageList() {
  els.foldersManageList.innerHTML = '';

  if (state.folders.length === 0) {
    const li = document.createElement('li');
    li.className = 'folders-manage-empty';
    li.textContent = 'No folders yet.';
    els.foldersManageList.appendChild(li);
    return;
  }

  for (const { folder, count } of state.folders) {
    els.foldersManageList.appendChild(renderManageFolderRow(folder, count));
  }
}

function renderManageFolderRow(folder, count) {
  const li = document.createElement('li');
  li.className = 'folders-manage-row';

  const label = document.createElement('span');
  label.className = 'folders-manage-name';
  label.textContent = `${folder} (${count})`;
  li.appendChild(label);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.textContent = 'Rename';
  renameBtn.className = 'secondary';
  renameBtn.addEventListener('click', () => startRenameFolder(li, folder));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', () => deleteFolderPrompt(folder));

  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);
  li.appendChild(actions);

  return li;
}

function startRenameFolder(li, folder) {
  li.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = folder;
  li.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => renameFolderSubmit(folder, input.value.trim()));

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'secondary';
  cancelBtn.addEventListener('click', renderFoldersManageList);

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  li.appendChild(actions);
  input.focus();
}

async function renameFolderSubmit(oldName, newName) {
  if (!newName || newName === oldName) {
    renderFoldersManageList();
    return;
  }
  try {
    await api('/folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName }),
    });
    if (state.currentFolder === oldName || state.currentFolder.startsWith(`${oldName}/`)) {
      state.currentFolder = newName + state.currentFolder.slice(oldName.length);
    }
    await Promise.all([loadFolders(), loadBookmarks()]);
    renderFoldersManageList();
    showToast('Folder renamed', 'success');
  } catch (err) {
    showToast(`Failed to rename folder: ${err.message}`, 'error');
  }
}

async function deleteFolderPrompt(folder) {
  const confirmed = await confirmDialog(
    `Delete folder "${folder}"? Bookmarks inside will become unfiled, not deleted.`,
    { danger: true }
  );
  if (!confirmed) return;
  try {
    await api('/folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folder }),
    });
    if (state.currentFolder === folder || state.currentFolder.startsWith(`${folder}/`)) {
      state.currentFolder = '';
    }
    await Promise.all([loadFolders(), loadBookmarks()]);
    renderFoldersManageList();
    showToast('Folder deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete folder: ${err.message}`, 'error');
  }
}

els.manageFoldersBtn.addEventListener('click', openFoldersModal);
els.foldersModalCloseBtn.addEventListener('click', closeFoldersModal);
els.foldersModal.addEventListener('click', (e) => {
  if (e.target === els.foldersModal) closeFoldersModal();
});

els.newFolderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.newFolderInput.value.trim();
  if (!name) return;
  try {
    await api('/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    els.newFolderInput.value = '';
    await loadFolders();
    renderFoldersManageList();
    showToast('Folder created', 'success');
  } catch (err) {
    showToast(`Failed to create folder: ${err.message}`, 'error');
  }
});

// --- View toggle, sort, search ---

els.viewListBtn.addEventListener('click', () => setView('list'));
els.viewGridBtn.addEventListener('click', () => setView('grid'));

els.sortSelect.value = state.sort;
els.sortSelect.addEventListener('change', () => {
  state.sort = els.sortSelect.value;
  localStorage.setItem('syncmark:sort', state.sort);
  loadBookmarks();
});

let searchDebounce;
els.searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = e.target.value.trim();
    loadBookmarks();
  }, 200);
});

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === '/' && !isTyping) {
    e.preventDefault();
    els.searchInput.focus();
  } else if (e.key === 'n' && !isTyping) {
    e.preventDefault();
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

setView(state.view);
loadFolders();
loadBookmarks();
loadAccountBadge();
