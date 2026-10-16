import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { openDatabase, DEFAULT_SETTINGS } from './db.js';
import { createAroFloClient, AroFloError } from './aroflo.js';
import { createMockClient } from './mock.js';
import { createPortalData } from './data.js';
import { createStore } from './store.js';
import { createSync } from './sync.js';
import {
  hashPassword, checkLogin, startSession, endSession, sessionMiddleware,
  requireUser, requireAdmin, requireJson, loginThrottle,
} from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(ROOT, '.env'));
const env = process.env;

// The project's .env wins over inherited variables. Editors (e.g. VS Code) can inject
// an old copy of .env into the terminal, which would otherwise silently keep stale
// AroFlo credentials alive after the key is regenerated. On Azure, App Settings are the
// source of truth, so a stray .env never overrides them there.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const values = parseEnv(fs.readFileSync(file, 'utf8'));
  if (process.env.WEBSITE_SITE_NAME) {
    for (const [k, v] of Object.entries(values)) process.env[k] ??= v;
    return;
  }
  const overridden = Object.keys(values).filter((k) => process.env[k] !== undefined && process.env[k] !== values[k]);
  if (overridden.length) console.warn(`.env overrides values already set in this terminal: ${overridden.join(', ')}`);
  Object.assign(process.env, values);
}

// Azure App Service sets WEBSITE_SITE_NAME. There the app sits behind Azure's HTTPS
// front end, and only /home survives restarts and redeploys.
const ON_AZURE = Boolean(env.WEBSITE_SITE_NAME);
const PORT = Number(env.PORT) || 3000;
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || (ON_AZURE ? '/home/data' : 'data'));
const COOKIE_SECURE = (env.COOKIE_SECURE ?? (ON_AZURE ? 'true' : 'false')) === 'true';
const TRUST_PROXY = env.TRUST_PROXY ?? (ON_AZURE ? '1' : '');
// /home on App Service is network storage, where SQLite's WAL mode isn't safe.
const SQLITE_JOURNAL_MODE = env.SQLITE_JOURNAL_MODE || (ON_AZURE ? 'DELETE' : 'WAL');
const demoMode = env.DEMO_MODE === 'true';
// On a public server, creating the first admin needs this code so nobody else can claim it.
const SETUP_TOKEN = env.SETUP_TOKEN || '';
const SETUP_NEEDS_CODE = ON_AZURE || Boolean(SETUP_TOKEN);

const aroflo = demoMode
  ? createMockClient()
  : createAroFloClient({
      baseUrl: env.AROFLO_API_BASE_URL || 'https://api.aroflo.com/',
      secretKey: env.AROFLO_SECRET_KEY,
      uEncoded: env.AROFLO_UENCODED,
      pEncoded: env.AROFLO_PENCODED,
      orgEncoded: env.AROFLO_ORG_ENCODED,
      hostIp: env.AROFLO_HOST_IP,
    });
const HAS_AROFLO_LOGIN = demoMode || Boolean(env.AROFLO_SECRET_KEY && env.AROFLO_UENCODED && env.AROFLO_PENCODED && env.AROFLO_ORG_ENCODED);
if (!HAS_AROFLO_LOGIN) {
  console.warn('AroFlo credentials are not set, so syncing is off (no AroFlo API calls). The portal still serves the jobs it already has.');
}

const db = openDatabase(DATA_DIR, { journalMode: SQLITE_JOURNAL_MODE });
const store = createStore(db, path.join(DATA_DIR, 'files'));

// If the AroFlo login changed (e.g. .env or Azure App Settings now point at another
// AroFlo account), the synced copy belongs to the old account: clear it so the next
// sync downloads the new account's jobs instead of mixing the two.
if (HAS_AROFLO_LOGIN) {
  const accountKey = crypto.createHash('sha256')
    .update(demoMode ? 'demo' : `${env.AROFLO_ORG_ENCODED}|${env.AROFLO_UENCODED}`).digest('hex');
  const previous = store.getState('arofloAccount');
  if (previous !== accountKey) {
    if (previous || store.counts().jobs) {
      console.log('AroFlo account changed: clearing the previous account\'s synced jobs and clients for a fresh download.');
      store.resetSyncedData();
    }
    store.setState('arofloAccount', accountKey);
  }
}
const sync = createSync({
  aroflo,
  store,
  getIntervalMinutes: () => Number(env.SYNC_INTERVAL_MINUTES) || db.getSettings().syncIntervalMinutes,
});
const portal = createPortalData({ store, sync });
setInterval(() => db.purgeSessions(), 3600_000).unref();

