const state = {
  contacts: [],
  favoritesOnly: false,
  query: '',
  sort: localStorage.getItem('syncmark:contactsSort') || 'name-asc',
  selectedIds: new Set(),
  modalMode: null, // 'add' | 'edit'
  modalContactId: null,
  pendingPhotoFile: null,
  photoRemoved: false,
};

const els = {
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  resultCount: document.getElementById('result-count'),
  rows: document.getElementById('contact-rows'),
  emptyState: document.getElementById('empty-state'),
  addContactBtn: document.getElementById('add-contact-btn'),
  allContactsBtn: document.getElementById('all-contacts-btn'),
  favoritesBtn: document.getElementById('favorites-btn'),
  importFile: document.getElementById('import-contacts-file'),
  selectAllCheckbox: document.getElementById('select-all-checkbox'),
  bulkBar: document.getElementById('bulk-action-bar'),
  bulkSelectedCount: document.getElementById('bulk-selected-count'),
  bulkFavoriteBtn: document.getElementById('bulk-favorite-btn'),
  bulkUnfavoriteBtn: document.getElementById('bulk-unfavorite-btn'),
  bulkExportBtn: document.getElementById('bulk-export-btn'),
  bulkDeleteBtn: document.getElementById('bulk-delete-btn'),
  bulkClearBtn: document.getElementById('bulk-clear-btn'),
  modal: document.getElementById('contact-modal'),
  modalHeading: document.getElementById('contact-modal-heading'),
  modalForm: document.getElementById('contact-form'),
  firstNameInput: document.getElementById('modal-first-name'),
  lastNameInput: document.getElementById('modal-last-name'),
  organizationInput: document.getElementById('modal-organization'),
  notesInput: document.getElementById('modal-notes'),
  favoriteInput: document.getElementById('modal-favorite-input'),
  phoneRows: document.getElementById('phone-rows'),
  emailRows: document.getElementById('email-rows'),
  addPhoneBtn: document.getElementById('add-phone-btn'),
  addEmailBtn: document.getElementById('add-email-btn'),
  modalError: document.getElementById('modal-error'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  photoPreview: document.getElementById('contact-photo-preview'),
  photoFile: document.getElementById('contact-photo-file'),
  photoRemoveBtn: document.getElementById('contact-photo-remove-btn'),
};

const TYPE_OPTIONS = {
  phone: ['cell', 'home', 'work', 'main', 'other'],
  email: ['home', 'work', 'other'],
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

function initials(contact) {
  const first = (contact.first_name || '')[0] || '';
  const last = (contact.last_name || '')[0] || '';
  const combined = (first + last).toUpperCase();
  if (combined) return combined;
  return (contact.full_name || '?')[0].toUpperCase();
}

function makeContactAvatar(contact, size) {
  const el = document.createElement('div');
  el.className = 'contact-avatar';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  if (contact.has_photo) {
    const img = document.createElement('img');
    img.src = `/api/contacts/${contact.id}/photo?t=${Date.now()}`;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = initials(contact);
  }
  return el;
}

// --- Loading & rendering ---

async function loadContacts() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.favoritesOnly) params.set('favorite', '1');
  params.set('sort', state.sort);
  state.contacts = await api(`/contacts?${params.toString()}`);

  const visibleIds = new Set(state.contacts.map((c) => c.id));
  for (const id of state.selectedIds) {
    if (!visibleIds.has(id)) state.selectedIds.delete(id);
  }

  renderContacts();
}

function updateBulkBar() {
  const count = state.selectedIds.size;
  els.bulkBar.hidden = count === 0;
  els.bulkSelectedCount.textContent = `${count} selected`;

  const total = state.contacts.length;
  els.selectAllCheckbox.checked = total > 0 && count === total;
  els.selectAllCheckbox.indeterminate = count > 0 && count < total;
}

function toggleSelected(id, selected) {
  if (selected) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  updateBulkBar();
}

