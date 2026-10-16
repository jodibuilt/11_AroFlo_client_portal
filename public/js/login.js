import { api, errorBox, mount } from './common.js';

const form = document.getElementById('form');
const msg = document.getElementById('msg');
let setupMode = false;

const session = await api('/api/session');
if (session.user) location.href = '/';
document.getElementById('portal-name').textContent = session.portalName;
document.getElementById('mark').textContent = session.portalName.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
document.title = `Sign in · ${session.portalName}`;

if (session.needsSetup) {
  setupMode = true;
  document.getElementById('title').textContent = 'Create the first admin account';
  document.getElementById('intro').textContent = 'No users exist yet. This account will manage client logins in the Control Panel.';
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
  mount(msg);
  try {
    const body = { email: form.email.value, password: form.password.value };
    if (setupMode) Object.assign(body, { name: form.elements.namedItem('name').value, setupCode: form.setupCode.value });
    await api(setupMode ? '/api/setup' : '/api/login', { method: 'POST', body });
    location.href = setupMode ? '/admin' : '/';
  } catch (err) {
    mount(msg, errorBox(err.message));
    button.disabled = false;
  }
});
