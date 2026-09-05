const state = {
  contacts: [],
  groups: [],
  favoritesOnly: false,
  activeGroupId: null,
  query: '',
  sort: localStorage.getItem('syncmark:contactsSort') || 'name-asc',
  selectedIds: new Set(),
  modalMode: null, // 'add' | 'edit'
  modalContactId: null,
  modalTags: [],
  pendingPhotoFile: null,
  photoRemoved: false,
  cardContactId: null,
};

let editingGroupId = null;

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

  // Add/edit modal
  modal: document.getElementById('contact-modal'),
  modalHeading: document.getElementById('contact-modal-heading'),
  modalForm: document.getElementById('contact-form'),
  firstNameInput: document.getElementById('modal-first-name'),
  lastNameInput: document.getElementById('modal-last-name'),
  organizationInput: document.getElementById('modal-organization'),
  titleInput: document.getElementById('modal-title'),
  notesInput: document.getElementById('modal-notes'),
  favoriteInput: document.getElementById('modal-favorite-input'),
  phoneRows: document.getElementById('phone-rows'),
  emailRows: document.getElementById('email-rows'),
  addressRows: document.getElementById('address-rows'),
  socialRows: document.getElementById('social-rows'),
  messagingRows: document.getElementById('messaging-rows'),
  keydateRows: document.getElementById('keydate-rows'),
  relationshipRows: document.getElementById('relationship-rows'),
  customfieldRows: document.getElementById('customfield-rows'),
  addPhoneBtn: document.getElementById('add-phone-btn'),
  addEmailBtn: document.getElementById('add-email-btn'),
  addAddressBtn: document.getElementById('add-address-btn'),
  addSocialBtn: document.getElementById('add-social-btn'),
  addMessagingBtn: document.getElementById('add-messaging-btn'),
  addKeydateBtn: document.getElementById('add-keydate-btn'),
  addRelationshipBtn: document.getElementById('add-relationship-btn'),
  addCustomfieldBtn: document.getElementById('add-customfield-btn'),
  tagChips: document.getElementById('tag-chips'),
  tagInput: document.getElementById('tag-input'),
  tagSuggestions: document.getElementById('tag-suggestions'),
  notesPreviewToggle: document.getElementById('notes-preview-toggle'),
  notesPreview: document.getElementById('notes-preview'),
  modalError: document.getElementById('modal-error'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  photoPreview: document.getElementById('contact-photo-preview'),
  photoFile: document.getElementById('contact-photo-file'),
  photoRemoveBtn: document.getElementById('contact-photo-remove-btn'),

  // Contact card
  cardModal: document.getElementById('contact-card-modal'),
  cardAvatar: document.getElementById('contact-card-avatar'),
  cardHeading: document.getElementById('contact-card-heading'),
  cardSubtitle: document.getElementById('contact-card-subtitle'),
  cardFavoriteBtn: document.getElementById('contact-card-favorite-btn'),
  cardTags: document.getElementById('contact-card-tags'),
  cardBody: document.getElementById('contact-card-body'),
  cardDeleteBtn: document.getElementById('contact-card-delete-btn'),
  cardCloseBtn: document.getElementById('contact-card-close-btn'),
  cardEditBtn: document.getElementById('contact-card-edit-btn'),

  // Groups
  groupList: document.getElementById('group-list'),
  groupListEmpty: document.getElementById('group-list-empty'),
  manageGroupsBtn: document.getElementById('manage-groups-btn'),
  groupsModal: document.getElementById('groups-modal'),
  groupsModalCloseBtn: document.getElementById('groups-modal-close-btn'),
  groupsManageList: document.getElementById('groups-manage-list'),
  groupsManageEmpty: document.getElementById('groups-manage-empty'),
  groupForm: document.getElementById('group-form'),
  groupNameInput: document.getElementById('group-name-input'),
  groupTypeInput: document.getElementById('group-type-input'),
  smartRulesSection: document.getElementById('smart-rules-section'),
  smartRuleRows: document.getElementById('smart-rule-rows'),
  addSmartRuleBtn: document.getElementById('add-smart-rule-btn'),
  groupFormError: document.getElementById('group-form-error'),
  groupFormSaveBtn: document.getElementById('group-form-save-btn'),
  groupFormCancelBtn: document.getElementById('group-form-cancel-btn'),

  // Duplicate detection
  findDuplicatesBtn: document.getElementById('find-duplicates-btn'),
  duplicatesModal: document.getElementById('duplicates-modal'),
  duplicatesModalCloseBtn: document.getElementById('duplicates-modal-close-btn'),
  duplicatesList: document.getElementById('duplicates-list'),
  duplicatesEmpty: document.getElementById('duplicates-empty'),
};