function renderContacts() {
  els.rows.innerHTML = '';
  els.emptyState.hidden = state.contacts.length > 0;
  els.resultCount.textContent = state.contacts.length
    ? `${state.contacts.length} contact${state.contacts.length === 1 ? '' : 's'}`
    : '';

  for (const contact of state.contacts) {
    const phones = JSON.parse(contact.phones || '[]');
    const emails = JSON.parse(contact.emails || '[]');

    const tr = document.createElement('tr');
    if (state.selectedIds.has(contact.id)) tr.classList.add('is-selected');

    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedIds.has(contact.id);
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      toggleSelected(contact.id, checkbox.checked);
      tr.classList.toggle('is-selected', checkbox.checked);
    });
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);

    const avatarTd = document.createElement('td');
    avatarTd.className = 'icon-cell';
    avatarTd.appendChild(makeContactAvatar(contact, 28));
    tr.appendChild(avatarTd);

    const nameTd = document.createElement('td');
    nameTd.textContent = contact.full_name;
    tr.appendChild(nameTd);

    const phoneTd = document.createElement('td');
    phoneTd.textContent = phones[0]?.value || '';
    tr.appendChild(phoneTd);

    const emailTd = document.createElement('td');
    emailTd.textContent = emails[0]?.value || '';
    tr.appendChild(emailTd);

    const orgTd = document.createElement('td');
    orgTd.textContent = contact.organization || '';
    tr.appendChild(orgTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = `star-btn${contact.favorite ? ' active' : ''}`;
    starBtn.title = contact.favorite ? 'Unfavorite' : 'Favorite';
    starBtn.innerHTML = '<span class="material-symbols-outlined">star</span>';
    starBtn.addEventListener('click', () => toggleFavorite(contact));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openModal('edit', contact));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteContact(contact));

    actionsTd.append(starBtn, editBtn, deleteBtn);
    tr.appendChild(actionsTd);

    els.rows.appendChild(tr);
  }

  updateBulkBar();
}

async function toggleFavorite(contact) {
  try {
    await api(`/contacts/${contact.id}/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !contact.favorite }),
    });
    await loadContacts();
  } catch (err) {
    showToast(`Failed to update favorite: ${err.message}`, 'error');
  }
}

async function deleteContact(contact) {
  const confirmed = await confirmDialog(`Delete ${contact.full_name}? This cannot be undone.`, { danger: true });
  if (!confirmed) return;
  try {
    await api(`/contacts/${contact.id}`, { method: 'DELETE' });
    await loadContacts();
    showToast('Contact deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete contact: ${err.message}`, 'error');
  }
}

// --- Dynamic phone/email rows ---

function createFieldRow(kind, entry) {
  const value = entry || { type: kind === 'phone' ? 'cell' : 'home', value: '' };
  const row = document.createElement('div');
  row.className = 'contact-field-row';

  const select = document.createElement('select');
  for (const type of TYPE_OPTIONS[kind]) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type.charAt(0).toUpperCase() + type.slice(1);
    if (type === value.type) opt.selected = true;
    select.appendChild(opt);
  }

  const input = document.createElement('input');
  input.type = kind === 'phone' ? 'tel' : 'email';
  input.placeholder = kind === 'phone' ? 'Phone number' : 'Email address';
  input.value = value.value || '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.title = 'Remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(select, input, removeBtn);
  return row;
}

function readFieldRows(container) {
  return Array.from(container.children)
    .map((row) => ({
      type: row.querySelector('select').value,
      value: row.querySelector('input').value.trim(),
    }))
    .filter((entry) => entry.value);
}

els.addPhoneBtn.addEventListener('click', () => {
  els.phoneRows.appendChild(createFieldRow('phone'));
});
els.addEmailBtn.addEventListener('click', () => {
  els.emailRows.appendChild(createFieldRow('email'));
});

// --- Photo editing ---

function resetPhotoPreview() {
  els.photoPreview.innerHTML = '<span class="material-symbols-outlined">person</span>';
  els.photoRemoveBtn.hidden = true;
}

function showPhotoUrl(url) {
  els.photoPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  els.photoPreview.appendChild(img);
  els.photoRemoveBtn.hidden = false;
}

els.photoFile.addEventListener('change', () => {
  const file = els.photoFile.files[0];
  if (!file) return;
  state.pendingPhotoFile = file;
  state.photoRemoved = false;
  showPhotoUrl(URL.createObjectURL(file));
  els.photoFile.value = '';
});

els.photoRemoveBtn.addEventListener('click', () => {
  state.pendingPhotoFile = null;
  state.photoRemoved = true;
  resetPhotoPreview();
});

// --- Add/edit modal ---

function openModal(mode, contact) {
  state.modalMode = mode;
  state.modalContactId = contact ? contact.id : null;
  state.pendingPhotoFile = null;
  state.photoRemoved = false;

  els.modalHeading.textContent = mode === 'edit' ? 'Edit contact' : 'Add contact';
  els.modalError.hidden = true;
  els.phoneRows.innerHTML = '';
  els.emailRows.innerHTML = '';

  if (mode === 'edit' && contact) {
    els.firstNameInput.value = contact.first_name || '';
    els.lastNameInput.value = contact.last_name || '';
    els.organizationInput.value = contact.organization || '';
    els.notesInput.value = contact.notes || '';
    els.favoriteInput.checked = Boolean(contact.favorite);

    const phones = JSON.parse(contact.phones || '[]');
    const emails = JSON.parse(contact.emails || '[]');
    for (const p of phones) els.phoneRows.appendChild(createFieldRow('phone', p));
    for (const e of emails) els.emailRows.appendChild(createFieldRow('email', e));

    if (contact.has_photo) showPhotoUrl(`/api/contacts/${contact.id}/photo?t=${Date.now()}`);
    else resetPhotoPreview();
  } else {
    els.modalForm.reset();
    resetPhotoPreview();
  }

  if (els.phoneRows.children.length === 0) els.phoneRows.appendChild(createFieldRow('phone'));
  if (els.emailRows.children.length === 0) els.emailRows.appendChild(createFieldRow('email'));

  els.modal.classList.add('is-open');
  els.firstNameInput.focus();
}

