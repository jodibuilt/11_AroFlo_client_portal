import { api, h, mount, icon, renderTopbar, fmtDateTime, loading, errorBox } from './common.js';

const root = document.getElementById('root');
const me = await api('/api/me');
const content = h('div');
const sidenav = h('nav', { class: 'sidenav', 'aria-label': 'Control panel sections' });
mount(root,
  renderTopbar({ user: me.user, portalName: me.portalName, mode: me.mode, active: 'admin' }),
  h('div', { class: 'pagehead' }, h('h1', {}, 'Control Panel'), h('span', { class: 'crumbs' }, 'Manage client logins and what they can see')),
  h('main', {}, h('div', { class: 'admin-layout' }, sidenav, content)),
);

const SECTIONS = [
  ['users', 'Users', 'user', renderUsers],
  ['settings', 'Portal Settings', 'cog', renderSettings],
  ['status', 'AroFlo Sync', 'pulse', renderStatus],
];

let clientsCache = null;
async function loadClients(force = false) {
  if (!clientsCache || force) {
    clientsCache = api(`/api/admin/clients${force ? '?refresh=1' : ''}`).then((d) => d.clients);
    clientsCache.catch(() => { clientsCache = null; });
  }
  return clientsCache;
}

window.addEventListener('hashchange', route);
route();

function route() {
  document.querySelectorAll('.drawer, .drawer-bg').forEach((el) => el.remove());
  const id = location.hash.slice(1) || 'users';
  const section = SECTIONS.find((s) => s[0] === id) || SECTIONS[0];
  mount(sidenav, h('h3', {}, 'Site Admin'), SECTIONS.map(([sid, label, ic]) =>
    h('a', { href: `#${sid}`, class: sid === section[0] ? 'active' : '' }, icon(ic), label)));
  section[3]();
}

// ---------- Users ----------
let users = [];
let userSearch = '';

