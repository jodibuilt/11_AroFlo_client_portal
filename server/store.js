// Reads and writes the local copy of AroFlo jobs, notes and photos (see db.js tables).
import fs from 'node:fs';
import path from 'node:path';

export function createStore(db, fileDir) {
  const h = db.handle;
  fs.mkdirSync(fileDir, { recursive: true });

  const q = {
    upsertClient: h.prepare(`INSERT INTO clients (client_id, client_name) VALUES (?, ?)
                             ON CONFLICT(client_id) DO UPDATE SET client_name = excluded.client_name`),
    listClients: h.prepare('SELECT client_id AS clientId, client_name AS clientName FROM clients ORDER BY client_name COLLATE NOCASE'),
    clientById: h.prepare('SELECT client_id AS clientId, client_name AS clientName FROM clients WHERE client_id = ?'),
    countClients: h.prepare('SELECT COUNT(*) AS n FROM clients'),

    upsertJob: h.prepare(`INSERT INTO jobs (task_id, client_id, client_name, job_number, task_name, location, status, completed, synced_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(task_id) DO UPDATE SET client_id = excluded.client_id, client_name = excluded.client_name,
                            job_number = excluded.job_number, task_name = excluded.task_name, location = excluded.location,
                            status = excluded.status, completed = excluded.completed, synced_at = excluded.synced_at`),
    deleteJob: h.prepare('DELETE FROM jobs WHERE task_id = ?'),
    jobById: h.prepare('SELECT * FROM jobs WHERE task_id = ?'),
    jobsForClient: h.prepare(`SELECT task_id AS taskId, job_number AS jobNumber, task_name AS taskName, location, completed, status
                              FROM jobs WHERE client_id = ? ORDER BY completed DESC, CAST(job_number AS INTEGER) DESC`),
    allJobIds: h.prepare('SELECT task_id AS taskId FROM jobs'),
    countJobs: h.prepare('SELECT COUNT(*) AS n FROM jobs'),

    deleteNotes: h.prepare('DELETE FROM job_notes WHERE task_id = ?'),
    insertNote: h.prepare('INSERT OR REPLACE INTO job_notes (task_id, note_id, text, posted, author, filter) VALUES (?, ?, ?, ?, ?, ?)'),
    notesForJob: h.prepare('SELECT note_id AS id, text, posted, author, filter FROM job_notes WHERE task_id = ? ORDER BY posted DESC'),

    photosForJob: h.prepare(`SELECT doc_id AS id, name, comment, uploaded, filter, file, content_type AS contentType
                             FROM job_photos WHERE task_id = ? ORDER BY uploaded ASC, name ASC`),
    photo: h.prepare('SELECT * FROM job_photos WHERE task_id = ? AND doc_id = ?'),
    upsertPhoto: h.prepare(`INSERT INTO job_photos (task_id, doc_id, name, comment, uploaded, filter) VALUES (?, ?, ?, ?, ?, ?)
                            ON CONFLICT(task_id, doc_id) DO UPDATE SET name = excluded.name, comment = excluded.comment,
                              uploaded = excluded.uploaded, filter = excluded.filter`),
    deletePhoto: h.prepare('DELETE FROM job_photos WHERE task_id = ? AND doc_id = ?'),
    setPhotoFile: h.prepare('UPDATE job_photos SET file = ?, content_type = ? WHERE task_id = ? AND doc_id = ?'),
    filesForJob: h.prepare('SELECT file FROM job_photos WHERE task_id = ? AND file IS NOT NULL'),
    tasksMissingPhotos: h.prepare(`SELECT DISTINCT p.task_id AS taskId FROM job_photos p JOIN jobs j ON j.task_id = p.task_id
                                   WHERE p.file IS NULL AND j.client_id IN (SELECT client_id FROM user_clients) LIMIT ?`),
    countPhotos: h.prepare('SELECT COUNT(*) AS photos, COUNT(file) AS photosSaved FROM job_photos'),
    linkedClient: h.prepare('SELECT 1 FROM user_clients WHERE client_id = ? LIMIT 1'),

    getState: h.prepare('SELECT value FROM sync_state WHERE key = ?'),
    putState: h.prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  };

  const removeFiles = (files) => {
    for (const f of files) fs.rm(path.join(fileDir, path.basename(f)), { force: true }, () => {});
  };

  return {
    fileDir,

    // ----- clients -----
    saveClients: (clients) => db.transaction(() => { for (const c of clients) q.upsertClient.run(c.clientId, c.clientName); }),
    listClients: () => q.listClients.all(),
    getClient: (id) => q.clientById.get(id) || null,
    hasClients: () => q.countClients.get().n > 0,
    isClientLinked: (clientId) => Boolean(q.linkedClient.get(clientId)),

    // ----- jobs -----
    // Replaces everything we hold for one job with what AroFlo returned.
    // Photos already downloaded keep their file; photos removed in AroFlo are deleted.
    saveJob(job) {
      let removedFiles = [];
      db.transaction(() => {
        q.upsertJob.run(job.taskId, job.clientId, job.clientName, job.jobNumber, job.taskName, job.location,
          job.status, job.completed, new Date().toISOString());
        q.deleteNotes.run(job.taskId);
        for (const n of job.notes) q.insertNote.run(job.taskId, n.id, n.text, n.posted, n.author, n.filter);
        const keep = new Set(job.photos.map((p) => p.id));
        for (const old of q.photosForJob.all(job.taskId)) {
          if (!keep.has(old.id)) {
            q.deletePhoto.run(job.taskId, old.id);
            if (old.file) removedFiles.push(old.file);
          }
        }
        for (const p of job.photos) q.upsertPhoto.run(job.taskId, p.id, p.name, p.comment, p.uploaded, p.filter);
      });
      removeFiles(removedFiles);
    },
    removeJob(taskId) {
      const files = q.filesForJob.all(taskId).map((r) => r.file);
      q.deleteJob.run(taskId);
      removeFiles(files);
    },
    getJob: (taskId) => q.jobById.get(taskId) || null,
    jobsForClient: (clientId) => q.jobsForClient.all(clientId),
    allJobIds: () => q.allJobIds.all().map((r) => r.taskId),
    notesForJob: (taskId) => q.notesForJob.all(taskId),
    photosForJob: (taskId) => q.photosForJob.all(taskId),
    getPhoto: (taskId, docId) => q.photo.get(taskId, docId) || null,
    setPhotoFile: (taskId, docId, file, contentType) => q.setPhotoFile.run(file, contentType, taskId, docId),
    tasksMissingPhotos: (limit) => q.tasksMissingPhotos.all(limit).map((r) => r.taskId),

    // ----- sync bookkeeping -----
    // Forgets everything synced from AroFlo (jobs, notes, photos, clients, sync position)
    // so the next sync downloads afresh. Users, their links and settings are kept.
    resetSyncedData() {
      db.transaction(() => {
        h.exec('DELETE FROM jobs; DELETE FROM clients;');
        h.prepare("DELETE FROM sync_state WHERE key IN ('cursor', 'clientsAt', 'recentAt', 'fullSyncAt')").run();
      });
      for (const f of fs.readdirSync(fileDir)) fs.rmSync(path.join(fileDir, f), { force: true });
    },
    getState: (key) => {
      const row = q.getState.get(key);
      return row ? JSON.parse(row.value) : null;
    },
    setState: (key, value) => q.putState.run(key, JSON.stringify(value)),
    counts: () => ({ jobs: q.countJobs.get().n, clients: q.countClients.get().n, ...q.countPhotos.get() }),
  };
}
