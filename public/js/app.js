// Client view: completed jobs (newest first, grouped by month) and the job record:
// notes beside photos on one page, printable as a completion record.
import {
  api, h, mount, icon, renderTopbar, pageBar, fmtDate, fmtDateTime,
  loading, errorBox, emptyState,
} from './common.js';

const PAGE_SIZE = 50;
const PERIODS = [
  ['all', 'Any time'],
  ['30', 'Last 30 days'],
  ['90', 'Last 3 months'],
  ['365', 'Last 12 months'],
  ['custom', 'Custom range'],
];

const root = document.getElementById('root');
const view = h('div');
let tableHost = null;     // re-rendered on search/filter/page without rebuilding the toolbar
let currentJob = null;    // last opened job, reused when returning to it

const state = {
  clients: [],            // clients this user can pick from
  clientId: null,
  jobs: null,
  error: null,
  filters: { q: '', period: 'all', from: '', to: '' },
  page: 1,
  sort: { key: 'completed', dir: 'desc' },
};

const me = await api('/api/me');
const isAdmin = me.user.role === 'admin';

if (isAdmin) {
  try {
    // Only active clients have jobs in the portal, so only they can be previewed.
    state.clients = (await api('/api/admin/clients')).clients.filter((c) => c.active);
  } catch (err) {
    state.error = err.message;
  }
} else {
  state.clients = me.clients;
}
const params = new URLSearchParams(location.search);
state.clientId = state.clients.some((c) => c.clientId === params.get('client'))
  ? params.get('client')
  : isAdmin ? null : state.clients[0]?.clientId || null;

const orgName = () => state.clients.find((c) => c.clientId === state.clientId)?.clientName || '';
// Company in the header, like AroFlo. Clients only ever see their company name(s) as
// text; the switcher is an admin tool for previewing a client.
const names = state.clients.map((c) => c.clientName).sort((a, b) => a.length - b.length);
const orgLabel = names.length > 1 ? `${names[0]} + ${names.length - 1} more` : names[0];
const orgControl = isAdmin
  ? companySwitcher()
  : orgLabel ? h('span', { class: 'org-name', title: names.join(', ') }, orgLabel) : null;
mount(root, renderTopbar({ user: me.user, mode: me.mode, active: 'jobs', org: orgControl }), view);

window.addEventListener('hashchange', route);
route();

// ---------- Routing ----------
function route() {
  const m = location.hash.match(/^#\/job\/([^/]+)/);
  if (m) return showJob(decodeURIComponent(m[1]));
  document.title = 'Completed jobs · TTS Built Client Portal';
  showList();
}

// ---------- Jobs list ----------
async function showList() {
  renderList();
  if (!state.clientId || state.jobs) return;
  state.error = null;
  try {
    state.jobs = (await api(isAdmin ? `/api/jobs?clientId=${encodeURIComponent(state.clientId)}` : '/api/jobs')).jobs;
  } catch (err) {
    state.error = err.message;
    state.jobs = [];
  }
  if (!location.hash.startsWith('#/job/')) renderList();
}

function setClient(clientId) {
  state.clientId = clientId || null;
  state.jobs = null;
  state.page = 1;
  const url = new URL(location.href);
  if (clientId) url.searchParams.set('client', clientId);
  else url.searchParams.delete('client');
  url.hash = '';
  history.replaceState(null, '', url);
  showList();
}

function renderList() {
  const jobs = state.jobs;

  let body;
  if (state.error && !jobs?.length) {
    body = errorBox(state.error);
  } else if (!state.clientId) {
    body = h('div', { class: 'panel' }, isAdmin
      ? emptyState('eye', 'Preview a client', 'Choose a client in the header to see exactly what their users see.')
      : emptyState('briefcase', 'Your login isn’t linked to an account yet', 'Please contact TTS Built and we’ll connect your login to your organisation’s jobs.'));
  } else if (!jobs) {
    body = h('div', { class: 'panel' }, loading(6));
  } else {
    tableHost = h('section', { class: 'panel', 'aria-labelledby': 'jobs-title' });
    body = [searchPanel(), tableHost];
    fillTable();
  }

  const notice = isAdmin && state.clientId
    ? h('div', { class: 'notice preview', role: 'status' }, icon('eye'), `Previewing as ${orgName()}: this is exactly what their users see.`)
    : null;
  mount(view, notice, h('main', { class: 'page' }, body));
}

function companySwitcher() {
  return h('select', { 'aria-label': 'Preview client', onchange: (e) => setClient(e.target.value) },
    h('option', { value: '' }, 'Preview a client…'),
    state.clients.map((c) => h('option', { value: c.clientId, selected: c.clientId === state.clientId }, c.clientName)));
}

function searchPanel() {
  const f = state.filters;
  const range = h('div', { class: 'range', hidden: f.period !== 'custom' },
    h('label', { class: 'field' }, h('span', {}, 'From'), h('input', { type: 'date', value: f.from, onchange: (e) => update('from', e.target.value) })),
    h('label', { class: 'field' }, h('span', {}, 'To'), h('input', { type: 'date', value: f.to, onchange: (e) => update('to', e.target.value) })));
  function update(key, value) {
    f[key] = value;
    state.page = 1;
    range.hidden = f.period !== 'custom';
    fillTable();
  }
  return h('section', { class: 'panel search-panel', role: 'search', 'aria-labelledby': 'search-title' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'search-title' }, 'Search')),
    h('div', { class: 'toolbar' },
      h('label', { class: 'field search' }, h('span', {}, 'Keyword'),
        h('div', { class: 'input-icon' }, icon('search'),
          h('input', { type: 'search', value: f.q, placeholder: 'Cust ON, task or location', oninput: (e) => update('q', e.target.value) }))),
      h('label', { class: 'field period' }, h('span', {}, 'Completed'),
        h('select', { onchange: (e) => update('period', e.target.value) },
          PERIODS.map(([value, label]) => h('option', { value, selected: value === f.period }, label)))),
      range,
      h('button', { class: 'btn', type: 'button', onclick: clearFilters }, 'Clear'),
    ),
  );
}