// Secret part of the webhook URL given to AroFlo. Set WEBHOOK_SECRET to choose it;
// otherwise one is generated once and kept in the database.
const WEBHOOK_SECRET = env.WEBHOOK_SECRET || store.getState('webhookSecret') || (() => {
  const secret = crypto.randomBytes(24).toString('base64url');
  store.setState('webhookSecret', secret);
  return secret;
})();

const app = express();
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
app.disable('x-powered-by');

// Health probe for Azure App Service (no auth, touches the database).
app.get('/healthz', (_req, res) => {
  db.hasUsers();
  res.type('text').send('ok');
});

// AroFlo Event Message webhook (e.g. "Task Completed"). AroFlo's payload format isn't
// documented, so we don't depend on it: any task ids found are fetched first, and every
// call triggers a check of what changed in AroFlo. Always answers quickly.
app.post('/webhooks/aroflo/:secret', express.raw({ type: () => true, limit: '256kb' }), (req, res) => {
  if (!sameSecret(req.params.secret, WEBHOOK_SECRET)) return res.status(404).end();
  sync.notify(findTaskIds(req.body, req.query));
  res.status(202).json({ ok: true });
});

app.use(express.json({ limit: '100kb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  next();
});
app.use(sessionMiddleware(db));
app.use('/api', requireJson);

const SYNC_INTERVAL_CHOICES = [15, 30, 60, 180, 360, 720, 1440];
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role };

// ---------- Pages ----------
const page = (file) => path.join(ROOT, 'public', file);
app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(page('app.html'));
});
app.get('/admin', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.redirect('/');
  res.sendFile(page('admin.html'));
});
app.get('/login', (req, res) => (req.user ? res.redirect('/') : res.sendFile(page('login.html'))));
app.use(express.static(path.join(ROOT, 'public'), { index: false, extensions: [] }));

// ---------- Session ----------
app.get('/api/session', (req, res) => {
  res.json({
    user: publicUser(req.user),
    needsSetup: !db.hasUsers(),
    setupNeedsCode: SETUP_NEEDS_CODE,
    portalName: db.getSettings().portalName,
    mode: aroflo.mode,
  });
});

app.post('/api/setup', (req, res) => {
  if (db.hasUsers()) return res.status(409).json({ error: 'Setup has already been completed.' });
  const { name, email, password, setupCode } = req.body || {};
  if (SETUP_NEEDS_CODE && !(SETUP_TOKEN && sameSecret(setupCode, SETUP_TOKEN))) {
    return res.status(403).json({ error: SETUP_TOKEN ? 'Incorrect setup code.' : 'Setup is locked: set the SETUP_TOKEN app setting first.' });
  }
  const problem = validateUser({ name, email, password, role: 'admin' }, true);
  if (problem) return res.status(400).json({ error: problem });
  const id = db.createUser({ email: email.trim(), name: name.trim(), role: 'admin', passwordHash: hashPassword(password) });
  startSession(db, res, id, COOKIE_SECURE);
  res.json({ user: publicUser(db.getUser(id)) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = loginThrottle.key(req, email);
  if (loginThrottle.blocked(key)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  }
  const user = checkLogin(db, email, password);
  if (!user) {
    loginThrottle.fail(key);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  loginThrottle.clear(key);
  db.touchLogin(user.id);
  startSession(db, res, user.id, COOKIE_SECURE);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  endSession(db, req, res);
  res.json({ ok: true });
});

// ---------- Client portal ----------
// Admins may view any AroFlo client (to preview what a client sees); client users
// only ever get the clients assigned to them in the control panel.
function resolveClient(req, clientId) {
  if (req.user.role === 'admin') return clientId ? portal.getClient(clientId) : null;
  const mine = db.clientsForUser(req.user.id);
  return clientId ? mine.find((c) => c.clientId === clientId) || null : mine[0] || null;
}
const allowedClientIds = (req) =>
  req.user.role === 'admin' ? null : db.clientsForUser(req.user.id).map((c) => c.clientId);

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: publicUser(req.user),
    clients: req.user.role === 'admin' ? [] : db.clientsForUser(req.user.id),
    portalName: db.getSettings().portalName,
    mode: aroflo.mode,
  });
});

