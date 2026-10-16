// Shared helpers for every page. All DOM is built with h(), which only ever sets
// text via textContent, so data from AroFlo can't inject markup.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = '/login';
    return new Promise(() => {});
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

const ICONS = {
  jobs: 'M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z',
  cog: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-2.2-.6-.6-1.5 1.1-2-1.6-1.6-2 1.1-1.5-.6L13.6 4h-2.2l-.6 2.2-1.5.6-2-1.1-1.6 1.6 1.1 2-.6 1.5L4 11v2l2.2.6.6 1.5-1.1 2 1.6 1.6 2-1.1 1.5.6.6 2.2h2.2l.6-2.2 1.5-.6 2 1.1 1.6-1.6-1.1-2 .6-1.5L21 13z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  download: 'M11 4h2v8l3-3 1.4 1.4L12 15.8l-5.4-5.4L8 9l3 3zM5 18h14v2H5z',
  back: 'M15.4 6.6 14 5.2 7.2 12l6.8 6.8 1.4-1.4L10 12z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z',
  eye: 'M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  pulse: 'M3 13h4l2-6 4 12 2-6h6v-2h-4.6L15 4.6 11 16.6 9 10.4 7.6 11H3z',
};

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

export function renderTopbar({ user, portalName, mode, active }) {
  const initials = portalName.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const nav = [h('a', { href: '/', class: active === 'jobs' ? 'active' : '' }, icon('jobs'), h('span', {}, 'Completed Jobs'))];
  if (user.role === 'admin') {
    nav.push(h('a', { href: '/admin', class: active === 'admin' ? 'active' : '' }, icon('cog'), h('span', {}, 'Control Panel')));
  }
  const bar = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand-mark' }, initials || 'CP'), h('span', { class: 'brand-name' }, portalName)),
    h('nav', { class: 'topnav' }, nav),
    h('div', { class: 'usermenu' },
      h('div', { class: 'who' }, user.name, h('small', {}, user.role === 'admin' ? 'Administrator' : user.email)),
      h('button', { type: 'button', onclick: logout }, 'Sign out'),
    ),
  );
  const parts = [bar];
  if (mode === 'demo') {
    parts.push(h('div', { class: 'demo-banner' }, 'Demo mode: showing sample data, not live AroFlo jobs. Set DEMO_MODE=false in .env once the AroFlo API key is working.'));
  }
  document.title = `${active === 'admin' ? 'Control Panel' : 'Completed Jobs'} · ${portalName}`;
  return parts;
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
}

// Dates arrive as zone-less "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss" in AroFlo's local time.
function parts(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m && { y: +m[1], mo: +m[2], d: +m[3], hh: m[4] != null ? +m[4] : null, mm: m[5] != null ? +m[5] : null };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(value) {
  const p = parts(value);
  return p ? `${String(p.d).padStart(2, '0')} ${MONTHS[p.mo - 1]} ${p.y}` : '—';
}

export function fmtDateTime(value) {
  const p = parts(value);
  if (!p) return '—';
  if (p.hh == null || (p.hh === 0 && p.mm === 0)) return fmtDate(value);
  const ampm = p.hh >= 12 ? 'pm' : 'am';
  const hour = p.hh % 12 || 12;
  return `${fmtDate(value)} ${hour}:${String(p.mm).padStart(2, '0')}${ampm}`;
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text);
}

export function errorBox(message) {
  return h('div', { class: 'error-box', role: 'alert' }, message);
}