function filteredJobs() {
  const { q, period, from, to } = state.filters;
  const needle = q.trim().toLowerCase();
  let min = '';
  let max = '';
  if (period === 'custom') {
    min = from;
    max = to;
  } else if (period !== 'all') {
    const d = new Date(Date.now() - Number(period) * 86400000);
    min = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return state.jobs.filter((j) => {
    const done = (j.completed || '').slice(0, 10);
    if (min && (!done || done < min)) return false;
    if (max && (!done || done > max)) return false;
    if (!needle) return true;
    return [j.custOn, j.taskName, j.location, j.clientName].some((v) => String(v || '').toLowerCase().includes(needle));
  });
}

function clearFilters() {
  state.filters = { q: '', period: 'all', from: '', to: '' };
  state.page = 1;
  renderList();
}

// Grid columns: [key, heading, class]. All are sortable.
function columns() {
  const multi = state.jobs.some((j) => j.clientName);
  return [
    ['completed', 'Completed', 'col-date'],
    ['custOn', 'Cust ON', 'col-job'],
    ['taskName', 'Task', 'col-task'],
    ['location', 'Location', 'col-site'],
    multi ? ['clientName', 'Company', 'col-company'] : null,
  ].filter(Boolean);
}

function sortedJobs(rows) {
  const { key, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { numeric: true, sensitivity: 'base' });
    return cmp * mult || String(b.completed || '').localeCompare(String(a.completed || ''));
  });
}

function sortBy(key) {
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['completed', 'custOn'].includes(key) ? 'desc' : 'asc' };
  state.page = 1;
  fillTable();
}

function fillTable() {
  const rows = sortedJobs(filteredJobs());
  const total = state.jobs.length;
  const filtered = rows.length !== total;
  const head = h('div', { class: 'panel-head' },
    h('h2', { id: 'jobs-title' }, 'Jobs', h('span', { class: 'count' }, filtered ? `${rows.length} of ${total}` : total)));

  if (!rows.length) {
    return mount(tableHost, head, total
      ? h('div', { class: 'empty' }, h('b', {}, 'No jobs match your search'),
        h('p', {}, h('button', { class: 'btn small', type: 'button', onclick: clearFilters }, 'Clear search')))
      : emptyState('briefcase', 'No completed jobs yet', 'Jobs appear here as soon as TTS Built completes them.'));
  }
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  state.page = Math.min(state.page, pages);
  const first = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(first, first + PAGE_SIZE);
  const cols = columns();

  mount(tableHost, head,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data grid stack' },
      h('caption', { class: 'visually-hidden' }, 'Completed jobs. Select a column heading to sort.'),
      h('thead', {}, h('tr', {}, cols.map(([key, label, cls]) => {
        const active = state.sort.key === key;
        return h('th', { scope: 'col', class: cls, 'aria-sort': active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : null },
          h('button', { class: `sort${active ? ' active' : ''}`, type: 'button', onclick: () => sortBy(key) },
            label, active ? icon(state.sort.dir === 'asc' ? 'chevron-up' : 'chevron-down', 'icon sort-mark') : null));
      }))),
      h('tbody', {}, pageRows.map((j) => jobRow(j, cols))))),
    pages > 1 ? h('div', { class: 'pager' },
      h('span', { class: 'num', role: 'status' }, `${first + 1}–${first + pageRows.length} of ${rows.length}`),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', disabled: state.page === 1, onclick: () => { state.page--; fillTable(); } }, icon('chevron-left'), 'Previous'),
      h('button', { class: 'btn small', type: 'button', disabled: state.page === pages, onclick: () => { state.page++; fillTable(); } }, 'Next', icon('chevron-right'))) : null,
  );
}

