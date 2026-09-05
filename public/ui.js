(function () {
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
    </div>`;
  document.body.appendChild(backdrop);

  const messageEl = backdrop.querySelector('.confirm-message');
  const okBtn = backdrop.querySelector('.confirm-ok');
  const cancelBtn = backdrop.querySelector('.confirm-cancel');
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

  window.confirmDialog = function confirmDialog(message, { danger = false } = {}) {
    messageEl.textContent = message;
    okBtn.className = danger ? 'danger confirm-ok' : 'confirm-ok';
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

  /* Mobile nav: injects a hamburger button before .nav so the 5 top-level
     links collapse into a dropdown below the mobile breakpoint instead of
     wrapping in place — CSS (.mobile-nav-toggle / .nav.nav-open) does the
     rest. No-ops harmlessly if .nav isn't on the page. */
  function initMobileNav() {
    const nav = document.querySelector('.nav');
    const topbarLeft = document.querySelector('.topbar-left');
    if (!nav || !topbarLeft) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn mobile-nav-toggle';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="material-symbols-outlined">menu</span>';
    topbarLeft.insertBefore(toggle, nav);

    function closeNav() {
      nav.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeNav();
    });
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('nav-open') && !nav.contains(e.target) && e.target !== toggle) closeNav();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNav();
    });
  }

  /* Mobile sidebar drawer: only runs on pages with a .sidebar (Bookmarks/
     Contacts/Files — not Calendar or Settings). Injects a toggle button at
     the top of .content, labeled from the sidebar's own heading, plus a
     backdrop appended to body. CSS (.sidebar.is-open / .sidebar-backdrop)
     does the actual slide-in. */
  function initSidebarDrawer() {
    const sidebar = document.querySelector('.sidebar');
    const content = document.querySelector('.content');
    if (!sidebar || !content) return;

    const label = sidebar.querySelector('.sidebar-header h2')?.textContent || 'Menu';

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'button secondary mobile-sidebar-toggle';
    toggle.innerHTML = `<span class="material-symbols-outlined">menu</span>${label}`;
    content.insertBefore(toggle, content.firstChild);

    function closeSidebar() {
      sidebar.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      document.body.classList.remove('sidebar-drawer-open');
    }

    toggle.addEventListener('click', () => {
      sidebar.classList.add('is-open');
      backdrop.classList.add('is-open');
      document.body.classList.add('sidebar-drawer-open');
    });
    backdrop.addEventListener('click', closeSidebar);
    sidebar.addEventListener('click', (e) => {
      const target = e.target.closest('a, button');
      // "Manage folders"/"Manage groups" open their own modal on top of the
      // drawer — closing the drawer out from under that modal would be
      // jarring, so only real navigation (everything else) closes it.
      if (!target || target.id === 'manage-folders-btn' || target.id === 'manage-groups-btn') return;
      closeSidebar();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSidebar();
    });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAccountMenu();
      initMobileNav();
      initSidebarDrawer();
    });
  } else {
    initAccountMenu();
    initMobileNav();
    initSidebarDrawer();
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
