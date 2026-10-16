import crypto from 'node:crypto';

const COOKIE = 'portal_session';
const SESSION_DAYS = 14;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// Burned on unknown emails so login timing doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function checkLogin(db, email, password) {
  const user = db.getUserByEmail(String(email || '').trim());
  const ok = verifyPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return ok && user && user.active ? user : null;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function startSession(db, res, userId, secure) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 86400_000;
  db.createSession(hashToken(token), userId, Date.now() + maxAge);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
}

export function endSession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.deleteSession(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = readCookie(req, COOKIE);
    req.user = token ? db.sessionUser(hashToken(token)) || null : null;
    next();
  };
}

export const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please sign in.' });

export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' });

// Mutating requests must be JSON. Browsers can't send cross-site JSON without a
// CORS preflight, which we never grant, so this doubles as CSRF protection.
export function requireJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected a JSON request.' });
  }
  next();
}

// Simple in-memory brute-force guard: 8 failures per email+IP per 15 minutes.
const failures = new Map();
const WINDOW = 15 * 60_000;
export const loginThrottle = {
  // Azure's proxy can append the client port to the IP; drop it so retries share one key.
  key: (req, email) => `${String(req.ip).replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1')}|${String(email).toLowerCase()}`,
  blocked(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > WINDOW) return false;
    return f.count >= 8;
  },
  fail(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
    else f.count++;
  },
  clear: (key) => failures.delete(key),
};

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
