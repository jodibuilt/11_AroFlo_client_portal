// Keeps the local copy of completed jobs in step with AroFlo while spending as little
// of the API allowance as possible:
//
//  * First run: one paged download of every Completed/Archived task, with notes and photos.
//  * AroFlo webhook (Task Completed / Archived / Add Task Note): the main trigger. The
//    payload carries the task id, so just that task is fetched by id (separate 20,000/day
//    "single record" allowance, not the 2,000/day limit).
//  * Change check (on every webhook and as a safety net, default hourly): the `lastupdate`
//    zone (free under the daily limit) lists tasks changed since last time. Only tasks we
//    already hold are re-fetched, to catch edits, reopened jobs and deletions; busy
//    in-progress jobs elsewhere in AroFlo are ignored. New completions arrive by webhook.
//  * Daily: client list, and a re-check of jobs completed in the last 7 days, which picks
//    up any completion whose webhook was missed and photos added just after completion.
//
// Photo files are downloaded once (for clients linked to a portal user) and kept on disk.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60_000;
const DONE_STATUSES = new Set(['completed', 'archived']);
const PHOTO_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const CLIENT_REFRESH_EVERY = 24 * 60 * MIN;
const RECENT_REFRESH_EVERY = 24 * 60 * MIN;
const RECENT_DAYS = 7;
const PHOTO_RETRY_EVERY = 6 * 60 * MIN;
const MAX_QUEUED_TASKS = 50;

// getIntervalMinutes is read before every scheduled check, so changes in Portal Settings
// apply without a restart.
export function createSync({ aroflo, store, getIntervalMinutes = () => 60, log = console }) {
  const status = {
    running: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastWebhookAt: null,
    lastChanges: 0,
  };
  const queuedTasks = new Set();
  const photoAttempts = new Map(); // taskId -> time of last failed download attempt
  let running = null;
  let runAgain = false;
  let soonTimer = null;

  // ---------- AroFlo → local records ----------
  async function fetchTask(taskId) {
    const resp = await aroflo.get([
      ['zone', 'tasks'],
      ['where', `and|taskid|=|${taskId}`],
      ['join', 'notes'],
      ['join', 'documentsandphotos'],
      ['page', '1'],
    ]);
    return (resp.tasks || []).find((t) => t.taskid === taskId) || null;
  }

  async function applyTask(task, { downloadAll = false } = {}) {
    const st = String(task.status || '').toLowerCase();
    if (!DONE_STATUSES.has(st) || !task.client?.clientid) {
      store.removeJob(task.taskid);
      return;
    }
    const job = mapTask(task);
    store.saveJob(job);
    if (downloadAll || store.isClientLinked(job.clientId)) await downloadPhotos(job);
  }

  async function syncTask(taskId, opts) {
    const task = await fetchTask(taskId);
    if (!task) store.removeJob(taskId);
    else await applyTask(task, opts);
  }

  async function downloadPhotos(job) {
    let failed = false;
    for (const p of job.photos) {
      if (store.getPhoto(job.taskId, p.id)?.file || !p.url) continue;
      try {
        const { contentType, body } = await aroflo.fetchDocument(p.url);
        if (!/^image\//i.test(contentType)) continue;
        const file = `${crypto.createHash('sha256').update(p.id).digest('hex')}.bin`;
        await fs.promises.writeFile(path.join(store.fileDir, file), body);
        store.setPhotoFile(job.taskId, p.id, file, contentType);
      } catch (err) {
        failed = true;
        log.warn(`Photo ${p.name} on job ${job.jobNumber} not downloaded yet: ${err.message}`);
      }
    }
    if (failed) photoAttempts.set(job.taskId, Date.now());
    else photoAttempts.delete(job.taskId);
  }

  // Pages through a task query with notes and photos joined, handling each page right
  // away because AroFlo's photo links expire after 10 minutes.
  async function eachTask(where, onTask) {
    let pageSize = 25;
    let done = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const page = Math.floor(done / pageSize) + 1;
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
          pageSize = Math.max(2, Math.floor(pageSize / 2));
          done = Math.floor(done / pageSize) * pageSize;
          continue;
        }
        throw err;
      }
      const rows = resp.tasks || [];
      for (const task of rows) await onTask(task);
      done += rows.length;
      if (rows.length < pageSize) return;
    }
  }

  const DONE_WHERE = ['and|(|status|=|completed', 'or|status|=|archived|)'];

  async function fullSync() {
    const startedAt = utcStamp(Date.now() - 2 * MIN);
    const seen = new Set();
    await eachTask(DONE_WHERE, async (task) => {
      seen.add(task.taskid);
      await applyTask(task);
    });
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

  async function refreshRecent() {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * MIN).toISOString().slice(0, 10);
    await eachTask([...DONE_WHERE, `and|datecompleted|>|${since}`], (task) => applyTask(task));
    store.setState('recentAt', Date.now());
  }

  async function fillMissingPhotos() {
    for (const taskId of store.tasksMissingPhotos(25)) {
      if (Date.now() - (photoAttempts.get(taskId) || 0) < PHOTO_RETRY_EVERY) continue;
      await syncTask(taskId);
    }
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
        for (const taskId of [...queuedTasks]) {
          queuedTasks.delete(taskId);
          await syncTask(taskId);
        }
        if (!store.hasClients() || due('clientsAt', CLIENT_REFRESH_EVERY)) await refreshClients();
        status.lastChanges = await incrementalSync();
        if (due('recentAt', RECENT_REFRESH_EVERY)) await refreshRecent();
        await fillMissingPhotos();
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
      const schedule = (delay) => setTimeout(async () => {
        await run();
        schedule(Math.max(5, Number(getIntervalMinutes()) || 60) * MIN);
      }, delay);
      schedule(2000);
    },
    run,
    runSoon,
    // Called by the webhook. Task ids found in the payload are fetched first; either way
    // the lastupdate check runs, so the webhook payload format doesn't matter.
    notify(taskIds = []) {
      status.lastWebhookAt = new Date().toISOString();
      for (const id of taskIds) if (queuedTasks.size < MAX_QUEUED_TASKS) queuedTasks.add(id);
      runSoon();
    },
    async fullResync() {
      store.setState('cursor', null);
      return run();
    },
    async refreshClients() {
      await refreshClients();
    },
    // Used when someone opens a photo we haven't downloaded yet (e.g. admin previewing a
    // client nobody is linked to): one single-task fetch for fresh links, then download.
    async fetchPhotosNow(taskId) {
      await syncTask(taskId, { downloadAll: true });
    },
  };
}

// ---------- Mapping AroFlo records ----------
function mapTask(t) {
  return {
    taskId: t.taskid,
    clientId: t.client.clientid,
    clientName: t.client.clientname || '',
    jobNumber: String(t.jobnumber || ''),
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
