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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccountMenu);
  } else {
    initAccountMenu();
  }
})();
