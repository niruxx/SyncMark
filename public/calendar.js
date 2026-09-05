const state = {
  events: [],
  viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  query: '',
  selectedDateKey: null,
  selectedDate: null,
  modalMode: null, // 'add' | 'edit'
  modalEventId: null,
  modalEvent: null,
};

const els = {
  searchInput: document.getElementById('search-input'),
  addEventBtn: document.getElementById('add-event-btn'),
  prevBtn: document.getElementById('cal-prev-btn'),
  nextBtn: document.getElementById('cal-next-btn'),
  todayBtn: document.getElementById('cal-today-btn'),
  monthLabel: document.getElementById('cal-month-label'),
  grid: document.getElementById('calendar-grid'),

  dayPanel: document.getElementById('calendar-day-panel'),
  dayPanelHeading: document.getElementById('calendar-day-panel-heading'),
  dayPanelList: document.getElementById('calendar-day-panel-list'),
  dayPanelCloseBtn: document.getElementById('calendar-day-panel-close-btn'),
  dayPanelAddBtn: document.getElementById('calendar-day-panel-add-btn'),

  modal: document.getElementById('event-modal'),
  modalHeading: document.getElementById('event-modal-heading'),
  form: document.getElementById('event-form'),
  titleInput: document.getElementById('event-title-input'),
  allDayInput: document.getElementById('event-allday-input'),
  startLabel: document.getElementById('event-start-label'),
  endLabel: document.getElementById('event-end-label'),
  startInput: document.getElementById('event-start-input'),
  endInput: document.getElementById('event-end-input'),
  locationInput: document.getElementById('event-location-input'),
  descriptionInput: document.getElementById('event-description-input'),
  repeatInput: document.getElementById('event-repeat-input'),
  repeatUntilLabel: document.getElementById('event-repeat-until-label'),
  repeatUntilInput: document.getElementById('event-repeat-until-input'),
  modalError: document.getElementById('event-modal-error'),
  deleteBtn: document.getElementById('event-delete-btn'),
  cancelBtn: document.getElementById('event-cancel-btn'),
};

const MAX_PILLS_PER_DAY = 3;
const WEEKDAY_COUNT = 7;
const GRID_DAYS = 42; // 6 full weeks

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

// --- Context menu ---

let activeContextMenu = null;

function closeContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// items: [{ label, icon, danger?, onClick }] — used for both the day-cell
// ("Add event") and event-pill ("Edit event" / "Remove event") right-click menus.
function showContextMenu(x, y, items) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `context-menu-item${item.danger ? ' danger' : ''}`;
    btn.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span>${item.label}`;
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.onClick();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Position after measuring, clamped so the menu never runs off-screen.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

// A plain left click anywhere dismisses an open menu. Right-clicking a new
// target reopens it there instead (showContextMenu already closes the old
// one first) — no separate document-level "contextmenu" listener is needed,
// and one would misfire anyway: the cell/pill's own handler runs first and
// opens the new menu, then the same event bubbles to document.
document.addEventListener('click', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
window.addEventListener('scroll', closeContextMenu, true);

// --- Date helpers ---

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDayKey(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

// Timed occurrences bucket by the viewer's local wall-clock date; all-day
// ones use the UTC date components, since that's the calendar date the
// event was actually saved against (independent of the viewer's timezone).
function dayKeyFor(date, allDay) {
  return allDay
    ? localDayKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : localDayKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function toLocalInputValue(iso, allDay) {
  const d = new Date(iso);
  if (allDay) return dayKeyFor(d, true);
  return `${localDayKey(d.getFullYear(), d.getMonth(), d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value, allDay) {
  if (allDay) return `${value}T00:00:00.000Z`;
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePart || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).toISOString();
}

