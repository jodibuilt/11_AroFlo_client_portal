// Client view: completed jobs (newest first) and, for each job, only its notes and photos.
import { api, h, mount, icon, renderTopbar, fmtDate, fmtDateTime, loading, errorBox } from './common.js';

const PAGE_SIZE = 50;
const root = document.getElementById('root');
const view = h('div');
let jobsPanelEl = null;   // the jobs grid panel, re-rendered on filter/page
let currentJob = null;    // last opened job, reused when switching tabs

const state = {
  clients: [],          // clients this user can pick from
  clientId: null,
  jobs: null,
  error: null,
  filters: { q: '', from: '', to: '' },
  page: 1,
};

const me = await api('/api/me');
const isAdmin = me.user.role === 'admin';
mount(root, renderTopbar({ user: me.user, portalName: me.portalName, mode: me.mode, active: 'jobs' }), view);

if (isAdmin) {
  try {
    state.clients = (await api('/api/admin/clients')).clients;
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

window.addEventListener('hashchange', route);
route();

// ---------- Routing ----------
function route() {
  const m = location.hash.match(/^#\/job\/([^/]+)(?:\/(\w+))?/);
  if (m) return showJob(decodeURIComponent(m[1]), m[2] || 'notes');
  showList();
}

// ---------- Job list ----------
async function showList() {
  renderList();
  if (!state.clientId) return;
  if (state.jobs) return;
  state.jobs = null;
  state.error = null;
  renderList();
  try {
    const data = await api(`/api/jobs?clientId=${encodeURIComponent(state.clientId)}`);
    state.jobs = data.jobs;
  } catch (err) {
    state.error = err.message;
    state.jobs = [];
  }
  if (!location.hash) renderList();
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
  const client = state.clients.find((c) => c.clientId === state.clientId);
  const head = h('div', { class: 'pagehead' },
    h('h1', {}, 'Completed Jobs'),
    clientPicker(),
  );

  const banner = isAdmin && client
    ? h('div', { class: 'preview-banner' }, icon('eye'), `Admin preview: this is exactly what users linked to "${client.clientName}" see.`)
    : null;

  const body = h('main');
  if (state.error && !state.jobs?.length) body.append(errorBox(state.error));

  if (!state.clientId) {
    body.append(h('div', { class: 'panel' }, h('div', { class: 'empty' },
      isAdmin
        ? 'Choose an AroFlo client above to preview the jobs, notes and photos they see.'
        : 'Your login has not been linked to a client account yet. Please contact us to get access.')));
  } else if (!state.jobs) {
    body.append(h('div', { class: 'panel' }, loading('Loading jobs…')));
  } else {
    body.append(filterPanel(), jobsPanel());
  }
  mount(view, head, banner, body);
}

function clientPicker() {
  if (!isAdmin && state.clients.length <= 1) {
    const only = state.clients[0];
    return only ? h('span', { class: 'crumbs' }, only.clientName) : null;
  }
  const select = h('select', { 'aria-label': 'Client', onchange: (e) => setClient(e.target.value) },
    isAdmin ? h('option', { value: '' }, '— Select a client to preview —') : null,
    state.clients.map((c) => h('option', { value: c.clientId, selected: c.clientId === state.clientId }, c.clientName)),
  );
  return h('label', { class: 'field' }, select);
}

function filterPanel() {
  const f = state.filters;
  const update = (key) => (e) => {
    f[key] = e.target.value;
    state.page = 1;
    if (jobsPanelEl) fillJobsPanel();
  };
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, 'Search'),
    h('div', { class: 'panel-body filters' },
      h('label', { class: 'field search' }, h('span', {}, 'Keyword'),
        h('input', { type: 'search', value: f.q, placeholder: 'Job #, task or location…', oninput: update('q') })),
      h('label', { class: 'field' }, h('span', {}, 'Completed from'), h('input', { type: 'date', value: f.from, onchange: update('from') })),
      h('label', { class: 'field' }, h('span', {}, 'Completed to'), h('input', { type: 'date', value: f.to, onchange: update('to') })),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => { state.filters = { q: '', from: '', to: '' }; state.page = 1; renderList(); },
      }, 'Clear'),
    ),
  );
}

