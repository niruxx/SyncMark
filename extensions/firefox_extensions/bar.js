(function () {
  const HOST_TAG = 'syncmark-bookmarks-bar';
  const BAR_HEIGHT = 34;

  if (window.top !== window) return;
  if (document.querySelector(HOST_TAG)) return;

  let dismissed = false;

  function faviconUrl(url) {
    try {
      const { hostname } = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(hostname)}`;
    } catch {
      return '';
    }
  }

  async function isOwnServerPage() {
    const raw = await browser.storage.local.get(['provider', 'serverUrl', 'linkwardenUrl', 'karakeepUrl']);
    const serverUrl = { syncmark: raw.serverUrl, linkwarden: raw.linkwardenUrl, karakeep: raw.karakeepUrl }[
      raw.provider || 'syncmark'
    ];
    if (!serverUrl) return false;
    try {
      return location.origin === new URL(serverUrl).origin;
    } catch {
      return false;
    }
  }

  function removeBar() {
    document.documentElement.style.removeProperty('margin-top');
    const existing = document.querySelector(HOST_TAG);
    if (existing) existing.remove();
  }

  function render(data) {
    removeBar();
    if (dismissed || !data || !data.enabled || data.unauthenticated) return;
    if (!data.bookmarks || data.bookmarks.length === 0) return;

    const host = document.createElement(HOST_TAG);
    host.style.cssText =
      'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; ' +
      'right: 0 !important; z-index: 2147483647 !important; display: block !important;';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .bar {
        display: flex;
        align-items: center;
        height: ${BAR_HEIGHT}px;
        background: #161922;
        border-bottom: 1px solid #2a2f3b;
        font-family: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, Arial, sans-serif;
        font-size: 12.5px;
        color: #e9ebf0;
      }
      .brand {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        padding: 0 0.7rem;
        height: 100%;
        color: #5b8cff;
        font-weight: 600;
        cursor: pointer;
        border-right: 1px solid #2a2f3b;
        user-select: none;
      }
      .items {
        display: flex;
        align-items: center;
        height: 100%;
        flex: 1;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
      }
      .items::-webkit-scrollbar { height: 6px; }
      .items::-webkit-scrollbar-thumb { background: #2a2f3b; border-radius: 3px; }
      a.item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        height: 100%;
        padding: 0 0.65rem;
        color: #e9ebf0;
        text-decoration: none;
        white-space: nowrap;
        flex-shrink: 0;
      }
      a.item:hover { background: #1d212c; }
      a.item img {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      .close {
        flex-shrink: 0;
        background: none;
        border: none;
        border-left: 1px solid #2a2f3b;
        color: #99a1b3;
        cursor: pointer;
        font-size: 13px;
        padding: 0 0.7rem;
        height: 100%;
      }
      .close:hover { color: #e9ebf0; }
    `;
    shadow.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';

    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.textContent = 'SyncMark';
    brand.title = 'Open SyncMark extension settings';
    brand.addEventListener('click', () => {
      browser.runtime.sendMessage({ type: 'SYNCMARK_OPEN_OPTIONS' });
    });
    bar.appendChild(brand);

    const items = document.createElement('div');
    items.className = 'items';
    for (const bookmark of data.bookmarks) {
      const a = document.createElement('a');
      a.className = 'item';
      a.href = bookmark.url;
      a.title = bookmark.url;

      const img = document.createElement('img');
      img.src = faviconUrl(bookmark.url);
      img.alt = '';
      a.appendChild(img);

      const span = document.createElement('span');
      span.textContent = bookmark.title || bookmark.url;
      a.appendChild(span);

      items.appendChild(a);
    }
    bar.appendChild(items);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '✕';
    close.title = 'Hide for this page';
    close.addEventListener('click', () => {
      dismissed = true;
      removeBar();
    });
    bar.appendChild(close);

    shadow.appendChild(bar);
    document.documentElement.appendChild(host);
    document.documentElement.style.setProperty('margin-top', `${BAR_HEIGHT}px`, 'important');
  }

  async function load() {
    if (await isOwnServerPage()) return;
    let data;
    try {
      data = await browser.runtime.sendMessage({ type: 'SYNCMARK_GET_BAR_DATA' });
    } catch {
      return;
    }
    render(data);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SYNCMARK_BAR_REFRESH') {
      dismissed = false;
      load();
    }
  });

  load();
})();