const TYPE_OPTIONS = {
  phone: ['cell', 'home', 'work', 'main', 'other'],
  email: ['home', 'work', 'other'],
  social: ['twitter', 'instagram', 'facebook', 'linkedin', 'other'],
  messaging: ['whatsapp', 'telegram', 'signal', 'imessage', 'other'],
};

const ADDRESS_TYPES = ['home', 'work', 'other'];

const SMART_FIELD_OPTIONS = [
  { value: 'tag', label: 'Tag equals' },
  { value: 'organization', label: 'Organization contains' },
  { value: 'title', label: 'Title contains' },
  { value: 'favorite', label: 'Favorite is (true/false)' },
  { value: 'addedWithinDays', label: 'Added within (days)' },
];

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

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
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

// --- Markdown (notes) ---
// Escape first, transform second — this is what makes it safe without a
// sanitizer: there's no raw HTML left in the source for a transform to ever
// re-expose. Links are restricted to http(s)/mailto so "javascript:" etc.
// never becomes clickable.

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Consecutive "- " lines become one <ul>.
  html = html.replace(/(^|\n)((?:- .*(?:\n|$))+)/g, (_, prefix, block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^- /, '')}</li>`)
      .join('');
    return `${prefix}<ul>${items}</ul>`;
  });

  html = html
    .split(/\n{2,}/)
    .map((block) => (block.startsWith('<ul>') ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`))
    .join('');

  return html;
}

// --- Loading & rendering ---

async function loadContacts() {
  if (state.activeGroupId) {
    try {
      state.contacts = await api(`/contact-groups/${state.activeGroupId}/contacts`);
    } catch (err) {
      showToast(`Failed to load group: ${err.message}`, 'error');
      state.contacts = [];
    }
    renderContacts();
    return;
  }

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

function makeContactDraggable(tr, contact) {
  tr.draggable = true;
  tr.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', String(contact.id));
  });
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
    const tags = JSON.parse(contact.tags || '[]');

    const tr = document.createElement('tr');
    if (state.selectedIds.has(contact.id)) tr.classList.add('is-selected');
    makeContactDraggable(tr, contact);
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, button')) return;
      openCard(contact.id);
    });

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
    for (const tag of tags.slice(0, 2)) {
      const pill = document.createElement('span');
      pill.className = 'contact-tag-pill';
      pill.textContent = tag;
      nameTd.appendChild(pill);
    }
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
    editBtn.addEventListener('click', () => openModal('edit', contact.id));

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
    if (state.cardContactId === contact.id) closeCard();
    await loadContacts();
    showToast('Contact deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete contact: ${err.message}`, 'error');
  }
}

// --- Unified Contact Card (read-only view) ---

function addCardSection(title, lines) {
  if (!lines.length) return;
  const section = document.createElement('div');
  section.className = 'contact-card-section';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  section.appendChild(h3);
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'contact-card-line';
    div.textContent = line;
    section.appendChild(div);
  }
  els.cardBody.appendChild(section);
}

// Resolves each linked contact by fetching it directly rather than trusting
// state.contacts — that's just whatever the current search/group filter
// happens to have loaded, not a reliable place to look up an arbitrary
// related contact (e.g. searching for "Alice" wouldn't have "Bob", her
// manager, loaded at all, even though the link is perfectly valid).
async function addRelationshipsSection(contact) {
  const relationships = JSON.parse(contact.relationships || '[]');
  if (!relationships.length) return;

  const section = document.createElement('div');
  section.className = 'contact-card-section';
  const h3 = document.createElement('h3');
  h3.textContent = 'Relationships';
  section.appendChild(h3);

  for (const rel of relationships) {
    const line = document.createElement('div');
    line.className = 'contact-card-line';

    const label = document.createElement('span');
    label.className = 'contact-card-label';
    label.textContent = `${rel.type}:`;
    line.appendChild(label);

    try {
      const related = await api(`/contacts/${rel.contactId}`);
      const link = document.createElement('span');
      link.className = 'contact-card-link';
      link.textContent = related.full_name;
      link.addEventListener('click', () => openCard(related.id));
      line.appendChild(link);
    } catch {
      line.appendChild(document.createTextNode('(contact not found)'));
    }
    section.appendChild(line);
  }
  els.cardBody.appendChild(section);
}

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