// Jobs arrive from the server already sorted newest-completed first.
function filteredJobs() {
  const { q, from, to } = state.filters;
  const needle = q.trim().toLowerCase();
  return state.jobs.filter((j) => {
    const done = (j.completed || '').slice(0, 10);
    if (from && (!done || done < from)) return false;
    if (to && (!done || done > to)) return false;
    if (!needle) return true;
    return [j.jobNumber, j.taskName, j.location].some((v) => String(v || '').toLowerCase().includes(needle));
  });
}

function jobsPanel() {
  jobsPanelEl = h('div', { class: 'panel' });
  fillJobsPanel();
  return jobsPanelEl;
}

function fillJobsPanel() {
  const rows = filteredJobs();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const pageRows = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const table = h('table', { class: 'grid cards' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, 'Completed', h('span', { class: 'arrow' }, '▼')),
      h('th', { scope: 'col' }, 'Job #'),
      h('th', { scope: 'col' }, 'Task'),
      h('th', { scope: 'col' }, 'Location'))),
    h('tbody', {}, pageRows.map((j) => {
      const href = `#/job/${encodeURIComponent(j.taskId)}`;
      return h('tr', { class: 'clickable', onclick: () => { location.hash = href; } },
        h('td', { class: 'nowrap', 'data-label': 'Completed' }, fmtDate(j.completed)),
        h('td', { class: 'jobno' }, h('a', { href, onclick: (e) => e.stopPropagation() }, j.jobNumber || '—')),
        h('td', {}, j.taskName),
        h('td', { 'data-label': 'Location' }, j.location || '—'),
      );
    })),
  );

  mount(jobsPanelEl,
    h('div', { class: 'panel-head' }, 'Jobs', h('span', { class: 'count' }, `(${rows.length}${rows.length !== state.jobs.length ? ` of ${state.jobs.length}` : ''})`)),
    rows.length
      ? h('div', { class: 'grid-wrap' }, table)
      : h('div', { class: 'empty' }, state.jobs.length ? 'No jobs match your search.' : 'No completed jobs yet.'),
    pages > 1 ? h('div', { class: 'pager' },
      `Showing ${(state.page - 1) * PAGE_SIZE + 1}–${Math.min(state.page * PAGE_SIZE, rows.length)} of ${rows.length}`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', disabled: state.page === 1, onclick: () => { state.page--; fillJobsPanel(); } }, 'Previous'),
      `Page ${state.page} of ${pages}`,
      h('button', { class: 'btn small', type: 'button', disabled: state.page === pages, onclick: () => { state.page++; fillJobsPanel(); } }, 'Next'),
    ) : null,
  );
}

// ---------- Job: notes & photos ----------
async function showJob(taskId, tab) {
  if (currentJob?.taskId === taskId) return renderJob(currentJob, tab);
  mount(view,
    h('div', { class: 'pagehead' }, h('div', { class: 'crumbs' }, h('a', { href: '#' }, 'Completed Jobs'), ' › Loading…')),
    h('main', {}, h('div', { class: 'panel' }, loading('Loading job…'))),
  );
  try {
    const { job } = await api(`/api/jobs/${encodeURIComponent(taskId)}`);
    currentJob = job;
    if (location.hash.startsWith(`#/job/${encodeURIComponent(taskId)}`)) renderJob(job, tab);
  } catch (err) {
    mount(view,
      h('div', { class: 'pagehead' }, h('div', { class: 'crumbs' }, h('a', { href: '#' }, 'Completed Jobs'))),
      h('main', {}, errorBox(err.message)),
    );
  }
}

