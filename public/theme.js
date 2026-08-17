(function () {
  const root = document.documentElement;

  const theme = localStorage.getItem('syncmark:theme') || 'light';
  root.setAttribute('data-theme', theme);

  // Chrome/Safari animate cross-document navigations natively via @view-transition.
  // Browsers without it (Firefox today) get an equivalent hand-rolled fade instead —
  // flagged here, before first paint, so the two never double up.
  const supportsViewTransitions =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('view-transition-name', 'none');

  if (!supportsViewTransitions) root.classList.add('no-vt');
})();
