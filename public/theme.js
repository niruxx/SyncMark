(function () {
  const theme = localStorage.getItem('syncmark:theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();
