const els = {
  providerSelect: document.getElementById('provider-select'),
  panels: {
    syncmark: document.getElementById('panel-syncmark'),
    linkwarden: document.getElementById('panel-linkwarden'),
    karakeep: document.getElementById('panel-karakeep'),
  },

  syncmarkForm: document.getElementById('syncmark-form'),
  syncmarkUrl: document.getElementById('syncmark-url-input'),
  syncmarkStatus: document.getElementById('syncmark-status'),

  linkwardenForm: document.getElementById('linkwarden-form'),
  linkwardenUrl: document.getElementById('linkwarden-url-input'),
  linkwardenAuthMode: document.getElementById('linkwarden-auth-mode'),
  linkwardenPasswordFields: document.getElementById('linkwarden-password-fields'),
  linkwardenTokenFields: document.getElementById('linkwarden-token-fields'),
  linkwardenUsername: document.getElementById('linkwarden-username-input'),
  linkwardenPassword: document.getElementById('linkwarden-password-input'),
  linkwardenToken: document.getElementById('linkwarden-token-input'),
  linkwardenStatus: document.getElementById('linkwarden-status'),
  linkwardenHint: document.getElementById('linkwarden-connection-hint'),

  karakeepForm: document.getElementById('karakeep-form'),
  karakeepUrl: document.getElementById('karakeep-url-input'),
  karakeepToken: document.getElementById('karakeep-token-input'),
  karakeepStatus: document.getElementById('karakeep-status'),
  karakeepHint: document.getElementById('karakeep-connection-hint'),

  barEnabled: document.getElementById('bar-enabled-input'),
  barFolder: document.getElementById('bar-folder-select'),
  barLayout: document.getElementById('bar-layout-select'),
  barSidebarRow: document.getElementById('bar-sidebar-row'),
  barOpenSidebarBtn: document.getElementById('bar-open-sidebar-btn'),
  barSidebarStatus: document.getElementById('bar-sidebar-status'),
  barStatus: document.getElementById('bar-status'),
};

function showStatus(el, text) {
  el.textContent = text;
  setTimeout(() => {
    if (el.textContent === text) el.textContent = '';
  }, 3000);
}

function showProviderPanel(id) {
  for (const [key, panel] of Object.entries(els.panels)) {
    panel.hidden = key !== id;
  }
}

function requireHttpUrl(url) {
  return /^https?:\/\/.+/i.test(url);
}

// Firefox doesn't activate broad host_permissions (e.g. "http://*/*") just because they're
// listed in the manifest — it treats them as ad-hoc and only grants them once the user approves
// via this API, or fetches from extension pages fail with "NetworkError when attempting to
// fetch resource" even though the manifest looks correct. Chrome grants these at install time,
// so `request` resolves true immediately there without a prompt.
//
// `request()` must be called synchronously in direct response to the user's click — Firefox
// tracks "handling user input" per call stack, and even one `await` beforehand (e.g. checking
// `permissions.contains()` first) drops that flag, so `request()` throws instead of prompting.
// That's why this is the very first `await` in every caller, with no pre-check.
async function ensureHostPermission(url) {
  let origin;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return true; // malformed URL — let the caller's own validation surface the real error
  }
  try {
    return await browser.permissions.request({ origins: [origin] });
  } catch (err) {
    console.error('SyncMark: host permission request failed', err);
    return false;
  }
}

// --- Load current settings into the form ---

