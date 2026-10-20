import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { openDatabase, DEFAULT_SETTINGS } from './db.js';
import { prepareLocalCopy, snapshotTo, snapshotToSync } from './dbfile.js';
import { createAroFloClient, AroFloError } from './aroflo.js';
import { createMockClient } from './mock.js';
import { createPortalData } from './data.js';
import { createStore } from './store.js';
import { createSync } from './sync.js';
import { createTokens } from './tokens.js';
import { createAssets } from './assets.js';
import * as totp from './totp.js';
import {
  hashPassword, checkLogin, startSession, endSession, sessionMiddleware,
  requireUser, requireAdmin, requireJson, sameOrigin, loginThrottle, codeThrottle,
  createLimiter, rateLimit, clientIp,
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
// On Azure the database runs from local disk (see dbfile.js) and is snapshotted to
// DATA_DIR, because SQLite locks are unreliable on the /home network share.
const LOCAL_DB_DIR = env.LOCAL_DB_DIR || (ON_AZURE ? '/tmp/portal-db' : '');
const SQLITE_JOURNAL_MODE = env.SQLITE_JOURNAL_MODE || 'WAL';
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
      dailyReserve: Number(env.AROFLO_DAILY_RESERVE) || 200,
    });
const HAS_AROFLO_LOGIN = demoMode || Boolean(env.AROFLO_SECRET_KEY && env.AROFLO_UENCODED && env.AROFLO_PENCODED && env.AROFLO_ORG_ENCODED);
if (!HAS_AROFLO_LOGIN) {
  console.warn('AroFlo credentials are not set, so syncing is off (no AroFlo API calls). The portal still serves the jobs it already has.');
}

const db = openDatabase(LOCAL_DB_DIR ? prepareLocalCopy(DATA_DIR, LOCAL_DB_DIR) : DATA_DIR, { journalMode: SQLITE_JOURNAL_MODE });

// Save the local database back to DATA_DIR whenever it has changed (checked every 30s),
// and on shutdown. Saves run one at a time; the copy to the share doesn't block requests.
let savedChanges = -1;
let saving = Promise.resolve();
let finalSaveDone = false;
function saveDatabase() {
  if (!LOCAL_DB_DIR) return saving;
  saving = saving.then(async () => {
    const changes = db.handle.prepare('SELECT total_changes() AS n').get().n;
    if (changes === savedChanges || finalSaveDone) return;
    try {
      await snapshotTo(db.handle, DATA_DIR, LOCAL_DB_DIR, () => !finalSaveDone);
      savedChanges = changes;
    } catch (err) {
      console.error(`Saving the database to ${DATA_DIR} failed: ${err.message}`);
    }
  });
  return saving;
}
// Shutdown or crash: save right now, before the process ends.
function saveDatabaseNow() {
  if (!LOCAL_DB_DIR) return;
  finalSaveDone = true;
  try {
    snapshotToSync(db.handle, DATA_DIR, LOCAL_DB_DIR);
  } catch (err) {
    console.error(`Saving the database to ${DATA_DIR} failed: ${err.message}`);
  }
}
if (LOCAL_DB_DIR) setInterval(saveDatabase, 30_000).unref();
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
  getSyncFrom: () => db.getSettings().syncFrom,
  // Photos are cached on disk up to this size (MB); on Azure the plan's storage is shared.
  photoCacheBytes: (Number(env.PHOTO_CACHE_MB) || 2000) * 1024 * 1024,
  // Photos of jobs completed more than this many days ago are stored shrunk.
  compressAfterDays: Number(env.PHOTO_COMPRESS_AFTER_DAYS) || 30,
});
const portal = createPortalData({ store, sync });
setInterval(() => db.purgeSessions(), 3600_000).unref();

// Secrets generated on first run are kept in the database, saved straight away so an
// Azure restart before the next snapshot can't lose them.
function storedSecret(key, bytes) {
  const existing = store.getState(key);
  if (existing) return existing;
  const secret = crypto.randomBytes(bytes).toString('base64url');
  store.setState(key, secret);
  saveDatabase();
  return secret;
}

// Secret part of the webhook URL given to AroFlo. Set WEBHOOK_SECRET to choose it.
const WEBHOOK_SECRET = env.WEBHOOK_SECRET || storedSecret('webhookSecret', 24);