// Client users get every job for all of their linked companies in one list (newest
// first, labelled by company when there's more than one); they never pick a company.
// Admins pass ?clientId= to preview one client.
app.get('/api/jobs', requireUser, (req, res) => {
  const settings = db.getSettings();
  if (req.user.role !== 'admin') {
    const mine = db.clientsForUser(req.user.id);
    if (!mine.length) return res.status(404).json({ error: 'No client account is linked to your login yet.' });
    const jobs = mine
      .flatMap((c) => portal.jobsForClient(c.clientId, settings)
        .map((j) => (mine.length > 1 ? { ...j, clientName: c.clientName } : j)))
      .sort((a, b) => String(b.completed || '').localeCompare(String(a.completed || '')));
    return res.json({ clients: mine, jobs });
  }
  const client = resolveClient(req, req.query.clientId);
  if (!client) return res.status(404).json({ error: 'Choose a client to preview.' });
  res.json({ clients: [client], jobs: portal.jobsForClient(client.clientId, settings) });
});

app.get('/api/jobs/:taskId', requireUser, (req, res) => {
  const job = portal.jobDetail(req.params.taskId, allowedClientIds(req), db.getSettings());
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job });
});

app.get('/api/jobs/:taskId/files/:docId', requireUser, ah(async (req, res) => {
  const file = await portal.getFile(req.params.taskId, req.params.docId, allowedClientIds(req), db.getSettings());
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const inline = req.query.download !== '1' && /^(image\/|application\/pdf)/i.test(file.contentType);
  const safeName = file.name.replace(/[^\w.\- ]+/g, '_');
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, max-age=86400',
    // Uploaded files are untrusted: never let one run script on our origin.
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  });
  res.sendFile(file.filePath);
}));

// ---------- Control panel ----------
const admin = express.Router();
admin.use(requireUser, requireAdmin);

admin.get('/status', (req, res) => {
  res.json({
    mode: aroflo.mode,
    stats: aroflo.stats,
    sync: { ...sync.status, ...store.counts(), fullSyncAt: store.getState('fullSyncAt') },
    webhookUrl: `${req.protocol}://${req.get('host')}/webhooks/aroflo/${WEBHOOK_SECRET}`,
    syncIntervalMinutes: Number(env.SYNC_INTERVAL_MINUTES) || db.getSettings().syncIntervalMinutes,
  });
});

// Kicks off a sync now. { full: true } re-downloads every completed job from scratch.
admin.post('/sync', (req, res) => {
  if (req.body?.full) sync.fullResync();
  else sync.run();
  res.json({ ok: true });
});

admin.get('/clients', ah(async (req, res) => {
  if (req.query.refresh === '1' || !store.hasClients()) await sync.refreshClients();
  res.json({ clients: portal.listClients() });
}));

admin.get('/users', (_req, res) => res.json({ users: db.listUsers() }));

admin.post('/users', ah(async (req, res) => {
  const input = req.body || {};
  const problem = validateUser(input, true);
  if (problem) return res.status(400).json({ error: problem });
  if (db.getUserByEmail(input.email.trim())) return res.status(409).json({ error: 'A user with that email already exists.' });
  const id = db.createUser({
    email: input.email.trim(),
    name: input.name.trim(),
    role: input.role,
    passwordHash: hashPassword(input.password),
    clients: input.role === 'client' ? await normaliseClients(input.clients) : [],
  });
  sync.runSoon(); // fetch photos for any newly linked client
  res.json({ user: db.listUsers().find((u) => u.id === id) });
}));

admin.put('/users/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getUser(id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const input = { ...req.body, active: req.body?.active !== false };
  const problem = validateUser(input, false);
  if (problem) return res.status(400).json({ error: problem });
  const other = db.getUserByEmail(input.email.trim());
  if (other && other.id !== id) return res.status(409).json({ error: 'A user with that email already exists.' });
  if (existing.role === 'admin' && (input.role !== 'admin' || !input.active) && wouldRemoveLastAdmin(id)) {
    return res.status(400).json({ error: 'You need at least one active admin.' });
  }
  db.updateUser(id, {
    email: input.email.trim(),
    name: input.name.trim(),
    role: input.role,
    active: input.active,
    clients: input.role === 'client' ? await normaliseClients(input.clients) : [],
  });
  if (input.password) {
    db.setPassword(id, hashPassword(input.password));
    if (id !== req.user.id) db.deleteUserSessions(id);
  }
  sync.runSoon(); // fetch photos for any newly linked client
  res.json({ user: db.listUsers().find((u) => u.id === id) });
}));

