// Shared helpers for every page. All DOM is built with h(), which only ever sets
// text via textContent, so data from AroFlo can't inject markup.
import { ICONS } from './icons.js';

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

// Short names used around the app, mapped to Lucide icon names.
const ALIASES = {
  jobs: 'briefcase', user: 'users', cog: 'settings', pulse: 'activity', refresh: 'refresh-cw',
  close: 'x', back: 'chevron-left', note: 'message-square-text', photo: 'image', site: 'map-pin',
  alert: 'circle-alert', signout: 'log-out', print: 'printer',
};

// ICONS holds static, trusted SVG markup bundled with the app (never data).
export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[ALIASES[name] || name] || '';
  return svg;
}

// `org` is the company the user is working in, shown in the header like AroFlo's
// business name: a plain name, or an element (a company switcher) when there's a choice.
export function renderTopbar({ user, mode, active, org }) {
  // Clients only have the jobs page, so they get no nav at all. Admins switch between
  // previewing the client view and the Control Panel.
  const nav = user.role === 'admin' ? [
    h('a', { href: '/', 'aria-current': active === 'jobs' ? 'page' : null }, icon('eye'), h('span', { class: 'label' }, 'Client view')),
    h('a', { href: '/admin', 'aria-current': active === 'admin' ? 'page' : null }, icon('cog'), h('span', { class: 'label' }, 'Control Panel')),
  ] : [];
  const bar = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '/', 'aria-label': 'TTS Built Client Portal, home' },
      h('img', { src: '/img/tts-logo.svg', alt: 'TTS Built', width: '97', height: '22' })),
    h('div', { class: 'org' },
      h('span', { class: 'org-caption' }, 'Client Portal'),
      typeof org === 'string' || org == null ? h('span', { class: 'org-name' }, org || 'TTS Built') : org),
    h('nav', { class: 'topnav', 'aria-label': 'Main' }, nav),
    h('div', { class: 'usermenu' },
      h('div', { class: 'who' }, h('b', {}, user.name), h('span', {}, user.role === 'admin' ? 'TTS Built administrator' : user.email)),
      h('button', { class: 'btn-shell', type: 'button', onclick: logout }, icon('signout', 'icon'), h('span', { class: 'label' }, 'Sign out')),
    ),
  );
  const parts = [bar];
  if (mode === 'demo') {
    parts.push(h('div', { class: 'notice demo', role: 'status' }, icon('alert'),
      'Demo mode: showing sample data, not live AroFlo jobs.'));
  }
  return parts;
}

// Slim full-width title strip under the shell: optional breadcrumb link, the page title,
// and actions on the right.
export function pageBar({ title, crumb, actions }) {
  return h('div', { class: 'pagebar' }, h('div', { class: 'pagebar-inner' },
    h('div', { class: 'titles' },
      crumb ? h('div', { class: 'crumbs' }, h('a', { href: crumb.href }, crumb.label), icon('chevron-right'), crumb.current || null) : null,
      h('h1', {}, title)),
    actions ? h('div', { class: 'actions' }, actions) : null));
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
}

// Dates arrive as zone-less "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss" in AroFlo's local time.
// A trailing "Z" marks a UTC time (photo uploads); those are shown in the viewer's time zone.
function parts(value) {
  if (/T\d{2}:\d{2}(:\d{2})?Z$/.test(String(value || ''))) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes() };
    }
  }
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m && { y: +m[1], mo: +m[2], d: +m[3], hh: m[4] != null ? +m[4] : null, mm: m[5] != null ? +m[5] : null };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(value) {
  const p = parts(value);
  return p ? `${p.d} ${MONTHS[p.mo - 1]} ${p.y}` : '—';
}

export function fmtDayMonth(value) {
  const p = parts(value);
  return p ? `${p.d} ${MONTHS[p.mo - 1]}` : '—';
}

export function fmtMonth(value) {
  const p = parts(value);
  return p ? `${MONTHS_LONG[p.mo - 1]} ${p.y}` : 'No completion date';
}

export function fmtTime(value) {
  const p = parts(value);
  if (!p || p.hh == null || (p.hh === 0 && p.mm === 0)) return '';
  return `${p.hh % 12 || 12}:${String(p.mm).padStart(2, '0')} ${p.hh >= 12 ? 'pm' : 'am'}`;
}

export function fmtDateTime(value) {
  const time = fmtTime(value);
  return time ? `${fmtDate(value)}, ${time}` : fmtDate(value);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Skeleton rows in place of content while it loads.
export function loading(rows = 3) {
  return h('div', { class: 'panel-body', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: rows }, (_, i) => h('div', { class: 'skeleton-row' },
      h('span', { class: `skeleton ${['w60', 'w40', 'w80'][i % 3]}` }),
      h('span', { class: 'skeleton w20' }))));
}

export function errorBox(message) {
  return h('div', { class: 'alert error', role: 'alert' }, icon('alert'), h('span', {}, message));
}

export function okBox(message) {
  return h('div', { class: 'alert ok', role: 'status' }, icon('check'), h('span', {}, message));
}

export function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('b', {}, title), text ? h('p', {}, text) : null);
}
