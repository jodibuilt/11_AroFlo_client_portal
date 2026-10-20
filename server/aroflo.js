// AroFlo API client.
// Implements AroFlo's HMAC-SHA512 request signing (see the Postman pre-request
// script at apidocs.aroflo.com) plus a request queue that keeps us inside the
// published rate limits: 3 req/sec, 120 req/min, 2000 req/day.
//
// READ-ONLY: the portal never changes anything in AroFlo. Every request is a GET with
// no body, and checkQuery() refuses anything outside the few read queries sync.js
// needs before it is signed or sent. (AroFlo writes are POSTs; nothing here builds one.)
import crypto from 'node:crypto';

const ACCEPT = 'text/json';
const READ_ONLY_METHOD = 'GET';
const MIN_GAP_MS = 400;          // ~2.5 req/sec, under the 3/sec cap
const PER_MINUTE = 110;          // headroom under the 120/min cap
const MAX_RETRIES = 3;
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const PAUSE_MS = 60 * 60_000;    // how long to stop calling when the allowance runs low

const ZONES = new Set(['tasks', 'clients', 'lastupdate']);
const JOINS = new Set(['notes', 'documentsandphotos']);
const WHERE = /^and\|(taskid|datecompleted|clientname|zonename|lastupdateutc|archived)\|(=|>|>=)\|[^|\r\n]{0,200}$/i;
const ORDER = /^lastupdateutc\|(asc|desc)$/i;

export class AroFloError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AroFloError';
    this.status = status;
  }
}

// Throws unless `params` is one of the read queries the portal uses: one allowed zone,
// and only simple "and|field|op|value" filters on known fields.
export function checkQuery(params) {
  const ok = Array.isArray(params)
    && params.filter((p) => p?.[0] === 'zone').length === 1
    && params.every((p) => {
      if (!Array.isArray(p) || p.length !== 2) return false;
      const value = String(p[1]);
      switch (p[0]) {
        case 'zone': return ZONES.has(value.toLowerCase());
        case 'where': return WHERE.test(value);
        case 'join': return JOINS.has(value.toLowerCase());
        case 'order': return ORDER.test(value);
        case 'page':
        case 'pageSize': return /^\d{1,4}$/.test(value);
        default: return false;
      }
    });
  if (!ok) throw new AroFloError('Refused: not one of the read-only AroFlo queries the portal is allowed to make', 'blocked');
}

