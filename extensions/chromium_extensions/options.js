const form = document.getElementById('options-form');
const input = document.getElementById('server-url-input');
const status = document.getElementById('save-status');

async function load() {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  input.value = serverUrl || 'http://localhost:3000';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim().replace(/\/+$/, '');

  if (!/^https?:\/\/.+/i.test(url)) {
    status.textContent = 'URL must start with http:// or https://';
    return;
  }

  await chrome.storage.local.set({ serverUrl: url });
  status.textContent = 'Saved.';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
});

load();
