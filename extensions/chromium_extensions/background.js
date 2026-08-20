const BAR_CACHE_TTL_MS = 30 * 1000;

async function fetchFolderBookmarks(base, folder) {
  const res = await fetch(`${base}/api/bookmarks?folder=${encodeURIComponent(folder)}&exact=1&sort=custom`, {
    credentials: 'include',
  });
  if (res.status === 401) return { unauthenticated: true };
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return { bookmarks: await res.json() };
}

async function getBarData() {
  const { serverUrl, pinnedFolder, barEnabled, barCache } = await chrome.storage.local.get([
    'serverUrl',
    'pinnedFolder',
    'barEnabled',
    'barCache',
  ]);

  if (!barEnabled || !serverUrl || !pinnedFolder) {
    return { enabled: false };
  }

  const base = serverUrl.replace(/\/+$/, '');
  const now = Date.now();

  if (barCache && barCache.folder === pinnedFolder && barCache.base === base && now - barCache.time < BAR_CACHE_TTL_MS) {
    return { enabled: true, serverUrl: base, bookmarks: barCache.bookmarks };
  }

  try {
    const result = await fetchFolderBookmarks(base, pinnedFolder);
    if (result.unauthenticated) {
      return { enabled: true, serverUrl: base, unauthenticated: true };
    }
    await chrome.storage.local.set({
      barCache: { folder: pinnedFolder, base, time: now, bookmarks: result.bookmarks },
    });
    return { enabled: true, serverUrl: base, bookmarks: result.bookmarks };
  } catch {
    // Server unreachable right now — fall back to the last-known list for this folder rather than an empty bar.
    if (barCache && barCache.folder === pinnedFolder && barCache.base === base) {
      return { enabled: true, serverUrl: base, bookmarks: barCache.bookmarks };
    }
    return { enabled: true, serverUrl: base, bookmarks: [] };
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
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pinnedFolder || changes.barEnabled || changes.serverUrl) {
    chrome.storage.local.remove('barCache');
    broadcastRefresh();
  }
});