export function createAroFloClient(config) {
  const { baseUrl, secretKey, uEncoded, pEncoded, orgEncoded, hostIp } = config;
  // Calls stop for an hour when fewer than this many remain today, so the portal never
  // uses up the allowance TTS's other AroFlo integrations share.
  const dailyReserve = config.dailyReserve ?? 200;
  const singleRecordReserve = config.singleRecordReserve ?? 1000;
  let pausedUntil = 0;
  const authorization =
    `uencoded=${encodeURIComponent(uEncoded)}` +
    `&pencoded=${encodeURIComponent(pEncoded)}` +
    `&orgEncoded=${encodeURIComponent(orgEncoded)}`;

  const stats = {
    requestsMade: 0,
    dailyRemaining: null,
    dailyLimit: null,
    singleRecordRemaining: null,
    lastError: null,
    lastErrorAt: null,
    lastSuccessAt: null,
    pausedUntil: null,
  };

  // Serialised queue so concurrent page loads can't burst past the limits.
  let chain = Promise.resolve();
  let lastSent = 0;
  const sentTimes = [];

  function schedule(fn) {
    const run = chain.then(async () => {
      const now = Date.now();
      while (sentTimes.length && now - sentTimes[0] > 60_000) sentTimes.shift();
      let wait = Math.max(0, lastSent + MIN_GAP_MS - now);
      if (sentTimes.length >= PER_MINUTE) {
        wait = Math.max(wait, sentTimes[0] + 60_000 - now);
      }
      if (wait) await sleep(wait);
      lastSent = Date.now();
      sentTimes.push(lastSent);
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  }

  function sign(method, varString, timestamp) {
    const payload = [method];
    if (hostIp) payload.push(hostIp);
    payload.push('', ACCEPT, authorization, timestamp, varString);
    return crypto.createHmac('sha512', secretKey).update(payload.join('+')).digest('hex');
  }

  function checkPaused() {
    if (Date.now() < pausedUntil) {
      throw new AroFloError(`Paused until ${new Date(pausedUntil).toISOString()} to save the rest of today's AroFlo allowance`, 'budget');
    }
  }

  async function sendOnce(varString) {
    checkPaused(); // re-checked here: requests already queued when the pause began
    const timestamp = new Date().toISOString();
    const headers = {
      Accept: ACCEPT,
      Authorization: authorization,
      Authentication: `HMAC ${sign(READ_ONLY_METHOD, varString, timestamp)}`,
      afdatetimeutc: timestamp,
    };
    if (hostIp) headers.HostIP = hostIp;

    const res = await fetch(`${baseUrl}?${varString}`, {
      method: READ_ONLY_METHOD,
      headers,
      signal: AbortSignal.timeout(70_000),
    });
    stats.requestsMade++;
    const daily = res.headers.get('x-ratelimit-daily-remaining');
    if (daily != null) stats.dailyRemaining = Number(daily);
    const dailyLimit = res.headers.get('x-ratelimit-daily-limit');
    if (dailyLimit != null) stats.dailyLimit = Number(dailyLimit);
    const single = res.headers.get('x-ratelimit-secondary-daily-remaining');
    if (single != null) stats.singleRecordRemaining = Number(single);
    if ((daily != null && stats.dailyRemaining < dailyReserve) || (single != null && stats.singleRecordRemaining < singleRecordReserve)) {
      pausedUntil = Date.now() + PAUSE_MS;
      stats.pausedUntil = new Date(pausedUntil).toISOString();
    }

    if (res.status === 429) throw new AroFloError('Too many requests per second', '429');
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AroFloError(`Unexpected response from AroFlo (HTTP ${res.status})`, String(res.status));
    }
    if (String(body.status) !== '0') {
      throw new AroFloError(body.statusmessage || 'AroFlo request failed', String(body.status));
    }
    return body.zoneresponse || {};
  }

  async function get(params) {
    if (!secretKey || !uEncoded || !pEncoded || !orgEncoded) {
      throw new AroFloError('AroFlo credentials are not set (AROFLO_* settings)', 'config');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        checkQuery(params);
        checkPaused();
        const varString = params
          .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
          .join('&');
        const result = await schedule(() => sendOnce(varString));
        stats.lastSuccessAt = new Date().toISOString();
        return result;
      } catch (err) {
        // Per-second / per-minute rate limits are transient, so back off and retry.
        const retryable = err instanceof AroFloError && ['429', '6'].includes(err.status);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        stats.lastError = err.message;
        stats.lastErrorAt = new Date().toISOString();
        throw err;
      }
    }
  }

  // Fetches every page of a zone query and returns the concatenated records.
  async function getAll(zone, params, { pageSize = 500, maxPages = 20 } = {}) {
    const records = [];
    for (let page = 1; page <= maxPages; page++) {
      const resp = await get([
        ['zone', zone],
        ...params,
        ['pageSize', String(pageSize)],
        ['page', String(page)],
      ]);
      const rows = resp[zone.toLowerCase()] || [];
      records.push(...rows);
      // Fewer rows than requested means this was the last page.
      if (rows.length < pageSize) break;
    }
    return records;
  }

  // Downloads a document/photo from the short-lived signed URL AroFlo returns.
  // Only AroFlo hosts are allowed so a bad record can't make us fetch arbitrary URLs,
  // and oversized files are refused so one can't exhaust the server's memory.
  async function fetchDocument(url) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !/(^|\.)aroflo\.com$/i.test(parsed.hostname)) {
      throw new AroFloError('Refusing to fetch document from a non-AroFlo host', 'host');
    }
    const res = await fetch(parsed, { method: READ_ONLY_METHOD, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new AroFloError(`Document download failed (HTTP ${res.status})`, String(res.status));
    const tooBig = () => new AroFloError(`Document is larger than ${MAX_DOCUMENT_BYTES / 1048576} MB`, 'size');
    if (Number(res.headers.get('content-length')) > MAX_DOCUMENT_BYTES) {
      await res.body?.cancel();
      throw tooBig();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body ?? []) {
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES) throw tooBig();
      chunks.push(chunk);
    }
    return {
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      body: Buffer.concat(chunks),
    };
  }

  return { get, getAll, fetchDocument, stats, mode: 'live' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