async function openCard(contactId) {
  let contact;
  try {
    contact = await api(`/contacts/${contactId}`);
  } catch (err) {
    showToast(`Failed to load contact: ${err.message}`, 'error');
    return;
  }

  state.cardContactId = contact.id;

  els.cardAvatar.innerHTML = '';
  if (contact.has_photo) {
    const img = document.createElement('img');
    img.src = `/api/contacts/${contact.id}/photo?t=${Date.now()}`;
    img.alt = '';
    els.cardAvatar.appendChild(img);
  } else {
    els.cardAvatar.textContent = initials(contact);
  }

  els.cardHeading.textContent = contact.full_name;
  els.cardSubtitle.textContent = [contact.title, contact.organization].filter(Boolean).join(' at ');
  els.cardFavoriteBtn.classList.toggle('active', Boolean(contact.favorite));
  els.cardFavoriteBtn.onclick = () => toggleFavorite(contact).then(() => openCard(contact.id));

  els.cardTags.innerHTML = '';
  for (const tag of JSON.parse(contact.tags || '[]')) {
    const pill = document.createElement('span');
    pill.className = 'contact-tag-pill';
    pill.textContent = tag;
    els.cardTags.appendChild(pill);
  }

  els.cardBody.innerHTML = '';
  addCardSection(
    'Phone',
    JSON.parse(contact.phones || '[]').map((p) => `${capitalize(p.type)}: ${p.value}`)
  );
  addCardSection(
    'Email',
    JSON.parse(contact.emails || '[]').map((e) => `${capitalize(e.type)}: ${e.value}`)
  );
  addCardSection(
    'Address',
    JSON.parse(contact.addresses || '[]').map(
      (a) => `${capitalize(a.type)}: ${[a.street, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ')}`
    )
  );
  addCardSection(
    'Social',
    JSON.parse(contact.social_profiles || '[]').map((s) => `${capitalize(s.type)}: ${s.value}`)
  );
  addCardSection(
    'Messaging',
    JSON.parse(contact.messaging_handles || '[]').map((m) => `${capitalize(m.type)}: ${m.value}`)
  );
  addCardSection(
    'Key dates',
    JSON.parse(contact.key_dates || '[]').map((d) => `${d.label}: ${formatDateDisplay(d.date)}`)
  );
  await addRelationshipsSection(contact);
  addCardSection(
    'Custom fields',
    JSON.parse(contact.custom_fields || '[]').map((f) => `${f.label}: ${f.value}`)
  );

  if (contact.notes) {
    const section = document.createElement('div');
    section.className = 'contact-card-section';
    const h3 = document.createElement('h3');
    h3.textContent = 'Notes';
    const notesDiv = document.createElement('div');
    notesDiv.innerHTML = renderMarkdown(contact.notes);
    section.append(h3, notesDiv);
    els.cardBody.appendChild(section);
  }

  els.cardDeleteBtn.onclick = () => deleteContact(contact);
  els.cardEditBtn.onclick = () => {
    closeCard();
    openModal('edit', contact.id);
  };

  els.cardModal.classList.add('is-open');
}

function closeCard() {
  els.cardModal.classList.remove('is-open');
  state.cardContactId = null;
}

els.cardCloseBtn.addEventListener('click', closeCard);
els.cardModal.addEventListener('click', (e) => {
  if (e.target === els.cardModal) closeCard();
});

// --- Dynamic phone/email/social/messaging rows (shared {type,value} shape) ---

function createFieldRow(kind, entry) {
  const defaultType = TYPE_OPTIONS[kind][0];
  const value = entry || { type: defaultType, value: '' };
  const row = document.createElement('div');
  row.className = 'contact-field-row';

  const select = document.createElement('select');
  for (const type of TYPE_OPTIONS[kind]) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = capitalize(type);
    if (type === value.type) opt.selected = true;
    select.appendChild(opt);
  }

  const input = document.createElement('input');
  if (kind === 'phone') {
    input.type = 'tel';
    input.placeholder = 'Phone number';
  } else if (kind === 'email') {
    input.type = 'email';
    input.placeholder = 'Email address';
  } else if (kind === 'social') {
    input.type = 'text';
    input.placeholder = 'Profile URL or @handle';
  } else {
    input.type = 'text';
    input.placeholder = 'Handle or number';
  }
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

els.addPhoneBtn.addEventListener('click', () => els.phoneRows.appendChild(createFieldRow('phone')));
els.addEmailBtn.addEventListener('click', () => els.emailRows.appendChild(createFieldRow('email')));
els.addSocialBtn.addEventListener('click', () => els.socialRows.appendChild(createFieldRow('social')));
els.addMessagingBtn.addEventListener('click', () => els.messagingRows.appendChild(createFieldRow('messaging')));

// --- Addresses ---

function createAddressRow(entry) {
  const value = entry || { type: 'home', street: '', city: '', state: '', postalCode: '', country: '' };
  const row = document.createElement('div');
  row.className = 'contact-multi-row';

  const select = document.createElement('select');
  for (const type of ADDRESS_TYPES) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = capitalize(type);
    if (type === value.type) opt.selected = true;
    select.appendChild(opt);
  }
  select.dataset.role = 'type';

  const fieldSpecs = [
    ['street', 'Street'],
    ['city', 'City'],
    ['state', 'State/Region'],
    ['postalCode', 'Postal code'],
    ['country', 'Country'],
  ];
  const inputs = fieldSpecs.map(([role, placeholder]) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value[role] || '';
    input.dataset.role = role;
    return input;
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(select, ...inputs, removeBtn);
  return row;
}