function renderJob(job, tab) {
  const base = `#/job/${encodeURIComponent(job.taskId)}`;
  const tabs = [['notes', 'Notes', job.notes.length], ['photos', 'Photos', job.photos.length]];
  if (!tabs.some(([id]) => id === tab)) tab = 'notes';

  mount(view,
    h('div', { class: 'pagehead' },
      h('a', { class: 'btn small', href: '#' }, icon('back'), 'Back'),
      h('div', { class: 'crumbs' }, h('a', { href: '#' }, 'Completed Jobs'), ` › Job ${job.jobNumber}`),
    ),
    h('main', {},
      h('div', { class: 'panel' },
        h('div', { class: 'taskhead' },
          h('div', {},
            h('h2', {}, job.taskName || `Job ${job.jobNumber}`),
            h('div', { class: 'ids' },
              h('span', {}, 'Job # ', h('b', {}, job.jobNumber)),
              job.location ? h('span', {}, job.location) : null,
              h('span', {}, `Completed ${fmtDate(job.completed)}`),
            ),
          ),
        ),
        h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label, count]) =>
          h('button', {
            type: 'button', role: 'tab', 'aria-selected': String(id === tab),
            onclick: () => { location.hash = `${base}/${id}`; },
          }, label, h('span', { class: 'badge' }, count)))),
        h('div', { class: 'tabpanel', role: 'tabpanel' }, tab === 'photos' ? photosTab(job) : notesTab(job)),
      ),
    ),
  );
}

function notesTab(job) {
  if (!job.notes.length) return h('div', { class: 'empty' }, 'No notes for this job.');
  return job.notes.map((n) => h('div', { class: 'note' },
    h('div', { class: 'note-head' },
      h('strong', {}, n.author || 'Technician'),
      h('span', { class: 'spacer' }),
      h('span', {}, fmtDateTime(n.posted)),
    ),
    h('div', { class: 'note-body' }, n.text || '(empty note)'),
  ));
}

const photoUrl = (job, p, download) =>
  `/api/jobs/${encodeURIComponent(job.taskId)}/files/${encodeURIComponent(p.id)}${download ? '?download=1' : ''}`;

function photosTab(job) {
  if (!job.photos.length) return h('div', { class: 'empty' }, 'No photos for this job.');
  return h('div', { class: 'photos' }, job.photos.map((p, i) =>
    h('button', { class: 'photo', type: 'button', onclick: () => openLightbox(job, i) },
      h('img', { class: 'thumb', src: photoUrl(job, p), alt: p.comment || p.name, loading: 'lazy' }),
      h('span', { class: 'cap' },
        h('b', {}, p.comment || p.name),
        h('span', {}, fmtDateTime(p.uploaded))),
    )));
}

// ---------- Lightbox ----------
function openLightbox(job, index) {
  const opener = document.activeElement;
  const img = h('img', { alt: '' });
  const caption = h('div', { class: 'lb-cap' });
  const counter = h('span');
  const download = h('a', { class: 'btn small' }, icon('download'), 'Download');
  const closeBtn = h('button', { class: 'btn small', type: 'button', onclick: close }, icon('close'), 'Close');

  const show = (i) => {
    index = (i + job.photos.length) % job.photos.length;
    const p = job.photos[index];
    img.src = photoUrl(job, p);
    img.alt = p.comment || p.name;
    download.href = photoUrl(job, p, true);
    counter.textContent = `${index + 1} / ${job.photos.length}`;
    mount(caption, p.comment || p.name, h('span', {}, fmtDateTime(p.uploaded)));
  };
  const multi = job.photos.length > 1;
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer' },
    h('div', { class: 'lb-top' }, counter, h('span', { class: 'spacer' }), download, closeBtn),
    h('div', { class: 'lb-stage', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      img,
      multi ? h('button', { class: 'lb-nav prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => show(index - 1) }, '‹') : null,
      multi ? h('button', { class: 'lb-nav next', type: 'button', 'aria-label': 'Next photo', onclick: () => show(index + 1) }, '›') : null,
    ),
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