admin.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.getUser(id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  if (existing.role === 'admin' && wouldRemoveLastAdmin(id)) {
    return res.status(400).json({ error: 'You need at least one active admin.' });
  }
  db.deleteUser(id);
  res.json({ ok: true });
});

admin.get('/settings', (_req, res) => res.json({ settings: db.getSettings() }));

admin.put('/settings', (req, res) => {
  const s = req.body || {};
  const next = {
    noteVisibility: s.noteVisibility === 'all' ? 'all' : 'client',
    fileVisibility: s.fileVisibility === 'all' ? 'all' : 'client',
    includeArchived: s.includeArchived !== false,
    syncIntervalMinutes: SYNC_INTERVAL_CHOICES.includes(Number(s.syncIntervalMinutes)) ? Number(s.syncIntervalMinutes) : DEFAULT_SETTINGS.syncIntervalMinutes,
    portalName: String(s.portalName || DEFAULT_SETTINGS.portalName).trim().slice(0, 60) || DEFAULT_SETTINGS.portalName,
  };
  db.saveSettings(next);
  res.json({ settings: db.getSettings() });
});

app.use('/api/admin', admin);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, _next) => {
  if (err instanceof AroFloError) {
    console.error(`AroFlo error on ${req.method} ${req.path}: ${err.message} (status ${err.status})`);
    const detail = req.user?.role === 'admin' ? ` AroFlo said: "${err.message}"` : '';
    return res.status(502).json({ error: `Couldn't reach AroFlo right now. Please try again shortly.${detail}` });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ---------- Helpers ----------
function validateUser(u, passwordRequired) {
  if (!u || typeof u !== 'object') return 'Missing user details.';
  if (!String(u.name || '').trim()) return 'Name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u.email || '').trim())) return 'Enter a valid email address.';
  if (!['admin', 'client'].includes(u.role)) return 'Role must be admin or client.';
  if (passwordRequired || u.password) {
    if (typeof u.password !== 'string' || u.password.length < 8) return 'Password must be at least 8 characters.';
  }
  if (u.role === 'client' && u.clients !== undefined && !Array.isArray(u.clients)) return 'Clients must be a list.';
  return null;
}

// Use the client names from our synced AroFlo client list where we have them.
async function normaliseClients(clients) {
  const known = new Map(portal.listClients().map((c) => [c.clientId, c.clientName]));
  return (Array.isArray(clients) ? clients : [])
    .filter((c) => c && typeof c.clientId === 'string' && c.clientId)
    .map((c) => ({ clientId: c.clientId, clientName: known.get(c.clientId) || String(c.clientName || '').trim() || c.clientId }));
}

// Collects anything that looks like an AroFlo task id from a webhook payload
// (JSON or form fields, any nesting) and the query string.
function findTaskIds(rawBody, query) {
  const ids = new Set();
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.forEach((v) => visit(v, key));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => visit(v, k));
    if (/^task_?id$/i.test(key) && typeof value === 'string' && /^[\w+/=-]{4,64}$/.test(value)) ids.add(value);
  };
  visit(query);
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';
  try {
    visit(JSON.parse(text));
  } catch {
    visit(Object.fromEntries(new URLSearchParams(text)));
  }
  // AroFlo's Event Message payloads ({"payload":{"api_related_ids":{"taskid":"..."}}}) can
  // contain raw line breaks inside note text, which makes them invalid JSON. Fall back to
  // reading "taskid": "..." pairs straight from the text.
  for (const m of text.matchAll(/"task_?id"\s*:\s*"([\w+/=-]{4,64})"/gi)) ids.add(m[1]);
  return [...ids];
}

function sameSecret(a, b) {
  const hash = (v) => crypto.createHash('sha256').update(String(v ?? '')).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function wouldRemoveLastAdmin(id) {
  return !db.listUsers().some((u) => u.role === 'admin' && u.active && u.id !== id);
}

const server = app.listen(PORT, () => {
  console.log(`Client portal running at http://localhost:${PORT}  (${aroflo.mode === 'demo' ? 'DEMO data' : 'live AroFlo data'})`);
  if (!db.hasUsers()) console.log(`No users yet - open http://localhost:${PORT}/login to create the first admin account.`);
  if (HAS_AROFLO_LOGIN) sync.start();
});

// App Service sends SIGTERM on restart/redeploy: finish in-flight requests, then close the database.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