function readAddressRows(container) {
  return Array.from(container.children)
    .map((row) => ({
      type: row.querySelector('[data-role="type"]').value,
      street: row.querySelector('[data-role="street"]').value.trim(),
      city: row.querySelector('[data-role="city"]').value.trim(),
      state: row.querySelector('[data-role="state"]').value.trim(),
      postalCode: row.querySelector('[data-role="postalCode"]').value.trim(),
      country: row.querySelector('[data-role="country"]').value.trim(),
    }))
    .filter((a) => a.street || a.city || a.state || a.postalCode || a.country);
}

els.addAddressBtn.addEventListener('click', () => els.addressRows.appendChild(createAddressRow()));

// --- Custom fields ---

function createCustomFieldRow(entry) {
  const value = entry || { label: '', value: '' };
  const row = document.createElement('div');
  row.className = 'contact-multi-row';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. LinkedIn)';
  labelInput.value = value.label || '';
  labelInput.dataset.role = 'label';

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'Value';
  valueInput.value = value.value || '';
  valueInput.dataset.role = 'value';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(labelInput, valueInput, removeBtn);
  return row;
}

function readCustomFieldRows(container) {
  return Array.from(container.children)
    .map((row) => ({
      label: row.querySelector('[data-role="label"]').value.trim(),
      value: row.querySelector('[data-role="value"]').value.trim(),
    }))
    .filter((f) => f.label && f.value);
}

els.addCustomfieldBtn.addEventListener('click', () => els.customfieldRows.appendChild(createCustomFieldRow()));

// --- Key dates ---

function createKeyDateRow(entry) {
  const value = entry || { label: '', date: '' };
  const row = document.createElement('div');
  row.className = 'contact-multi-row';

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Label (e.g. Birthday)';
  labelInput.value = value.label || '';
  labelInput.dataset.role = 'label';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = value.date || '';
  dateInput.dataset.role = 'date';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(labelInput, dateInput, removeBtn);
  return row;
}

function readKeyDateRows(container) {
  return Array.from(container.children)
    .map((row) => ({
      label: row.querySelector('[data-role="label"]').value.trim(),
      date: row.querySelector('[data-role="date"]').value,
    }))
    .filter((d) => d.label && d.date);
}

els.addKeydateBtn.addEventListener('click', () => els.keydateRows.appendChild(createKeyDateRow()));

// --- Relationships (linked to another contact via an in-memory picker) ---

// resolvedName: the linked contact's current display name, looked up by the
// caller (openModal) via the API rather than state.contacts — the currently
// loaded/filtered list is not a reliable place to find an arbitrary contact.
function createRelationshipRow(entry, resolvedName) {
  const value = entry || { type: '', contactId: null };
  const row = document.createElement('div');
  row.className = 'contact-multi-row';

  const typeInput = document.createElement('input');
  typeInput.type = 'text';
  typeInput.placeholder = 'Relationship (e.g. Manager)';
  typeInput.value = value.type || '';
  typeInput.dataset.role = 'type';

  const pickerWrap = document.createElement('div');
  pickerWrap.className = 'contact-picker-wrap';

  const pickerInput = document.createElement('input');
  pickerInput.type = 'text';
  pickerInput.placeholder = 'Search a contact…';
  pickerInput.dataset.role = 'picker';
  pickerInput.dataset.contactId = value.contactId || '';
  if (resolvedName) pickerInput.value = resolvedName;

  const dropdown = document.createElement('div');
  dropdown.className = 'contact-picker-dropdown';
  dropdown.hidden = true;

  pickerInput.addEventListener('input', () => {
    pickerInput.dataset.contactId = '';
    const query = pickerInput.value.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (!query) {
      dropdown.hidden = true;
      return;
    }
    const matches = state.contacts
      .filter((c) => c.id !== state.modalContactId && c.full_name.toLowerCase().includes(query))
      .slice(0, 8);
    if (matches.length === 0) {
      dropdown.hidden = true;
      return;
    }
    for (const match of matches) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'contact-picker-option';
      opt.textContent = match.full_name;
      opt.addEventListener('click', () => {
        pickerInput.value = match.full_name;
        pickerInput.dataset.contactId = String(match.id);
        dropdown.hidden = true;
      });
      dropdown.appendChild(opt);
    }
    dropdown.hidden = false;
  });
  pickerInput.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.hidden = true;
    }, 150); // let a dropdown-option click register before it disappears
  });

  pickerWrap.append(pickerInput, dropdown);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(typeInput, pickerWrap, removeBtn);
  return row;
}