function jobRow(j, cols) {
  const href = `#/job/${encodeURIComponent(j.taskId)}`;
  const cell = {
    completed: () => fmtDate(j.completed),
    custOn: () => (j.custOn ? h('a', { class: 'job-link', href }, j.custOn) : ''),
    // Without a Cust ON the task name carries the link, so every row stays reachable by keyboard.
    taskName: () => (j.custOn
      ? h('span', { class: 'cell-text', title: j.taskName }, j.taskName || 'Job')
      : h('a', { class: 'job-link cell-text', href, title: j.taskName }, j.taskName || 'Job')),
    location: () => h('span', { class: 'cell-text', title: j.location }, j.location || ''),
    clientName: () => h('span', { class: 'cell-text', title: j.clientName }, j.clientName || ''),
  };
  return h('tr', { class: 'row', onclick: (e) => { if (!e.target.closest('a')) location.hash = href; } },
    cols.map(([key, , cls]) => h('td', { class: `${cls} num` }, cell[key]())));
}

// ---------- Job record ----------
// How a job is referred to: its customer order number, the reference clients know it by.
const jobRef = (job) => (job.custOn ? `Cust ON ${job.custOn}` : 'Job');

async function showJob(taskId) {
  if (currentJob?.taskId === taskId) return renderJob(currentJob);
  const bar = pageBar({ title: 'Loading job…', crumb: { href: '#', label: 'Completed Jobs' } });
  mount(view, bar, h('main', { class: 'page' }, h('div', { class: 'panel' }, loading(4))));
  try {
    const { job } = await api(`/api/jobs/${encodeURIComponent(taskId)}`);
    currentJob = job;
    if (location.hash.startsWith(`#/job/${encodeURIComponent(taskId)}`)) renderJob(job);
  } catch (err) {
    mount(view, pageBar({ title: 'Job not available', crumb: { href: '#', label: 'Completed Jobs' } }),
      h('main', { class: 'page' }, errorBox(err.message)));
  }
}

function renderJob(job) {
  document.title = `${jobRef(job)} · TTS Built Client Portal`;
  const printed = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const showCompany = !isAdmin && state.clients.length > 1 && job.clientName;
  const detail = (label, value) => (value ? h('div', {}, h('dt', {}, label), h('dd', {}, value)) : null);
  mount(view,
    pageBar({
      title: job.taskName || jobRef(job),
      crumb: { href: '#', label: 'Completed Jobs', current: jobRef(job) },
      actions: h('button', { class: 'btn primary', type: 'button', onclick: (e) => printRecord(e.currentTarget) }, icon('print'), 'Print / Save PDF'),
    }),
    h('main', { class: 'page' },
      h('div', { class: 'print-head' },
        h('img', { src: '/img/tts-logo-dark.svg', alt: 'TTS Built' }),
        h('span', {}, 'Job completion record', job.clientName ? [h('br'), job.clientName] : null, h('br'), `Printed ${printed}`)),
      h('section', { class: 'panel', 'aria-labelledby': 'details-title' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'details-title' }, 'Job details')),
        // Company is already in the header; list it here only for users linked to several.
        h('dl', { class: `detail-grid${showCompany ? ' five' : ''}${job.custOn ? '' : ' no-ref'}` },
          job.custOn ? detail('Cust ON', h('span', { class: 'num' }, job.custOn)) : null,
          detail('Task', job.taskName),
          detail('Location', job.location),
          detail('Completed', h('span', { class: 'num' }, fmtDateTime(job.completed))),
          showCompany ? detail('Company', job.clientName) : null)),
      recordBody(job),
    ));
}