async function loadProviderFields() {
  const raw = await browser.storage.local.get(SyncMarkProviders.STORAGE_KEYS);
  const providerId = raw.provider || 'syncmark';
  els.providerSelect.value = providerId;
  showProviderPanel(providerId);

  els.syncmarkUrl.value = raw.serverUrl || 'http://localhost:3000';

  els.linkwardenUrl.value = raw.linkwardenUrl || '';
  const lwAuthMode = raw.linkwardenAuthMode || 'password';
  els.linkwardenAuthMode.value = lwAuthMode;
  els.linkwardenTokenFields.hidden = lwAuthMode !== 'token';
  els.linkwardenPasswordFields.hidden = lwAuthMode === 'token';
  els.linkwardenUsername.value = raw.linkwardenUsername || '';
  els.linkwardenHint.textContent = raw.linkwardenToken
    ? 'Connected. Leave the password/token blank and save to keep the current connection.'
    : '';

  els.karakeepUrl.value = raw.karakeepUrl || '';
  els.karakeepHint.textContent = raw.karakeepToken
    ? 'Connected. Leave the API key blank and save to keep the current connection.'
    : '';
}

els.providerSelect.addEventListener('change', async () => {
  showProviderPanel(els.providerSelect.value);
  await browser.storage.local.set({ provider: els.providerSelect.value });
  await loadBarSettings();
});

els.linkwardenAuthMode.addEventListener('change', () => {
  const isToken = els.linkwardenAuthMode.value === 'token';
  els.linkwardenTokenFields.hidden = !isToken;
  els.linkwardenPasswordFields.hidden = isToken;
});

// --- SyncMark ---

els.syncmarkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = els.syncmarkUrl.value.trim().replace(/\/+$/, '');
  if (!requireHttpUrl(url)) {
    showStatus(els.syncmarkStatus, 'URL must start with http:// or https://');
    return;
  }
  if (!(await ensureHostPermission(url))) {
    showStatus(els.syncmarkStatus, 'Grant access to this site to continue, then try again.');
    return;
  }
  await browser.storage.local.set({ serverUrl: url });
  showStatus(els.syncmarkStatus, 'Saved.');
  await loadBarSettings();
});

// --- Linkwarden ---

els.linkwardenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = els.linkwardenUrl.value.trim().replace(/\/+$/, '');
  if (!requireHttpUrl(url)) {
    showStatus(els.linkwardenStatus, 'URL must start with http:// or https://');
    return;
  }

  if (!(await ensureHostPermission(url))) {
    showStatus(els.linkwardenStatus, 'Grant access to this site to continue, then try again.');
    return;
  }

  const provider = SyncMarkProviders.get('linkwarden');
  const authMode = els.linkwardenAuthMode.value;
  const { linkwardenToken: existingToken } = await browser.storage.local.get('linkwardenToken');

  try {
    if (authMode === 'token') {
      const token = els.linkwardenToken.value.trim();
      if (!token && !existingToken) {
        showStatus(els.linkwardenStatus, 'Paste an access token first.');
        return;
      }
      const finalToken = token || existingToken;
      if (token) {
        const auth = await provider.testAuth({ serverUrl: url, token: finalToken });
        if (!auth.authenticated) {
          showStatus(els.linkwardenStatus, 'That token was rejected — check it and try again.');
          return;
        }
      }
      await browser.storage.local.set({
        linkwardenUrl: url,
        linkwardenAuthMode: 'token',
        linkwardenToken: finalToken,
      });
    } else {
      const username = els.linkwardenUsername.value.trim();
      const password = els.linkwardenPassword.value;
      if (!password) {
        if (!existingToken) {
          showStatus(els.linkwardenStatus, 'Enter your username and password.');
          return;
        }
        // No new password entered — just update the URL/username, keep the existing session token.
        await browser.storage.local.set({ linkwardenUrl: url, linkwardenAuthMode: 'password', linkwardenUsername: username });
      } else {
        const { token } = await provider.login({ serverUrl: url }, { username, password });
        await browser.storage.local.set({
          linkwardenUrl: url,
          linkwardenAuthMode: 'password',
          linkwardenUsername: username,
          linkwardenToken: token,
        });
        els.linkwardenPassword.value = '';
      }
    }
    showStatus(els.linkwardenStatus, 'Connected.');
  } catch (err) {
    showStatus(els.linkwardenStatus, err.message || 'Could not connect.');
  }
  await loadProviderFields();
  await loadBarSettings();
});