function readRelationshipRows(container) {
  return Array.from(container.children)
    .map((row) => ({
      type: row.querySelector('[data-role="type"]').value.trim(),
      contactId: Number(row.querySelector('[data-role="picker"]').dataset.contactId) || null,
    }))
    .filter((r) => r.type && r.contactId);
}

els.addRelationshipBtn.addEventListener('click', () => els.relationshipRows.appendChild(createRelationshipRow()));

// --- Tags ---

function renderTagChips() {
  els.tagChips.innerHTML = '';
  for (const tag of state.modalTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    removeBtn.addEventListener('click', () => {
      state.modalTags = state.modalTags.filter((t) => t !== tag);
      renderTagChips();
    });
    chip.appendChild(removeBtn);
    els.tagChips.appendChild(chip);
  }
}

function addTagFromInput() {
  const value = els.tagInput.value.trim();
  els.tagInput.value = '';
  if (!value || state.modalTags.includes(value)) return;
  state.modalTags.push(value);
  renderTagChips();
}

els.tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTagFromInput();
  }
});
els.tagInput.addEventListener('blur', addTagFromInput);

async function loadTagSuggestions() {
  try {
    const tags = await api('/contacts/tags');
    els.tagSuggestions.innerHTML = '';
    for (const tag of tags) {
      const opt = document.createElement('option');
      opt.value = tag;
      els.tagSuggestions.appendChild(opt);
    }
  } catch {
    /* ignore */
  }
}

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

// --- Notes preview toggle ---

els.notesPreviewToggle.addEventListener('click', () => {
  const isPreviewing = !els.notesPreview.hidden;
  if (isPreviewing) {
    els.notesPreview.hidden = true;
    els.notesInput.hidden = false;
    els.notesPreviewToggle.textContent = 'Preview';
  } else {
    els.notesPreview.innerHTML = renderMarkdown(els.notesInput.value) || '<em>Nothing to preview yet.</em>';
    els.notesInput.hidden = true;
    els.notesPreview.hidden = false;
    els.notesPreviewToggle.textContent = 'Edit';
  }
});

// --- Add/edit modal ---

function clearDynamicRows() {
  els.phoneRows.innerHTML = '';
  els.emailRows.innerHTML = '';
  els.addressRows.innerHTML = '';
  els.socialRows.innerHTML = '';
  els.messagingRows.innerHTML = '';
  els.keydateRows.innerHTML = '';
  els.relationshipRows.innerHTML = '';
  els.customfieldRows.innerHTML = '';
}

async function openModal(mode, contactOrId) {
  state.modalMode = mode;
  let contact = null;

  if (mode === 'edit') {
    const id = typeof contactOrId === 'object' && contactOrId !== null ? contactOrId.id : contactOrId;
    try {
      contact = await api(`/contacts/${id}`);
    } catch (err) {
      showToast(`Failed to load contact: ${err.message}`, 'error');
      return;
    }
  }

  state.modalContactId = contact ? contact.id : null;
  state.pendingPhotoFile = null;
  state.photoRemoved = false;
  state.modalTags = contact ? JSON.parse(contact.tags || '[]') : [];

  els.modalHeading.textContent = mode === 'edit' ? 'Edit contact' : 'Add contact';
  els.modalError.hidden = true;
  els.notesInput.hidden = false;
  els.notesPreview.hidden = true;
  els.notesPreviewToggle.textContent = 'Preview';
  clearDynamicRows();
  renderTagChips();

  if (mode === 'edit' && contact) {
    els.firstNameInput.value = contact.first_name || '';
    els.lastNameInput.value = contact.last_name || '';
    els.organizationInput.value = contact.organization || '';
    els.titleInput.value = contact.title || '';
    els.notesInput.value = contact.notes || '';
    els.favoriteInput.checked = Boolean(contact.favorite);

    for (const p of JSON.parse(contact.phones || '[]')) els.phoneRows.appendChild(createFieldRow('phone', p));
    for (const e of JSON.parse(contact.emails || '[]')) els.emailRows.appendChild(createFieldRow('email', e));
    for (const a of JSON.parse(contact.addresses || '[]')) els.addressRows.appendChild(createAddressRow(a));
    for (const s of JSON.parse(contact.social_profiles || '[]')) els.socialRows.appendChild(createFieldRow('social', s));
    for (const m of JSON.parse(contact.messaging_handles || '[]')) els.messagingRows.appendChild(createFieldRow('messaging', m));
    for (const d of JSON.parse(contact.key_dates || '[]')) els.keydateRows.appendChild(createKeyDateRow(d));
    for (const r of JSON.parse(contact.relationships || '[]')) {
      let resolvedName = null;
      try {
        resolvedName = (await api(`/contacts/${r.contactId}`)).full_name;
      } catch {
        /* linked contact may have been deleted; leave the picker blank */
      }
      els.relationshipRows.appendChild(createRelationshipRow(r, resolvedName));
    }
    for (const f of JSON.parse(contact.custom_fields || '[]')) els.customfieldRows.appendChild(createCustomFieldRow(f));

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
  if (e.key !== 'Escape') return;
  if (els.modal.classList.contains('is-open')) closeModal();
  else if (els.cardModal.classList.contains('is-open')) closeCard();
  else if (els.groupsModal.classList.contains('is-open')) closeGroupsModal();
  else if (els.duplicatesModal.classList.contains('is-open')) closeDuplicatesModal();
});