async function renderUsers() {
  mount(content, h('div', { class: 'panel' }, loading('Loading users…')));
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
    mount(tableHost, rows.length ? h('div', { class: 'grid-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Name', 'Email', 'Role', 'Linked clients', 'Status', 'Last sign-in', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((u) => h('tr', {},
        h('td', {}, h('a', { href: '#users', onclick: (e) => { e.preventDefault(); openUserDrawer(u); } }, u.name)),
        h('td', {}, u.email),
        h('td', {}, h('span', { class: `tag ${u.role === 'admin' ? 'admin' : ''}` }, u.role === 'admin' ? 'Admin' : 'Client')),
        h('td', {}, u.role === 'admin' ? h('span', { class: 'sub' }, 'All clients') :
          u.clients.length ? [u.clients.slice(0, 3).map((c) => h('span', { class: 'tag' }, c.clientName)),
            u.clients.length > 3 ? h('span', { class: 'sub' }, ` +${u.clients.length - 3} more`) : null]
            : h('span', { class: 'tag off' }, 'None assigned')),
        h('td', {}, u.active ? 'Active' : h('span', { class: 'tag off' }, 'Disabled')),
        h('td', { class: 'nowrap' }, u.last_login_at ? fmtDateTime(u.last_login_at.replace(' ', 'T')) + ' UTC' : 'Never'),
        h('td', { class: 'nowrap' },
          h('button', { class: 'btn small', type: 'button', onclick: () => openUserDrawer(u) }, 'Edit'), ' ',
          u.role === 'client' && u.clients[0]
            ? h('a', { class: 'btn small', href: `/?client=${encodeURIComponent(u.clients[0].clientId)}`, title: 'See what this user sees' }, icon('eye'), 'Preview')
            : null),
      ))),
    )) : h('div', { class: 'empty' }, users.length ? 'No users match your search.' : 'No users yet. Create one to give a client access.'));
  };
  draw();
  mount(content,
    flash || null,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, 'Users', h('span', { class: 'count' }, `(${users.length})`), h('span', { class: 'spacer' }),
        h('input', { type: 'search', placeholder: 'Search users or clients…', value: userSearch, class: 'head-search', 'aria-label': 'Search users',
          oninput: (e) => { userSearch = e.target.value; draw(); } }),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openUserDrawer(null) }, icon('plus'), 'New User')),
      tableHost,
    ),
  );
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function openUserDrawer(user) {
  const isNew = !user;
  const isSelf = user?.id === me.user.id;
  const selected = new Map((user?.clients || []).map((c) => [c.clientId, c]));
  const msg = h('div');

  const name = h('input', { type: 'text', value: user?.name || '', required: true, autocomplete: 'off' });
  const email = h('input', { type: 'email', value: user?.email || '', required: true, autocomplete: 'off' });
  const role = h('select', { disabled: isSelf },
    h('option', { value: 'client', selected: user?.role !== 'admin' }, 'Client - sees only their linked clients'),
    h('option', { value: 'admin', selected: user?.role === 'admin' }, 'Admin - manages the portal'));
  const active = h('input', { type: 'checkbox', checked: user ? user.active : true, disabled: isSelf });
  const password = h('input', { type: 'text', autocomplete: 'new-password', placeholder: isNew ? 'At least 8 characters' : 'Leave blank to keep current password' });
  if (isNew) password.value = generatePassword();

  // Client picker
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'picker-list' }, loading('Loading AroFlo clients…'));
  let allClients = [];
  let filter = '';
  const search = h('input', { type: 'search', placeholder: 'Search AroFlo clients…', 'aria-label': 'Search AroFlo clients',
    oninput: (e) => { filter = e.target.value; drawList(); } });
  const drawChips = () => mount(chips, selected.size
    ? [...selected.values()].map((c) => h('span', { class: 'chip' }, c.clientName,
      h('button', { type: 'button', 'aria-label': `Remove ${c.clientName}`, onclick: () => { selected.delete(c.clientId); drawChips(); drawList(); } }, '×')))
    : h('span', { class: 'sub' }, 'No clients linked - this user will see no jobs.'));
  const drawList = () => {
    if (!allClients.length) return;
    const needle = filter.trim().toLowerCase();
    const matches = allClients.filter((c) => !needle || c.clientName.toLowerCase().includes(needle));
    mount(list, matches.slice(0, 200).map((c) => h('label', {},
      h('input', { type: 'checkbox', checked: selected.has(c.clientId),
        onchange: (e) => { if (e.target.checked) selected.set(c.clientId, c); else selected.delete(c.clientId); drawChips(); } }),
      c.clientName)),
    matches.length > 200 ? h('div', { class: 'empty' }, `${matches.length - 200} more - refine your search.`) : null,
    !matches.length ? h('div', { class: 'empty' }, 'No clients match.') : null);
  };
  drawChips();
  loadClients().then((c) => { allClients = c; drawList(); })
    .catch((err) => mount(list, h('div', { class: 'error-box' }, `Couldn't load clients from AroFlo: ${err.message}`)));

  const clientField = h('div', { class: 'field wide' },
    h('span', {}, 'Linked AroFlo clients ', h('span', { class: 'hint' }, '- the user only sees completed jobs for these clients')),
    h('div', { class: 'picker' }, chips, search, list));
  const syncRole = () => { clientField.hidden = role.value !== 'client'; };
  role.addEventListener('change', syncRole);
  syncRole();

  const close = () => { bg.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  async function save(e) {
    e.preventDefault();
    mount(msg);
    const body = {
      name: name.value, email: email.value, role: role.value, active: active.checked,
      clients: [...selected.values()],
    };
    if (password.value) body.password = password.value;
    saveBtn.disabled = true;
    try {
      if (isNew) await api('/api/admin/users', { method: 'POST', body });
      else await api(`/api/admin/users/${user.id}`, { method: 'PUT', body });
      close();
      users = (await api('/api/admin/users')).users;
      drawUsers(password.value ? passwordReveal(body.email, password.value, isNew) : h('div', { class: 'ok-box' }, `Saved ${body.name}.`));
    } catch (err) {
      mount(msg, errorBox(err.message));
      saveBtn.disabled = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete ${user.name}? They will no longer be able to sign in. This can't be undone.`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      close();
      users = users.filter((u) => u.id !== user.id);
      drawUsers(h('div', { class: 'ok-box' }, `Deleted ${user.name}.`));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  }

  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Create user' : 'Save changes');
  const bg = h('div', { class: 'drawer-bg', onclick: close });
  const drawer = h('form', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'New user' : `Edit ${user.name}`, onsubmit: save, novalidate: true },
    h('div', { class: 'panel-head' }, isNew ? 'New User' : `Edit User: ${user.name}`, h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', onclick: close, 'aria-label': 'Close' }, icon('close'))),
    h('div', { class: 'drawer-body' },
      msg,
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field' }, h('span', {}, 'Email (sign-in)'), email),
        h('label', { class: 'field wide' }, h('span', {}, 'Role'), role),
        h('div', { class: 'field wide' },
          h('span', {}, isNew ? 'Password' : 'Reset password'),
          password,
          h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { password.value = generatePassword(); } }, 'Generate password'))),
        clientField,
        !isNew ? h('label', { class: 'check wide' }, active, h('span', {}, 'Account active', h('span', { class: 'hint' }, isSelf ? ' (you can’t disable yourself)' : ' - untick to block sign-in without deleting'))) : null,
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
  const code = h('code', {}, password);
  const copy = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(`Sign in at ${location.origin}\nEmail: ${email}\nPassword: ${password}`); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
  } }, 'Copy sign-in details');
  return h('div', { class: 'pw-reveal', role: 'status' },
    h('span', {}, `${isNew ? 'User created.' : 'Password updated.'} Send ${email} this password - it won't be shown again:`),
    code, copy);
}