// --- Karakeep ---

els.karakeepForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = els.karakeepUrl.value.trim().replace(/\/+$/, '');
  if (!requireHttpUrl(url)) {
    showStatus(els.karakeepStatus, 'URL must start with http:// or https://');
    return;
  }

  if (!(await ensureHostPermission(url))) {
    showStatus(els.karakeepStatus, 'Grant access to this site to continue, then try again.');
    return;
  }

  const provider = SyncMarkProviders.get('karakeep');
  const { karakeepToken: existingToken } = await browser.storage.local.get('karakeepToken');
  const token = els.karakeepToken.value.trim();

  if (!token && !existingToken) {
    showStatus(els.karakeepStatus, 'Paste an API key first.');
    return;
  }
  const finalToken = token || existingToken;

  try {
    if (token) {
      const auth = await provider.testAuth({ serverUrl: url, token: finalToken });
      if (!auth.authenticated) {
        showStatus(els.karakeepStatus, 'That API key was rejected — check it and try again.');
        return;
      }
    }
    await browser.storage.local.set({ karakeepUrl: url, karakeepToken: finalToken });
    showStatus(els.karakeepStatus, 'Connected.');
  } catch (err) {
    showStatus(els.karakeepStatus, err.message || 'Could not connect.');
  }
  await loadProviderFields();
  await loadBarSettings();
});

// --- Bookmarks bar ---

async function loadBarSettings() {
  const raw = await browser.storage.local.get(SyncMarkProviders.STORAGE_KEYS);
  const providerId = raw.provider || 'syncmark';
  els.barEnabled.checked = Boolean(raw.barEnabled);
  els.barLayout.value = raw.barLayout || 'bar';
  els.barSidebarRow.hidden = els.barLayout.value !== 'sidebar';

  const provider = SyncMarkProviders.get(providerId);
  const config = SyncMarkProviders.readConfig(providerId, raw);

  if (!provider.configured(config)) {
    els.barFolder.innerHTML = '<option value="">— connect a service above first —</option>';
    els.barFolder.disabled = true;
    return;
  }

  try {
    const folders = await provider.listFolders(config);
    els.barFolder.innerHTML = '<option value="">— choose a folder —</option>';
    for (const f of folders) {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = f.count != null ? `${f.name} (${f.count})` : f.name;
      els.barFolder.appendChild(option);
    }
    els.barFolder.value = raw.pinnedFolder || '';
    els.barFolder.disabled = false;
  } catch {
    els.barFolder.innerHTML = '<option value="">— check the connection above —</option>';
    els.barFolder.disabled = true;
  }
}

async function saveBarSettings() {
  await browser.storage.local.set({
    barEnabled: els.barEnabled.checked,
    pinnedFolder: els.barFolder.value,
    barLayout: els.barLayout.value,
  });
  showStatus(els.barStatus, 'Saved.');
}

els.barEnabled.addEventListener('change', saveBarSettings);
els.barFolder.addEventListener('change', saveBarSettings);
els.barLayout.addEventListener('change', async () => {
  els.barSidebarRow.hidden = els.barLayout.value !== 'sidebar';
  els.barSidebarStatus.textContent = '';
  await saveBarSettings();
});

// browser.sidebarAction.open() must be called directly from this click handler — no `await`
// beforehand — or Firefox drops the "handling user input" flag and throws instead of opening it
// (the same restriction that applies to permissions.request(), see ensureHostPermission above).
els.barOpenSidebarBtn.addEventListener('click', () => {
  if (!browser.sidebarAction) {
    els.barSidebarStatus.textContent = "This browser doesn't support sidebar panels.";
    return;
  }
  browser.sidebarAction.open().catch((err) => {
    console.error('SyncMark: sidebarAction.open failed', err);
    els.barSidebarStatus.textContent = 'Could not open the sidebar automatically — open it from the browser\'s sidebar menu.';
  });
});

loadProviderFields();
loadBarSettings();
