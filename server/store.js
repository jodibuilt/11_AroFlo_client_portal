// Reads and writes the local copy of AroFlo jobs, notes and photos (see db.js tables).
import fs from 'node:fs';
import path from 'node:path';

export function createStore(db, fileDir) {
  const h = db.handle;
  fs.mkdirSync(fileDir, { recursive: true });

  const q = {
    // Client names refresh from AroFlo; the active flag is ours and is never overwritten.
    upsertClient: h.prepare(`INSERT INTO clients (client_id, client_name) VALUES (?, ?)
                             ON CONFLICT(client_id) DO UPDATE SET client_name = excluded.client_name`),
    listClients: h.prepare(`SELECT c.client_id AS clientId, c.client_name AS clientName, c.active,
                              (SELECT COUNT(*) FROM user_clients u WHERE u.client_id = c.client_id) AS users,
                              (SELECT COUNT(*) FROM jobs j WHERE j.client_id = c.client_id) AS jobs
                            FROM clients c ORDER BY c.client_name COLLATE NOCASE`),
    clientById: h.prepare('SELECT client_id AS clientId, client_name AS clientName, active FROM clients WHERE client_id = ?'),
    activeClients: h.prepare('SELECT client_id AS clientId, client_name AS clientName FROM clients WHERE active = 1 ORDER BY client_name COLLATE NOCASE'),
    setActive: h.prepare(`INSERT INTO clients (client_id, client_name, active) VALUES (?, ?, ?)
                          ON CONFLICT(client_id) DO UPDATE SET active = excluded.active`),
    countClients: h.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(active), 0) AS active FROM clients'),

    upsertJob: h.prepare(`INSERT INTO jobs (task_id, client_id, client_name, job_number, cust_on, task_name, location, status, completed, synced_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(task_id) DO UPDATE SET client_id = excluded.client_id, client_name = excluded.client_name,
                            job_number = excluded.job_number, cust_on = excluded.cust_on, task_name = excluded.task_name, location = excluded.location,
                            status = excluded.status, completed = excluded.completed, synced_at = excluded.synced_at`),
    deleteJob: h.prepare('DELETE FROM jobs WHERE task_id = ?'),
    jobById: h.prepare('SELECT * FROM jobs WHERE task_id = ?'),
    jobsForClient: h.prepare(`SELECT task_id AS taskId, cust_on AS custOn, task_name AS taskName, location, completed, status
                              FROM jobs WHERE client_id = ? ORDER BY completed DESC, CAST(job_number AS INTEGER) DESC`),
    jobIdsForClient: h.prepare('SELECT task_id AS taskId FROM jobs WHERE client_id = ?'),
    jobIdsCompletedBefore: h.prepare(`SELECT task_id AS taskId FROM jobs WHERE completed IS NOT NULL AND substr(completed, 1, 10) < ?`),
    jobIdsOutsideActive: h.prepare('SELECT task_id AS taskId FROM jobs WHERE client_id NOT IN (SELECT client_id FROM clients WHERE active = 1)'),
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
    setPhotoFile: h.prepare('UPDATE job_photos SET file = ?, content_type = ?, compressed = ? WHERE task_id = ? AND doc_id = ?'),
    forgetPhotoFile: h.prepare('UPDATE job_photos SET file = NULL, compressed = 0 WHERE file = ?'),
    markCompressed: h.prepare('UPDATE job_photos SET compressed = 1, content_type = COALESCE(?, content_type) WHERE file = ?'),
    recentJobsMissingPhotos: h.prepare(`SELECT j.task_id AS taskId FROM jobs j
                                         WHERE j.client_id IN (SELECT client_id FROM clients WHERE active = 1)
                                           AND j.completed IS NOT NULL AND substr(j.completed, 1, 10) >= ?
                                           AND EXISTS (SELECT 1 FROM job_photos p WHERE p.task_id = j.task_id AND p.file IS NULL)
                                         ORDER BY j.completed DESC LIMIT ?`),
    photosToCompress: h.prepare(`SELECT DISTINCT p.file FROM job_photos p JOIN jobs j ON j.task_id = p.task_id
                                  WHERE p.file IS NOT NULL AND p.compressed = 0 AND j.completed IS NOT NULL
                                    AND substr(j.completed, 1, 10) < ? LIMIT ?`),
    filesForJob: h.prepare('SELECT file FROM job_photos WHERE task_id = ? AND file IS NOT NULL'),
    fullSizeFiles: h.prepare('SELECT DISTINCT file FROM job_photos WHERE file IS NOT NULL AND compressed = 0'),
    setFileType: h.prepare('UPDATE job_photos SET content_type = ? WHERE file = ?'),
    countPhotos: h.prepare('SELECT COUNT(*) AS photos, COUNT(file) AS photosSaved FROM job_photos'),

    getState: h.prepare('SELECT value FROM sync_state WHERE key = ?'),
    putState: h.prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  };

  const removeFiles = (files) => {
    for (const f of files) fs.rm(path.join(fileDir, path.basename(f)), { force: true }, () => {});
  };

  const removeJob = (taskId) => {
    const files = q.filesForJob.all(taskId).map((r) => r.file);
    q.deleteJob.run(taskId);
    removeFiles(files);
  };

  return {
    fileDir,

    // ----- clients -----
    saveClients: (clients) => db.transaction(() => { for (const c of clients) q.upsertClient.run(c.clientId, c.clientName); }),
    listClients: () => q.listClients.all().map((c) => ({ ...c, active: Boolean(c.active) })),
    getClient: (id) => {
      const c = q.clientById.get(id);
      return c ? { ...c, active: Boolean(c.active) } : null;
    },
    hasClients: () => q.countClients.get().n > 0,
    // Only active clients are read from AroFlo and shown in the portal.
    activeClients: () => q.activeClients.all(),
    isClientActive: (clientId) => Boolean(q.clientById.get(clientId)?.active),
    setClientActive: (clientId, clientName, active) => q.setActive.run(clientId, clientName || clientId, active ? 1 : 0),
    // Removes the synced jobs (and photo files) of one client, or of every inactive client.
    removeJobsForClient: (clientId) => { for (const r of q.jobIdsForClient.all(clientId)) removeJob(r.taskId); },
    removeJobsOutsideActive: () => { for (const r of q.jobIdsOutsideActive.all()) removeJob(r.taskId); },
    removeJobsCompletedBefore: (date) => { for (const r of q.jobIdsCompletedBefore.all(date)) removeJob(r.taskId); },

    // ----- jobs -----
    // Replaces everything we hold for one job with what AroFlo returned.
    // Photos already downloaded keep their file; photos removed in AroFlo are deleted.
    saveJob(job) {
      let removedFiles = [];
      db.transaction(() => {
        q.upsertJob.run(job.taskId, job.clientId, job.clientName, job.jobNumber, job.custOn, job.taskName, job.location,
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
    removeJob,
    getJob: (taskId) => q.jobById.get(taskId) || null,
    jobsForClient: (clientId) => q.jobsForClient.all(clientId),
    allJobIds: () => q.allJobIds.all().map((r) => r.taskId),
    notesForJob: (taskId) => q.notesForJob.all(taskId),
    photosForJob: (taskId) => q.photosForJob.all(taskId),
    getPhoto: (taskId, docId) => q.photo.get(taskId, docId) || null,
    setPhotoFile: (taskId, docId, file, contentType, compressed = false) => q.setPhotoFile.run(file, contentType, compressed ? 1 : 0, taskId, docId),
    forgetPhotoFile: (file) => q.forgetPhotoFile.run(file),
    markCompressed: (file, contentType) => q.markCompressed.run(contentType, file),
    // Cached photo files stored at full size (not shrunk).
    fullSizeFiles: () => q.fullSizeFiles.all().map((r) => r.file),
    setFileType: (file, contentType) => q.setFileType.run(contentType, file),
    // Cached photo files (not yet shrunk) of jobs completed before the given date.
    photosToCompress: (beforeDate, limit) => q.photosToCompress.all(beforeDate, limit).map((r) => r.file),
    // Active clients' jobs completed on/after the date that still have photos to download, newest first.
    recentJobsMissingPhotos: (sinceDate, limit) => q.recentJobsMissingPhotos.all(sinceDate, limit).map((r) => r.taskId),

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
    counts: () => {
      const c = q.countClients.get();
      return { jobs: q.countJobs.get().n, clients: c.n, activeClients: c.active, ...q.countPhotos.get() };
    },
  };
}