// Key for the encrypted references in URLs, sign-in tickets and stored 2FA keys. Best
// kept apart from the database as an App Setting. Without one, a key is generated and
// kept in the database; that key stays readable after APP_SECRET is added later. Once
// set, never change APP_SECRET (that breaks saved links and every admin's 2FA).
if (!env.APP_SECRET && ON_AZURE) {
  console.warn('APP_SECRET is not set, so its key is generated and kept in the database. See README: Security.');
}
const dbAppSecret = store.getState('appSecret');
const tokens = env.APP_SECRET
  ? createTokens(env.APP_SECRET, { previous: dbAppSecret ? [dbAppSecret] : [] })
  : createTokens(dbAppSecret || storedSecret('appSecret', 32));

// Last-resort 2FA recovery, which needs access to the Azure App Settings:
// RESET_2FA_EMAIL=<admin email> clears that admin's authenticator so they set it up
// again at their next sign-in. It runs on every start while set, so remove it afterwards.
if (env.RESET_2FA_EMAIL) {
  const user = db.getUserByEmail(env.RESET_2FA_EMAIL.trim());
  if (user) {
    db.clearTotp(user.id);
    db.deleteUserSessions(user.id);
    saveDatabase();
  }
  console.warn(user
    ? `RESET_2FA_EMAIL: two-factor sign-in was reset for ${user.email}. Remove the RESET_2FA_EMAIL setting now.`
    : 'RESET_2FA_EMAIL: no user has that email. Remove the RESET_2FA_EMAIL setting.');
}

const app = express();
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
app.disable('x-powered-by');

const notFound = (res) => res.status(404).type('text').send('Not found');

// Security headers on every response.
const CSP = [
  "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self'", "script-src 'self'", "connect-src 'self'",
  "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ...(COOKIE_SECURE ? ['upgrade-insecure-requests'] : []),
].join('; ');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': CSP,
  });
  if (COOKIE_SECURE) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Health probe for Azure App Service (no auth, touches the database).
app.get('/healthz', (_req, res) => {
  db.hasUsers();
  res.type('text').send('ok');
});

// AroFlo Event Message webhook (e.g. "Task Completed"). AroFlo's payload format isn't
// documented, so we don't depend on it: any task ids found are fetched first, and every
// call triggers a check of what changed in AroFlo. Always answers quickly.
const webhookLimiter = createLimiter({ windowMs: 60_000, max: 120 });
app.post('/webhooks/aroflo/:secret', rateLimit(webhookLimiter, clientIp), express.raw({ type: () => true, limit: '256kb' }), (req, res) => {
  if (!sameSecret(req.params.secret, WEBHOOK_SECRET)) return notFound(res);
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const clientName = text.match(/"organisationname"\s*:\s*"([^"]*)"/i)?.[1];
  sync.notify(findTaskIds(req.body, req.query), { clientName });
  res.status(202).json({ ok: true });
});

