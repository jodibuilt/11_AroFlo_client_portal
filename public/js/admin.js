// Control Panel: client logins, what clients can see, and the AroFlo sync.
import { api, h, mount, icon, renderTopbar, pageBar, plural, loading, errorBox, okBox, emptyState } from './common.js';

const root = document.getElementById('root');
const me = await api('/api/me');
const content = h('div');
const sidenav = h('nav', { class: 'sidenav', 'aria-label': 'Control Panel sections' });
mount(root,
  renderTopbar({ user: me.user, mode: me.mode, active: 'admin' }),
  pageBar({ title: 'Control Panel' }),
  h('main', { class: 'page' }, h('div', { class: 'admin-layout' }, sidenav, content)),
);

const SECTIONS = [
  ['users', 'Users', 'user', renderUsers],
  ['clients', 'Clients', 'briefcase', renderClients],
  ['settings', 'Portal settings', 'cog', renderSettings],
  ['status', 'AroFlo sync', 'pulse', renderStatus],
];

let clientsCache = null;
async function loadClients(force = false) {
  if (!clientsCache || force) {
    clientsCache = api(`/api/admin/clients${force ? '?refresh=1' : ''}`).then((d) => d.clients);
    clientsCache.catch(() => { clientsCache = null; });
  }
  return clientsCache;
}

// Times from the server are UTC; show them in the viewer's local time.
const localTime = (v) => {
  if (!v) return 'Never';
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

window.addEventListener('hashchange', route);
route();

function route() {
  document.querySelectorAll('.drawer, .drawer-bg').forEach((el) => el.remove());
  const id = location.hash.slice(1) || 'users';
  const section = SECTIONS.find((s) => s[0] === id) || SECTIONS[0];
  document.title = `${section[1]} · Control Panel · TTS Built Client Portal`;
  mount(sidenav, SECTIONS.map(([sid, label, ic]) =>
    h('a', { href: `#${sid}`, 'aria-current': sid === section[0] ? 'page' : null }, icon(ic), label)));
  section[3]();
}

// ---------- Users ----------
let users = [];
let userSearch = '';

async function renderUsers() {
  mount(content, h('div', { class: 'panel' }, loading(4)));
  try {
    users = (await api('/api/admin/users')).users;
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  drawUsers();
}

function drawUsers(flash) {
  const tableHost = h('div');
  const draw = () => {
    const needle = userSearch.trim().toLowerCase();
    const rows = users.filter((u) => !needle ||
      [u.name, u.email, ...u.clients.map((c) => c.clientName)].some((v) => v.toLowerCase().includes(needle)));
    if (!rows.length) {
      return mount(tableHost, users.length
        ? emptyState('search', 'No users match', 'Try a different name, email or client.')
        : emptyState('user', 'No users yet', 'Create a login for each client contact, and link it to their AroFlo client.'));
    }
    mount(tableHost, h('div', { class: 'table-wrap' }, h('table', { class: 'data cards' },
      h('thead', {}, h('tr', {}, ['Name', 'Role', 'Linked clients', 'Status', 'Last sign-in', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.map((u) => h('tr', {},
        h('td', { class: 'card-title' },
          h('a', { class: 'job-link', href: '#users', onclick: (e) => { e.preventDefault(); openUserDrawer(u); } }, u.name),
          h('div', { class: 'task-site' }, u.email)),
        h('td', { 'data-label': 'Role' }, h('span', { class: `tag${u.role === 'admin' ? ' admin' : ''}` }, u.role === 'admin' ? 'Admin' : 'Client'),
          u.role === 'admin' ? [' ', h('span', { class: `tag ${u.mfa ? 'on' : 'off'}`, title: 'Two-factor sign-in' }, u.mfa ? '2FA on' : '2FA not set up')] : null),
        h('td', { 'data-label': 'Linked clients' }, u.role === 'admin' ? h('span', { class: 'muted' }, 'All clients')
          : u.clients.length ? [u.clients.slice(0, 2).map((c) => h('span', { class: 'tag' }, c.clientName)),
            u.clients.length > 2 ? h('span', { class: 'muted' }, ` +${u.clients.length - 2} more`) : null]
            : h('span', { class: 'tag off' }, 'None linked')),
        h('td', { 'data-label': 'Status' }, h('span', { class: `tag ${u.active ? 'on' : 'off'}` }, u.active ? 'Active' : 'Disabled')),
        h('td', { class: 'num', 'data-label': 'Last sign-in' }, localTime(u.last_login_at)),
        h('td', { class: 'col-job card-action' },
          u.role === 'client' && u.clients[0]
            ? h('a', { class: 'btn small quiet', href: `/?client=${encodeURIComponent(u.clients[0].id)}` }, icon('eye'), 'Preview')
            : null),
      ))),
    )));
  };
  draw();
  mount(content,
    flash || null,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', {}, 'Users', h('span', { class: 'count' }, users.length)),
        h('span', { class: 'spacer' }),
        h('div', { class: 'input-icon' }, icon('search'),
          h('input', { type: 'search', placeholder: 'Search users or clients', value: userSearch, 'aria-label': 'Search users',
            oninput: (e) => { userSearch = e.target.value; draw(); } })),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openUserDrawer(null) }, icon('plus'), 'New user')),
      tableHost,
    ),
  );
}

