(function () {
  const root = document.documentElement;

  // Dark is the default until someone picks otherwise.
  let theme = 'dark';
  try {
    theme = localStorage.getItem('syncmark:theme') || 'dark';
  } catch {}
  root.setAttribute('data-theme', theme);

  let scheme = 'blue';
  try {
    scheme = localStorage.getItem('syncmark:colorScheme') || 'blue';
  } catch {}
  root.setAttribute('data-scheme', scheme);

  // Chrome/Safari animate cross-document navigations natively via @view-transition.
  // Browsers without it (Firefox today) get an equivalent hand-rolled fade instead —
  // flagged here, before first paint, so the two never double up.
  const supportsViewTransitions =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('view-transition-name', 'none');

  if (!supportsViewTransitions) root.classList.add('no-vt');

  window.getTheme = function getTheme() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  };

  /* The one place the light/dark theme changes — the top-bar toggle, the
     Settings select and the setup wizard all go through here, and listen for
     `syncmark:themechange` to keep their own controls in sync. `origin` (an
     element or {x, y}) is where the circular reveal grows from. */
  window.setTheme = function setTheme(next, origin) {
    next = next === 'light' ? 'light' : 'dark';
    try {
      localStorage.setItem('syncmark:theme', next);
    } catch {}
    if (next === window.getTheme()) return;

    const apply = () => {
      root.setAttribute('data-theme', next);
      document.dispatchEvent(new CustomEvent('syncmark:themechange', { detail: { theme: next } }));
    };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      apply();
      return;
    }

    if (typeof document.startViewTransition !== 'function') {
      root.classList.add('theme-fade');
      apply();
      setTimeout(() => root.classList.remove('theme-fade'), 400);
      return;
    }

    let x = window.innerWidth / 2;
    let y = 0;
    if (origin && typeof origin.getBoundingClientRect === 'function') {
      const rect = origin.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else if (origin && typeof origin.x === 'number') {
      ({ x, y } = origin);
    }
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    root.classList.add('theme-transition');
    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: 560,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            pseudoElement: '::view-transition-new(root)',
          }
        );
      })
      .catch(() => {});
    transition.finished.finally(() => root.classList.remove('theme-transition'));
  };
})();