// Flood guard per IP, checked before the body is even read.
const apiLimiter = createLimiter({ windowMs: 60_000, max: 600 });
app.use('/api', rateLimit(apiLimiter, clientIp));
app.use(express.json({ limit: '100kb' }));
app.use(sessionMiddleware(db, COOKIE_SECURE));
// API responses are never cached; changes must be same-site JSON (CSRF protection).
app.use('/api', requireJson, sameOrigin, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const SYNC_INTERVAL_CHOICES = [15, 30, 60, 180, 360, 720, 1440];
const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait 15 minutes and try again.';
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// The browser only ever sees encrypted references (tokens.js), never AroFlo record ids
// or database ids. ref.* makes them; unref.* reads them back (null/[] if invalid).
const ref = {
  job: (taskId) => tokens.encode('job', taskId),
  photo: (taskId, docId) => tokens.encode('photo', taskId, docId),
  client: (clientId) => tokens.encode('client', clientId),
  user: (id) => tokens.encode('user', id),
};
const unref = {
  job: (token) => tokens.decode('job', token)?.[0] ?? null,
  photo: (token) => tokens.decode('photo', token) ?? [],
  client: (token) => tokens.decode('client', token)?.[0] ?? null,
  user: (token) => Number(tokens.decode('user', token)?.[0]) || null,
};
const publicUser = (u) => u && { id: ref.user(u.id), name: u.name, email: u.email, role: u.role };
const publicClient = ({ clientId, ...c }) => ({ id: ref.client(clientId), ...c });
const publicJob = ({ taskId, ...j }) => ({ id: ref.job(taskId), ...j });
const adminUser = ({ id, clients, ...u }) => ({ ...u, id: ref.user(id), clients: clients.map(publicClient) });
const listedUser = (id) => adminUser(db.listUsers().find((u) => u.id === id));

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
// Pages are served only by the routes above. Scripts and styles are only ever sent
// minified, without comments (assets.js), and the Control Panel script only to admins.
// The path is normalised the way the file server reads it, so spellings like
// /JS/./admin.js can't get round this. express.static then serves only images.
const assets = createAssets(path.join(ROOT, 'public'));
app.use(ah(async (req, res, next) => {
  let file;
  try {
    file = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, '/')).replace(/[. ]+$/, '');
  } catch {
    return notFound(res);
  }
  const lower = file.toLowerCase();
  if (/\.html?$/.test(lower)) return notFound(res);
  if (!/\.(m?js|css|map)$/.test(lower) || !['GET', 'HEAD'].includes(req.method)) return next();
  const adminScript = lower === '/js/admin.js';
  if (adminScript && req.user?.role !== 'admin') return notFound(res);
  const asset = await assets(file);
  if (!asset) return notFound(res);
  // Admin script: never kept by a shared cache. Everything: re-checked on each load.
  res.set({ 'Content-Type': asset.type, ETag: asset.etag, 'Cache-Control': adminScript ? 'private, no-cache' : 'no-cache', Vary: 'Accept-Encoding' });
  if (req.fresh) return res.status(304).end();
  if (!req.acceptsEncodings('gzip')) return res.send(asset.body);
  res.set('Content-Encoding', 'gzip').send(asset.gzip);
}));
app.use(express.static(path.join(ROOT, 'public'), { index: false, extensions: [] }));

// ---------- Session ----------
app.get('/api/session', (req, res) => {
  const needsSetup = !db.hasUsers();
  res.json({
    user: publicUser(req.user),
    needsSetup,
    ...(needsSetup ? { setupNeedsCode: SETUP_NEEDS_CODE } : {}),
    portalName: db.getSettings().portalName,
  });
});

app.post('/api/setup', ah(async (req, res) => {
  if (db.hasUsers()) return res.status(409).json({ error: 'Setup has already been completed.' });
  if (loginThrottle.blocked(req)) return res.status(429).json({ error: TOO_MANY_ATTEMPTS });
  const { name, email, password, setupCode } = req.body || {};
  if (SETUP_NEEDS_CODE && !(SETUP_TOKEN && sameSecret(setupCode, SETUP_TOKEN))) {
    loginThrottle.fail(req);
    return res.status(403).json({ error: SETUP_TOKEN ? 'Incorrect setup code.' : 'Setup is locked: set the SETUP_TOKEN app setting first.' });
  }
  const problem = validateUser({ name, email, password, role: 'admin' }, true);
  if (problem) return res.status(400).json({ error: problem });
  const passwordHash = await hashPassword(password);
  if (db.hasUsers()) return res.status(409).json({ error: 'Setup has already been completed.' });
  const id = db.createUser({ email: email.trim(), name: name.trim(), role: 'admin', passwordHash });
  res.json(secondFactor(db.getUser(id)));
}));

app.post('/api/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (loginThrottle.blocked(req, email)) return res.status(429).json({ error: TOO_MANY_ATTEMPTS });
  const user = await checkLogin(db, email, password);
  if (!user) {
    if (loginThrottle.fail(req, email)) securityLog(`Sign-in locked for 15 minutes after repeated failures: ${who(email)} from ${clientIp(req)}`);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  loginThrottle.clear(req, email);
  if (user.role === 'admin') return res.json(secondFactor(user));
  signIn(res, user);
}));