function formatMonthLabel(monthDate) {
  return monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatEventTime(event) {
  if (event.all_day) return 'All day';
  const start = new Date(event.start_at);
  return start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// --- Recurrence ---

function parseRecurrence(rruleValue) {
  if (!rruleValue) return null;
  const parts = {};
  for (const pair of rruleValue.split(';')) {
    const [key, value] = pair.split('=');
    if (key) parts[key] = value;
  }
  return parts.FREQ ? parts : null;
}

function parseUntil(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.999Z`) : null;
}

// Walks a basic FREQ=DAILY|WEEKLY|MONTHLY[;UNTIL=...] rule from the event's
// start, yielding {start, end} occurrences overlapping [rangeStart, rangeEnd).
// The only recurrence-walking logic in the app — the CalDAV server (and the
// events REST API) intentionally return the raw series instead of expanding it.
function expandOccurrences(event, rangeStart, rangeEnd) {
  const startAt = new Date(event.start_at);
  const endAt = new Date(event.end_at);
  const duration = endAt - startAt;
  const rrule = parseRecurrence(event.recurrence);

  if (!rrule) {
    return startAt < rangeEnd && endAt > rangeStart ? [{ start: startAt, end: endAt }] : [];
  }

  const until = rrule.UNTIL ? parseUntil(rrule.UNTIL) : null;
  const occurrences = [];
  const cursor = new Date(startAt);
  let iterations = 0;

  while (cursor < rangeEnd && iterations < 2000) {
    iterations += 1;
    if (until && cursor > until) break;

    const occEnd = new Date(cursor.getTime() + duration);
    if (occEnd > rangeStart) occurrences.push({ start: new Date(cursor), end: occEnd });

    if (rrule.FREQ === 'DAILY') cursor.setDate(cursor.getDate() + 1);
    else if (rrule.FREQ === 'WEEKLY') cursor.setDate(cursor.getDate() + 7);
    else if (rrule.FREQ === 'MONTHLY') cursor.setMonth(cursor.getMonth() + 1);
    else break;
  }

  return occurrences;
}

// Every calendar day an occurrence touches — all-day end dates are exclusive
// per iCalendar convention (a 2-day all-day event has DTEND on day 3).
function daysCoveredByOccurrence(occ, allDay) {
  const days = [];
  if (allDay) {
    const cursor = new Date(Date.UTC(occ.start.getUTCFullYear(), occ.start.getUTCMonth(), occ.start.getUTCDate()));
    const end = new Date(Date.UTC(occ.end.getUTCFullYear(), occ.end.getUTCMonth(), occ.end.getUTCDate()));
    if (cursor >= end) return [cursor];
    while (cursor < end) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else {
    const cursor = new Date(occ.start.getFullYear(), occ.start.getMonth(), occ.start.getDate());
    const end = new Date(occ.end.getFullYear(), occ.end.getMonth(), occ.end.getDate());
    while (cursor <= end) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return days;
}

// --- Loading & rendering ---

async function loadEvents() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  state.events = await api(`/events?${params.toString()}`);
  renderGrid();
  renderDayPanel();
}

function buildDayBuckets() {
  const firstOfMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + GRID_DAYS);

  const buckets = new Map(); // dayKey -> [{ event, occ }]
  for (const event of state.events) {
    const occurrences = expandOccurrences(event, gridStart, gridEnd);
    for (const occ of occurrences) {
      for (const day of daysCoveredByOccurrence(occ, Boolean(event.all_day))) {
        const key = dayKeyFor(day, Boolean(event.all_day));
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ event, occ });
      }
    }
  }

  return { gridStart, buckets };
}

// Bound once so every render/delete path (grid pill, day-panel item, modal
// delete button) shares the same confirm-and-delete behavior.
async function deleteEvent(event) {
  const isRecurring = Boolean(event.recurrence);
  const message = isRecurring
    ? `Delete "${event.title}" and its whole recurring series? This cannot be undone.`
    : `Delete "${event.title}"? This cannot be undone.`;
  const confirmed = await confirmDialog(message, { danger: true });
  if (!confirmed) return;

  try {
    await api(`/events/${event.id}`, { method: 'DELETE' });
    if (state.modalEventId === event.id) closeModal();
    await loadEvents();
    showToast('Event deleted', 'success');
  } catch (err) {
    showToast(`Failed to delete event: ${err.message}`, 'error');
  }
}

function eventContextMenuItems(event) {
  return [
    { icon: 'edit', label: 'Edit event', onClick: () => openModal('edit', event) },
    { icon: 'delete', label: 'Remove event', danger: true, onClick: () => deleteEvent(event) },
  ];
}

function renderGrid() {
  els.monthLabel.textContent = formatMonthLabel(state.viewMonth);
  els.grid.innerHTML = '';

  const { gridStart, buckets } = buildDayBuckets();
  const today = new Date();
  const todayKey = localDayKey(today.getFullYear(), today.getMonth(), today.getDate());

  const cursor = new Date(gridStart);
  for (let i = 0; i < GRID_DAYS; i += 1) {
    const cellDate = new Date(cursor);
    const key = localDayKey(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    const entries = (buckets.get(key) || []).sort((a, b) => a.occ.start - b.occ.start);

    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (cellDate.getMonth() !== state.viewMonth.getMonth()) cell.classList.add('is-other-month');
    if (key === todayKey) cell.classList.add('is-today');
    if (key === state.selectedDateKey) cell.classList.add('is-selected-day');

    const numberEl = document.createElement('span');
    numberEl.className = 'calendar-day-number';
    numberEl.textContent = String(cellDate.getDate());
    cell.appendChild(numberEl);

    const eventsEl = document.createElement('div');
    eventsEl.className = 'calendar-day-events';

    const visible = entries.slice(0, MAX_PILLS_PER_DAY);
    for (const { event } of visible) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'calendar-event-pill';
      pill.textContent = event.all_day ? event.title : `${formatEventTime(event)} ${event.title}`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal('edit', event);
      });
      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, eventContextMenuItems(event));
      });
      eventsEl.appendChild(pill);
    }

    if (entries.length > MAX_PILLS_PER_DAY) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'calendar-day-more';
      more.textContent = `+${entries.length - MAX_PILLS_PER_DAY} more`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDate(cellDate);
      });
      eventsEl.appendChild(more);
    }

    cell.appendChild(eventsEl);
    cell.addEventListener('click', () => selectDate(cellDate));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { icon: 'add', label: 'Add event', onClick: () => openModal('add', null, cellDate) },
      ]);
    });

    els.grid.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// Clicking a date expands the day panel on the right (calendar shrinks to
// make room) showing every event that day, instead of a modal popup.
function selectDate(date) {
  state.selectedDate = date;
  state.selectedDateKey = localDayKey(date.getFullYear(), date.getMonth(), date.getDate());
  renderDayPanel();
  renderGrid();
}

function closeDayPanel() {
  state.selectedDate = null;
  state.selectedDateKey = null;
  els.dayPanel.hidden = true;
  renderGrid();
}

function renderDayPanel() {
  if (!state.selectedDate) {
    els.dayPanel.hidden = true;
    return;
  }

  els.dayPanel.hidden = false;
  els.dayPanelHeading.textContent = state.selectedDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const { buckets } = buildDayBuckets();
  const entries = (buckets.get(state.selectedDateKey) || []).sort((a, b) => a.occ.start - b.occ.start);

  els.dayPanelList.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'day-events-empty';
    empty.textContent = 'No events on this day.';
    els.dayPanelList.appendChild(empty);
  }

  for (const { event } of entries) {
    const li = document.createElement('li');
    li.className = 'day-events-item';

    const time = document.createElement('span');
    time.className = 'day-events-time';
    time.textContent = formatEventTime(event);

    const title = document.createElement('span');
    title.className = 'day-events-title';
    title.textContent = event.title;

    li.append(time, title);
    li.addEventListener('click', () => openModal('edit', event));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, eventContextMenuItems(event));
    });
    els.dayPanelList.appendChild(li);
  }
}

els.dayPanelCloseBtn.addEventListener('click', closeDayPanel);
els.dayPanelAddBtn.addEventListener('click', () => openModal('add', null, state.selectedDate));

// --- Month navigation ---

function goToMonth(delta) {
  state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + delta, 1);
  renderGrid();
}

els.prevBtn.addEventListener('click', () => goToMonth(-1));
els.nextBtn.addEventListener('click', () => goToMonth(1));
els.todayBtn.addEventListener('click', () => {
  const now = new Date();
  state.viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  renderGrid();
});

let searchDebounce;
els.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = els.searchInput.value.trim();
    loadEvents();
  }, 200);
});

// --- Add/edit modal ---

function setAllDayInputTypes(isAllDay) {
  const startVal = els.startInput.value;
  const endVal = els.endInput.value;
  els.startInput.type = isAllDay ? 'date' : 'datetime-local';
  els.endInput.type = isAllDay ? 'date' : 'datetime-local';
  if (startVal) els.startInput.value = isAllDay ? startVal.slice(0, 10) : `${startVal.slice(0, 10)}T09:00`;
  if (endVal) els.endInput.value = isAllDay ? endVal.slice(0, 10) : `${endVal.slice(0, 10)}T10:00`;
}

els.allDayInput.addEventListener('change', () => setAllDayInputTypes(els.allDayInput.checked));

els.repeatInput.addEventListener('change', () => {
  els.repeatUntilLabel.hidden = !els.repeatInput.value;
});

function openModal(mode, event, defaultDate) {
  state.modalMode = mode;
  state.modalEventId = event ? event.id : null;
  state.modalEvent = event || null;

  els.modalHeading.textContent = mode === 'edit' ? 'Edit event' : 'Add event';
  els.modalError.hidden = true;
  els.deleteBtn.hidden = mode !== 'edit';
  els.form.reset();

  if (mode === 'edit' && event) {
    els.titleInput.value = event.title || '';
    els.locationInput.value = event.location || '';
    els.descriptionInput.value = event.description || '';
    els.allDayInput.checked = Boolean(event.all_day);
    setAllDayInputTypes(Boolean(event.all_day));
    els.startInput.value = toLocalInputValue(event.start_at, event.all_day);
    els.endInput.value = toLocalInputValue(event.end_at, event.all_day);

    const rrule = parseRecurrence(event.recurrence);
    els.repeatInput.value = rrule ? rrule.FREQ.toLowerCase() : '';
    els.repeatUntilLabel.hidden = !rrule;
    if (rrule && rrule.UNTIL) {
      const until = parseUntil(rrule.UNTIL);
      els.repeatUntilInput.value = until ? until.toISOString().slice(0, 10) : '';
    } else {
      els.repeatUntilInput.value = '';
    }
  } else {
    els.allDayInput.checked = false;
    setAllDayInputTypes(false);
    const base = defaultDate ? new Date(defaultDate) : new Date();
    base.setHours(base.getHours() + 1, 0, 0, 0);
    const end = new Date(base.getTime() + 60 * 60 * 1000);
    els.startInput.value = toLocalInputValue(base.toISOString(), false);
    els.endInput.value = toLocalInputValue(end.toISOString(), false);
    els.repeatInput.value = '';
    els.repeatUntilLabel.hidden = true;
    els.repeatUntilInput.value = '';
  }

  els.modal.classList.add('is-open');
  els.titleInput.focus();
}

function closeModal() {
  els.modal.classList.remove('is-open');
}

els.addEventBtn.addEventListener('click', () => openModal('add', null));
els.cancelBtn.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (activeContextMenu) closeContextMenu();
  else if (els.modal.classList.contains('is-open')) closeModal();
  else if (!els.dayPanel.hidden) closeDayPanel();
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.modalError.hidden = true;

  const title = els.titleInput.value.trim();
  if (!title) {
    els.modalError.textContent = 'Title is required.';
    els.modalError.hidden = false;
    return;
  }

  const allDay = els.allDayInput.checked;
  const startAt = fromLocalInputValue(els.startInput.value, allDay);
  const endAt = fromLocalInputValue(els.endInput.value, allDay);
  if (new Date(endAt) < new Date(startAt)) {
    els.modalError.textContent = 'End must be on or after the start.';
    els.modalError.hidden = false;
    return;
  }

  const payload = {
    title,
    location: els.locationInput.value.trim(),
    description: els.descriptionInput.value.trim(),
    allDay,
    startAt,
    endAt,
    recurrence: { freq: els.repeatInput.value, until: els.repeatInput.value ? els.repeatUntilInput.value : '' },
  };

  try {
    if (state.modalMode === 'edit') {
      await api(`/events/${state.modalEventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    closeModal();
    await loadEvents();
    showToast(state.modalMode === 'edit' ? 'Event updated' : 'Event added', 'success');
  } catch (err) {
    els.modalError.textContent = err.message;
    els.modalError.hidden = false;
  }
});

els.deleteBtn.addEventListener('click', () => {
  if (state.modalEvent) deleteEvent(state.modalEvent);
});

async function loadAccountBadge() {
  try {
    renderAccountBadge(await api('/auth/me'));
  } catch {
    /* ignore */
  }
}

loadEvents();
loadAccountBadge();
