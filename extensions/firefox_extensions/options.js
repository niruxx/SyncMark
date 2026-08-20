const form = document.getElementById('options-form');
const input = document.getElementById('server-url-input');
const status = document.getElementById('save-status');

const barEnabledInput = document.getElementById('bar-enabled-input');
const barFolderSelect = document.getElementById('bar-folder-select');
const barStatus = document.getElementById('bar-status');

async function load() {
  const { serverUrl } = await browser.storage.local.get('serverUrl');
  input.value = serverUrl || 'http://localhost:3000';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim().replace(/\/+$/, '');

  if (!/^https?:\/\/.+/i.test(url)) {
    status.textContent = 'URL must start with http:// or https://';
    return;
  }

  await browser.storage.local.set({ serverUrl: url });
  status.textContent = 'Saved.';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);

  await loadBarSettings();
});

// --- Bookmarks bar ---

async function loadBarSettings() {
  const { serverUrl, barEnabled, pinnedFolder } = await browser.storage.local.get([
    'serverUrl',
    'barEnabled',
    'pinnedFolder',
  ]);
  barEnabledInput.checked = Boolean(barEnabled);

  const base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    barFolderSelect.innerHTML = '<option value="">— set a server URL above first —</option>';
    barFolderSelect.disabled = true;
    return;
  }

  try {
    const res = await fetch(`${base}/api/folders`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const folders = await res.json();

    barFolderSelect.innerHTML = '<option value="">— choose a folder —</option>';
    for (const { folder, count } of folders) {
      const option = document.createElement('option');
      option.value = folder;
      option.textContent = `${folder} (${count})`;
      barFolderSelect.appendChild(option);
    }
    barFolderSelect.value = pinnedFolder || '';
    barFolderSelect.disabled = false;
  } catch {
    barFolderSelect.innerHTML = '<option value="">— sign in via the toolbar popup first —</option>';
    barFolderSelect.disabled = true;
  }
}

async function saveBarSettings() {
  await browser.storage.local.set({
    barEnabled: barEnabledInput.checked,
    pinnedFolder: barFolderSelect.value,
  });
  barStatus.textContent = 'Saved.';
  setTimeout(() => {
    barStatus.textContent = '';
  }, 2000);
}

barEnabledInput.addEventListener('change', saveBarSettings);
barFolderSelect.addEventListener('change', saveBarSettings);

load();
loadBarSettings();