els.modalForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.modalError.hidden = true;
  addTagFromInput(); // catch a tag left typed but not yet committed

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
    title: els.titleInput.value.trim(),
    notes: els.notesInput.value.trim(),
    favorite: els.favoriteInput.checked,
    tags: state.modalTags,
    phones: readFieldRows(els.phoneRows),
    emails: readFieldRows(els.emailRows),
    addresses: readAddressRows(els.addressRows),
    socialProfiles: readFieldRows(els.socialRows),
    messagingHandles: readFieldRows(els.messagingRows),
    keyDates: readKeyDateRows(els.keydateRows),
    relationships: readRelationshipRows(els.relationshipRows),
    customFields: readCustomFieldRows(els.customfieldRows),
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
    await loadTagSuggestions();
    showToast(state.modalMode === 'edit' ? 'Contact updated' : 'Contact added', 'success');
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

// --- Groups ---

async function loadGroups() {
  try {
    state.groups = await api('/contact-groups');
  } catch {
    state.groups = [];
  }
  renderGroups();
}

function makeGroupDropTarget(el, group) {
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
    const contactId = Number(e.dataTransfer.getData('text/plain'));
    if (!contactId) return;
    try {
      await api(`/contact-groups/${group.id}/members/${contactId}`, { method: 'POST' });
      showToast(`Added to "${group.name}"`, 'success');
      if (state.activeGroupId === group.id) await loadContacts();
    } catch (err) {
      showToast(`Failed to add to group: ${err.message}`, 'error');
    }
  });
}

function renderGroups() {
  els.groupList.innerHTML = '';
  els.groupListEmpty.hidden = state.groups.length > 0;

  for (const group of state.groups) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `folder-btn${state.activeGroupId === group.id ? ' active' : ''}`;
    const icon = group.type === 'smart' ? 'auto_awesome' : 'group';
    btn.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span class="folder-label">${group.name}</span>`;
    btn.addEventListener('click', () => selectGroup(group.id));
    if (group.type === 'manual') makeGroupDropTarget(btn, group);
    li.appendChild(btn);
    els.groupList.appendChild(li);
  }
}

function selectGroup(id) {
  state.activeGroupId = id;
  state.favoritesOnly = false;
  els.allContactsBtn.classList.remove('active');
  els.favoritesBtn.classList.remove('active');
  renderGroups();
  loadContacts();
}

function createSmartRuleRow(rule) {
  const value = rule || { field: 'tag', value: '' };
  const row = document.createElement('div');
  row.className = 'contact-multi-row';

  const select = document.createElement('select');
  for (const opt of SMART_FIELD_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value.field) o.selected = true;
    select.appendChild(o);
  }
  select.dataset.role = 'field';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Value';
  input.value = value.value ?? '';
  input.dataset.role = 'value';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn contact-field-remove';
  removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  removeBtn.addEventListener('click', () => row.remove());

  row.append(select, input, removeBtn);
  return row;
}

els.addSmartRuleBtn.addEventListener('click', () => els.smartRuleRows.appendChild(createSmartRuleRow()));

els.groupTypeInput.addEventListener('change', () => {
  els.smartRulesSection.hidden = els.groupTypeInput.value !== 'smart';
  if (els.groupTypeInput.value === 'smart' && els.smartRuleRows.children.length === 0) {
    els.smartRuleRows.appendChild(createSmartRuleRow());
  }
});

function readSmartRules() {
  return Array.from(els.smartRuleRows.children).map((row) => {
    const field = row.querySelector('[data-role="field"]').value;
    let value = row.querySelector('[data-role="value"]').value.trim();
    if (field === 'favorite') value = ['true', '1', 'yes'].includes(value.toLowerCase());
    else if (field === 'addedWithinDays') value = Number(value) || 0;
    return { field, operator: 'equals', value };
  });
}

function resetGroupForm() {
  editingGroupId = null;
  els.groupForm.reset();
  els.groupTypeInput.disabled = false;
  els.smartRulesSection.hidden = true;
  els.smartRuleRows.innerHTML = '';
  els.groupFormError.hidden = true;
  els.groupFormSaveBtn.textContent = 'Add group';
  els.groupFormCancelBtn.hidden = true;
}

function loadGroupIntoForm(group) {
  editingGroupId = group.id;
  els.groupNameInput.value = group.name;
  els.groupTypeInput.value = group.type;
  els.groupTypeInput.disabled = true; // a group's type is fixed after creation
  els.smartRulesSection.hidden = group.type !== 'smart';
  els.smartRuleRows.innerHTML = '';

  if (group.type === 'smart') {
    const rules = JSON.parse(group.smart_rules || '[]');
    for (const rule of rules) els.smartRuleRows.appendChild(createSmartRuleRow(rule));
    if (rules.length === 0) els.smartRuleRows.appendChild(createSmartRuleRow());
  }

  els.groupFormSaveBtn.textContent = 'Save changes';
  els.groupFormCancelBtn.hidden = false;
  els.groupFormError.hidden = true;
  els.groupNameInput.focus();
}

function renderGroupsManageList() {
  els.groupsManageList.innerHTML = '';
  els.groupsManageEmpty.hidden = state.groups.length > 0;

  for (const group of state.groups) {
    const li = document.createElement('li');
    li.className = 'folders-manage-row';

    const name = document.createElement('span');
    name.className = 'folders-manage-name';
    name.textContent = group.type === 'smart' ? `${group.name} (smart)` : group.name;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => loadGroupIntoForm(group));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteGroup(group));

    li.append(name, editBtn, deleteBtn);
    els.groupsManageList.appendChild(li);
  }
}

async function deleteGroup(group) {
  const confirmed = await confirmDialog(`Delete the group "${group.name}"? Contacts themselves are not affected.`, { danger: true });
  if (!confirmed) return;

  try {
    await api(`/contact-groups/${group.id}`, { method: 'DELETE' });
    if (state.activeGroupId === group.id) {
      state.activeGroupId = null;
      await loadContacts();
    }
    await loadGroups();
    renderGroupsManageList();
    showToast('Group deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete group: ${err.message}`, 'error');
  }
}

