(function () {
  const HOST_TAG = 'syncmark-bookmarks-bar';
  const BAR_HEIGHT = 28;
  const MAX_LABEL_WIDTH = 132;
  const RESIZE_DEBOUNCE_MS = 120;

  const ADD_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10a1 1 0 0 1 1 1v16l-6-4-6 4V4a1 1 0 0 1 1-1z"/>' +
    '<path d="M9.5 9h4M11.5 7v4"/></svg>';

  const SIDEBAR_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8"/><rect x="4.6" y="5.6" width="5" height="12.8" rx="1" fill="currentColor"/></svg>';

  const CHEVRON_ICON =
    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  const FALLBACK_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z"/></svg>'
    );

  if (window.top !== window) return;
  if (document.querySelector(HOST_TAG)) return;

  let dismissed = false;

  // Module-level (not per-render) so the outside-click and resize listeners below can stay
  // registered once for the page's lifetime and just look at "whatever's current" — render()
  // rebuilds the whole bar from scratch on every refresh, and re-adding a document/window
  // listener each time would leak one per refresh instead of replacing it.
  let currentItemsBox = null;
  let currentMoreBtn = null;
  let currentDropdown = null;
  let currentItemEls = [];
  let dropdownOpen = false;

  function faviconUrl(url) {
    try {
      const { hostname } = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(hostname)}`;
    } catch {
      return '';
    }
  }

  function isOwnServerPage(raw) {
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
    currentItemsBox = null;
    currentMoreBtn = null;
    currentDropdown = null;
    currentItemEls = [];
    dropdownOpen = false;
  }

  function closeDropdown() {
    dropdownOpen = false;
    if (currentDropdown) currentDropdown.hidden = true;
  }

  // Clips items to whatever fits in the row instead of letting the row scroll, and reports back
  // the bookmarks that didn't fit so they can be rendered into the "more" dropdown instead.
  function layoutItems() {
    if (!currentItemsBox || !currentItemsBox.isConnected) return [];
    for (const el of currentItemEls) el.hidden = false;
    currentMoreBtn.hidden = true;
    if (currentItemEls.length === 0) return [];

    const boxRect = currentItemsBox.getBoundingClientRect();
    let cut = currentItemEls.length;
    for (let i = 0; i < currentItemEls.length; i++) {
      if (currentItemEls[i].getBoundingClientRect().right > boxRect.right) {
        cut = i;
        break;
      }
    }
    if (cut === currentItemEls.length) return [];

    // Showing the "more" button is a flex sibling of `.items`, so it shrinks `.items`'s own
    // width — re-measure after making it visible rather than estimating the new width by hand.
    currentMoreBtn.hidden = false;
    const shrunkRect = currentItemsBox.getBoundingClientRect();
    cut = currentItemEls.length;
    for (let i = 0; i < currentItemEls.length; i++) {
      if (currentItemEls[i].getBoundingClientRect().right > shrunkRect.right) {
        cut = i;
        break;
      }
    }
    for (let i = cut; i < currentItemEls.length; i++) currentItemEls[i].hidden = true;
    return currentItemEls.slice(cut).map((el) => el.__bookmark);
  }

  function renderDropdownList(hiddenBookmarks) {
    currentDropdown.innerHTML = '';
    for (const bookmark of hiddenBookmarks) {
      currentDropdown.appendChild(buildLink(bookmark, 'drop-item', 220));
    }
  }

  function relayout() {
    const hidden = layoutItems();
    if (currentDropdown) renderDropdownList(hidden);
    if (hidden.length === 0) closeDropdown();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, RESIZE_DEBOUNCE_MS);
  });

  // Registered once at module scope — see the comment on the `current*` variables above.
  document.addEventListener('click', (e) => {
    if (!dropdownOpen) return;
    const path = e.composedPath();
    if (!path.includes(currentDropdown) && !path.includes(currentMoreBtn)) closeDropdown();
  });

  function buildLink(bookmark, className, labelWidth) {
    const a = document.createElement('a');
    a.className = className;
    a.href = bookmark.url;
    a.title = bookmark.title ? `${bookmark.title}\n${bookmark.url}` : bookmark.url;
    a.__bookmark = bookmark;

    const img = document.createElement('img');
    img.src = faviconUrl(bookmark.url);
    img.alt = '';
    img.addEventListener('error', () => {
      img.src = FALLBACK_ICON;
    });
    a.appendChild(img);

    const span = document.createElement('span');
    span.className = 'label';
    span.style.maxWidth = `${labelWidth}px`;
    span.textContent = bookmark.title || bookmark.url;
    a.appendChild(span);

    if (className === 'drop-item') a.addEventListener('click', closeDropdown);
    return a;
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
      :host { color-scheme: light dark; }
      .bar {
        display: flex;
        align-items: center;
        height: ${BAR_HEIGHT}px;
        box-sizing: border-box;
        padding: 0 4px;
        gap: 1px;
        background: #f1f3f4;
        border-bottom: 1px solid #dadce0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 12px;
        line-height: 1;
        color: #3c4043;
      }
      @media (prefers-color-scheme: dark) {
        .bar { background: #2a2b2e; border-bottom-color: #4a4d51; color: #e8eaed; }
      }
      button, a { font: inherit; color: inherit; }
      .icon-btn {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 22px;
        border: none;
        background: none;
        border-radius: 4px;
        cursor: pointer;
        padding: 0;
        position: relative;
      }
      .icon-btn:hover { background: rgba(60, 64, 67, 0.09); }
      @media (prefers-color-scheme: dark) {
        .icon-btn:hover { background: rgba(255, 255, 255, 0.1); }
      }
      .divider {
        flex-shrink: 0;
        width: 1px;
        height: 16px;
        margin: 0 3px;
        background: #dadce0;
      }
      @media (prefers-color-scheme: dark) {
        .divider { background: #4a4d51; }
      }
      .items {
        display: flex;
        align-items: center;
        height: 100%;
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      a.item {
        display: flex;
        align-items: center;
        height: 22px;
        max-width: ${MAX_LABEL_WIDTH + 34}px;
        padding: 0 6px;
        margin: 0 1px;
        border-radius: 4px;
        text-decoration: none;
        white-space: nowrap;
        flex-shrink: 0;
        box-sizing: border-box;
      }
      a.item:hover { background: rgba(60, 64, 67, 0.09); }
      @media (prefers-color-scheme: dark) {
        a.item:hover { background: rgba(255, 255, 255, 0.1); }
      }
      a.item img, a.drop-item img {
        width: 16px;
        height: 16px;
        margin-right: 8px;
        border-radius: 3px;
        flex-shrink: 0;
      }
      a.item .label, a.drop-item .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      a.item .label { max-width: ${MAX_LABEL_WIDTH}px; }
      .more-btn {
        gap: 3px;
        width: auto;
        padding: 0 6px;
      }
      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 200px;
        max-width: 300px;
        max-height: 60vh;
        overflow-y: auto;
        background: #fff;
        border: 1px solid #dadce0;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
        padding: 4px;
        box-sizing: border-box;
      }
      @media (prefers-color-scheme: dark) {
        .dropdown { background: #35363a; border-color: #4a4d51; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45); }
      }
      a.drop-item {
        display: flex;
        align-items: center;
        height: 28px;
        padding: 0 8px;
        border-radius: 6px;
        text-decoration: none;
        white-space: nowrap;
        box-sizing: border-box;
      }
      a.drop-item:hover { background: rgba(60, 64, 67, 0.09); }
      @media (prefers-color-scheme: dark) {
        a.drop-item:hover { background: rgba(255, 255, 255, 0.1); }
      }
    `;
    shadow.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'icon-btn';
    addBtn.innerHTML = ADD_ICON;
    addBtn.title = 'Bookmark this page';
    addBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SYNCMARK_OPEN_ADD_BOOKMARK', url: location.href, title: document.title });
    });
    bar.appendChild(addBtn);

    const leftDivider = document.createElement('div');
    leftDivider.className = 'divider';
    bar.appendChild(leftDivider);

    const items = document.createElement('div');
    items.className = 'items';
    const itemEls = data.bookmarks.map((bookmark) => {
      const a = buildLink(bookmark, 'item', MAX_LABEL_WIDTH);
      items.appendChild(a);
      return a;
    });
    bar.appendChild(items);

    const moreWrap = document.createElement('div');
    moreWrap.className = 'icon-btn more-btn';
    moreWrap.hidden = true;
    moreWrap.innerHTML = CHEVRON_ICON;
    const moreCount = document.createElement('span');
    moreWrap.appendChild(moreCount);
    moreWrap.title = 'More bookmarks';
    moreWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownOpen = !dropdownOpen;
      dropdown.hidden = !dropdownOpen;
    });
    bar.appendChild(moreWrap);

    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';
    dropdown.hidden = true;
    moreWrap.appendChild(dropdown);

    const rightDivider = document.createElement('div');
    rightDivider.className = 'divider';
    bar.appendChild(rightDivider);

    const sidebarBtn = document.createElement('button');
    sidebarBtn.type = 'button';
    sidebarBtn.className = 'icon-btn';
    sidebarBtn.innerHTML = SIDEBAR_ICON;
    sidebarBtn.title = 'Switch to sidebar layout';
    sidebarBtn.addEventListener('click', async () => {
      await chrome.storage.local.set({ barLayout: 'sidebar' });
      chrome.runtime.sendMessage({ type: 'SYNCMARK_OPEN_OPTIONS' });
    });
    bar.appendChild(sidebarBtn);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
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

    currentItemsBox = items;
    currentMoreBtn = moreWrap;
    currentDropdown = dropdown;
    currentItemEls = itemEls;

    const hidden = layoutItems();
    moreCount.textContent = hidden.length ? String(hidden.length) : '';
    renderDropdownList(hidden);
  }

  function load() {
    chrome.storage.local.get(
      ['provider', 'serverUrl', 'linkwardenUrl', 'karakeepUrl', 'barLayout'],
      (raw) => {
        if (raw.barLayout === 'sidebar') {
          removeBar();
          return;
        }
        if (isOwnServerPage(raw)) return;

        chrome.runtime.sendMessage({ type: 'SYNCMARK_GET_BAR_DATA' }, (data) => {
          if (chrome.runtime.lastError) return;
          render(data);
        });
      }
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SYNCMARK_BAR_REFRESH') {
      dismissed = false;
      load();
    }
  });

  load();
})();
