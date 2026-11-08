(function () {
  /* ---------- Workspace shell ----------
     Every app page ships the same plain markup (top bar, <nav class="nav">,
     optional .sidebar, main.content). This rebuilds it into one consistent,
     Google-Workspace-style layout so the pages don't each carry their own copy:

       top bar   menu · logo + app name · search · settings, theme, account
       app rail  one icon per app, far left (a drawer section on mobile)
       sidebar   the page's primary "New" action, then its folders/filters
       sheet     main.content on a rounded surface, with a compact title row
                 and a ⋮ menu gathering the page's secondary actions

     Elements keep their ids and listeners; they are only moved, so page
     scripts don't need to know about any of this. */
  const NAV_ICONS = {
    Bookmarks: 'bookmarks',
    Contacts: 'contacts',
    Calendar: 'calendar_month',
    Files: 'folder',
    Passwords: 'key',
    Settings: 'settings',
  };
  const SETTINGS_TAB_ICONS = {
    account: 'account_circle',
    general: 'tune',
    bookmarks: 'bookmarks',
    files: 'folder',
    passwords: 'key',
    contacts: 'contacts',
    calendar: 'calendar_month',
  };
  const COLLAPSED_KEY = 'syncmark:sidebarCollapsed';
  const mobileQuery = window.matchMedia('(max-width: 820px)');

  function symbol(name, className) {
    const span = document.createElement('span');
    span.className = `material-symbols-outlined${className ? ` ${className}` : ''}`;
    span.setAttribute('aria-hidden', 'true');
    span.textContent = name;
    return span;
  }

  // An element's visible label without its Material Symbols ligature text.
  function plainLabel(el) {
    const text = [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text || el.getAttribute('aria-label') || el.title || el.textContent.trim();
  }

  function iconOf(el, fallback) {
    return el.dataset.icon || el.querySelector('.material-symbols-outlined')?.textContent.trim() || fallback;
  }

  // Shared by page scripts for per-row actions: swaps a text button for a
  // compact icon button that keeps an accessible name and tooltip.
  window.iconizeButton = function iconizeButton(btn, icon, label) {
    const name = label || btn.textContent.trim();
    btn.classList.add('row-action');
    btn.title = name;
    btn.setAttribute('aria-label', name);
    btn.replaceChildren(symbol(icon));
    return btn;
  };

  const shell = document.getElementById('app-shell');
  const workspaceNav = document.querySelector('nav.nav');
  const workspaceMain = document.querySelector('main.content');
  if (shell && workspaceNav && workspaceMain) buildWorkspaceShell();

  function buildWorkspaceShell() {
    shell.classList.add('has-workspace-nav', 'gw-shell');
    const topbar = shell.querySelector('.topbar');
    const topbarLeft = topbar.querySelector('.topbar-left');
    const topbarActions = topbar.querySelector('.topbar-actions');
    const layout = shell.querySelector('.layout');
    const brand = topbarLeft.querySelector('.brand');

    const activeLink = workspaceNav.querySelector('a.active');
    const appName = activeLink ? activeLink.textContent.trim() : 'Workspace';
    shell.dataset.app = appName.toLowerCase();

    /* App rail: icon above label, Gmail-style. Settings moves to the top bar. */
    workspaceNav.setAttribute('aria-label', 'Apps');
    const settingsLink = workspaceNav.querySelector('a[href="settings.html"]');
    workspaceNav.querySelectorAll('a').forEach((link) => {
      const label = link.textContent.trim();
      const pill = document.createElement('span');
      pill.className = 'rail-pill';
      pill.append(symbol(NAV_ICONS[label] || 'apps'));
      const text = document.createElement('span');
      text.className = 'rail-label';
      text.textContent = label;
      link.replaceChildren(pill, text);
      if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
    });
    const drawerNav = workspaceNav.cloneNode(true);
    if (settingsLink) settingsLink.remove();
    const rail = document.createElement('aside');
    rail.className = 'app-rail';
    rail.append(workspaceNav);
    layout.prepend(rail);

    /* Top bar: menu button, logo + current app, then utility icons. */
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'icon-btn gw-menu-btn';
    menuBtn.setAttribute('aria-label', 'Main menu');
    menuBtn.title = 'Main menu';
    menuBtn.append(symbol('menu'));
    topbarLeft.prepend(menuBtn);
    if (brand) {
      brand.setAttribute('aria-label', `SyncMark ${appName}`);
      const appLabel = document.createElement('span');
      appLabel.className = 'brand-app';
      appLabel.textContent = appName;
      brand.append(appLabel);
    }
    const gear = document.createElement('a');
    gear.href = 'settings.html';
    gear.className = 'icon-btn topbar-icon-btn';
    gear.title = 'Settings';
    gear.setAttribute('aria-label', 'Settings');
    gear.append(symbol('settings'));
    if (settingsLink?.classList.contains('active')) {
      gear.classList.add('active');
      gear.setAttribute('aria-current', 'page');
    }
    topbarActions.insertBefore(gear, topbarActions.querySelector('.account-menu'));

    // The account button becomes avatar-only; the name moves into the menu.
    const accountBtn = document.getElementById('account-menu-trigger');
    const accountName = document.getElementById('account-username');
    const accountDropdown = document.getElementById('account-dropdown');
    if (accountBtn && accountName && accountDropdown) {
      accountBtn.setAttribute('aria-label', 'Account menu');
      accountBtn.title = 'Account';
      const header = document.createElement('div');
      header.className = 'account-dropdown-header';
      const signedIn = document.createElement('span');
      signedIn.className = 'account-dropdown-caption';
      signedIn.textContent = 'Signed in as';
      header.append(signedIn, accountName);
      accountDropdown.prepend(header);
    }

    /* Sidebar: every page gets one (Settings uses it for its sections). */
    let sidebar = layout.querySelector('.sidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.className = 'sidebar';
      layout.insertBefore(sidebar, workspaceMain);
    }
    sidebar.id ||= 'workspace-sidebar';
    sidebar.setAttribute('aria-label', `${appName} sidebar`);
    menuBtn.setAttribute('aria-controls', sidebar.id);

    const settingsTabs = workspaceMain.querySelector('.settings-tabs');
    if (settingsTabs) {
      settingsTabs.setAttribute('aria-orientation', 'vertical');
      settingsTabs.querySelectorAll('.settings-tab').forEach((tab) => {
        tab.prepend(symbol(SETTINGS_TAB_ICONS[tab.dataset.tab] || 'tune'));
      });
      sidebar.prepend(settingsTabs);
    }

    /* Primary action: the big "New" button at the top of the sidebar. One
       action is moved there as-is; several (Files: folder + upload) become a
       "New" button that opens a menu of them. */
    const primary = [...topbarActions.querySelectorAll(':scope > button:not(.theme-toggle), :scope > label.button')];
    const compose = document.createElement('div');
    compose.className = 'sidebar-compose';
    if (primary.length === 1) {
      primary[0].classList.remove('secondary');
      primary[0].classList.add('compose-btn');
      compose.append(primary[0]);
    } else if (primary.length > 1) {
      const holder = document.createElement('div');
      holder.hidden = true;
      primary.forEach((el) => holder.append(el));
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'button compose-btn';
      newBtn.setAttribute('aria-haspopup', 'menu');
      newBtn.append(symbol('add'), document.createTextNode('New'));
      newBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = newBtn.getBoundingClientRect();
        window.showContextMenu(rect.left, rect.bottom + 6, primary.filter((el) => !el.hidden && !el.disabled).map((el) => ({
          label: plainLabel(el),
          icon: iconOf(el, 'add'),
          onClick: () => el.click(),
        })));
      });
      compose.append(newBtn, holder);
    }
    topbarActions.querySelectorAll(':scope > input[type="file"]').forEach((input) => compose.append(input));
    // Desktop: top of the sidebar. Mobile: a floating action button, which
    // can't live inside the drawer (its transform would trap position:fixed).
    function placeCompose() {
      if (!compose.childElementCount) return;
      compose.classList.toggle('is-fab', mobileQuery.matches);
      if (mobileQuery.matches) shell.append(compose);
      else sidebar.prepend(compose);
    }
    placeCompose();
    mobileQuery.addEventListener('change', placeCompose);

    /* Mobile: the sidebar is a drawer, and app switching lives at its foot. */
    const drawerApps = document.createElement('div');
    drawerApps.className = 'drawer-apps';
    const drawerHeading = document.createElement('h2');
    drawerHeading.textContent = 'Apps';
    drawerNav.classList.add('drawer-nav');
    drawerNav.setAttribute('aria-label', 'Apps');
    drawerApps.append(drawerHeading, drawerNav);
    sidebar.append(drawerApps);

    /* Title row inside the content sheet. Files (breadcrumb) and Calendar
       (month label) already title themselves, so they skip the heading. */
    const titled = workspaceMain.querySelector('.breadcrumb, .calendar-toolbar');
    const heading = document.createElement('div');
    heading.className = 'workspace-heading';
    if (!titled) {
      // Title follows the active sidebar item ("Favorites", "Work", "Account"…),
      // since the app name is already in the top bar.
      const title = document.createElement('h2');
      const sectionTitle = () => {
        const active = sidebar.querySelector('.folder-btn.active, .settings-tab.active');
        if (!active) return appName;
        const label = active.querySelector('.folder-label');
        return (label ? label.textContent : plainLabel(active)).trim() || appName;
      };
      const syncTitle = () => {
        const next = sectionTitle();
        if (title.textContent !== next) title.textContent = next;
      };
      syncTitle();
      new MutationObserver(syncTitle).observe(sidebar, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      heading.append(title);
    }
    const headingActions = document.createElement('div');
    headingActions.className = 'workspace-actions';
    heading.append(headingActions);

    const overflow = [...workspaceMain.querySelectorAll('[data-overflow]')];
    if (overflow.length) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'icon-btn page-more-btn';
      moreBtn.title = 'More actions';
      moreBtn.setAttribute('aria-label', 'More actions');
      moreBtn.setAttribute('aria-haspopup', 'menu');
      moreBtn.append(symbol('more_vert'));
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        const items = overflow
          .filter((el) => !el.hidden && !el.disabled && !el.closest('[hidden]:not([data-overflow])'))
          .map((el) => ({ label: plainLabel(el), icon: iconOf(el, 'chevron_right'), onClick: () => el.click() }));
        window.showContextMenu(rect.right - 280, rect.bottom + 6, items);
      });
      headingActions.append(moreBtn);
    }
    if (!titled) {
      workspaceMain.prepend(heading);
    } else if (overflow.length) {
      // Files' toolbar / Calendar's toolbar host the ⋮ menu directly.
      titled.closest('.toolbar, .calendar-toolbar').append(headingActions);
    }

    /* Menu button: collapses the sidebar on desktop, opens it as a drawer on
       mobile. */
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    function setDrawer(open) {
      sidebar.classList.toggle('is-open', open);
      backdrop.classList.toggle('is-open', open);
      document.body.classList.toggle('sidebar-drawer-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    }
    function syncMenuState() {
      if (mobileQuery.matches) {
        menuBtn.setAttribute('aria-expanded', String(sidebar.classList.contains('is-open')));
      } else {
        setDrawer(false);
        menuBtn.setAttribute('aria-expanded', String(!shell.classList.contains('sidebar-collapsed')));
      }
    }
    if (localStorage.getItem(COLLAPSED_KEY) === '1') shell.classList.add('sidebar-collapsed');
    syncMenuState();
    mobileQuery.addEventListener('change', syncMenuState);

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mobileQuery.matches) {
        setDrawer(!sidebar.classList.contains('is-open'));
        if (sidebar.classList.contains('is-open')) sidebar.querySelector('a, button')?.focus();
        return;
      }
      const collapsed = shell.classList.toggle('sidebar-collapsed');
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
      syncMenuState();
    });
    backdrop.addEventListener('click', () => setDrawer(false));
    sidebar.addEventListener('click', (e) => {
      if (!mobileQuery.matches) return;
      const target = e.target.closest('a, button');
      // "Manage folders"/"Manage groups"/"New" open something on top of the
      // drawer, and chevrons only expand a folder — keep the drawer for those.
      if (!target || target.matches('#manage-folders-btn, #manage-groups-btn, .compose-btn, .folder-chevron')) return;
      setDrawer(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
        setDrawer(false);
        menuBtn.focus();
      }
    });

    workspaceMain.id ||= 'main-content';
    workspaceMain.tabIndex = -1;
    const skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = `#${workspaceMain.id}`;
    skip.textContent = 'Skip to content';
    document.body.prepend(skip);
    document.querySelectorAll('input[type="search"]').forEach((input) => {
      if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', input.placeholder || 'Search');
    });
  }
  /* ---------- Top progress bar ----------
     Reference-counted so overlapping requests don't cut each other short:
     the bar creeps toward 90% while anything is in flight, then completes
     only once every pending operation has finished. */

  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-bar-fill';
  progressBar.appendChild(progressFill);
  document.body.appendChild(progressBar);

  let pending = 0;
  let creepTimer = null;
  let width = 0;

  function setWidth(pct) {
    width = pct;
    progressFill.style.width = `${pct}%`;
  }

  window.progress = {
    start() {
      pending += 1;
      if (pending > 1) return;

      clearInterval(creepTimer);
      document.body.classList.add('is-busy');
      progressBar.classList.add('active');
      setWidth(8);

      creepTimer = setInterval(() => {
        // Ease toward 90% and stop — the last 10% is reserved for completion.
        const step = Math.max(0.4, (90 - width) * 0.08);
        setWidth(Math.min(90, width + step));
      }, 120);
    },

    done() {
      pending = Math.max(0, pending - 1);
      if (pending > 0) return;

      clearInterval(creepTimer);
      creepTimer = null;
      document.body.classList.remove('is-busy');
      setWidth(100);

      setTimeout(() => {
        if (pending > 0) return;
        progressBar.classList.remove('active');
        setTimeout(() => {
          if (pending === 0) setWidth(0);
        }, 250);
      }, 180);
    },

    // Convenience wrapper so callers can't forget to call done().
    async track(promise) {
      window.progress.start();
      try {
        return await promise;
      } finally {
        window.progress.done();
      }
    },
  };

  // Cross-document navigations (nav links, the brand logo) also get the bar —
  // it simply unloads with the page, and the next page starts a fresh one.
  // Browsers with native View Transitions (Chromium/Safari, via the
  // @view-transition rule in style.css) crossfade the swap on their own.
  // Everyone else (Firefox today — flagged by theme.js as `no-vt` on <html>)
  // gets a short hand-rolled fade first so the switch doesn't feel instant.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    // Pure in-page anchors don't navigate.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

    window.progress.start();

    if (document.documentElement.classList.contains('no-vt')) {
      e.preventDefault();
      document.documentElement.classList.add('page-leaving');
      setTimeout(() => {
        location.href = url.href;
      }, 160);
    }
  });

  /* Shared top-bar account badge (name + optional profile picture), so all
     three pages render it identically from one /api/auth/me payload. */
  window.renderAccountBadge = function renderAccountBadge(data) {
    const nameEl = document.getElementById('account-username');
    if (nameEl && data.username) nameEl.textContent = data.username;

    const iconEl = document.querySelector('.account-icon');
    if (!iconEl) return;

    if (data.hasAvatar) {
      iconEl.classList.add('has-image');
      iconEl.textContent = '';
      const img = document.createElement('img');
      // Cache-bust so a freshly uploaded picture replaces the old one immediately.
      img.src = `/api/auth/avatar?t=${Date.now()}`;
      img.alt = '';
      iconEl.appendChild(img);
    } else {
      iconEl.classList.remove('has-image');
      iconEl.textContent = 'person';
    }
  };

  /* Shared right-click context menu — originally built for the Calendar's
     day-cell/event-pill menus, promoted here so files.js can reuse it
     without duplicating it. */
  let activeContextMenu = null;

  window.closeContextMenu = function closeContextMenu() {
    if (activeContextMenu) {
      activeContextMenu.remove();
      activeContextMenu = null;
    }
  };

  window.isContextMenuOpen = function isContextMenuOpen() {
    return Boolean(activeContextMenu);
  };

  // items: [{ label, icon, danger?, onClick }]
  window.showContextMenu = function showContextMenu(x, y, items) {
    window.closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `context-menu-item${item.danger ? ' danger' : ''}`;
      btn.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span>${item.label}`;
      btn.addEventListener('click', () => {
        window.closeContextMenu();
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
  };

  // A plain left click anywhere dismisses an open menu. Right-clicking a new
  // target reopens it there instead (showContextMenu already closes the old
  // one first) — no separate document-level "contextmenu" listener is
  // needed, and one would misfire anyway: the cell/pill's own handler runs
  // first and opens the new menu, then the same event bubbles to document.
  document.addEventListener('click', () => window.closeContextMenu());
  window.addEventListener('resize', () => window.closeContextMenu());
  window.addEventListener('scroll', () => window.closeContextMenu(), true);

  /* Feature toggles (Settings → Features): hides nav links for disabled
     features, and bounces away from a page whose own feature is off. Every
     page calls this once after signing in. Fails open on any error — a
     transient /api/features hiccup should never lock someone out of their
     own app. */
  window.applyFeatureGate = async function applyFeatureGate() {
    let features;
    try {
      const res = await fetch('/api/features');
      if (!res.ok) return;
      features = await res.json();
    } catch {
      return;
    }

    document.querySelectorAll('nav.nav a[data-feature]').forEach((link) => {
      if (features[link.dataset.feature] === false) link.hidden = true;
    });

    const pageFeature = appShellFeature();
    if (pageFeature && features[pageFeature] === false) {
      const fallbacks = [
        ['bookmarks', 'index.html'],
        ['contacts', 'contacts.html'],
        ['calendar', 'calendar.html'],
        ['files', 'files.html'],
        ['passwords', 'passwords.html'],
      ];
      const match = fallbacks.find(([key]) => features[key] !== false);
      location.replace(match ? match[1] : 'settings.html');
    }
  };

  function appShellFeature() {
    const shell = document.getElementById('app-shell');
    return shell ? shell.dataset.pageFeature || null : null;
  }

  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  toastContainer.setAttribute('role', 'status');
  toastContainer.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastContainer);

  window.showToast = function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop confirm-backdrop';
  backdrop.innerHTML = `
    <div class="modal confirm-modal">
      <p class="confirm-message"></p>
      <div class="modal-actions">
        <button type="button" class="secondary confirm-cancel">Cancel</button>
        <button type="button" class="confirm-ok">Confirm</button>
      </div>
      <div class="danger-bar" hidden>
        <span class="material-symbols-outlined">warning</span>
        <span class="confirm-danger-text"></span>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const messageEl = backdrop.querySelector('.confirm-message');
  const okBtn = backdrop.querySelector('.confirm-ok');
  const cancelBtn = backdrop.querySelector('.confirm-cancel');
  const dangerBar = backdrop.querySelector('.danger-bar');
  const dangerBarText = backdrop.querySelector('.confirm-danger-text');
  let resolveFn = null;

  function close(result) {
    backdrop.classList.remove('is-open');
    if (resolveFn) {
      resolveFn(result);
      resolveFn = null;
    }
  }

  okBtn.addEventListener('click', () => close(true));
  cancelBtn.addEventListener('click', () => close(false));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('is-open')) close(false);
  });

  // `irreversible` adds the same red bottom-bar warning strip used in the
  // app's other high-stakes dialogs (delete account, reset instance) —
  // pass a string to customize the wording, or `true` for the generic one,
  // for actions like deleting a user or another genuinely un-undoable
  // confirm that goes through this shared dialog rather than a bespoke one.
  window.confirmDialog = function confirmDialog(message, { danger = false, irreversible = false } = {}) {
    messageEl.textContent = message;
    okBtn.className = danger ? 'danger confirm-ok' : 'confirm-ok';
    if (irreversible) {
      dangerBarText.textContent = typeof irreversible === 'string' ? irreversible : 'This action is permanent and cannot be undone.';
      dangerBar.hidden = false;
    } else {
      dangerBar.hidden = true;
    }
    backdrop.classList.add('is-open');
    okBtn.focus();
    return new Promise((resolve) => {
      resolveFn = resolve;
    });
  };

  /* Top-bar account menu: click the badge to reveal "Account settings" /
     "Sign out" so signing out no longer means digging into Settings first. */
  function initAccountMenu() {
    const trigger = document.getElementById('account-menu-trigger');
    const dropdown = document.getElementById('account-dropdown');
    if (!trigger || !dropdown) return;

    function closeMenu() {
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('open')) closeMenu();
      else openMenu();
    });
    document.addEventListener('click', (e) => {
      if (dropdown.classList.contains('open') && !dropdown.contains(e.target) && e.target !== trigger) {
        closeMenu();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    const signOutBtn = document.getElementById('account-sign-out-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        closeMenu();
        const confirmed = await window.confirmDialog('Sign out of SyncMark?');
        if (!confirmed) return;
        window.progress.start();
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
          window.progress.done();
        }
        location.href = 'index.html';
      });
    }
  }

  /* Long-press → context menu: calendar.js and files.js already listen for
     the "contextmenu" event (not a mouse-specific one), so synthesizing that
     same event after a touch-and-hold makes their existing quick-action
     menus work on touch with zero changes to either file. */
  function initLongPressContextMenu() {
    const HOLD_MS = 500;
    const MOVE_TOLERANCE = 10;
    let timer = null;
    let start = null;

    function cancel() {
      clearTimeout(timer);
      timer = null;
      start = null;
    }

    document.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return cancel();
        const touch = e.touches[0];
        start = { x: touch.clientX, y: touch.clientY, target: e.target };
        timer = setTimeout(() => {
          if (!start) return;
          const target = document.elementFromPoint(start.x, start.y) || start.target;
          target.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: start.x,
              clientY: start.y,
            })
          );
          cancel();
        }, HOLD_MS);
      },
      { passive: true }
    );

    document.addEventListener(
      'touchmove',
      (e) => {
        if (!start) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - start.x) > MOVE_TOLERANCE || Math.abs(touch.clientY - start.y) > MOVE_TOLERANCE) cancel();
      },
      { passive: true }
    );

    document.addEventListener('touchend', cancel, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
  }

  /* Light/dark toggle: injected into every page's top bar (just before the
     account menu); the sign-in screen renders its own .theme-toggle. One
     delegated listener drives both through theme.js's setTheme(). */
  function themeToggleIcon() {
    // Shows the theme you'd switch *to*, like most OS quick toggles.
    return window.getTheme() === 'dark' ? 'light_mode' : 'dark_mode';
  }

  function themeToggleLabel() {
    return window.getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  function syncThemeToggles(animate) {
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = themeToggleIcon();
      btn.title = themeToggleLabel();
      btn.setAttribute('aria-label', themeToggleLabel());
      if (animate) {
        btn.classList.remove('is-switching');
        void btn.offsetWidth; // restart the icon swap animation
        btn.classList.add('is-switching');
      }
    });
  }

  window.syncThemeToggles = syncThemeToggles;

  function initThemeToggle() {
    const actions = document.querySelector('.topbar-actions');
    if (actions && !actions.querySelector('.theme-toggle')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-toggle';
      btn.innerHTML = '<span class="material-symbols-outlined"></span>';
      actions.insertBefore(btn, actions.querySelector('.account-menu'));
    }
    syncThemeToggles(false);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-toggle');
    if (!btn) return;
    window.setTheme(window.getTheme() === 'dark' ? 'light' : 'dark', btn);
  });

  document.addEventListener('syncmark:themechange', () => syncThemeToggles(true));

  document.addEventListener('animationend', (e) => {
    if (e.animationName === 'themeIconSwap') e.target.closest('.theme-toggle')?.classList.remove('is-switching');
  });

  /* Staggered list entrances: rows/cards rendered in one go get an
     increasing --stagger index (style.css turns it into animation-delay),
     so a fresh render ripples down instead of appearing all at once. */
  function initListStagger() {
    const STAGGER_CAP = 14;
    const pending = new Set();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && (node.tagName === 'TR' || node.classList.contains('bookmark-card'))) {
            pending.add(node);
          }
        }
      }
      if (!pending.size) return;
      let i = 0;
      for (const node of pending) {
        if (node.isConnected) node.style.setProperty('--stagger', String(Math.min(i++, STAGGER_CAP)));
      }
      pending.clear();
    });

    document.querySelectorAll('tbody, .bookmark-grid').forEach((list) => {
      observer.observe(list, { childList: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAccountMenu();
      initThemeToggle();
      initListStagger();
    });
  } else {
    initAccountMenu();
    initThemeToggle();
    initListStagger();
  }
  initLongPressContextMenu();

  /* Global page-load fade-in: once #app-shell becomes visible (either right
     away, for an already-signed-in reload, or after auth.js reveals it),
     stagger a brief entrance across each page's top-level blocks so the
     whole page feels like it animates in, not just list rows. */
  function applyContentFadeIn() {
    const shell = document.getElementById('app-shell');
    if (!shell) return;
    // .sidebar is deliberately excluded: on mobile it's a drawer positioned
    // via `transform` (closed by default), and this fade-in's own
    // translateY animation — with fill-mode "both" — would permanently
    // override that transform once the animation ends, leaving the drawer
    // stuck open with no way to close it.
    const targets = shell.querySelectorAll('.topbar, .content > *');
    targets.forEach((el, i) => {
      el.classList.add('content-fade-in');
      el.style.animationDelay = `${Math.min(i * 40, 200)}ms`;
    });
  }

  const shellEl = document.getElementById('app-shell');
  if (shellEl) {
    if (!shellEl.hidden) {
      applyContentFadeIn();
    } else {
      const shellObserver = new MutationObserver(() => {
        if (!shellEl.hidden) {
          applyContentFadeIn();
          shellObserver.disconnect();
        }
      });
      shellObserver.observe(shellEl, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  /* Livelier buttons: a small delegated ripple from the click position, no
     library — position via CSS custom properties, animation lives in
     style.css (and is skipped entirely under prefers-reduced-motion). */
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button, .button');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty('--ripple-x', `${e.clientX - rect.left}px`);
    btn.style.setProperty('--ripple-y', `${e.clientY - rect.top}px`);
    btn.classList.remove('rippling');
    void btn.offsetWidth; // force reflow so re-adding the class restarts the animation
    btn.classList.add('rippling');
  });

  document.addEventListener('animationend', (e) => {
    if (e.animationName === 'buttonRipple') e.target.classList.remove('rippling');
  });
})();
