// Keeps the local copy of completed jobs in step with AroFlo while spending as little
// of the API allowance as possible:
//
//  * Only ACTIVE clients (chosen in Control Panel → Clients, or linked to a user) are read.
//    Everything below is limited to them; other AroFlo clients cost no API calls.
//  * First run: one paged download of each active client's Completed/Archived tasks.
//    Activating a client later downloads just that client.
//  * AroFlo webhook (Task Completed / Archived / Add Task Note): the main trigger. The
//    payload carries the task id, so just that task is fetched by id (separate 20,000/day
//    "single record" allowance, not the 2,000/day limit).
//  * Change check (on every webhook and as a safety net, default hourly): the `lastupdate`
//    zone (free under the daily limit) lists tasks changed since last time. Only tasks we
//    already hold are re-fetched, to catch edits, reopened jobs and deletions; busy
//    in-progress jobs elsewhere in AroFlo are ignored. New completions arrive by webhook.
//  * Webhooks for inactive clients are ignored without calling AroFlo (the payload carries
//    the client's name).
//  * Hourly: each active client's jobs completed in the last 2 days (new completions
//    without relying on webhooks; ~1 call per active client).
//  * Daily: client list, and a re-check of active clients' jobs completed in the last 7
//    days, which picks up any completion whose webhook was missed.
//
// Photo files: recent jobs' photos (completed within compressAfterDays) are pre-downloaded
// full-size in the background while the cache has room; anything else downloads the first
// time someone opens the job. Photos of older jobs are stored shrunk. The cache is capped
// (least recently viewed photos are evicted first).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { shrink, cleanFullSize, canProcess, SHRUNK_TYPE } from './images.js';

const MIN = 60_000;
const PHOTO_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const CLIENT_REFRESH_EVERY = 24 * 60 * MIN;
const RECENT_REFRESH_EVERY = 24 * 60 * MIN;
const RECENT_DAYS = 7;
const COMPRESS_EVERY = 24 * 60 * MIN;
const NEW_JOBS_EVERY = 55 * MIN;       // with the hourly cycle: once per cycle
const NEW_JOBS_DAYS = 2;              // look back this far for newly completed jobs
const PREFETCH_PER_RUN = 40;          // jobs per cycle (1 single-job lookup each)
const PREFETCH_BUDGET = 0.7;          // stop pre-downloading at 70% of the photo cache cap
const MAX_QUEUED_TASKS = 50;