// Second step for admins: the ticket from /api/login or /api/setup, plus the current
// code from their authenticator app. A first-time ticket carries the new key until a
// code proves the app has it.
app.post('/api/login/verify', (req, res) => {
  const { ticket, code } = req.body || {};
  const t = tokens.open(ticket);
  const user = t?.kind === 'mfa' && t.exp > Date.now() ? db.getUser(t.uid) : null;
  if (!user?.active || user.role !== 'admin' || (t.key && user.totp_secret)) {
    return res.status(401).json({ error: 'This sign-in has expired. Please start again.' });
  }
  const throttleKey = String(user.id);
  if (codeThrottle.blocked(throttleKey)) {
    return res.status(429).json({ error: 'Too many incorrect codes. Please try again later, or ask another admin to reset your two-factor sign-in.' });
  }
  const secret = t.key || tokens.open(user.totp_secret)?.key;
  if (!secret) {
    securityLog(`The stored 2FA key for ${who(user.email)} can't be read (has APP_SECRET changed?).`);
    return res.status(409).json({ error: 'Your two-factor sign-in needs to be reset. Ask another admin to reset it.' });
  }
  const step = totp.verify(secret, code, user.totp_last_step);
  const ok = step !== null && (t.key ? db.enrolTotp(user.id, tokens.seal({ key: secret }), step) : db.useTotpStep(user.id, step));
  if (!ok) {
    // The password was right, so a wrong code is worth knowing about.
    codeThrottle.fail(throttleKey);
    securityLog(`Wrong 2FA code for ${who(user.email)} from ${clientIp(req)}`);
    return res.status(401).json({ error: 'That code didn’t work. Enter the code your authenticator app shows now.' });
  }
  codeThrottle.clear(throttleKey);
  if (t.key) securityLog(`Two-factor sign-in set up for ${who(user.email)} from ${clientIp(req)}`);
  signIn(res, user);
});

app.post('/api/logout', (req, res) => {
  endSession(db, req, res, COOKIE_SECURE);
  // Also clear cached job photos from this browser (shared computers).
  res.set('Clear-Site-Data', '"cache", "storage"');
  res.json({ ok: true });
});

// Admins finish signing in with an authenticator code. The sealed ticket lasts 5 minutes
// and names who is signing in; for first-time setup it also carries the new key.
function secondFactor(user) {
  const ticket = { kind: 'mfa', uid: user.id, exp: Date.now() + 5 * 60_000 };
  if (user.totp_secret) return { mfa: 'verify', ticket: tokens.seal(ticket) };
  const key = totp.newSecret();
  return { mfa: 'enroll', ticket: tokens.seal({ ...ticket, key }), key, qr: totp.qrDataUrl(totp.otpauthUrl(key, user.email)) };
}

function signIn(res, user) {
  db.touchLogin(user.id);
  startSession(db, res, user, COOKIE_SECURE);
  res.json({ user: publicUser(user) });
}

// Security events go to the app log (Azure log stream). Emails are quoted so a crafted
// value can't forge extra log lines.
const securityLog = (message) => console.warn(`[security] ${message}`);
const who = (email) => JSON.stringify(String(email ?? '').slice(0, 254));

// ---------- Client portal ----------
// Admins may view any AroFlo client (to preview what a client sees); client users
// only ever get the clients assigned to them in the control panel.
const allowedClientIds = (req) =>
  req.user.role === 'admin' ? null : db.clientsForUser(req.user.id).map((c) => c.clientId);

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: publicUser(req.user),
    clients: req.user.role === 'admin' ? [] : db.clientsForUser(req.user.id).map(publicClient),
    portalName: db.getSettings().portalName,
    // Only flagged in demo mode (for its banner); nothing about the live data source.
    ...(aroflo.mode === 'demo' ? { mode: 'demo' } : {}),
  });
});

// Client users get every job for all of their linked companies in one list (newest
// first, labelled by company when there's more than one); they never pick a company.
// Admins pass ?client= to preview one client.
app.get('/api/jobs', requireUser, (req, res) => {
  const settings = db.getSettings();
  if (req.user.role !== 'admin') {
    const mine = db.clientsForUser(req.user.id);
    if (!mine.length) return res.status(404).json({ error: 'No client account is linked to your login yet.' });
    const jobs = mine
      .flatMap((c) => portal.jobsForClient(c.clientId, settings)
        .map((j) => (mine.length > 1 ? { ...j, clientName: c.clientName } : j)))
      .sort((a, b) => String(b.completed || '').localeCompare(String(a.completed || '')));
    return res.json({ clients: mine.map(publicClient), jobs: jobs.map(publicJob) });
  }
  const clientId = unref.client(req.query.client);
  const client = clientId && portal.getClient(clientId);
  if (!client) return res.status(404).json({ error: 'Choose a client to preview.' });
  res.json({ clients: [publicClient(client)], jobs: portal.jobsForClient(client.clientId, settings).map(publicJob) });
});

