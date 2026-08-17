const usernameForm = document.getElementById('username-form');
const newUsernameInput = document.getElementById('new-username-input');
const usernameCurrentPassword = document.getElementById('username-current-password');
const usernameError = document.getElementById('username-error');

const passwordForm = document.getElementById('password-form');
const passwordCurrentInput = document.getElementById('password-current-input');
const passwordNewInput = document.getElementById('password-new-input');
const passwordConfirmInput = document.getElementById('password-confirm-input');
const passwordError = document.getElementById('password-error');

const accountUsernameEl = document.getElementById('account-username');

const avatarPreview = document.getElementById('avatar-preview');
const avatarFile = document.getElementById('avatar-file');
const avatarRemoveBtn = document.getElementById('avatar-remove-btn');
const avatarError = document.getElementById('avatar-error');

async function api(path, options) {
  progress.start();
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } finally {
    progress.done();
  }
  if (res.status === 401) {
    location.reload();
    return new Promise(() => {});
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadAccount() {
  try {
    const data = await api('/auth/me');
    renderAccountBadge(data);
    newUsernameInput.placeholder = data.username;
    renderAvatarPreview(data.hasAvatar);
  } catch {
    /* leave placeholders as-is */
  }
}

// --- Profile picture ---

function renderAvatarPreview(hasAvatar) {
  avatarPreview.textContent = '';
  avatarRemoveBtn.hidden = !hasAvatar;

  if (hasAvatar) {
    const img = document.createElement('img');
    img.src = `/api/auth/avatar?t=${Date.now()}`;
    img.alt = 'Your profile picture';
    avatarPreview.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'person';
    avatarPreview.appendChild(icon);
  }
}

avatarFile.addEventListener('change', async () => {
  const file = avatarFile.files[0];
  if (!file) return;
  avatarError.hidden = true;

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    await api('/auth/avatar', { method: 'POST', body: formData });
    renderAvatarPreview(true);
    renderAccountBadge({ hasAvatar: true });
    showToast('Profile picture updated', 'success');
  } catch (err) {
    avatarError.textContent = err.message;
    avatarError.hidden = false;
  } finally {
    avatarFile.value = '';
  }
});

avatarRemoveBtn.addEventListener('click', async () => {
  const confirmed = await confirmDialog('Remove your profile picture?', { danger: true });
  if (!confirmed) return;
  avatarError.hidden = true;

  try {
    await api('/auth/avatar', { method: 'DELETE' });
    renderAvatarPreview(false);
    renderAccountBadge({ hasAvatar: false });
    showToast('Profile picture removed', 'success');
  } catch (err) {
    avatarError.textContent = err.message;
    avatarError.hidden = false;
  }
});

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  usernameError.hidden = true;

  try {
    const result = await api('/auth/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: newUsernameInput.value.trim(),
        currentPassword: usernameCurrentPassword.value,
      }),
    });
    usernameForm.reset();
    accountUsernameEl.textContent = result.username;
    newUsernameInput.placeholder = result.username;
    showToast('Username updated', 'success');
  } catch (err) {
    usernameError.textContent = err.message;
    usernameError.hidden = false;
  }
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  passwordError.hidden = true;

  if (passwordNewInput.value.length < 8) {
    passwordError.textContent = 'New password must be at least 8 characters.';
    passwordError.hidden = false;
    return;
  }
  if (passwordNewInput.value !== passwordConfirmInput.value) {
    passwordError.textContent = 'New passwords do not match.';
    passwordError.hidden = false;
    return;
  }

  try {
    await api('/auth/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newPassword: passwordNewInput.value,
        currentPassword: passwordCurrentInput.value,
      }),
    });
    passwordForm.reset();
    showToast('Password updated', 'success');
  } catch (err) {
    passwordError.textContent = err.message;
    passwordError.hidden = false;
  }
});

loadAccount();
