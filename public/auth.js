(function () {
  const nextScriptSrc = document.currentScript.dataset.next;
  const appShell = document.getElementById('app-shell');

  const page = document.createElement('div');
  page.className = 'auth-page';
  page.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">SyncMark</div>
      <div class="lock-icon" id="lock-icon">🔒</div>
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
      icon.textContent = '👋';
      heading.textContent = 'Welcome to SyncMark';
      subtitle.textContent = "Let's set up the account that keeps your bookmarks yours — pick a username and password to get started.";
      confirmWrap.hidden = false;
      confirmInput.required = true;
      passwordInput.minLength = 8;
      passwordInput.autocomplete = 'new-password';
      submitBtn.textContent = 'Create account & sign in';
    } else {
      icon.textContent = '🔒';
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
    page.remove();
    appShell.hidden = false;
    document.body.classList.add('bg-animated');
    const script = document.createElement('script');
    script.src = nextScriptSrc;
    document.body.appendChild(script);
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
    try {
      const res = await fetch(`/api/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
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
      const res = await fetch('/api/auth/status');
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
