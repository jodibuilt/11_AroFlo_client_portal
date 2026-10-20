// What the portal shows, read entirely from the local copy kept by sync.js.
// Page views never call AroFlo; the only exception is a photo nobody has opened
// before for a client no portal user is linked to (see getFile).
import path from 'node:path';

const CLIENT_VISIBLE = new Set(['show client', 'show all']);

export function createPortalData({ store, sync }) {
  // Every stored job has a completed date; archived ones are shown only when the setting allows.
  const statusAllowed = (status, settings) => status !== 'archived' || settings.includeArchived;

  // Returns the stored job only if it belongs to one of `clientIds` (null = any client)
  // and has a status the portal shows.
  function accessibleJob(taskId, clientIds, settings) {
    const job = store.getJob(taskId);
    if (!job || !statusAllowed(job.status, settings)) return null;
    if (clientIds !== null && !clientIds.includes(job.client_id)) return null;
    return job;
  }

  return {
    listClients: () => store.listClients(),
    getClient: (clientId) => store.getClient(clientId),

    // Newest completed first. Only the fields clients are meant to see.
    jobsForClient(clientId, settings) {
      return store.jobsForClient(clientId)
        .filter((j) => statusAllowed(j.status, settings))
        .map(({ status, ...job }) => job);
    },

    jobDetail(taskId, clientIds, settings) {
      const job = accessibleJob(taskId, clientIds, settings);
      if (!job) return null;
      return {
        taskId: job.task_id,
        custOn: job.cust_on,
        taskName: job.task_name,
        location: job.location,
        clientName: job.client_name,
        completed: job.completed,
        notes: store.notesForJob(taskId)
          .filter((n) => visible(n.filter, settings.noteVisibility))
          .map(({ text, posted }) => ({ text, posted })),
        // `id` is AroFlo's document id: index.js swaps it for an encrypted reference.
        photos: store.photosForJob(taskId)
          .filter((p) => visible(p.filter, settings.fileVisibility))
          // AroFlo gives upload times in UTC (unlike job and note times, which are local),
          // so mark them as UTC and let the browser show local time.
          .map(({ id, comment, uploaded }) => ({ id, comment, uploaded: uploaded?.includes('T') ? `${uploaded}Z` : uploaded })),
      };
    },

    // canFetch() is asked only when the photo must come from AroFlo first and no fetch
    // for this job is already running; returning false gives { limited: true }.
    async getFile(taskId, docId, clientIds, settings, canFetch = () => true) {
      const job = accessibleJob(taskId, clientIds, settings);
      if (!job) return null;
      let photo = store.getPhoto(taskId, docId);
      if (!photo || !visible(photo.filter, settings.fileVisibility)) return null;
      if (!photo.file) {
        if (!sync.isFetchingPhotos(taskId) && !canFetch()) return { limited: true };
        await sync.fetchPhotosNow(taskId);
        photo = store.getPhoto(taskId, docId);
        if (!photo?.file) return null;
      }
      return { contentType: photo.content_type, custOn: job.cust_on, compressed: Boolean(photo.compressed), filePath: path.join(store.fileDir, photo.file) };
    },
  };
}

function visible(filter, mode) {
  return mode === 'all' || CLIENT_VISIBLE.has(String(filter || '').trim().toLowerCase());
}
