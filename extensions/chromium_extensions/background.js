importScripts('providers.js');

const BAR_CACHE_TTL_MS = 30 * 1000;

async function getActiveContext() {
  const raw = await chrome.storage.local.get(SyncMarkProviders.STORAGE_KEYS);
  const providerId = raw.provider || 'syncmark';
  const provider = SyncMarkProviders.get(providerId);
  const config = SyncMarkProviders.readConfig(providerId, raw);
  return {
    providerId,
    provider,
    config,
    pinnedFolder: raw.pinnedFolder || '',
    barEnabled: Boolean(raw.barEnabled),
    barCache: raw.barCache,
  };
}

async function getBarData() {
  const { providerId, provider, config, pinnedFolder, barEnabled, barCache } = await getActiveContext();

  if (!barEnabled || !provider.configured(config) || !pinnedFolder) {
    return { enabled: false };
  }

  const now = Date.now();
  const cacheMatches =
    barCache && barCache.provider === providerId && barCache.folder === pinnedFolder && barCache.base === config.serverUrl;

  if (cacheMatches && now - barCache.time < BAR_CACHE_TTL_MS) {
    return { enabled: true, bookmarks: barCache.bookmarks };
  }

  try {
    const bookmarks = await provider.listBookmarks(config, { folderId: pinnedFolder });
    await chrome.storage.local.set({
      barCache: { provider: providerId, folder: pinnedFolder, base: config.serverUrl, time: now, bookmarks },
    });
    return { enabled: true, bookmarks };
  } catch (err) {
    if (err && err.status === 401) {
      return { enabled: true, unauthenticated: true };
    }
    // Server unreachable right now — fall back to the last-known list rather than an empty bar.
    if (cacheMatches) {
      return { enabled: true, bookmarks: barCache.bookmarks };
    }
    return { enabled: true, bookmarks: [] };
  }
}

function broadcastRefresh() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, { type: 'SYNCMARK_BAR_REFRESH' }, () => {
        void chrome.runtime.lastError; // no content script in this tab (chrome://, extension gallery, etc.) — ignore
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SYNCMARK_GET_BAR_DATA') {
    getBarData().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message?.type === 'SYNCMARK_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
  }
  if (message?.type === 'SYNCMARK_OPEN_ADD_BOOKMARK') {
    const params = new URLSearchParams({ context: 'window', mode: 'add', url: message.url || '', title: message.title || '' });
    chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?${params.toString()}`),
      type: 'popup',
      width: 380,
      height: 560,
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const relevant = SyncMarkProviders.STORAGE_KEYS.filter((k) => k !== 'barCache');
  if (relevant.some((key) => key in changes)) {
    chrome.storage.local.remove('barCache');
    broadcastRefresh();
  }
});
