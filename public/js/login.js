import { api, errorBox, h, mount } from './common.js';

const form = document.getElementById('form');
const msg = document.getElementById('msg');
let setupMode = false;

const session = await api('/api/session');
if (session.user) location.href = '/';

// First run only: the setup fields are added to the page when needed, never sent in it.
if (session.needsSetup) {
  setupMode = true;
  document.title = 'Set up · TTS Built Client Portal';
  document.getElementById('title').textContent = 'Set up the portal';
  document.getElementById('intro').textContent = 'Create the first admin account. It manages client logins in the Control Panel.';
  form.prepend(
    session.setupNeedsCode ? h('label', { class: 'field' }, h('span', {}, 'Setup code'), h('input', { type: 'text', name: 'setupCode', autocomplete: 'off' })) : '',
    h('label', { class: 'field' }, h('span', {}, 'Your name'), h('input', { type: 'text', name: 'name', autocomplete: 'name' })),
  );
  form.password.autocomplete = 'new-password';
  form.password.placeholder = 'At least 10 characters';
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
    if (setupMode) Object.assign(body, { name: form.elements.namedItem('name').value, setupCode: form.elements.namedItem('setupCode')?.value });
    const result = await api(setupMode ? '/api/setup' : '/api/login', { method: 'POST', body });
    if (result.mfa) return showSecondStep(result);
    location.href = '/';
  } catch (err) {
    mount(msg, errorBox(err.message));
    button.disabled = false;
    button.textContent = setupMode ? 'Create admin account' : 'Sign in';
  }
});

// Admins confirm with a code from their authenticator app. The first time, they add
// the portal to the app by scanning the QR code (or typing the key).
function showSecondStep({ mfa, ticket, key, qr }) {
  const enrolling = mfa === 'enroll';
  document.title = 'Two-factor sign-in · TTS Built Client Portal';
  document.getElementById('title').textContent = enrolling ? 'Set up two-factor sign-in' : 'Enter your sign-in code';
  document.getElementById('intro').textContent = enrolling
    ? 'Admin accounts need a code from an authenticator app (such as Microsoft or Google Authenticator) as well as a password. Scan this QR code with the app, then enter the 6-digit code it shows.'
    : 'Open your authenticator app and enter the 6-digit code shown for TTS Built Portal.';
  mount(msg);

  const code = h('input', { type: 'text', name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', required: true });
  const button = h('button', { class: 'btn primary', type: 'submit' }, enrolling ? 'Confirm and sign in' : 'Sign in');
  const step = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    button.disabled = true;
    mount(msg);
    try {
      await api('/api/login/verify', { method: 'POST', body: { ticket, code: code.value } });
      location.href = '/admin';
    } catch (err) {
      mount(msg, errorBox(err.message));
      button.disabled = false;
      code.select();
    }
  } },
  enrolling ? h('div', { class: 'mfa-setup' },
    qr ? h('img', { class: 'mfa-qr', src: qr, alt: 'QR code to add the portal to your authenticator app', width: '180', height: '180' }) : null,
    h('p', { class: 'hint' }, 'Can’t scan it? Add an account in the app and type this key:'),
    h('code', { class: 'mfa-key' }, key.replace(/(.{4})/g, '$1 ').trim())) : null,
  h('label', { class: 'field' }, h('span', {}, '6-digit code'), code),
  button,
  h('a', { class: 'mfa-restart', href: '/login' }, 'Start again'));

  form.replaceWith(step);
  code.focus();
}
