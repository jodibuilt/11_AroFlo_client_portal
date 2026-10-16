import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  // 'client' = only notes/files AroFlo marks "Show Client" or "Show All"; 'all' = everything.
  noteVisibility: 'client',
  fileVisibility: 'client',
  // AroFlo moves completed jobs to Archived once invoiced; include them so history doesn't vanish.
  includeArchived: true,
  portalName: 'Client Portal',
  // Safety-net check for missed webhooks. Webhooks do most of the work.
  syncIntervalMinutes: 60,
};

export function openDatabase(dataDir, { journalMode = 'WAL' } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'portal.db'));
  if (!/^(WAL|DELETE|TRUNCATE|PERSIST)$/i.test(journalMode)) throw new Error(`Unsupported SQLITE_JOURNAL_MODE: ${journalMode}`);
  db.exec(`PRAGMA journal_mode = ${journalMode}; PRAGMA busy_timeout = 5000;`);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin', 'client')),
      password_hash TEXT NOT NULL,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_clients (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id   TEXT NOT NULL,
      client_name TEXT NOT NULL,
      PRIMARY KEY (user_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Local copy of AroFlo data, kept up to date by sync.js. The portal reads only
    -- from these tables, so page views never call AroFlo.
    CREATE TABLE IF NOT EXISTS clients (
      client_id   TEXT PRIMARY KEY,
      client_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      task_id     TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      job_number  TEXT NOT NULL DEFAULT '',
      task_name   TEXT NOT NULL DEFAULT '',
      location    TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL,              -- 'completed' or 'archived'
      completed   TEXT,                       -- zone-less local time, e.g. 2026-09-23T10:15:00
      synced_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_by_client ON jobs (client_id, completed DESC);

    CREATE TABLE IF NOT EXISTS job_notes (
      task_id TEXT NOT NULL REFERENCES jobs(task_id) ON DELETE CASCADE,
      note_id TEXT NOT NULL,
      text    TEXT NOT NULL DEFAULT '',
      posted  TEXT,
      author  TEXT NOT NULL DEFAULT '',
      filter  TEXT NOT NULL DEFAULT '',       -- AroFlo visibility, e.g. 'Show Client', 'Internal Only'
      PRIMARY KEY (task_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS job_photos (
      task_id      TEXT NOT NULL REFERENCES jobs(task_id) ON DELETE CASCADE,
      doc_id       TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT '',
      comment      TEXT NOT NULL DEFAULT '',
      uploaded     TEXT,
      filter       TEXT NOT NULL DEFAULT '',
      file         TEXT,                      -- file name in data/files once downloaded
      content_type TEXT,
      PRIMARY KEY (task_id, doc_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const q = {
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    listUsers: db.prepare('SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY role, name'),
    insertUser: db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)'),
    updateUser: db.prepare('UPDATE users SET email = ?, name = ?, role = ?, active = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    touchLogin: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
    clientsForUser: db.prepare('SELECT client_id AS clientId, client_name AS clientName FROM user_clients WHERE user_id = ? ORDER BY client_name'),
    allAssignments: db.prepare('SELECT user_id AS userId, client_id AS clientId, client_name AS clientName FROM user_clients'),
    clearClients: db.prepare('DELETE FROM user_clients WHERE user_id = ?'),
    addClient: db.prepare('INSERT OR IGNORE INTO user_clients (user_id, client_id, client_name) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    getSettings: db.prepare('SELECT key, value FROM settings'),
    putSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    handle: db,
    transaction,
    close: () => db.close(),
    hasUsers: () => q.countUsers.get().n > 0,
    getUser: (id) => q.userById.get(id),
    getUserByEmail: (email) => q.userByEmail.get(email),
    listUsers: () => {
      const byUser = new Map();
      for (const a of q.allAssignments.all()) {
        if (!byUser.has(a.userId)) byUser.set(a.userId, []);
        byUser.get(a.userId).push({ clientId: a.clientId, clientName: a.clientName });
      }
      return q.listUsers.all().map((u) => ({ ...u, active: !!u.active, clients: byUser.get(u.id) || [] }));
    },
    createUser: ({ email, name, role, passwordHash, clients }) =>
      transaction(() => {
        const { lastInsertRowid } = q.insertUser.run(email, name, role, passwordHash);
        const id = Number(lastInsertRowid);
        for (const c of clients || []) q.addClient.run(id, c.clientId, c.clientName);
        return id;
      }),
    updateUser: (id, { email, name, role, active, clients }) =>
      transaction(() => {
        q.updateUser.run(email, name, role, active ? 1 : 0, id);
        q.clearClients.run(id);
        for (const c of clients || []) q.addClient.run(id, c.clientId, c.clientName);
        if (!active) q.deleteUserSessions.run(id);
      }),
    setPassword: (id, passwordHash) => q.setPassword.run(passwordHash, id),
    deleteUser: (id) => q.deleteUser.run(id),
    touchLogin: (id) => q.touchLogin.run(id),
    clientsForUser: (id) => q.clientsForUser.all(id),

    createSession: (tokenHash, userId, expiresAt) => q.insertSession.run(tokenHash, userId, expiresAt),
    sessionUser: (tokenHash) => q.sessionUser.get(tokenHash, Date.now()),
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),
    deleteUserSessions: (userId) => q.deleteUserSessions.run(userId),
    purgeSessions: () => q.purgeSessions.run(Date.now()),

    getSettings: () => {
      const stored = Object.fromEntries(q.getSettings.all().map((r) => [r.key, JSON.parse(r.value)]));
      return { ...DEFAULT_SETTINGS, ...stored };
    },
    saveSettings: (values) =>
      transaction(() => {
        for (const [key, value] of Object.entries(values)) q.putSetting.run(key, JSON.stringify(value));
      }),
  };
}