// 12 characters, every one equally likely (bytes that would skew the pick are skipped).
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < 12) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

function openUserDrawer(user) {
  const isNew = !user;
  const isSelf = user?.id === me.user.id;
  const selected = new Map((user?.clients || []).map((c) => [c.id, c]));
  const msg = h('div');

  const name = h('input', { type: 'text', value: user?.name || '', required: true, autocomplete: 'off' });
  const email = h('input', { type: 'email', value: user?.email || '', required: true, autocomplete: 'off' });
  const role = h('select', { disabled: isSelf },
    h('option', { value: 'client', selected: user?.role !== 'admin' }, 'Client: sees completed jobs for their linked clients'),
    h('option', { value: 'admin', selected: user?.role === 'admin' }, 'Admin: manages the portal'));
  const active = h('input', { type: 'checkbox', checked: user ? user.active : true, disabled: isSelf });
  const password = h('input', { type: 'text', autocomplete: 'new-password', placeholder: isNew ? 'At least 10 characters' : 'Leave blank to keep the current password' });
  if (isNew) password.value = generatePassword();

  // Client picker
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'picker-list' }, loading(3));
  let allClients = [];
  let filter = '';
  const search = h('input', { type: 'search', placeholder: 'Search AroFlo clients', 'aria-label': 'Search AroFlo clients',
    oninput: (e) => { filter = e.target.value; drawList(); } });
  const drawChips = () => mount(chips, selected.size
    ? [...selected.values()].map((c) => h('span', { class: 'chip' }, c.clientName,
      h('button', { type: 'button', 'aria-label': `Remove ${c.clientName}`, onclick: () => { selected.delete(c.id); drawChips(); drawList(); } }, icon('close'))))
    : h('span', { class: 'hint' }, 'No clients linked yet. This user will see no jobs.'));
  const drawList = () => {
    if (!allClients.length) return;
    const needle = filter.trim().toLowerCase();
    const matches = allClients.filter((c) => !needle || c.clientName.toLowerCase().includes(needle));
    mount(list, matches.slice(0, 200).map((c) => h('label', {},
      h('input', { type: 'checkbox', checked: selected.has(c.id),
        onchange: (e) => { if (e.target.checked) selected.set(c.id, c); else selected.delete(c.id); drawChips(); } }),
      c.clientName)),
    matches.length > 200 ? h('div', { class: 'empty compact' }, h('p', {}, `${matches.length - 200} more. Refine your search.`)) : null,
    !matches.length ? h('div', { class: 'empty compact' }, h('p', {}, 'No clients match.')) : null);
  };
  drawChips();
  loadClients().then((c) => { allClients = c; drawList(); })
    .catch((err) => mount(list, h('div', { class: 'panel-body' }, errorBox(`Couldn’t load the AroFlo client list: ${err.message}`))));

  const clientField = h('div', { class: 'field wide' },
    h('span', {}, 'Linked AroFlo clients'),
    h('div', { class: 'picker' }, chips, search, list),
    h('span', { class: 'hint' }, 'The user sees completed jobs for these clients only. Linking a client makes it active in the portal.'));
  const syncRole = () => { clientField.hidden = role.value !== 'client'; };
  role.addEventListener('change', syncRole);
  syncRole();

  const close = () => { bg.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const opener = document.activeElement;

  async function save(e) {
    e.preventDefault();
    mount(msg);
    const body = { name: name.value, email: email.value, role: role.value, active: active.checked, clients: [...selected.keys()].map((id) => ({ id })) };
    if (password.value) body.password = password.value;
    saveBtn.disabled = true;
    try {
      if (isNew) await api('/api/admin/users', { method: 'POST', body });
      else await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body });
      close();
      users = (await api('/api/admin/users')).users;
      drawUsers(password.value ? passwordReveal(body.email, password.value, isNew) : okBox(`Saved ${body.name}.`));
    } catch (err) {
      mount(msg, errorBox(err.message));
      saveBtn.disabled = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete ${user.name}? They will no longer be able to sign in. This can't be undone.`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      close();
      users = users.filter((u) => u.id !== user.id);
      drawUsers(okBox(`Deleted ${user.name}.`));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  }

  async function resetMfa() {
    if (!confirm(`Reset two-factor sign-in for ${user.name}? They'll be signed out and will set it up again with their authenticator app next time they sign in.`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(user.id)}/reset-2fa`, { method: 'POST' });
      close();
      users = (await api('/api/admin/users')).users;
      drawUsers(okBox(`Two-factor sign-in reset for ${user.name}.`));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  }

  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Create user' : 'Save changes');
  const bg = h('div', { class: 'drawer-bg', onclick: close });
  const drawer = h('form', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title', onsubmit: save, novalidate: true },
    h('div', { class: 'drawer-head' },
      h('h2', { id: 'drawer-title' }, isNew ? 'New user' : `Edit ${user.name}`),
      h('button', { class: 'btn small quiet', type: 'button', onclick: close, 'aria-label': 'Close' }, icon('close'))),
    h('div', { class: 'drawer-body' },
      msg,
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field' }, h('span', {}, 'Email (used to sign in)'), email),
        h('label', { class: 'field wide' }, h('span', {}, 'Role'), role),
        h('div', { class: 'field wide' },
          h('span', {}, isNew ? 'Password' : 'Reset password'),
          password,
          h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { password.value = generatePassword(); } }, icon('refresh'), 'Generate password'))),
        clientField,
        !isNew && !isSelf && user.role === 'admin' ? h('div', { class: 'field wide' },
          h('span', {}, 'Two-factor sign-in'),
          user.mfa
            ? h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: resetMfa }, icon('refresh'), 'Reset two-factor'))
            : null,
          h('span', { class: 'hint' }, user.mfa
            ? 'Set up. Reset it if they lose or replace their phone; they’ll set it up again at their next sign-in.'
            : 'Not set up yet. They’ll be asked to set it up with an authenticator app at their next sign-in.')) : null,
        !isNew ? h('label', { class: 'check wide' }, active,
          h('span', {}, 'Account active', h('div', { class: 'hint' }, isSelf ? 'You can’t disable your own account.' : 'Untick to block sign-in without deleting the user.'))) : null,
      ),
    ),
    h('div', { class: 'drawer-foot' },
      !isNew && !isSelf ? h('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Delete user') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
      saveBtn,
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(bg, drawer);
  name.focus();
}

function passwordReveal(email, password, isNew) {
  const copy = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    try {
      await navigator.clipboard.writeText(`Sign in at ${location.origin}\nEmail: ${email}\nPassword: ${password}`);
      mount(copy, icon('check'), 'Copied');
    } catch {
      mount(copy, 'Copy failed: select the password instead');
    }
  } }, icon('copy'), 'Copy sign-in details');
  return h('div', { class: 'secret', role: 'status' },
    h('span', {}, `${isNew ? 'User created.' : 'Password updated.'} Send ${email} this password. It won’t be shown again:`),
    h('code', {}, password), copy);
}

// ---------- Clients ----------
let clientFilter = { q: '', show: 'all' };

async function renderClients(flash) {
  mount(content, h('div', { class: 'panel' }, loading(6)));
  let clients;
  try {
    clients = await loadClients();
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  const tableHost = h('div');
  const activeCount = () => clients.filter((c) => c.active).length;
  const countEl = h('span', { class: 'count' }, '');
  const msg = h('div');

  async function toggle(c, input) {
    const want = input.checked;
    if (!want && c.users && !confirm(`${c.clientName} has ${plural(c.users, 'linked user')}. Deactivating removes its jobs from the portal and those users will see nothing. Continue?`)) {
      input.checked = true;
      return;
    }
    input.disabled = true;
    try {
      await api(`/api/admin/clients/${encodeURIComponent(c.id)}`, { method: 'PUT', body: { active: want } });
      c.active = want;
      if (!want) c.jobs = 0;
      clientsCache = null;
      mount(msg, okBox(want
        ? `${c.clientName} is active. Its completed jobs are downloading now.`
        : `${c.clientName} is inactive. Its jobs were removed and it is no longer read from AroFlo.`));
      draw();
    } catch (err) {
      input.checked = !want;
      mount(msg, errorBox(err.message));
    }
    input.disabled = false;
  }

  function draw() {
    countEl.textContent = `${activeCount()} active of ${clients.length}`;
    const needle = clientFilter.q.trim().toLowerCase();
    const rows = clients
      .filter((c) => clientFilter.show === 'all' || (clientFilter.show === 'active') === c.active)
      .filter((c) => !needle || c.clientName.toLowerCase().includes(needle))
      .sort((a, b) => (b.active - a.active) || a.clientName.localeCompare(b.clientName));
    if (!rows.length) return mount(tableHost, emptyState('search', 'No clients match', 'Try a different name or filter.'));
    mount(tableHost, h('div', { class: 'table-wrap' }, h('table', { class: 'data cards' },
      h('thead', {}, h('tr', {}, ['Client', 'In portal', 'Linked users', 'Jobs synced'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows.slice(0, 300).map((c) => {
        const input = h('input', { type: 'checkbox', role: 'switch', checked: c.active, 'aria-label': `${c.clientName} active in portal` });
        input.addEventListener('change', () => toggle(c, input));
        return h('tr', {},
          h('td', { class: 'card-title' }, c.clientName),
          h('td', { 'data-label': 'In portal' }, h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', {}, c.active ? 'Active' : 'Inactive'))),
          h('td', { class: 'num', 'data-label': 'Linked users' }, c.users || ''),
          h('td', { class: 'num', 'data-label': 'Jobs synced' }, c.active ? c.jobs : ''));
      })))),
    rows.length > 300 ? h('p', { class: 'hint panel-body' }, `Showing 300 of ${rows.length}. Search to narrow the list.`) : null);
  }

  draw();
  mount(content,
    flash || null,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', {}, 'Clients', countEl),
        h('span', { class: 'spacer' }),
        h('select', { 'aria-label': 'Show', class: 'compact-select', onchange: (e) => { clientFilter.show = e.target.value; draw(); } },
          [['all', 'All clients'], ['active', 'Active only'], ['inactive', 'Inactive only']]
            .map(([v, l]) => h('option', { value: v, selected: clientFilter.show === v }, l))),
        h('div', { class: 'input-icon' }, icon('search'),
          h('input', { type: 'search', placeholder: 'Search clients', value: clientFilter.q, 'aria-label': 'Search clients',
            oninput: (e) => { clientFilter.q = e.target.value; draw(); } })),
        h('button', { class: 'btn small', type: 'button', title: 'Fetch the latest client list from AroFlo (1 API call)',
          onclick: async (e) => { e.currentTarget.disabled = true; try { await loadClients(true); renderClients(okBox('Client list refreshed from AroFlo.')); } catch (err) { mount(msg, errorBox(err.message)); e.currentTarget.disabled = false; } } },
          icon('refresh'), 'Refresh list')),
      h('div', { class: 'panel-body' }, msg,
        h('p', { class: 'hint' }, 'Only active clients are read from AroFlo and shown in the portal, so inactive clients use no API calls. Linking a client to a user activates it automatically.')),
      tableHost,
    ),
  );
}

// ---------- Settings ----------
async function renderSettings() {
  mount(content, h('div', { class: 'panel' }, loading(4)));
  let settings;
  try {
    settings = (await api('/api/admin/settings')).settings;
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  const msg = h('div');
  const radio = (name, value, label, hint) => h('label', { class: 'check' },
    h('input', { type: 'radio', name, value, checked: settings[name] === value }),
    h('span', {}, label, h('div', { class: 'hint' }, hint)));
  const includeArchived = h('input', { type: 'checkbox', checked: settings.includeArchived });
  const syncFrom = h('input', { type: 'date', value: settings.syncFrom || '2026-01-01', required: true });
  const interval = h('select', { name: 'syncIntervalMinutes' },
    [[15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour (recommended)'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Once a day']]
      .map(([v, label]) => h('option', { value: String(v), selected: Number(settings.syncIntervalMinutes) === v }, label)));

  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        portalName: settings.portalName,
        fileVisibility: fd.get('fileVisibility'),
        includeArchived: includeArchived.checked,
        syncIntervalMinutes: Number(interval.value),
        syncFrom: syncFrom.value,
      } });
      mount(msg, okBox('Settings saved. Clients see the change next time they open a page.'));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  } },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Portal settings')),
    h('div', { class: 'panel-body' },
      msg,
      h('div', { class: 'form-grid' },
        h('fieldset', { class: 'field radio-group' },
          h('legend', {}, 'Which photos can clients see?'),
          radio('fileVisibility', 'client', 'Only photos shared with the client', 'Photos set to “Show Client” or “Show All” in AroFlo. Recommended.'),
          radio('fileVisibility', 'all', 'All photos', 'Also shows photos marked “Internal Only”. Other documents are never shown.')),
        h('label', { class: 'check wide' }, includeArchived,
          h('span', {}, 'Include archived jobs', h('div', { class: 'hint' }, 'AroFlo moves completed jobs to Archived after invoicing. Leave on so clients keep their full history.'))),
        h('label', { class: 'field' }, h('span', {}, 'Sync jobs completed on or after'), syncFrom,
          h('span', { class: 'hint' }, 'Older jobs are never read from AroFlo. Moving this later removes older jobs; moving it earlier downloads them for active clients.')),
        h('label', { class: 'field' }, h('span', {}, 'Backup check for missed webhooks'), interval,
          h('span', { class: 'hint' }, 'AroFlo webhooks update the portal as jobs change. This check only catches anything a webhook missed.')),
      ),
      h('div', { class: 'button-row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')),
    ),
  );
  mount(content, form);
}

// ---------- AroFlo sync & connection ----------
async function renderStatus() {
  mount(content, h('div', { class: 'panel' }, loading(4)));
  let data;
  try {
    data = await api('/api/admin/status');
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  const { stats: s, sync: y } = data;
  const msg = h('div');
  const stat = (label, value) => h('div', { class: 'stat' }, h('span', {}, label), h('b', {}, value ?? '—'));

  const kick = (full) => async (e) => {
    if (full && !confirm('Re-download every completed job from AroFlo? This uses more of the daily API allowance and can take a few minutes.')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('/api/admin/sync', { method: 'POST', body: { full } });
      mount(msg, okBox(full ? 'Full resync started. Refresh this page in a minute to see progress.' : 'Sync started. Refresh this page in a few seconds.'));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
    btn.disabled = false;
  };

  const urlBox = h('input', { type: 'text', value: data.webhookUrl, readonly: true, 'aria-label': 'Webhook URL', onfocus: (e) => e.target.select() });
  const copyBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(data.webhookUrl); mount(copyBtn, icon('check'), 'Copied'); } catch { urlBox.select(); }
  } }, icon('copy'), 'Copy');

  mount(content,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Job sync'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: kick(true) }, 'Full resync'),
        h('button', { class: 'btn primary', type: 'button', onclick: kick(false) }, icon('refresh'), 'Sync now')),
      h('div', { class: 'panel-body' },
        msg,
        data.mode === 'demo' ? h('div', { class: 'alert warn' }, icon('alert'), h('span', {}, 'Demo mode: sample data, not live AroFlo jobs. Set DEMO_MODE=false and restart to go live.')) : null,
        y.lastError ? errorBox(`The last sync failed: ${y.lastError}`) : null,
        s.pausedUntil && new Date(s.pausedUntil) > new Date()
          ? h('div', { class: 'alert warn' }, icon('alert'), h('span', {}, `AroFlo calls are paused until ${localTime(s.pausedUntil)} because today's API allowance is nearly used up. This keeps calls in reserve for TTS's other AroFlo integrations.`))
          : null,
        h('div', { class: 'stats' },
          stat('Status', y.running ? 'Syncing now…' : 'Up to date'),
          stat('Last successful sync', localTime(y.lastSuccessAt)),
          stat('Last webhook from AroFlo', localTime(y.lastWebhookAt)),
          stat('Completed jobs stored', y.jobs),
          stat('Photos stored on server', `${y.photosSaved.toLocaleString()} of ${y.photos.toLocaleString()} available`),
          stat('Active clients', `${y.activeClients} of ${y.clients}`),
        ),
        h('p', { class: 'hint' },
          'Completed jobs, notes and photos are copied into the portal, so clients viewing jobs never use the AroFlo API. ',
          'Photos of jobs from the last 30 days are pre-downloaded in the background (newest first, while storage has room); older jobs\' photos download when first opened and are stored smaller. The least recently viewed are cleared when storage is full. Last full download: ', localTime(y.fullSyncAt), '.'),
      ),
    ),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'AroFlo webhook')),
      h('div', { class: 'panel-body' },
        h('p', {}, 'Webhooks keep the portal up to date as jobs change, with very few AroFlo API calls. Add this URL in AroFlo:'),
        h('ol', { class: 'steps' },
          h('li', {}, 'In AroFlo, open Site Admin → Settings → Event Messages.'),
          h('li', {}, 'Under Task Status – Completed, add a Webhook message, paste the URL below, and save.'),
          h('li', {}, 'Recommended: add the same URL to Task Status – Archived and Task – Add Task Note.')),
        h('div', { class: 'copy-row' }, urlBox, copyBtn),
        h('p', { class: 'hint' }, 'Keep this URL private. Its random part is what proves a request came from your AroFlo.'),
      ),
    ),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'AroFlo API usage')),
      h('div', { class: 'panel-body' },
        h('div', { class: 'stats' },
          stat('API calls since restart', s.requestsMade),
          stat('Daily allowance left', s.dailyRemaining != null ? `${s.dailyRemaining} of ${s.dailyLimit ?? 2000}` : null),
          stat('Single-job lookups left today', s.singleRecordRemaining != null ? `${s.singleRecordRemaining} of 20,000` : null),
          stat('Last AroFlo error', s.lastError ? `${s.lastError} (${localTime(s.lastErrorAt)})` : 'None'),
        ),
        h('p', { class: 'hint' }, `The per-minute limit is shared with TTS’s other AroFlo integrations. ${plural(Math.round(60 / Math.max(1, Number(data.syncIntervalMinutes) || 60) * 24), 'backup check')} a day at the current setting.`),
      ),
    ),
  );
}