// ---------- Settings ----------
async function renderSettings() {
  mount(content, h('div', { class: 'panel' }, loading()));
  let settings;
  try {
    settings = (await api('/api/admin/settings')).settings;
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  const msg = h('div');
  const portalName = h('input', { type: 'text', value: settings.portalName, maxlength: '60' });
  const radio = (name, value, label, hint) => h('label', { class: 'check' },
    h('input', { type: 'radio', name, value, checked: settings[name] === value }),
    h('span', {}, label, h('div', { class: 'hint' }, hint)));
  const includeArchived = h('input', { type: 'checkbox', checked: settings.includeArchived });

  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        portalName: portalName.value,
        noteVisibility: fd.get('noteVisibility'),
        fileVisibility: fd.get('fileVisibility'),
        includeArchived: includeArchived.checked,
      } });
      mount(msg, h('div', { class: 'ok-box' }, 'Settings saved. Clients will see the change on their next page load.'));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  } },
    h('div', { class: 'panel-head' }, 'Portal Settings'),
    h('div', { class: 'panel-body' },
      msg,
      h('div', { class: 'form-grid' },
        h('label', { class: 'field wide' }, h('span', {}, 'Portal name'), portalName),
        h('fieldset', { class: 'field radio-group' },
          h('legend', {}, h('b', {}, 'Which notes can clients see?')),
          radio('noteVisibility', 'client', 'Only client-visible notes (recommended)', 'Notes set to "Show Client" or "Show All" in AroFlo.'),
          radio('noteVisibility', 'all', 'All notes', 'Includes "Internal Only" and "Internal Admin Only" notes.')),
        h('fieldset', { class: 'field radio-group' },
          h('legend', {}, h('b', {}, 'Which photos can clients see?')),
          radio('fileVisibility', 'client', 'Only client-visible photos (recommended)', 'Photos set to "Show Client" or "Show All" in AroFlo.'),
          radio('fileVisibility', 'all', 'All photos', 'Includes photos marked "Internal Only". Other documents (PDFs etc.) are never shown to clients.')),
        h('label', { class: 'check wide' }, includeArchived,
          h('span', {}, 'Include Archived jobs', h('div', { class: 'hint' }, 'AroFlo moves completed jobs to Archived after invoicing. Leave on so clients keep their job history.'))),
      ),
      h('p', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')),
    ),
  );
  mount(content, form);
}

