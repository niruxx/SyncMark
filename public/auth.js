(function () {
  const nextScriptSrc = document.currentScript.dataset.next;
  const appShell = document.getElementById('app-shell');

  const page = document.createElement('div');
  page.className = 'auth-page';
  page.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <span class="material-symbols-outlined">bookmarks</span>
        SyncMark
      </div>
      <div class="lock-icon"><span class="material-symbols-outlined" id="lock-icon">lock</span></div>
      <h2 id="lock-heading">Sign in</h2>
      <p class="lock-subtitle" id="lock-subtitle">Enter your username and password to unlock SyncMark.</p>
      <form id="lock-form">
        <label>
          Username
          <input type="text" id="lock-username" required autocomplete="username" />
        </label>
        <label>
          Password
          <input type="password" id="lock-password" required autocomplete="current-password" />
        </label>
        <label id="lock-confirm-wrap" hidden>
          Confirm password
          <input type="password" id="lock-confirm" autocomplete="new-password" />
        </label>
        <p class="modal-error" id="lock-error" hidden></p>
        <button type="submit" id="lock-submit" class="auth-submit">Sign in</button>
      </form>
    </div>`;
  document.body.appendChild(page);

  const icon = page.querySelector('#lock-icon');
  const heading = page.querySelector('#lock-heading');
  const subtitle = page.querySelector('#lock-subtitle');
  const form = page.querySelector('#lock-form');
  const usernameInput = page.querySelector('#lock-username');
  const passwordInput = page.querySelector('#lock-password');
  const confirmWrap = page.querySelector('#lock-confirm-wrap');
  const confirmInput = page.querySelector('#lock-confirm');
  const errorEl = page.querySelector('#lock-error');
  const submitBtn = page.querySelector('#lock-submit');

  let mode = 'login';

  function showPage(newMode) {
    mode = newMode;
    if (mode === 'setup') {
      icon.textContent = 'waving_hand';
      heading.textContent = 'Welcome to SyncMark';
      subtitle.textContent = "Let's set up the account that keeps your bookmarks yours — pick a username and password to get started.";
      confirmWrap.hidden = false;
      confirmInput.required = true;
      passwordInput.minLength = 8;
      passwordInput.autocomplete = 'new-password';
      submitBtn.textContent = 'Create account & sign in';
    } else {
      icon.textContent = 'lock';
      heading.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to unlock your bookmarks.';
      confirmWrap.hidden = true;
      confirmInput.required = false;
      passwordInput.minLength = 0;
      passwordInput.autocomplete = 'current-password';
      submitBtn.textContent = 'Sign in';
    }
    errorEl.hidden = true;
    usernameInput.focus();
  }

  function enterApp() {
    const reveal = () => {
      page.remove();
      appShell.hidden = false;
      document.body.classList.add('bg-animated');
      const script = document.createElement('script');
      script.src = nextScriptSrc;
      document.body.appendChild(script);
    };

    // Same-document swap (auth card -> app), distinct from the cross-document
    // navigation transition handled in ui.js/style.css. Chromium/Safari get a
    // native crossfade; everyone else gets a short hand-rolled one so the
    // handoff never feels instant either way.
    if (typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(reveal);
      // `.ready`/`.finished` reject (e.g. AbortError) when the browser skips
      // the transition outright — the reveal callback still runs either way,
      // so that's not an error worth surfacing, just one to not let go unhandled.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
      return;
    }

    page.classList.add('auth-page-leaving');
    setTimeout(() => {
      reveal();
      appShell.classList.add('app-shell-entering');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => appShell.classList.remove('app-shell-entering'));
      });
    }, 220);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (mode === 'setup') {
      if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        errorEl.hidden = false;
        return;
      }
      if (password !== confirmInput.value) {
        errorEl.textContent = 'Passwords do not match.';
        errorEl.hidden = false;
        return;
      }
    }

    submitBtn.disabled = true;
    progress.start();
    try {
      const res = await fetch(`/api/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }).finally(() => progress.done());
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong');
      form.reset();
      enterApp();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  async function init() {
    try {
      progress.start();
      const res = await fetch('/api/auth/status').finally(() => progress.done());
      const status = await res.json();
      if (status.setupRequired) {
        showPage('setup');
      } else if (!status.authenticated) {
        showPage('login');
      } else {
        enterApp();
      }
    } catch {
      showPage('login');
    }
  }

  init();
})();
