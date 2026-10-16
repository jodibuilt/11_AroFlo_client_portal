import { api, errorBox, mount } from './common.js';

const form = document.getElementById('form');
const msg = document.getElementById('msg');
let setupMode = false;

const session = await api('/api/session');
if (session.user) location.href = '/';

if (session.needsSetup) {
  setupMode = true;
  document.title = 'Set up · TTS Built Client Portal';
  document.getElementById('title').textContent = 'Set up the portal';
  document.getElementById('intro').textContent = 'Create the first admin account. It manages client logins in the Control Panel.';
  document.getElementById('name-field').hidden = false;
  document.getElementById('code-field').hidden = !session.setupNeedsCode;
  form.password.autocomplete = 'new-password';
  form.password.placeholder = 'At least 8 characters';
  document.getElementById('submit').textContent = 'Create admin account';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = document.getElementById('submit');
  button.disabled = true;
  button.textContent = setupMode ? 'Creating account…' : 'Signing in…';
  mount(msg);
  try {
    const body = { email: form.email.value, password: form.password.value };
    if (setupMode) Object.assign(body, { name: form.elements.namedItem('name').value, setupCode: form.setupCode.value });
    await api(setupMode ? '/api/setup' : '/api/login', { method: 'POST', body });
    location.href = setupMode ? '/admin' : '/';
  } catch (err) {
    mount(msg, errorBox(err.message));
    button.disabled = false;
    button.textContent = setupMode ? 'Create admin account' : 'Sign in';
  }
});
