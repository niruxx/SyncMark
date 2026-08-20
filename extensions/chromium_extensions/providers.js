// Shared bookmark-service adapters — SyncMark, Linkwarden, Karakeep.
// Loaded as a plain script (defines the global `SyncMarkProviders`) by popup.html, options.html,
// background.js, so all three share one copy of the request logic. Kept storage-agnostic: every
// function takes a plain `config` object built from whatever's in chrome.storage.local — nothing
// in here touches chrome.* directly, so it's identical between the Chromium and Firefox builds.

const SyncMarkProviders = (function () {
  function normBase(url) {
    return (url || '').trim().replace(/\/+$/, '');
  }

  async function toError(res) {
    const body = await res.json().catch(() => ({}));
    const message = body.error || body.message || (typeof body.response === 'string' ? body.response : null);
    const err = new Error(message || `Request failed: ${res.status}`);
    err.status = res.status;
    return err;
  }

  function faviconUrl(url) {
    try {
      const { hostname } = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(hostname)}`;
    } catch {
      return '';
    }
  }

  // ---------------- SyncMark ----------------
  // Session-cookie auth (the extension's original, and still default, backend).

  const syncmark = {
    id: 'syncmark',
    label: 'SyncMark',
    folderInputType: 'text', // arbitrary/new folder paths allowed, e.g. "Work/Projects"
    supports: { edit: true, favorite: true },

    configured(config) {
      return Boolean(config && config.serverUrl);
    },

    async testAuth(config) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/auth/status`, { credentials: 'include' });
      if (!res.ok) throw await toError(res);
      const status = await res.json();
      return { authenticated: Boolean(status.authenticated), setupRequired: Boolean(status.setupRequired) };
    },

    async setup(config, { username, password }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw await toError(res);
      return {};
    },

    async login(config, { username, password }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw await toError(res);
      return {};
    },

    async logout(config) {
      const base = normBase(config.serverUrl);
      await fetch(`${base}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    },

    async listFolders(config) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/folders`, { credentials: 'include' });
      if (!res.ok) throw await toError(res);
      const folders = await res.json();
      return folders.map((f) => ({ id: f.folder, name: f.folder, count: f.count }));
    },

    async listBookmarks(config, { folderId, query } = {}) {
      const base = normBase(config.serverUrl);
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (folderId) {
        params.set('folder', folderId);
        params.set('exact', '1');
      }
      params.set('sort', folderId ? 'custom' : 'title-asc');
      const res = await fetch(`${base}/api/bookmarks?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw await toError(res);
      const items = await res.json();
      return items.map((b) => ({
        id: String(b.id),
        title: b.title,
        url: b.url,
        folder: b.folder || '',
        favorite: Boolean(b.favorite),
        icon: faviconUrl(b.url),
      }));
    },

    async addBookmark(config, { title, url, folder }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/bookmarks`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url, folder: folder || '' }),
      });
      if (!res.ok) throw await toError(res);
      return res.json();
    },

    async updateBookmark(config, id, { title, url, folder }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/bookmarks/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url, folder: folder || '' }),
      });
      if (!res.ok) throw await toError(res);
      return res.json();
    },

    async toggleFavorite(config, id, favorite) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/bookmarks/${id}/favorite`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite }),
      });
      if (!res.ok) throw await toError(res);
    },

    async deleteBookmark(config, id) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/bookmarks/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw await toError(res);
    },
  };

  // ---------------- Linkwarden ----------------
  // Bearer-token auth: either a session token minted from POST /api/v1/session (username/password),
  // or a pre-generated Access Token pasted in from Linkwarden's Settings → Access Tokens.
  // "Folders" map to Linkwarden Collections.

  const linkwarden = {
    id: 'linkwarden',
    label: 'Linkwarden',
    folderInputType: 'select', // only existing collections — this extension doesn't create new ones
    supports: { edit: true, favorite: false },

    configured(config) {
      return Boolean(config && config.serverUrl && config.token);
    },

    async testAuth(config) {
      if (!config.token) return { authenticated: false };
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/collections`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (res.status === 401 || res.status === 403) return { authenticated: false };
      if (!res.ok) throw await toError(res);
      return { authenticated: true };
    },

    async login(config, { username, password }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, sessionName: 'SyncMark extension' }),
      });
      if (!res.ok) throw await toError(res);
      const body = await res.json();
      const token = body && body.response && body.response.token;
      if (!token) throw new Error('Linkwarden signed in but did not return a session token.');
      return { token };
    },

    async listFolders(config) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/collections`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
      const body = await res.json();
      return (body.response || []).map((c) => ({
        id: String(c.id),
        name: c.name,
        count: c._count ? c._count.links : undefined,
      }));
    },

    async listBookmarks(config, { folderId, query } = {}) {
      const base = normBase(config.serverUrl);
      const params = new URLSearchParams();
      if (folderId) params.set('collectionId', folderId);
      if (query) params.set('searchQueryString', query);
      const res = await fetch(`${base}/api/v1/links?${params.toString()}`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
      const body = await res.json();
      return (body.response || []).map((l) => ({
        id: String(l.id),
        title: l.name,
        url: l.url,
        folder: l.collectionId != null ? String(l.collectionId) : '',
        favorite: false,
        icon: faviconUrl(l.url),
      }));
    },

    async addBookmark(config, { title, url, folder }) {
      const base = normBase(config.serverUrl);
      const payload = { name: title, url, type: 'url' };
      if (folder) payload.collection = { id: Number(folder) };
      const res = await fetch(`${base}/api/v1/links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await toError(res);
      return res.json();
    },

    async updateBookmark(config, id, { title, url, folder }) {
      const base = normBase(config.serverUrl);
      const payload = { id: Number(id), name: title, url };
      if (folder) payload.collection = { id: Number(folder) };
      const res = await fetch(`${base}/api/v1/links/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await toError(res);
      return res.json();
    },

    async deleteBookmark(config, id) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/links/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
    },
  };

  // ---------------- Karakeep ----------------
  // Bearer-token auth only — Karakeep's public API has no username/password login endpoint, just
  // API keys from Settings → API Keys. "Folders" map to Karakeep Lists, which (unlike SyncMark
  // folders or Linkwarden collections) are many-to-many: a bookmark is created unfiled, then
  // separately attached to a list.

  const karakeep = {
    id: 'karakeep',
    label: 'Karakeep',
    folderInputType: 'select',
    supports: { edit: false, favorite: false },

    configured(config) {
      return Boolean(config && config.serverUrl && config.token);
    },

    async testAuth(config) {
      if (!config.token) return { authenticated: false };
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/lists`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (res.status === 401 || res.status === 403) return { authenticated: false };
      if (!res.ok) throw await toError(res);
      return { authenticated: true };
    },

    async listFolders(config) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/lists`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
      const body = await res.json();
      return (body.lists || []).map((l) => ({ id: String(l.id), name: l.name }));
    },

    async listBookmarks(config, { folderId } = {}) {
      if (!folderId) return [];
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/lists/${folderId}/bookmarks?limit=100`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
      const body = await res.json();
      return (body.bookmarks || [])
        .filter((b) => b.content && b.content.type === 'link' && b.content.url)
        .map((b) => ({
          id: String(b.id),
          title: b.title || b.content.title || b.content.url,
          url: b.content.url,
          folder: folderId,
          favorite: Boolean(b.favourited),
          icon: faviconUrl(b.content.url),
        }));
    },

    async addBookmark(config, { title, url, folder }) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/bookmarks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'link', url, title: title || undefined }),
      });
      if (!res.ok) throw await toError(res);
      const bookmark = await res.json();
      if (folder) {
        const attach = await fetch(`${base}/api/v1/lists/${folder}/bookmarks/${bookmark.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${config.token}` },
        });
        if (!attach.ok) throw await toError(attach);
      }
      return bookmark;
    },

    async deleteBookmark(config, id) {
      const base = normBase(config.serverUrl);
      const res = await fetch(`${base}/api/v1/bookmarks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!res.ok) throw await toError(res);
    },
  };

  const registry = { syncmark, linkwarden, karakeep };

  function get(id) {
    return registry[id] || registry.syncmark;
  }

  // Maps the flat keys kept in chrome.storage.local onto the config object each adapter expects.
  function readConfig(providerId, raw) {
    if (providerId === 'linkwarden') {
      return {
        serverUrl: raw.linkwardenUrl || '',
        authMode: raw.linkwardenAuthMode || 'password',
        username: raw.linkwardenUsername || '',
        token: raw.linkwardenToken || '',
      };
    }
    if (providerId === 'karakeep') {
      return {
        serverUrl: raw.karakeepUrl || '',
        token: raw.karakeepToken || '',
      };
    }
    return { serverUrl: raw.serverUrl || '' };
  }

  const STORAGE_KEYS = [
    'provider',
    'serverUrl',
    'linkwardenUrl',
    'linkwardenAuthMode',
    'linkwardenUsername',
    'linkwardenToken',
    'karakeepUrl',
    'karakeepToken',
    'pinnedFolder',
    'barEnabled',
    'barCache',
  ];

  return { registry, get, readConfig, faviconUrl, STORAGE_KEYS };
})();