// Photos load lazily on screen; make sure every one has loaded before printing so
// none of them prints as a blank tile.
async function printRecord(button) {
  button.disabled = true;
  const images = [...document.querySelectorAll('.photo img')];
  for (const img of images) img.loading = 'eager';
  await Promise.all(images.map((img) => img.decode().catch(() => {})));
  button.disabled = false;
  window.print();
}
window.addEventListener('beforeprint', () => {
  for (const img of document.querySelectorAll('.photo img')) img.loading = 'eager';
});

// Only sections with something in them are shown; a lone section takes the full width.
function recordBody(job) {
  const sections = [job.notes.length ? notesPanel(job) : null, job.photos.length ? photosPanel(job) : null].filter(Boolean);
  if (!sections.length) {
    return h('div', { class: 'panel record-empty' }, h('p', {}, 'No notes or photos have been shared for this job yet.'));
  }
  return h('div', { class: `record-body${sections.length === 1 ? ' single' : ''}` }, sections);
}

function notesPanel(job) {
  return h('section', { class: 'panel', 'aria-labelledby': 'notes-title' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'notes-title' }, 'Notes', h('span', { class: 'count' }, job.notes.length))),
    job.notes.length
      ? h('ul', { class: 'notes' }, job.notes.map((n) => h('li', {},
        h('div', { class: 'note-meta' },
          h('b', {}, n.author || 'TTS Built'),
          h('time', { datetime: n.posted || '' }, fmtDateTime(n.posted))),
        h('p', { class: 'note-text' }, n.text || '(empty note)'))))
      : null);
}

const photoUrl = (job, p, download) =>
  `/api/jobs/${encodeURIComponent(job.taskId)}/files/${encodeURIComponent(p.id)}${download ? '?download=1' : ''}`;

function photosPanel(job) {
  // When every photo was uploaded at the same time, say it once in the heading rather
  // than repeating it under each photo.
  const times = new Set(job.photos.map((p) => fmtDateTime(p.uploaded)));
  const sharedTime = times.size === 1 ? [...times][0] : null;
  return h('section', { class: 'panel', 'aria-labelledby': 'photos-title' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'photos-title' }, 'Photos', h('span', { class: 'count' }, job.photos.length)),
      sharedTime && sharedTime !== '—' ? h('span', { class: 'hint num' }, `Uploaded ${sharedTime}`) : null),
    h('div', { class: 'photo-grid' }, job.photos.map((p, i) => {
      const caption = [p.comment ? h('b', {}, p.comment) : null, sharedTime ? null : h('span', {}, fmtDateTime(p.uploaded))].filter(Boolean);
      return h('button', { class: 'photo', type: 'button', onclick: () => openViewer(job, i), 'aria-label': `Open photo ${i + 1}${p.comment ? `: ${p.comment}` : ''}` },
        h('img', { src: photoUrl(job, p), alt: '', loading: 'lazy', decoding: 'async' }),
        caption.length ? h('span', { class: 'cap' }, caption) : null);
    })));
}

// ---------- Photo viewer ----------
function openViewer(job, index) {
  const opener = document.activeElement;
  const img = h('img', { alt: '' });
  const caption = h('div', { class: 'viewer-cap' });
  const counter = h('span', { class: 'counter', 'aria-live': 'polite' });
  const download = h('a', { class: 'btn small' }, icon('download'), 'Download');
  const closeBtn = h('button', { class: 'btn small', type: 'button', onclick: close }, icon('close'), 'Close');
  const multi = job.photos.length > 1;

  const show = (i) => {
    index = (i + job.photos.length) % job.photos.length;
    const p = job.photos[index];
    img.src = photoUrl(job, p);
    img.alt = p.comment || `Photo ${index + 1} of ${jobRef(job)}`;
    download.href = photoUrl(job, p, true);
    counter.textContent = `Photo ${index + 1} of ${job.photos.length}`;
    mount(caption, p.comment || `Photo ${index + 1}`, h('span', {}, fmtDateTime(p.uploaded)));
  };
  const box = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Photos for ${jobRef(job)}` },
    h('div', { class: 'viewer-top' }, counter, h('span', { class: 'spacer' }), download, closeBtn),
    h('div', { class: 'viewer-stage', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      img,
      multi ? h('button', { class: 'viewer-nav prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => show(index - 1) }, icon('chevron-left')) : null,
      multi ? h('button', { class: 'viewer-nav next', type: 'button', 'aria-label': 'Next photo', onclick: () => show(index + 1) }, icon('chevron-right')) : null),
    caption,
  );
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && multi) show(index - 1);
    else if (e.key === 'ArrowRight' && multi) show(index + 1);
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    box.remove();
    document.body.style.overflow = '';
    opener?.focus();
  }
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(box);
  show(index);
  closeBtn.focus();
}