app.get('/api/jobs/:ref', requireUser, (req, res) => {
  const taskId = unref.job(req.params.ref);
  const job = taskId && portal.jobDetail(taskId, allowedClientIds(req), db.getSettings());
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job: { ...publicJob(job), photos: job.photos.map(({ id, ...p }) => ({ id: ref.photo(taskId, id), ...p })) } });
});

// Photos are named after the job (e.g. CustON-1234-photo-x7Kq2a.jpg), never the original
// upload's file name. The ending comes from the photo's encrypted reference.
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
const photoName = (file, type, photoRef) =>
  `${file.custOn ? `CustON-${file.custOn}` : 'job'}-photo-${photoRef.slice(-6)}.${PHOTO_EXT[String(type).split(';')[0].trim().toLowerCase()] || 'jpg'}`
    .replace(/[^\w.-]+/g, '_');

// A photo that isn't cached yet has to come from AroFlo first, so each user may only
// trigger a limited number of those per 10 minutes. Cached photos are unlimited.
const fetchLimiters = {
  admin: createLimiter({ windowMs: 10 * 60_000, max: 100 }),
  client: createLimiter({ windowMs: 10 * 60_000, max: 20 }),
};

app.get('/api/photos/:ref', requireUser, ah(async (req, res) => {
  const [taskId, docId] = unref.photo(req.params.ref);
  if (!taskId || !docId) return res.status(404).json({ error: 'File not found.' });
  const canFetch = () => (fetchLimiters[req.user.role] || fetchLimiters.client).hit(String(req.user.id));
  const thumb = req.query.size === 'thumb' && req.query.download !== '1';
  const file = await portal.getFile(taskId, docId, allowedClientIds(req), db.getSettings(), canFetch, { thumb });
  if (file?.limited) return res.status(429).json({ error: 'Too many new photos opened at once. Please wait a few minutes and try again.' });
  if (!file) return res.status(404).json({ error: 'File not found.' });
  // "Download" of a shrunk photo gives the full-resolution original from AroFlo (the
  // shrunk copy when over the limit).
  if (req.query.download === '1' && file.compressed && canFetch()) {
    const original = await sync.fetchOriginalPhoto(taskId, docId).catch(() => null);
    if (original) {
      res.set({
        'Content-Type': original.contentType,
        'Content-Disposition': `attachment; filename="${photoName(file, original.contentType, req.params.ref)}"`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      return res.send(original.body);
    }
  }
  const inline = req.query.download !== '1' && /^(image\/|application\/pdf)/i.test(file.contentType);
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${photoName(file, file.contentType, req.params.ref)}"`,
    'Cache-Control': 'private, max-age=86400',
    // Uploaded files are untrusted: never let one run script on our origin.
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  });
  // Mark the photo (and its preview) as recently viewed so the cache keeps it.
  const now = new Date();
  fs.utimes(file.filePath, now, now, () => {});
  if (file.sourcePath) fs.utimes(file.sourcePath, now, now, () => {});
  res.sendFile(file.filePath);
}));

// ---------- Control panel ----------
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/status', (req, res) => {
  res.json({
    mode: aroflo.mode,
    stats: aroflo.stats,
    sync: { ...sync.status, ...store.counts(), fullSyncAt: store.getState('fullSyncAt') },
    webhookUrl: `${req.protocol}://${req.get('host')}/webhooks/aroflo/${WEBHOOK_SECRET}`,
    syncIntervalMinutes: Number(env.SYNC_INTERVAL_MINUTES) || db.getSettings().syncIntervalMinutes,
  });
});

// The admin actions that spend AroFlo calls can't be repeated back to back.
const FULL_RESYNC_GAP = 10 * 60_000;
const CLIENT_REFRESH_GAP = 60_000;
let fullResyncAt = 0;
let clientsRefreshedAt = 0;