// getIntervalMinutes is read before every scheduled check, so changes in Portal Settings
// apply without a restart.
// getSyncFrom returns the earliest completed date (YYYY-MM-DD) to sync; older jobs are
// never requested from AroFlo or kept.
export function createSync({ aroflo, store, getIntervalMinutes = () => 60, getSyncFrom = () => '', photoCacheBytes = 2000 * 1024 * 1024, compressAfterDays = 30, log = console }) {
  // Photos of jobs completed before this date are stored shrunk (see images.js).
  const compressBefore = () => new Date(Date.now() - compressAfterDays * 24 * 60 * MIN).toISOString().slice(0, 10);
  const status = {
    running: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastWebhookAt: null,
    lastChanges: 0,
  };
  const queuedTasks = new Set();
  const queuedClients = new Set(); // client ids to download after being activated
  const photoAttempts = new Map(); // taskId -> time of last failed download attempt
  // On-demand AroFlo fetches in progress. A job page asks for all its photos at once, so
  // parallel requests for the same job share one fetch instead of one each.
  const inflight = new Map();
  const once = (key, fn) => {
    if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
    return inflight.get(key);
  };
  // Fires `${taskId}|${docId}` as each photo is saved, so someone waiting on one photo
  // gets it straight away instead of after the whole job's photos are done.
  const photoSaved = new EventEmitter();
  photoSaved.setMaxListeners(0);
  // Background photo work (pre-download, compression, cleaning) waits while someone is
  // waiting on a photo, so it doesn't take the server's only CPU core away from them.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yieldToVisitors = async () => {
    for (let i = 0; i < 120 && inflight.size; i++) await sleep(500);
  };
  let running = null;
  let runAgain = false;
  let soonTimer = null;

  // ---------- AroFlo → local records ----------
  async function fetchTask(taskId, urgent = false) {
    const resp = await aroflo.get([
      ['zone', 'tasks'],
      ['where', `and|taskid|=|${taskId}`],
      ['join', 'notes'],
      ['join', 'documentsandphotos'],
      ['page', '1'],
    ], { urgent });
    return (resp.tasks || []).find((t) => t.taskid === taskId) || null;
  }

  async function applyTask(task, { downloadAll = false, urgent = false } = {}) {
    // A job counts as completed when AroFlo has a completed date for it, whatever its
    // status or substatus (Completed, Ready for Invoicing, To Be Reviewed, Archived, ...).
    const completedOn = normDate(task.completeddatetime || task.completeddate);
    if (!completedOn || !task.client?.clientid || !store.isClientActive(task.client.clientid)) {
      store.removeJob(task.taskid);
      return;
    }
    const job = mapTask(task);
    const from = getSyncFrom();
    if (from && job.completed && job.completed.slice(0, 10) < from) {
      store.removeJob(job.taskId);
      return;
    }
    store.saveJob(job);
    if (downloadAll) await downloadPhotos(job, urgent);
  }

  async function syncTask(taskId, opts = {}) {
    const task = await fetchTask(taskId, opts.urgent);
    if (!task) store.removeJob(taskId);
    else await applyTask(task, opts);
  }

  async function downloadPhotos(job, urgent = false) {
    let failed = false;
    const keep = new Set(); // this job's files: never evicted by the trim below
    // Same order as the job page shows them, so the first photos on screen arrive first.
    const inPageOrder = [...job.photos].sort((a, b) =>
      String(a.uploaded || '').localeCompare(String(b.uploaded || '')) || String(a.name || '').localeCompare(String(b.name || '')));
    for (const p of inPageOrder) {
      if (store.getPhoto(job.taskId, p.id)?.file || !p.url) continue;
      if (!urgent) await yieldToVisitors();
      try {
        const { contentType, body } = await aroflo.fetchDocument(p.url);
        if (!/^image\//i.test(contentType)) continue;
        const file = `${crypto.createHash('sha256').update(p.id).digest('hex')}.bin`;
        // Photos of jobs completed more than compressAfterDays ago are stored shrunk; the
        // rest at full size. Either way hidden metadata (GPS, device) is removed.
        const old = job.completed && job.completed.slice(0, 10) < compressBefore();
        const small = old ? await shrink(body) : null;
        const clean = small ? { body: small, type: SHRUNK_TYPE } : await cleanFullSize(body);
        await fs.promises.writeFile(path.join(store.fileDir, file), clean?.body || body);
        store.setPhotoFile(job.taskId, p.id, file, clean?.type || contentType, Boolean(small));
        keep.add(file);
        photoSaved.emit(`${job.taskId}|${p.id}`);
      } catch (err) {
        failed = true;
        log.warn(`Photo ${p.name} on job ${job.jobNumber} not downloaded yet: ${err.message}`);
      }
    }
    if (failed) photoAttempts.set(job.taskId, Date.now());
    else photoAttempts.delete(job.taskId);
    for (const p of store.photosForJob(job.taskId)) if (p.file) keep.add(p.file);
    await trimPhotoCache(keep);
  }

  // Keeps the photo cache under photoCacheBytes by deleting the least recently viewed
  // files (serving a photo touches its file). Evicted photos re-download when opened.
  // Non-blocking: on network storage, deleting many large files can take a while.
  let trimming = null;
  function trimPhotoCache(keep = new Set()) {
    if (trimming) return trimming;
    trimming = (async () => {
      const names = await fs.promises.readdir(store.fileDir).catch(() => []);
      const files = [];
      for (const name of names) {
        const full = path.join(store.fileDir, name);
        const st = await fs.promises.stat(full).catch(() => null);
        if (st) files.push({ name, full, size: st.size, used: st.mtimeMs });
      }
      let total = files.reduce((sum, f) => sum + f.size, 0);
      if (total <= photoCacheBytes) return;
      files.sort((x, y) => x.used - y.used);
      for (const f of files) {
        if (total <= photoCacheBytes * 0.9) break;
        if (keep.has(f.name)) continue;
        try {
          await fs.promises.rm(f.full, { force: true });
          store.forgetPhotoFile(f.name);
          total -= f.size;
        } catch { /* in use; try the next one */ }
      }
    })().catch((err) => log.warn(`Photo cache trim failed: ${err.message}`)).finally(() => { trimming = null; });
    return trimming;
  }


  // Pages through a task query with notes and photos joined, handling each page right
  // away because AroFlo's photo links expire after 10 minutes.
  // AroFlo can return short pages part-way through a result set (with joins), so keep
  // going until a page comes back empty, and skip any task already handled.
  async function eachTask(where, onTask) {
    let pageSize = 50;
    let page = 1;
    const handled = new Set();
    for (let guard = 0; guard < 2000; guard++) {
      let resp;
      try {
        resp = await aroflo.get([
          ['zone', 'tasks'], ...where.map((w) => ['where', w]),
          ['join', 'notes'], ['join', 'documentsandphotos'],
          ['pageSize', String(pageSize)], ['page', String(page)],
        ]);
      } catch (err) {
        // Status 8 = response over AroFlo's 3.5 MB limit: retry with smaller pages.
        if (err.status === '8' && pageSize > 2) {
          const offset = (page - 1) * pageSize;
          pageSize = Math.max(2, Math.floor(pageSize / 2));
          page = Math.floor(offset / pageSize) + 1;
          continue;
        }
        throw err;
      }
      const rows = resp.tasks || [];
      if (!rows.length) return;
      for (const task of rows) {
        if (handled.has(task.taskid)) continue;
        handled.add(task.taskid);
        await onTask(task);
      }
      page++;
    }
  }

  // Tasks with a completed date on or after the cutoff, in any status. AroFlo's WHERE has
  // no ">=", so ask for completed after the day before the cutoff.
  const fromWhere = () => {
    const from = getSyncFrom();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '')) return ['and|datecompleted|>|1900-01-01'];
    const dayBefore = new Date(`${from}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    return [`and|datecompleted|>|${dayBefore.toISOString().slice(0, 10)}`];
  };

  const clientWhere = (c) => `and|clientname|=|${c.clientName}`;
  // Client names go into AroFlo filters, which can't contain "|" or line breaks (aroflo.js
  // refuses them). Such a client is skipped with a warning instead of stopping the sync.
  const queryable = (c) => {
    const ok = !/[|\r\n]/.test(c.clientName) && c.clientName.length <= 200;
    if (!ok) log.warn(`Client ${JSON.stringify(c.clientName)} can't be synced: its name can't be used in an AroFlo filter.`);
    return ok;
  };
  const activeClients = () => store.activeClients().filter(queryable);

  async function downloadClient(client, seen) {
    await eachTask([clientWhere(client), ...fromWhere()], async (task) => {
      seen?.add(task.taskid);
      await applyTask(task);
    });
  }

  async function fullSync() {
    const startedAt = utcStamp(Date.now() - 2 * MIN);
    const seen = new Set();
    for (const client of activeClients()) await downloadClient(client, seen);
    for (const id of store.allJobIds()) if (!seen.has(id)) store.removeJob(id);
    store.setState('cursor', { at: startedAt, keys: [] });
    store.setState('fullSyncAt', new Date().toISOString());
    store.setState('recentAt', Date.now());
    return seen.size;
  }

  // Asks the free `lastupdate` zone which tasks changed since our cursor.
  async function incrementalSync() {
    const cursor = store.getState('cursor');
    if (!cursor) return fullSync();
    const rows = await aroflo.getAll('lastupdate', [
      ['where', 'and|zonename|=|tasks'],
      ['where', `and|lastupdateutc|>=|${cursor.at}`],
      ['order', 'lastupdateutc|asc'],
    ]);
    const seenKeys = new Set(cursor.keys);
    let maxAt = cursor.at;
    let keysAtMax = new Set(cursor.keys);
    const changed = new Map(); // taskId -> deleted?
    for (const r of rows) {
      if (r.zonename !== 'tasks' || !r.zoneid) continue;
      const at = String(r.lastupdateutc || '').replace(/\//g, '-');
      const key = `${r.zoneid}|${at}`;
      if (seenKeys.has(key)) continue;
      changed.set(r.zoneid, Number(r.isdeleted) === 1);
      if (at > maxAt) { maxAt = at; keysAtMax = new Set(); }
      if (at === maxAt) keysAtMax.add(key);
    }
    let fetched = 0;
    for (const [taskId, deleted] of changed) {
      if (deleted) {
        store.removeJob(taskId);
      } else if (store.getJob(taskId)) {
        // Only jobs the portal already shows: catches edits, reopened jobs and deletions.
        await syncTask(taskId);
        fetched++;
      }
    }
    // Only move the cursor once every change was applied, so a failure is retried next time.
    store.setState('cursor', { at: maxAt, keys: [...keysAtMax] });
    return fetched;
  }

  async function refreshClients() {
    const rows = await aroflo.getAll('clients', [['where', 'and|archived|=|false']]);
    store.saveClients(rows
      .filter((c) => c.clientid && c.clientname)
      .map((c) => ({ clientId: c.clientid, clientName: c.clientname })));
    store.setState('clientsAt', Date.now());
  }

  // Hourly: each active client's jobs completed in the last NEW_JOBS_DAYS days, so new
  // completions arrive even without webhooks (about 1 call per active client).
  async function checkNewCompletions() {
    const since = new Date(Date.now() - NEW_JOBS_DAYS * 24 * 60 * MIN).toISOString().slice(0, 10);
    const cutoff = fromWhere()[0].split('|').pop(); // day before the sync-from date
    const after = since > cutoff ? since : cutoff;
    for (const client of activeClients()) {
      await eachTask([clientWhere(client), `and|datecompleted|>|${after}`], (task) => applyTask(task));
    }
    store.setState('newJobsAt', Date.now());
  }

  async function refreshRecent() {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * MIN).toISOString().slice(0, 10);
    const recent = `and|datecompleted|>|${since}`;
    const active = activeClients();
    // A few active clients: ask per client. Many: one query for everyone is cheaper, and
    // applyTask simply ignores jobs of inactive clients.
    if (active.length && active.length <= 5) {
      for (const client of active) await eachTask([clientWhere(client), recent], (task) => applyTask(task));
    } else if (active.length) {
      await eachTask([recent], (task) => applyTask(task));
    }
    store.setState('recentAt', Date.now());
  }


  // Shrinks cached photos once their job is older than compressAfterDays. Runs in the
  // background; each file is replaced via a temp file so a half-written photo is never served.
  // Pre-downloads full-size photos for recent jobs (completed within compressAfterDays) so
  // they open instantly. Newest first, a few dozen jobs per cycle, and only while the
  // cache is under PREFETCH_BUDGET of its cap, so it never churns against eviction.
  let prefetching = null;
  const prefetchTried = new Set(); // jobs attempted this process (avoid retry loops)
  async function cacheBytes() {
    const names = await fs.promises.readdir(store.fileDir).catch(() => []);
    let total = 0;
    for (const name of names) total += (await fs.promises.stat(path.join(store.fileDir, name)).catch(() => ({ size: 0 }))).size;
    return total;
  }
  function prefetchRecentPhotos() {
    if (prefetching) return prefetching;
    prefetching = (async () => {
      let used = await cacheBytes();
      let done = 0;
      while (done < PREFETCH_PER_RUN && used < photoCacheBytes * PREFETCH_BUDGET) {
        const next = store.recentJobsMissingPhotos(compressBefore(), PREFETCH_PER_RUN * 2).find((id) => !prefetchTried.has(id));
        if (!next) break;
        prefetchTried.add(next);
        await yieldToVisitors();
        await syncTask(next, { downloadAll: true });
        done++;
        if (done % 5 === 0) used = await cacheBytes();
      }
    })().catch((err) => log.warn(`Photo pre-download failed: ${err.message}`)).finally(() => { prefetching = null; });
    return prefetching;
  }

  // One-off: photos cached at full size before metadata cleaning existed are cleaned in
  // place (via a temp file, keeping their "last viewed" time). Runs again only if sharp
  // was unavailable.
  let cleaning = null;
  function cleanCachedPhotos() {
    if (cleaning || store.getState('photosCleaned')) return cleaning || Promise.resolve();
    cleaning = (async () => {
      if (!(await canProcess())) return;
      for (const name of store.fullSizeFiles()) {
        await yieldToVisitors();
        const full = path.join(store.fileDir, name);
        const original = await fs.promises.readFile(full).catch(() => null);
        if (!original) { store.forgetPhotoFile(name); continue; }
        const clean = await cleanFullSize(original);
        if (!clean) continue;
        const stat = await fs.promises.stat(full);
        await fs.promises.writeFile(`${full}.tmp`, clean.body);
        await fs.promises.rename(`${full}.tmp`, full);
        await fs.promises.utimes(full, stat.atime, stat.mtime);
        store.setFileType(name, clean.type);
      }
      store.setState('photosCleaned', true);
    })().catch((err) => log.warn(`Photo metadata cleaning failed: ${err.message}`)).finally(() => { cleaning = null; });
    return cleaning;
  }

  let compressing = null;
  function compressAgedPhotos() {
    if (compressing) return compressing;
    compressing = (async () => {
      let saved = 0;
      for (let batch = 0; batch < 100; batch++) {
        const files = store.photosToCompress(compressBefore(), 50);
        if (!files.length) break;
        for (const name of files) {
          await yieldToVisitors();
          const full = path.join(store.fileDir, name);
          const original = await fs.promises.readFile(full).catch(() => null);
          if (!original) { store.forgetPhotoFile(name); continue; }
          const small = await shrink(original);
          if (!small) return; // compression unavailable: stop, try again tomorrow
          if (small.length < original.length) {
            const stat = await fs.promises.stat(full);
            await fs.promises.writeFile(`${full}.tmp`, small);
            await fs.promises.rename(`${full}.tmp`, full);
            await fs.promises.utimes(full, stat.atime, stat.mtime); // keep its "last viewed" time
            saved += original.length - small.length;
          }
          store.markCompressed(name, small.length < original.length ? SHRUNK_TYPE : null);
        }
      }
      store.setState('compressedAt', Date.now());
      if (saved) log.warn?.(`Compressed aged photos, saved ${Math.round(saved / 1048576)} MB.`);
    })().catch((err) => log.warn(`Photo compression failed: ${err.message}`)).finally(() => { compressing = null; });
    return compressing;
  }

  const due = (key, every) => Date.now() - (store.getState(key) || 0) > every;

  // ---------- Scheduling ----------
  function run() {
    if (running) {
      runAgain = true;
      return running;
    }
    running = (async () => {
      status.running = true;
      status.lastRunAt = new Date().toISOString();
      try {
        for (const clientId of [...queuedClients]) {
          queuedClients.delete(clientId);
          const client = store.getClient(clientId);
          if (client?.active && store.getState('cursor') && queryable(client)) await downloadClient(client);
        }
        for (const taskId of [...queuedTasks]) {
          queuedTasks.delete(taskId);
          await syncTask(taskId);
        }
        if (!store.hasClients() || due('clientsAt', CLIENT_REFRESH_EVERY)) await refreshClients();
        status.lastChanges = await incrementalSync();
        if (due('newJobsAt', NEW_JOBS_EVERY)) await checkNewCompletions();
        if (due('recentAt', RECENT_REFRESH_EVERY)) await refreshRecent();
        if (due('compressedAt', COMPRESS_EVERY)) compressAgedPhotos(); // background, not awaited
        prefetchRecentPhotos(); // background, not awaited
        status.lastSuccessAt = new Date().toISOString();
        status.lastError = null;
      } catch (err) {
        status.lastError = err.message;
        log.error(`AroFlo sync failed: ${err.message}`);
      } finally {
        status.running = false;
        running = null;
        if (runAgain) {
          runAgain = false;
          runSoon();
        }
      }
    })();
    return running;
  }

  // Coalesces bursts (several webhooks, several admin edits) into one run.
  function runSoon(delayMs = 3000) {
    if (soonTimer) return;
    soonTimer = setTimeout(() => {
      soonTimer = null;
      run();
    }, delayMs);
  }

  return {
    status,
    start() {
      store.removeJobsOutsideActive();
      setTimeout(() => trimPhotoCache().then(() => (due('compressedAt', COMPRESS_EVERY) ? compressAgedPhotos() : null)).then(() => cleanCachedPhotos()).then(() => prefetchRecentPhotos()), 15_000);
      if (getSyncFrom()) store.removeJobsCompletedBefore(getSyncFrom());
      const schedule = (delay) => setTimeout(async () => {
        await run();
        schedule(Math.max(5, Number(getIntervalMinutes()) || 60) * MIN);
      }, delay);
      schedule(2000);
    },
    run,
    runSoon,
    // Called by the webhook. Task ids found in the payload are fetched first, then the free
    // change check runs. When the payload names a client that isn't active, nothing is
    // fetched at all.
    notify(taskIds = [], { clientName } = {}) {
      status.lastWebhookAt = new Date().toISOString();
      if (clientName) {
        const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (!store.activeClients().some((c) => norm(c.clientName) === norm(clientName))) {
          status.lastWebhookIgnored = status.lastWebhookAt;
          return;
        }
      }
      for (const id of taskIds) if (queuedTasks.size < MAX_QUEUED_TASKS) queuedTasks.add(id);
      runSoon();
    },
    // The sync-from date moved earlier: download the extra jobs for every active client.
    redownloadActiveClients() {
      for (const c of store.activeClients()) queuedClients.add(c.clientId);
      runSoon(500);
    },
    // A client was just activated: download its completed jobs on the next run.
    activateClient(clientId) {
      queuedClients.add(clientId);
      runSoon(500);
    },
    async fullResync() {
      store.setState('cursor', null);
      return run();
    },
    async refreshClients() {
      await refreshClients();
    },
    // Full-resolution original of one photo, straight from AroFlo (not cached). Used for
    // "Download" when the cached copy has been shrunk.
    fetchOriginalPhoto(taskId, docId) {
      return once(`original|${taskId}|${docId}`, async () => {
        const task = await fetchTask(taskId, true);
        const doc = (task?.documentsandphotos || []).find((d) => d.documentid === docId);
        if (!doc?.url) return null;
        const original = await aroflo.fetchDocument(doc.url);
        const clean = await cleanFullSize(original.body, { maxEdge: 0 }); // full resolution, no hidden metadata
        return clean ? { contentType: clean.type, body: clean.body } : original;
      });
    },
    cleanCachedPhotos,
    // Used when someone opens a photo we haven't downloaded yet (e.g. admin previewing a
    // client nobody is linked to): one single-task fetch for fresh links, then download.
    // Resolves when this photo is saved, or when the whole job's download ends (saved or not).
    fetchPhotoNow(taskId, docId) {
      const all = once(`photos|${taskId}`, () => syncTask(taskId, { downloadAll: true, urgent: true }));
      const key = `${taskId}|${docId}`;
      return new Promise((resolve, reject) => {
        const saved = () => resolve();
        photoSaved.once(key, saved);
        all.then(resolve, reject).finally(() => photoSaved.off(key, saved));
      });
    },
    isFetchingPhotos: (taskId) => inflight.has(`photos|${taskId}`),
  };
}

// ---------- Mapping AroFlo records ----------
function mapTask(t) {
  return {
    taskId: t.taskid,
    clientId: t.client.clientid,
    clientName: t.client.clientname || '',
    jobNumber: String(t.jobnumber || ''),
    custOn: String(t.custon || '').trim(),
    taskName: t.taskname || '',
    location: t.tasklocation?.locationname || t.location?.locationname || '',
    status: String(t.status).toLowerCase(),
    completed: normDate(t.completeddatetime || t.completeddate),
    notes: (t.tasknotes || []).map((n) => ({
      id: n.noteid,
      text: htmlToText(n.content ?? n.note),
      posted: parseNoteTime(n.timeposted) || normDate(n.dateposted),
      author: n.user?.username || '',
      filter: n.filter || '',
    })),
    photos: (t.documentsandphotos || [])
      .filter((d) => d.documentid && PHOTO_EXT.test(d.name || ''))
      .map((d) => ({
        id: d.documentid,
        name: d.name,
        comment: d.comment || '',
        uploaded: normDate(d.uploadeddatetime),
        filter: d.filter || '',
        url: d.url,
      })),
  };
}

// "YYYY-MM-DD HH:mm:ss" in UTC, the format AroFlo's WHERE filters accept.
function utcStamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

// AroFlo dates look like "2018/10/29 00:15:00" in the org's local time. Keep them
// zone-less ("2018-10-29T00:15:00") so the browser shows them as entered.
function normDate(value) {
  const m = String(value || '').trim().match(/^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}` : `${m[1]}-${m[2]}-${m[3]}`;
}

// Note times look like "Nov 14, 2018 2:56:20 PM".
function parseNoteTime(value) {
  const m = String(value || '').trim().match(/^(\w{3})\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()) + 1;
  if (!month) return null;
  let hour = Number(m[4]) % 12;
  if (m[7].toUpperCase() === 'PM') hour += 12;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p(month)}-${p(m[2])}T${p(hour)}:${m[5]}:${m[6] || '00'}`;
}

// Notes can be HTML. We store and render them as plain text, which keeps line breaks
// and removes any chance of injecting markup into the portal.
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
