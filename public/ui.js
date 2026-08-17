(function () {
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
})();