// Kicks off a sync now. { full: true } re-downloads every completed job from scratch.
admin.post('/sync', (req, res) => {
  if (req.body?.full) {
    if (Date.now() - fullResyncAt < FULL_RESYNC_GAP) {
      return res.status(429).json({ error: 'A full resync was started in the last 10 minutes. Please wait for it to finish.' });
    }
    fullResyncAt = Date.now();
    sync.fullResync();
  } else {
    sync.run();
  }
  res.json({ ok: true });
});

admin.get('/clients', ah(async (req, res) => {
  if ((req.query.refresh === '1' || !store.hasClients()) && Date.now() - clientsRefreshedAt > CLIENT_REFRESH_GAP) {
    clientsRefreshedAt = Date.now();
    await sync.refreshClients();
  }
  res.json({ clients: portal.listClients().map(publicClient) });
}));

// Turns a client on or off for the portal. Only active clients are read from AroFlo:
// activating downloads that client's completed jobs; deactivating removes them here.
admin.put('/clients/:ref', (req, res) => {
  const client = store.getClient(unref.client(req.params.ref));
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const active = req.body?.active === true;
  if (active === client.active) return res.json({ client: publicClient({ ...client, active }) });
  store.setClientActive(client.clientId, client.clientName, active);
  if (active) sync.activateClient(client.clientId);
  else store.removeJobsForClient(client.clientId);
  res.json({ client: publicClient({ ...client, active }) });
});

admin.get('/users', (_req, res) => res.json({ users: db.listUsers().map(adminUser) }));

admin.post('/users', ah(async (req, res) => {
  const input = req.body || {};
  const problem = validateUser(input, true);
  if (problem) return res.status(400).json({ error: problem });
  const passwordHash = await hashPassword(input.password);
  if (db.getUserByEmail(input.email.trim())) return res.status(409).json({ error: 'A user with that email already exists.' });
  const id = db.createUser({
    email: input.email.trim(),
    name: input.name.trim(),
    role: input.role,
    passwordHash,
    clients: input.role === 'client' ? linkableClients(input.clients) : [],
  });
  activateLinkedClients(id);
  res.json({ user: listedUser(id) });
}));

admin.put('/users/:ref', ah(async (req, res) => {
  const id = unref.user(req.params.ref);
  const existing = id && db.getUser(id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const input = { ...req.body, active: req.body?.active !== false };
  const problem = validateUser(input, false);
  if (problem) return res.status(400).json({ error: problem });
  const other = db.getUserByEmail(input.email.trim());
  if (other && other.id !== id) return res.status(409).json({ error: 'A user with that email already exists.' });
  if (existing.role === 'admin' && (input.role !== 'admin' || !input.active) && wouldRemoveLastAdmin(id)) {
    return res.status(400).json({ error: 'You need at least one active admin.' });
  }
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  db.updateUser(id, {
    email: input.email.trim(),
    name: input.name.trim(),
    role: input.role,
    active: input.active,
    clients: input.role === 'client' ? linkableClients(input.clients, db.clientsForUser(id)) : [],
  });
  // A new password signs that user out everywhere. Changing your own keeps only the
  // sign-in you're using now, so a stolen session elsewhere ends too.
  if (passwordHash) {
    db.setPassword(id, passwordHash);
    db.deleteUserSessions(id);
    if (id === req.user.id) startSession(db, res, req.user, COOKIE_SECURE);
  }
  // A role change signs the user out, so someone made an admin sets up 2FA first.
  if (input.role !== existing.role) {
    db.deleteUserSessions(id);
    if (input.role !== 'admin') db.clearTotp(id);
  }
  activateLinkedClients(id);
  res.json({ user: listedUser(id) });
}));

// For an admin who has lost their phone: they set up 2FA again at their next sign-in.
admin.post('/users/:ref/reset-2fa', (req, res) => {
  const id = unref.user(req.params.ref);
  if (!id || !db.getUser(id)) return res.status(404).json({ error: 'User not found.' });
  if (id === req.user.id) return res.status(400).json({ error: "You can't reset your own two-factor sign-in. Ask another admin." });
  db.clearTotp(id);
  db.deleteUserSessions(id);
  res.json({ user: listedUser(id) });
});

admin.delete('/users/:ref', (req, res) => {
  const id = unref.user(req.params.ref);
  const existing = id && db.getUser(id);
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
    noteVisibility: 'client',
    fileVisibility: s.fileVisibility === 'all' ? 'all' : 'client',
    includeArchived: s.includeArchived !== false,
    syncIntervalMinutes: SYNC_INTERVAL_CHOICES.includes(Number(s.syncIntervalMinutes)) ? Number(s.syncIntervalMinutes) : DEFAULT_SETTINGS.syncIntervalMinutes,
    syncFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(s.syncFrom || '')) ? s.syncFrom : DEFAULT_SETTINGS.syncFrom,
    portalName: String(s.portalName || DEFAULT_SETTINGS.portalName).trim().slice(0, 60) || DEFAULT_SETTINGS.portalName,
  };
  const previousFrom = db.getSettings().syncFrom;
  db.saveSettings(next);
  // Later cutoff: drop older jobs (no API calls). Earlier: fetch the extra jobs for active clients.
  if (next.syncFrom > previousFrom) store.removeJobsCompletedBefore(next.syncFrom);
  else if (next.syncFrom < previousFrom) sync.redownloadActiveClients();
  res.json({ settings: db.getSettings() });
});

