import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Over HTTPS the __Host- prefix makes browsers refuse the cookie unless it is Secure,
// host-only and path=/, so another site on a shared parent domain can't plant one.
const cookieName = (secure) => (secure ? '__Host-portal_session' : 'portal_session');
// Admins see every client and the sync controls, so their sign-ins expire sooner.
const SESSION_MS = { admin: 12 * 3600_000, client: 14 * 86400_000 };
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
// Async scrypt runs off the main thread, so a burst of sign-ins can't stall the server.
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// Burned on unknown emails so login timing doesn't reveal which accounts exist.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

export async function checkLogin(db, email, password) {
  const user = db.getUserByEmail(String(email || '').trim());
  const ok = await verifyPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return ok && user && user.active ? user : null;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function startSession(db, res, user, secure) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_MS[user.role] || SESSION_MS.client;
  db.createSession(hashToken(token), user.id, Date.now() + maxAge);
  res.cookie(cookieName(secure), token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
}

export function endSession(db, req, res, secure) {
  const token = readCookie(req, cookieName(secure));
  if (token) db.deleteSession(hashToken(token));
  res.clearCookie(cookieName(secure), { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

export function sessionMiddleware(db, secure) {
  return (req, _res, next) => {
    const token = readCookie(req, cookieName(secure));
    req.user = token ? db.sessionUser(hashToken(token)) || null : null;
    next();
  };
}

export const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please sign in.' });

// To anyone but an admin (signed in or not), admin routes look like they don't exist.
export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(404).json({ error: 'Not found.' });

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Mutating requests must be JSON. Browsers can't send cross-site JSON without a
// CORS preflight, which we never grant, so this doubles as CSRF protection.
export function requireJson(req, res, next) {
  if (MUTATING.has(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected a JSON request.' });
  }
  next();
}

// Second CSRF check: browsers label each request with where it came from (Sec-Fetch-Site,
// which pages can't forge; older browsers send only Origin), so refuse any mutating
// request from another site.
export function sameOrigin(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' ? next() : res.status(403).json({ error: 'Request refused.' });
  const origin = req.get('origin');
  if (!origin) return next();
  let host = null;
  try {
    host = new URL(origin).host;
  } catch { /* malformed: refused below */ }
  if (host && (host === req.get('host') || host === req.get('x-forwarded-host'))) return next();
  res.status(403).json({ error: 'Request refused.' });
}

// The address that limits are counted against. Azure's proxy can append the client
// port (dropped, so retries share one key), IPv4-mapped IPv6 is unwrapped, and an IPv6
// user usually holds a whole /64, so the /64 counts as one address.
export function clientIp(req) {
  const ip = String(req.ip || '')
    .replace(/%.*$/, '')
    .replace(/^\[([^\]]+)\](?::\d+)?$/, '$1')
    .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1')
    .replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Fixed-window counters in memory. Expired entries are pruned and the map is capped,
// so a flood of different keys can't exhaust memory.
export function createLimiter({ windowMs, max, maxKeys = 50_000 }) {
  const hits = new Map();
  const live = (key, now) => {
    const e = hits.get(key);
    return e && now - e.start < windowMs ? e : null;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [key, e] of hits) if (now - e.start >= windowMs) hits.delete(key);
  }, windowMs).unref();
  return {
    blocked: (key) => (live(key, Date.now())?.count ?? 0) >= max,
    // Counts one hit; false once the key is over the limit for this window.
    hit(key) {
      const now = Date.now();
      const e = live(key, now);
      if (e) return ++e.count <= max;
      if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      hits.set(key, { count: 1, start: now });
      return max >= 1;
    },
    clear: (key) => hits.delete(key),
  };
}

export const rateLimit = (limiter, key, error = 'Too many requests. Please wait a minute and try again.') =>
  (req, res, next) => (limiter.hit(key(req)) ? next() : res.status(429).json({ error }));

// Brute-force guard, per 15 minutes: 8 failures per email+IP, 30 per IP across all
// emails, and 20 per email across all IPs (password guessing spread over many machines).
const perAccount = createLimiter({ windowMs: 15 * 60_000, max: 8 });
const perIp = createLimiter({ windowMs: 15 * 60_000, max: 30 });
const perEmail = createLimiter({ windowMs: 15 * 60_000, max: 20 });
// Capped so huge made-up "emails" can't bloat the counters.
const emailKey = (email) => String(email ?? '').trim().toLowerCase().slice(0, 254);
const accountKey = (req, email) => `${clientIp(req)}|${emailKey(email)}`;
export const loginThrottle = {
  blocked: (req, email) => perIp.blocked(clientIp(req))
    || (email !== undefined && (perAccount.blocked(accountKey(req, email)) || perEmail.blocked(emailKey(email)))),
  // Counts a failure; true when that failure has just locked the email or address out.
  fail(req, email) {
    perIp.hit(clientIp(req));
    if (email !== undefined) {
      perAccount.hit(accountKey(req, email));
      perEmail.hit(emailKey(email));
    }
    return this.blocked(req, email);
  },
  clear: (req, email) => perAccount.clear(accountKey(req, email)),
};

// Wrong authenticator codes per admin: 5 per 15 minutes and 20 per day. Signing in
// clears only the 15-minute count, so guessing stays capped at 20 a day.
const codeShort = createLimiter({ windowMs: 15 * 60_000, max: 5 });
const codeDaily = createLimiter({ windowMs: 24 * 3600_000, max: 20 });
export const codeThrottle = {
  blocked: (key) => codeShort.blocked(key) || codeDaily.blocked(key),
  fail(key) {
    codeShort.hit(key);
    codeDaily.hit(key);
  },
  clear: (key) => codeShort.clear(key),
};

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null; // malformed cookie: treat as signed out
      }
    }
  }
  return null;
}