function openGroupsModal() {
  resetGroupForm();
  renderGroupsManageList();
  els.groupsModal.classList.add('is-open');
}

function closeGroupsModal() {
  els.groupsModal.classList.remove('is-open');
}

els.manageGroupsBtn.addEventListener('click', openGroupsModal);
els.groupsModalCloseBtn.addEventListener('click', closeGroupsModal);
els.groupsModal.addEventListener('click', (e) => {
  if (e.target === els.groupsModal) closeGroupsModal();
});

// --- Duplicate detection ---

// Rough "how filled-in is this contact" score, used only to pick a sensible
// default primary — the user can always pick a different one before merging.
function contactRichness(contact) {
  let score = JSON.parse(contact.phones || '[]').length + JSON.parse(contact.emails || '[]').length;
  score += JSON.parse(contact.tags || '[]').length;
  if (contact.organization) score += 1;
  if (contact.title) score += 1;
  if (contact.has_photo) score += 1;
  if (contact.favorite) score += 1;
  return score;
}

function renderDuplicateGroup(group, groupIndex) {
  const defaultPrimary = [...group].sort((a, b) => contactRichness(b) - contactRichness(a))[0];

  const card = document.createElement('div');
  card.className = 'duplicate-group-card';

  const candidates = document.createElement('div');
  candidates.className = 'duplicate-candidates';
  const pairs = [];

  function syncPrimaryLock() {
    for (const { radio, include } of pairs) {
      include.disabled = radio.checked;
      if (radio.checked) include.checked = true;
    }
  }

  for (const contact of group) {
    const phones = JSON.parse(contact.phones || '[]').map((e) => e.value).join(', ');
    const emails = JSON.parse(contact.emails || '[]').map((e) => e.value).join(', ');

    const row = document.createElement('label');
    row.className = 'duplicate-candidate';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `dup-primary-${groupIndex}`;
    radio.value = String(contact.id);
    radio.checked = contact.id === defaultPrimary.id;
    radio.className = 'duplicate-primary-radio';

    const avatar = makeContactAvatar(contact, 36);

    const info = document.createElement('div');
    info.className = 'duplicate-candidate-info';
    info.innerHTML = `
      <span class="duplicate-candidate-name">${escapeHtml(contact.full_name)}</span>
      <span class="duplicate-candidate-detail">${escapeHtml([contact.organization, phones, emails].filter(Boolean).join(' · ') || 'No details')}</span>
    `;

    const include = document.createElement('input');
    include.type = 'checkbox';
    include.checked = true;
    include.className = 'duplicate-include-checkbox';
    include.dataset.contactId = String(contact.id);
    include.title = 'Include in merge';
    include.addEventListener('click', (e) => e.stopPropagation());
    radio.addEventListener('change', syncPrimaryLock);

    pairs.push({ radio, include });
    row.append(radio, avatar, info, include);
    candidates.appendChild(row);
  }
  syncPrimaryLock(); // the chosen primary starts locked-included

  const actions = document.createElement('div');
  actions.className = 'duplicate-group-actions';

  const mergeBtn = document.createElement('button');
  mergeBtn.type = 'button';
  mergeBtn.textContent = 'Merge';
  mergeBtn.addEventListener('click', () => mergeDuplicateGroup(group, groupIndex, card));

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'secondary';
  dismissBtn.textContent = 'Not duplicates';
  dismissBtn.addEventListener('click', () => dismissDuplicateGroup(group, card));

  actions.append(mergeBtn, dismissBtn);
  card.append(candidates, actions);
  return card;
}

