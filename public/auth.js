(function () {
  const nextScriptSrc = document.currentScript.dataset.next;
  const appShell = document.getElementById('app-shell');

  const SCHEMES = [
    { value: 'blue', label: 'Blue', dot: '#0b57d0' },
    { value: 'green', label: 'Green', dot: '#146c2e' },
    { value: 'purple', label: 'Purple', dot: '#6750a4' },
    { value: 'orange', label: 'Orange', dot: '#8b5000' },
    { value: 'rose', label: 'Rose', dot: '#984061' },
  ];

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

          <div id="admin-account-section" hidden>
            <p class="lock-subtitle auth-section-heading">Administrator account</p>
            <p class="settings-hint">
              A separate admin login (username <strong>admin</strong>) manages users from the Admin Portal —
              it's not the account you're creating above, and has no bookmarks/contacts of its own.
            </p>
            <label>
              Admin password
              <input type="password" id="admin-password" autocomplete="new-password" />
            </label>
            <label>
              Confirm admin password
              <input type="password" id="admin-confirm" autocomplete="new-password" />
            </label>
            <div class="danger-bar">
              <span class="material-symbols-outlined">warning</span>
              This account has full administrative control over every user and every piece of data on this instance — keep it safe.
            </div>
          </div>
        </div>

        <div id="setup-step-2" hidden>
          <div class="scheme-picker" id="scheme-picker">
            ${SCHEMES.map(
              (s, i) => `
              <button type="button" class="scheme-swatch${i === 0 ? ' is-selected' : ''}" data-scheme="${s.value}" aria-pressed="${i === 0}">
                <span class="scheme-swatch-dot" style="background:${s.dot}"></span>
                ${s.label}
              </button>`
            ).join('')}
          </div>
        </div>

        <div id="setup-step-3" hidden>
          <div class="theme-picker" id="theme-picker">
            <button type="button" class="theme-option is-selected" data-theme-choice="light" aria-pressed="true">
              <span class="material-symbols-outlined">light_mode</span>
              Light
            </button>
            <button type="button" class="theme-option" data-theme-choice="dark" aria-pressed="false">
              <span class="material-symbols-outlined">dark_mode</span>
              Dark
            </button>
          </div>
        </div>

        <div id="setup-step-4" hidden>
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
            <button type="button" class="feature-toggle-btn" id="feature-passwords-input" aria-pressed="false">
              <span class="material-symbols-outlined">key</span>
              Passwords (off by default — a personal password manager)
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
        <span><span class="material-symbols-outlined">key</span>Passwords</span>
      </div>
    </div>`;
  document.body.appendChild(page);

  const icon = page.querySelector('#lock-icon');
  const heading = page.querySelector('#lock-heading');
  const subtitle = page.querySelector('#lock-subtitle');
  const form = page.querySelector('#lock-form');
  const steps = [
    page.querySelector('#setup-step-1'),
    page.querySelector('#setup-step-2'),
    page.querySelector('#setup-step-3'),
    page.querySelector('#setup-step-4'),
  ];
  const usernameInput = page.querySelector('#lock-username');
  const passwordInput = page.querySelector('#lock-password');
  const confirmWrap = page.querySelector('#lock-confirm-wrap');
  const confirmInput = page.querySelector('#lock-confirm');
  const adminSection = page.querySelector('#admin-account-section');
  const adminPasswordInput = page.querySelector('#admin-password');
  const adminConfirmInput = page.querySelector('#admin-confirm');
  const schemePicker = page.querySelector('#scheme-picker');
  const themePicker = page.querySelector('#theme-picker');
  const featureBookmarksInput = page.querySelector('#feature-bookmarks-input');
  const featureContactsInput = page.querySelector('#feature-contacts-input');
  const featureCalendarInput = page.querySelector('#feature-calendar-input');
  const featureFilesInput = page.querySelector('#feature-files-input');
  const featurePasswordsInput = page.querySelector('#feature-passwords-input');
  const errorEl = page.querySelector('#lock-error');
  const backBtn = page.querySelector('#lock-back-btn');
  const submitBtn = page.querySelector('#lock-submit');
  const forgotHint = page.querySelector('#lock-forgot-hint');
  const featureToggleBtns = [
    featureBookmarksInput,
    featureContactsInput,
    featureCalendarInput,
    featureFilesInput,
    featurePasswordsInput,
  ];
  const SETUP_STEP_COUNT = steps.length;

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

  // Both pickers apply their choice live (to the whole page, not just a
  // preview swatch) so picking a scheme/theme during setup shows exactly
  // what signing in will look like, and persist immediately — same
  // "commit on change" behavior Settings → Appearance already uses, so
  // there's no separate save step and no chance of losing the choice if
  // setup is abandoned partway through.
  schemePicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.scheme-swatch');
    if (!btn) return;
    for (const b of schemePicker.querySelectorAll('.scheme-swatch')) {
      b.classList.toggle('is-selected', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    }
    document.documentElement.setAttribute('data-scheme', btn.dataset.scheme);
    localStorage.setItem('syncmark:colorScheme', btn.dataset.scheme);
  });

  themePicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-option');
    if (!btn) return;
    for (const b of themePicker.querySelectorAll('.theme-option')) {
      b.classList.toggle('is-selected', b === btn);
      b.setAttribute('aria-pressed', String(b === btn));
    }
    document.documentElement.setAttribute('data-theme', btn.dataset.themeChoice);
    localStorage.setItem('syncmark:theme', btn.dataset.themeChoice);
  });

  let mode = 'login';
  let step = 1;

  const SETUP_STEP_SUBTITLES = [
    "Let's set up the account that keeps your data yours — pick a username and password to get started.",
    'Choose a color scheme — you can change this anytime in Settings.',
    'Light or dark? You can change this anytime in Settings.',
    'Choose what to turn on — you can change this anytime in Settings.',
  ];

  // Slides the newly-shown step in from the direction it conceptually came
  // from (right when advancing, left when going back) — same "toggling
  // [hidden] off replays the animation fresh" trick .settings-tab-panel's
  // revealDown already relies on, just directional here so progressing
  // through the wizard reads as movement rather than four unrelated screens.
  function showSetupStep(newStep) {
    const direction = newStep > step ? 'forward' : 'back';
    step = newStep;
    steps.forEach((el, i) => {
      const isCurrent = i === step - 1;
      el.hidden = !isCurrent;
      el.classList.remove('step-enter-forward', 'step-enter-back');
      if (isCurrent) el.classList.add(direction === 'forward' ? 'step-enter-forward' : 'step-enter-back');
    });
    subtitle.textContent = SETUP_STEP_SUBTITLES[step - 1];
    backBtn.hidden = step === 1;
    submitBtn.textContent = step === SETUP_STEP_COUNT ? 'Create account & sign in' : 'Continue';
    errorEl.hidden = true;
    if (step === 1) usernameInput.focus();
  }

  function showPage(newMode) {
    mode = newMode;
    if (mode === 'setup') {
      icon.textContent = 'waving_hand';
      heading.textContent = 'Welcome to SyncMark';
      confirmWrap.hidden = false;
      confirmInput.required = true;
      adminSection.hidden = false;
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
      adminSection.hidden = true;
      passwordInput.minLength = 0;
      passwordInput.autocomplete = 'current-password';
      steps.forEach((el, i) => {
        el.hidden = i !== 0;
      });
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

  backBtn.addEventListener('click', () => showSetupStep(step - 1));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (mode === 'setup' && step === 1) {
      if (!username) {
        errorEl.textContent = 'Username is required.';
        errorEl.hidden = false;
        return;
      }
      if (username.toLowerCase() === 'admin') {
        errorEl.textContent = '"admin" is reserved for the administrator account below — pick a different username.';
        errorEl.hidden = false;
        return;
      }
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
      if (adminPasswordInput.value.length < 8) {
        errorEl.textContent = 'Admin password must be at least 8 characters.';
        errorEl.hidden = false;
        return;
      }
      if (adminPasswordInput.value !== adminConfirmInput.value) {
        errorEl.textContent = 'Admin passwords do not match.';
        errorEl.hidden = false;
        return;
      }
      showSetupStep(2);
      return;
    }

    if (mode === 'setup' && step < SETUP_STEP_COUNT) {
      showSetupStep(step + 1);
      return;
    }

    let features;
    if (mode === 'setup') {
      features = {
        bookmarks: isPressed(featureBookmarksInput),
        contacts: isPressed(featureContactsInput),
        calendar: isPressed(featureCalendarInput),
        files: isPressed(featureFilesInput),
        passwords: isPressed(featurePasswordsInput),
      };
      if (!features.bookmarks && !features.contacts && !features.calendar && !features.files && !features.passwords) {
        errorEl.textContent = 'Turn on at least one feature to continue.';
        errorEl.hidden = false;
        return;
      }
    }

    submitBtn.disabled = true;
    progress.start();
    try {
      const body =
        mode === 'setup'
          ? { username, password, adminPassword: adminPasswordInput.value, features }
          : { username, password };
      const res = await fetch(`/api/auth/${mode === 'setup' ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).finally(() => progress.done());
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseBody.error || 'Something went wrong');
      form.reset();

      // Admin accounts have no personal workspace — they land in the Admin
      // Portal instead of whichever page they happened to sign in from.
      const onAdminPage = location.pathname.endsWith('/admin.html');
      if (responseBody.role === 'admin' && !onAdminPage) {
        location.href = 'admin.html';
        return;
      }
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
        // A page loaded directly (not via the login form) still needs the
        // same admin/non-admin routing — an admin bookmarking index.html, or
        // a regular user's stale tab still pointed at admin.html.
        const onAdminPage = location.pathname.endsWith('/admin.html');
        if (status.role === 'admin' && !onAdminPage) {
          location.replace('admin.html');
          return;
        }
        if (status.role !== 'admin' && onAdminPage) {
          location.replace('index.html');
          return;
        }
        enterApp();
      }
    } catch {
      showPage('login');
    }
  }

  init();
})();