app.use('/api/admin', admin);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((_req, res) => notFound(res));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof AroFloError) {
    console.error(`AroFlo error on ${req.method} ${req.path}: ${err.message} (status ${err.status})`);
    // Clients get a plain message; only admins see what AroFlo said.
    const error = req.user?.role === 'admin'
      ? `Couldn't reach AroFlo right now. Please try again shortly. AroFlo said: "${err.message}"`
      : "This isn't available right now. Please try again shortly.";
    return res.status(502).json({ error });
  }
  // Requests Express itself rejected: unreadable JSON, too large, bad URL encoding.
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 404 ? 'Not found.' : status === 413 ? 'That request is too large.' : 'That request could not be read.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ---------- Helpers ----------
function validateUser(u, passwordRequired) {
  if (!u || typeof u !== 'object' || typeof u.name !== 'string' || typeof u.email !== 'string') return 'Missing user details.';
  const name = u.name.trim();
  const email = u.email.trim();
  if (!name) return 'Name is required.';
  if (name.length > 100) return 'Name must be 100 characters or fewer.';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!['admin', 'client'].includes(u.role)) return 'Role must be admin or client.';
  if (passwordRequired || u.password) {
    if (typeof u.password !== 'string' || u.password.length < 10) return 'Password must be at least 10 characters.';
    if (u.password.length > 200) return 'Password must be 200 characters or fewer.';
  }
  if (u.role === 'client' && u.clients !== undefined && !Array.isArray(u.clients)) return 'Clients must be a list.';
  return null;
}

// Clients are linked by their encrypted reference, and only clients from the synced
// AroFlo list (or ones the user already has, so a stale list never silently unlinks
// anyone) are accepted. Names always come from our records, never from the request,
// because client names are used in AroFlo queries.
function linkableClients(clients, current = []) {
  const known = new Map([...current, ...portal.listClients()].map((c) => [c.clientId, c.clientName]));
  const linked = new Map();
  for (const c of Array.isArray(clients) ? clients : []) {
    const clientId = unref.client(c?.id);
    if (clientId && known.has(clientId)) linked.set(clientId, { clientId, clientName: known.get(clientId) });
  }
  return [...linked.values()];
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

// Clients linked to a user must be active so their jobs are synced.
function activateLinkedClients(userId) {
  for (const c of db.clientsForUser(userId)) {
    if (store.isClientActive(c.clientId)) continue;
    store.setClientActive(c.clientId, c.clientName, true);
    sync.activateClient(c.clientId);
  }
}

function wouldRemoveLastAdmin(id) {
  return !db.listUsers().some((u) => u.role === 'admin' && u.active && u.id !== id);
}

// A missed rejection in background work is logged rather than taking the portal down.
// Anything else unexpected: save the database and exit; Azure restarts the app.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try {
    saveDatabaseNow();
  } finally {
    process.exit(1);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Client portal running at http://localhost:${PORT}  (${aroflo.mode === 'demo' ? 'DEMO data' : 'live AroFlo data'})`);
  if (!db.hasUsers()) console.log(`No users yet - open http://localhost:${PORT}/login to create the first admin account.`);
  if (HAS_AROFLO_LOGIN) sync.start();
});

// App Service sends SIGTERM on restart/redeploy: finish in-flight requests, then close the database.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    saveDatabaseNow();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
