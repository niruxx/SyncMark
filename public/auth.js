(function () {
  const nextScriptSrc = document.currentScript.dataset.next;
  const appShell = document.getElementById('app-shell');

  const page = document.createElement('div');
  page.className = 'auth-page';
  page.innerHTML = `
    <div class="auth-bg" aria-hidden="true"></div>
    <div class="auth-card">
      <div class="auth-brand">
        <span class="material-symbols-outlined">bookmarks</span>
        SyncMark
      </div>
      <p class="auth-tagline">Your personal, self-hosted hub for bookmarks, contacts, and calendar.</p>
      <div class="lock-icon"><span class="material-symbols-outlined" id="lock-icon">lock</span></div>
      <h2 id="lock-heading">Sign in</h2>
      <p class="lock-subtitle" id="lock-subtitle">Enter your username and password to unlock SyncMark.</p>
      <form id="lock-form">
        <div id="setup-step-1">
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
        </div>

        <div id="setup-step-2" hidden>
          <p class="lock-subtitle">Choose what to turn on — you can change this anytime in Settings.</p>
          <div class="feature-toggle-group">
            <button type="button" class="feature-toggle-btn is-on" id="feature-bookmarks-input" aria-pressed="true">
              <span class="material-symbols-outlined">bookmark</span>
              Bookmarks
            </button>
            <button type="button" class="feature-toggle-btn is-on" id="feature-contacts-input" aria-pressed="true">
              <span class="material-symbols-outlined">contacts</span>
              Contacts (+ CardDAV sync)
            </button>
            <button type="button" class="feature-toggle-btn is-on" id="feature-calendar-input" aria-pressed="true">
              <span class="material-symbols-outlined">calendar_month</span>
              Calendar (+ CalDAV sync)
            </button>
            <button type="button" class="feature-toggle-btn" id="feature-files-input" aria-pressed="false">
              <span class="material-symbols-outlined">folder</span>
              Files (off by default — the one feature that reads/writes the host filesystem)
            </button>
          </div>
        </div>

        <p class="modal-error" id="lock-error" hidden></p>
        <div class="auth-step-actions">
          <button type="button" id="lock-back-btn" class="secondary" hidden>Back</button>
          <button type="submit" id="lock-submit" class="auth-submit">Sign in</button>
        </div>
      </form>
      <p class="lock-footnote" id="lock-forgot-hint" hidden>
        Forgot your password? An operator with shell access to the server can run
        <code>npm run reset-password</code> — see the README.
      </p>
      <div class="auth-feature-strip">
        <span><span class="material-symbols-outlined">bookmark</span>Bookmarks</span>
        <span><span class="material-symbols-outlined">contacts</span>Contacts</span>
        <span><span class="material-symbols-outlined">calendar_month</span>Calendar</span>
        <span><span class="material-symbols-outlined">folder</span>Files</span>
      </div>
    </div>`;
  document.body.appendChild(page);

  const icon = page.querySelector('#lock-icon');
  const heading = page.querySelector('#lock-heading');
  const subtitle = page.querySelector('#lock-subtitle');
  const form = page.querySelector('#lock-form');
  const step1 = page.querySelector('#setup-step-1');
  const step2 = page.querySelector('#setup-step-2');
  const usernameInput = page.querySelector('#lock-username');
  const passwordInput = page.querySelector('#lock-password');
  const confirmWrap = page.querySelector('#lock-confirm-wrap');
  const confirmInput = page.querySelector('#lock-confirm');
  const featureBookmarksInput = page.querySelector('#feature-bookmarks-input');
  const featureContactsInput = page.querySelector('#feature-contacts-input');
  const featureCalendarInput = page.querySelector('#feature-calendar-input');
  const featureFilesInput = page.querySelector('#feature-files-input');
  const errorEl = page.querySelector('#lock-error');
  const backBtn = page.querySelector('#lock-back-btn');
  const submitBtn = page.querySelector('#lock-submit');
  const forgotHint = page.querySelector('#lock-forgot-hint');
  const featureToggleBtns = [featureBookmarksInput, featureContactsInput, featureCalendarInput, featureFilesInput];

  function setPressed(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
  }

  function isPressed(btn) {
    return btn.getAttribute('aria-pressed') === 'true';
  }

  for (const btn of featureToggleBtns) {
    btn.addEventListener('click', () => setPressed(btn, !isPressed(btn)));
  }

  let mode = 'login';
  let step = 1;

  function showSetupStep(newStep) {
    step = newStep;
    step1.hidden = step !== 1;
    step2.hidden = step !== 2;
    backBtn.hidden = step !== 2;
    submitBtn.textContent = step === 1 ? 'Continue' : 'Create account & sign in';
    errorEl.hidden = true;
    if (step === 1) usernameInput.focus();
  }

  function showPage(newMode) {
    mode = newMode;
    if (mode === 'setup') {
      icon.textContent = 'waving_hand';
      heading.textContent = 'Welcome to SyncMark';
      subtitle.textContent = "Let's set up the account that keeps your data yours — pick a username and password to get started.";
      confirmWrap.hidden = false;
      confirmInput.required = true;
      passwordInput.minLength = 8;
      passwordInput.autocomplete = 'new-password';
      forgotHint.hidden = true;
      showSetupStep(1);
    } else {
      icon.textContent = 'lock';
      heading.textContent = 'Welcome back';
      subtitle.textContent = 'Sign in to unlock SyncMark.';
      confirmWrap.hidden = true;
      confirmInput.required = false;
      passwordInput.minLength = 0;
      passwordInput.autocomplete = 'current-password';
      step1.hidden = false;
      step2.hidden = true;
      backBtn.hidden = true;
      submitBtn.textContent = 'Sign in';
      forgotHint.hidden = false;
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

  backBtn.addEventListener('click', () => showSetupStep(1));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (mode === 'setup' && step === 1) {
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
      if (!username) {
        errorEl.textContent = 'Username is required.';
        errorEl.hidden = false;
        return;
      }
      showSetupStep(2);
      return;
    }

    let features;
    if (mode === 'setup') {
      features = {
        bookmarks: isPressed(featureBookmarksInput),
        contacts: isPressed(featureContactsInput),
        calendar: isPressed(featureCalendarInput),
        files: isPressed(featureFilesInput),
      };
      if (!features.bookmarks && !features.contacts && !features.calendar && !features.files) {
        errorEl.textContent = 'Turn on at least one feature to continue.';
        errorEl.hidden = false;
        return;
      }
    }

    submitBtn.disabled = true;
    progress.start();
    try {
      const body = mode === 'setup' ? { username, password, features } : { username, password };
      const res = await fetch(`/api/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).finally(() => progress.done());
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error || 'Something went wrong');
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
