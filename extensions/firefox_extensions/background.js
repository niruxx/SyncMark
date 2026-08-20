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
  const { serverUrl, pinnedFolder, barEnabled, barCache } = await browser.storage.local.get([
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
    await browser.storage.local.set({
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

async function broadcastRefresh() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    browser.tabs.sendMessage(tab.id, { type: 'SYNCMARK_BAR_REFRESH' }).catch(() => {
      // no content script in this tab (about:, addons.mozilla.org, etc.) — ignore
    });
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SYNCMARK_GET_BAR_DATA') {
    return getBarData();
  }
  if (message?.type === 'SYNCMARK_OPEN_OPTIONS') {
    browser.runtime.openOptionsPage();
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pinnedFolder || changes.barEnabled || changes.serverUrl) {
    browser.storage.local.remove('barCache');
    broadcastRefresh();
  }
});