// ---------- AroFlo sync & connection ----------
async function renderStatus() {
  mount(content, h('div', { class: 'panel' }, loading()));
  let data;
  try {
    data = await api('/api/admin/status');
  } catch (err) {
    return mount(content, errorBox(err.message));
  }
  const { stats: s, sync: y } = data;
  const msg = h('div');
  const stat = (label, value) => h('div', { class: 'stat' }, h('span', {}, label), h('b', {}, value ?? '—'));
  const when = (v) => (v ? new Date(v).toLocaleString() : 'Never');

  const kick = (full) => async (e) => {
    if (full && !confirm('Re-download every completed job from AroFlo? This uses more of the daily API allowance and can take a few minutes.')) return;
    e.currentTarget.disabled = true;
    try {
      await api('/api/admin/sync', { method: 'POST', body: { full } });
      mount(msg, h('div', { class: 'ok-box' }, full ? 'Full resync started. Refresh this page in a minute to see progress.' : 'Sync started. Refresh this page in a few seconds.'));
    } catch (err) {
      mount(msg, errorBox(err.message));
    }
  };

  const urlBox = h('input', { type: 'text', value: data.webhookUrl, readonly: true, 'aria-label': 'Webhook URL', onfocus: (e) => e.target.select() });
  const copyBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(data.webhookUrl); copyBtn.textContent = 'Copied'; } catch { urlBox.select(); }
  } }, 'Copy');

  mount(content,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, 'Job Sync'),
      h('div', { class: 'panel-body' },
        msg,
        data.mode === 'demo' ? h('div', { class: 'demo-banner' }, 'Running in demo mode with sample data. Set DEMO_MODE=false in .env and restart to use live AroFlo data.') : null,
        y.lastError ? errorBox(`Last sync failed: ${y.lastError}`) : null,
        h('p', {}, 'Completed jobs, notes and photos are copied from AroFlo into the portal. Clients only ever see this copy, so viewing jobs never uses the AroFlo API allowance.'),
        h('div', { class: 'stats' },
          stat('Status', y.running ? 'Syncing now…' : 'Idle'),
          stat('Last successful sync', when(y.lastSuccessAt)),
          stat('Completed jobs stored', y.jobs),
          stat('Photos downloaded', `${y.photosSaved} of ${y.photos}`),
          stat('AroFlo clients', y.clients),
          stat('Last webhook from AroFlo', when(y.lastWebhookAt)),
        ),
        h('p', { class: 'sub' },
          'Checks AroFlo for changed tasks every 5 minutes (this check is free under AroFlo\'s limits), and immediately when the webhook below is called. ',
          'Photos are downloaded for clients linked to a portal user. Last full download: ', when(y.fullSyncAt), '.'),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: kick(false) }, icon('refresh'), 'Sync now'),
          h('button', { class: 'btn', type: 'button', onclick: kick(true) }, 'Full resync'),
        ),
      ),
    ),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, 'AroFlo Webhook (instant updates)'),
      h('div', { class: 'panel-body' },
        h('p', {}, 'So jobs appear the moment they are completed, add this URL as a webhook in AroFlo:'),
        h('ol', { class: 'steps' },
          h('li', {}, 'In AroFlo go to Site Admin → Settings → Event Messages.'),
          h('li', {}, 'Create a new message for the Task Completed event and choose Webhook as the type.'),
          h('li', {}, 'Paste this URL and save. If the payload can include the Task ID, add it (optional).')),
        h('div', { class: 'copy-row' }, urlBox, copyBtn),
        h('p', { class: 'sub' }, 'Keep this URL private - the random part is what proves a request came from your AroFlo. AroFlo can only reach it once the portal is on a public address (e.g. Azure), not on localhost.'),
      ),
    ),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, 'AroFlo API Usage'),
      h('div', { class: 'panel-body' },
        h('div', { class: 'stats' },
          stat('API calls since restart', s.requestsMade),
          stat('Daily allowance left', s.dailyRemaining != null ? `${s.dailyRemaining} / ${s.dailyLimit ?? 2000}` : null),
          stat('Single-job lookups left today', s.singleRecordRemaining != null ? `${s.singleRecordRemaining} / 20000` : null),
          stat('Last AroFlo error', s.lastError ? `${s.lastError} (${when(s.lastErrorAt)})` : 'None'),
        ),
      ),
    ),
  );
}