async function mergeDuplicateGroup(group, groupIndex, card) {
  const primaryRadio = card.querySelector(`input[name="dup-primary-${groupIndex}"]:checked`);
  const primaryId = Number(primaryRadio.value);
  const mergeIds = [...card.querySelectorAll('.duplicate-include-checkbox')]
    .filter((cb) => cb.checked && Number(cb.dataset.contactId) !== primaryId)
    .map((cb) => Number(cb.dataset.contactId));

  if (mergeIds.length === 0) {
    showToast('Select at least one other contact to merge in', 'error');
    return;
  }

  const confirmed = await confirmDialog(
    `Merge ${mergeIds.length} contact${mergeIds.length === 1 ? '' : 's'} into "${group.find((c) => c.id === primaryId).full_name}"? This can't be undone.`,
    { danger: true }
  );
  if (!confirmed) return;

  try {
    await api('/contacts/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId, mergeIds }),
    });
    card.remove();
    showToast('Contacts merged', 'success');
    await loadContacts();
    await loadTagSuggestions();
    if (!els.duplicatesList.children.length) els.duplicatesEmpty.hidden = false;
  } catch (err) {
    showToast(`Merge failed: ${err.message}`, 'error');
  }
}

async function dismissDuplicateGroup(group, card) {
  try {
    await api('/contacts/duplicates/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: group.map((c) => c.id) }),
    });
    card.remove();
    if (!els.duplicatesList.children.length) els.duplicatesEmpty.hidden = false;
  } catch (err) {
    showToast(`Failed to dismiss: ${err.message}`, 'error');
  }
}

async function openDuplicatesModal() {
  els.duplicatesList.innerHTML = '';
  els.duplicatesEmpty.hidden = true;
  els.duplicatesModal.classList.add('is-open');

  try {
    const groups = await api('/contacts/duplicates');
    if (groups.length === 0) {
      els.duplicatesEmpty.hidden = false;
      return;
    }
    groups.forEach((group, i) => els.duplicatesList.appendChild(renderDuplicateGroup(group, i)));
  } catch (err) {
    showToast(`Failed to load duplicates: ${err.message}`, 'error');
  }
}

function closeDuplicatesModal() {
  els.duplicatesModal.classList.remove('is-open');
}

els.findDuplicatesBtn.addEventListener('click', openDuplicatesModal);
els.duplicatesModalCloseBtn.addEventListener('click', closeDuplicatesModal);
els.duplicatesModal.addEventListener('click', (e) => {
  if (e.target === els.duplicatesModal) closeDuplicatesModal();
});
els.groupFormCancelBtn.addEventListener('click', resetGroupForm);

els.groupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.groupFormError.hidden = true;

  const name = els.groupNameInput.value.trim();
  const type = els.groupTypeInput.value;
  const smartRules = type === 'smart' ? readSmartRules() : undefined;

  try {
    if (editingGroupId) {
      await api(`/contact-groups/${editingGroupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, smartRules }),
      });
    } else {
      await api('/contact-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, smartRules }),
      });
    }
    const wasEditing = Boolean(editingGroupId);
    resetGroupForm();
    await loadGroups();
    renderGroupsManageList();
    showToast(wasEditing ? 'Group updated' : 'Group added', 'success');
    if (state.activeGroupId) await loadContacts(); // a smart group's rules may have just changed
  } catch (err) {
    els.groupFormError.textContent = err.message;
    els.groupFormError.hidden = false;
  }
});

// --- Filters ---

els.allContactsBtn.addEventListener('click', () => {
  state.favoritesOnly = false;
  state.activeGroupId = null;
  els.allContactsBtn.classList.add('active');
  els.favoritesBtn.classList.remove('active');
  renderGroups();
  loadContacts();
});

els.favoritesBtn.addEventListener('click', () => {
  state.favoritesOnly = true;
  state.activeGroupId = null;
  els.favoritesBtn.classList.add('active');
  els.allContactsBtn.classList.remove('active');
  renderGroups();
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
  if (
    els.modal.classList.contains('is-open') ||
    els.cardModal.classList.contains('is-open') ||
    els.groupsModal.classList.contains('is-open') ||
    els.duplicatesModal.classList.contains('is-open')
  )
    return;
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
loadGroups();
loadTagSuggestions();
loadAccountBadge();
applyFeatureGate();