function closeModal() {
  els.modal.classList.remove('is-open');
}

els.addContactBtn.addEventListener('click', () => openModal('add', null));
els.modalCancelBtn.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.modal.classList.contains('is-open')) closeModal();
});

els.modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.modalError.hidden = true;

  const firstName = els.firstNameInput.value.trim();
  const lastName = els.lastNameInput.value.trim();
  if (!firstName && !lastName) {
    els.modalError.textContent = 'Enter a first or last name.';
    els.modalError.hidden = false;
    return;
  }

  const payload = {
    firstName,
    lastName,
    organization: els.organizationInput.value.trim(),
    notes: els.notesInput.value.trim(),
    favorite: els.favoriteInput.checked,
    phones: readFieldRows(els.phoneRows),
    emails: readFieldRows(els.emailRows),
  };

  try {
    const saved =
      state.modalMode === 'edit'
        ? await api(`/contacts/${state.modalContactId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await api('/contacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

    if (state.pendingPhotoFile) {
      const formData = new FormData();
      formData.append('photo', state.pendingPhotoFile);
      await api(`/contacts/${saved.id}/photo`, { method: 'POST', body: formData });
    } else if (state.photoRemoved) {
      await api(`/contacts/${saved.id}/photo`, { method: 'DELETE' });
    }

    closeModal();
    await loadContacts();
    showToast(state.modalMode === 'edit' ? 'Contact updated' : 'Contact added', 'success');
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

// --- Filters ---

els.allContactsBtn.addEventListener('click', () => {
  state.favoritesOnly = false;
  els.allContactsBtn.classList.add('active');
  els.favoritesBtn.classList.remove('active');
  loadContacts();
});

els.favoritesBtn.addEventListener('click', () => {
  state.favoritesOnly = true;
  els.favoritesBtn.classList.add('active');
  els.allContactsBtn.classList.remove('active');
  loadContacts();
});

let searchDebounce;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = els.searchInput.value.trim();
    loadContacts();
  }, 200);
});

els.sortSelect.value = state.sort;
els.sortSelect.addEventListener('change', () => {
  state.sort = els.sortSelect.value;
  localStorage.setItem('syncmark:contactsSort', state.sort);
  loadContacts();
});

// --- Import ---

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api('/contacts/import', { method: 'POST', body: formData });
    showToast(`Imported ${result.imported} contact${result.imported === 1 ? '' : 's'}`, 'success');
    await loadContacts();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  } finally {
    els.importFile.value = '';
  }
});

// --- Multi-select & bulk actions ---

els.selectAllCheckbox.addEventListener('change', () => {
  if (els.selectAllCheckbox.checked) {
    for (const contact of state.contacts) state.selectedIds.add(contact.id);
  } else {
    state.selectedIds.clear();
  }
  renderContacts();
});

els.bulkClearBtn.addEventListener('click', () => {
  state.selectedIds.clear();
  renderContacts();
});

async function runBulkAction(action, successMessage) {
  try {
    await api('/contacts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...state.selectedIds], action }),
    });
    state.selectedIds.clear();
    await loadContacts();
    showToast(successMessage, 'success');
  } catch (err) {
    showToast(`Bulk action failed: ${err.message}`, 'error');
  }
}

els.bulkFavoriteBtn.addEventListener('click', () => runBulkAction('favorite', 'Marked as favorite'));
els.bulkUnfavoriteBtn.addEventListener('click', () => runBulkAction('unfavorite', 'Removed from favorites'));

els.bulkDeleteBtn.addEventListener('click', async () => {
  const count = state.selectedIds.size;
  const confirmed = await confirmDialog(`Delete ${count} contact${count === 1 ? '' : 's'}? This cannot be undone.`, { danger: true });
  if (!confirmed) return;
  await runBulkAction('delete', `Deleted ${count} contact${count === 1 ? '' : 's'}`);
});

els.bulkExportBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = `/api/contacts/export?ids=${[...state.selectedIds].join(',')}`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
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

loadContacts();
loadAccountBadge();
