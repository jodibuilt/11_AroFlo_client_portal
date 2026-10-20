// Demo data source with the same shape as the AroFlo API responses.
// Used when DEMO_MODE=true so the portal can be tried without live credentials.
// Queries pass the same read-only allowlist as the live client.
import { checkQuery } from './aroflo.js';

const CLIENTS = [
  'Darwin Harbour Apartments',
  'NT Health - Palmerston Clinic',
  'Casuarina Square Retail',
  'Larrakeyah Primary School',
  'Top End Logistics',
  'Stuart Park Body Corporate',
];

const TASK_NAMES = [
  'Replace split system - Unit 4', 'Switchboard upgrade', 'Blocked stormwater drain',
  'Emergency lighting test', 'Leaking hot water system', 'Roof leak investigation',
  'RCD testing & tagging', 'Install exhaust fan', 'Repair security door closer',
  'Quarterly AC service', 'Replace broken tiles - Lobby', 'Gutter clean & inspect',
  'Fix tripping circuit', 'Repaint fire stair handrails', 'Smoke alarm replacement',
];
const LOCATIONS = ['Level 1 Plant Room', 'Ground Floor Lobby', 'Car Park B2', 'Rooftop', 'Unit 12', 'Kitchen', 'Admin Block'];
const TYPES = ['Maintenance', 'Service', 'Emergency', 'Install'];
const STAFF = ['Mick Rogers', 'Sarah Nguyen', 'Tom Baxter', 'Priya Shah'];
const STATUSES = ['Completed', 'Completed', 'Completed', 'Archived', 'In Progress', 'Not Started', 'Pending'];
const FILTERS = ['Show Client', 'Show All', 'Show Client', 'Internal Only'];
const NOTE_TEXT = [
  'Attended site and met with building manager. Isolated circuit and inspected.',
  '<p>Work completed as per scope.<br>All areas left clean and tidy.</p>',
  'Parts sourced from supplier, fitted and tested. System operating correctly.',
  'Customer advised of further recommended works - quote to follow.',
  '<p><strong>Internal:</strong> check stock levels for next visit.</p>',
  'Photos of completed works attached for your records.',
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const id = (prefix, n) => Buffer.from(`${prefix}-${n}`).toString('base64');
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const fmtDateTime = (d) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

function buildData() {
  const r = rng(42);
  const clients = CLIENTS.map((name, i) => ({ clientid: id('client', i), clientname: name, archived: 'false' }));
  const tasks = [];
  let job = 24100;
  for (const client of clients) {
    const count = 8 + Math.floor(r() * 14);
    for (let t = 0; t < count; t++) {
      job++;
      const requested = new Date(2026, 9, 14 - Math.floor(r() * 300), 7 + Math.floor(r() * 4), 0);
      const status = pick(r, STATUSES);
      const done = /Completed|Archived/.test(status);
      const completed = new Date(Math.min(Date.now() - 3600000, requested.getTime() + (1 + Math.floor(r() * 10)) * 86400000 + Math.floor(r() * 8) * 3600000));
      const notes = [];
      const noteCount = 1 + Math.floor(r() * 4);
      for (let n = 0; n < noteCount; n++) {
        const posted = new Date(requested.getTime() + n * 7200000 + 3600000);
        const content = pick(r, NOTE_TEXT);
        notes.push({
          noteid: id(`note-${job}`, n), filter: pick(r, FILTERS), content, note: content,
          dateposted: fmtDate(posted),
          timeposted: posted.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }),
          user: { userid: '', username: pick(r, STAFF) }, sticky: 'false',
        });
      }
      const docs = [];
      const photoCount = Math.floor(r() * 6);
      for (let p = 0; p < photoCount; p++) {
        const kind = p === 0 ? 'Before' : p === photoCount - 1 ? 'After' : 'Progress';
        docs.push({
          documentid: id(`doc-${job}`, p), sizeinbytes: String(180000 + Math.floor(r() * 2e6)),
          uploadeddatetime: fmtDateTime(new Date(requested.getTime() + p * 3600000)),
          uploadedbyuser: { userid: '', username: pick(r, STAFF) },
          filter: pick(r, FILTERS), comment: `${kind} photo`,
          url: `mock://photo/${job}/${p}/${kind}`, name: `IMG_${job}_${p + 1}.jpg`,
        });
      }
      if (r() > 0.6) {
        docs.push({
          documentid: id(`doc-${job}`, 99), sizeinbytes: '84211', uploadeddatetime: fmtDateTime(completed),
          uploadedbyuser: { userid: '', username: pick(r, STAFF) }, filter: 'Show Client',
          comment: 'Certificate of compliance', url: `mock://doc/${job}`, name: `Compliance_Certificate_${job}.pdf`,
        });
      }
      tasks.push({
        taskid: id('task', job), jobnumber: String(job), taskname: pick(r, TASK_NAMES),
        refcode: `TTS${job}`, custon: r() > 0.5 ? `PO-${Math.floor(r() * 90000) + 10000}` : '',
        status, substatus: { substatusid: '', substatus: done ? 'Ready to Invoice' : '' },
        tasktype: pick(r, TYPES), description: '<p>Please attend and rectify. Contact site manager on arrival.</p>',
        client: { clientid: client.clientid, clientname: client.clientname },
        tasklocation: { locationid: '', locationname: pick(r, LOCATIONS) },
        requestdate: fmtDate(requested), requestdatetime: fmtDateTime(requested),
        completeddate: done ? fmtDate(completed) : '', completeddatetime: done ? fmtDateTime(completed) : '',
        duedate: fmtDate(new Date(requested.getTime() + 7 * 86400000)),
        contactname: 'Site Manager', tasknotes: notes, documentsandphotos: docs,
      });
    }
  }
  return { clients, tasks };
}

function parseWhere(params) {
  const where = { statuses: [] };
  for (const [key, value] of params) {
    if (key !== 'where') continue;
    const parts = value.split('|').filter((p) => p !== '(' && p !== ')');
    const [, field, , val] = parts;
    if (field === 'status') where.statuses.push(val.toLowerCase());
    else where[field] = val;
  }
  return where;
}

export function createMockClient() {
  const data = buildData();
  const stats = { requestsMade: 0, dailyRemaining: null, dailyLimit: null, lastError: null, lastErrorAt: null, lastSuccessAt: null };

  function query(zone, params) {
    stats.requestsMade++;
    stats.lastSuccessAt = new Date().toISOString();
    const where = parseWhere(params);
    const joins = params.filter(([k]) => k === 'join').map(([, v]) => v);
    if (zone === 'clients') return data.clients;
    // Every demo task reports one change on 1 Oct 2026, so the first check after the
    // initial download finds them and later checks find nothing new.
    if (zone === 'lastupdate') {
      const since = String(where.lastupdateutc || '').replace(/-/g, '/');
      return data.tasks
        .map((t) => ({ isdeleted: 0, zoneid: t.taskid, zonename: 'tasks', zoneidreference: 'taskid', lastupdateutc: '2026/10/01 00:00:00' }))
        .filter((r) => r.lastupdateutc >= since);
    }
    if (zone === 'tasks') {
      return data.tasks
        .filter((t) => !where.taskid || t.taskid === where.taskid)
        .filter((t) => !where.clientname || t.client.clientname === where.clientname)
        .filter((t) => !where.statuses.length || where.statuses.includes(t.status.toLowerCase()))
        .map((t) => ({
          ...t,
          tasknotes: joins.includes('notes') ? t.tasknotes : [],
          documentsandphotos: joins.includes('documentsandphotos') ? t.documentsandphotos : [],
        }));
    }
    return [];
  }

  return {
    mode: 'demo',
    stats,
    async get(params) {
      checkQuery(params);
      const zone = params.find(([k]) => k === 'zone')[1].toLowerCase();
      const all = query(zone, params);
      const size = Number(params.find(([k]) => k === 'pageSize')?.[1]) || 500;
      const page = Number(params.find(([k]) => k === 'page')?.[1]) || 1;
      const rows = all.slice((page - 1) * size, page * size);
      return { [zone]: rows, currentpageresults: rows.length, maxpageresults: 500, pagenumber: page };
    },
    async getAll(zone, params) {
      checkQuery([['zone', zone], ...params]);
      return query(zone.toLowerCase(), params);
    },
    async fetchDocument(url) {
      const [, kind, job, index, label] = url.match(/^mock:\/\/(photo|doc)\/(\d+)\/?(\d*)\/?(.*)$/) || [];
      if (kind === 'doc') {
        return { contentType: 'application/pdf', body: Buffer.from(minimalPdf(`Compliance certificate - Job ${job}`)) };
      }
      return { contentType: 'image/svg+xml', body: Buffer.from(placeholderPhoto(job, Number(index), label)) };
    },
  };
}

function placeholderPhoto(job, index, label) {
  const hues = [205, 28, 160, 260, 340, 90];
  const h = hues[(Number(job) + index) % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${h},35%,62%)"/><stop offset="1" stop-color="hsl(${h + 30},30%,32%)"/>
  </linearGradient></defs>
  <rect width="1200" height="900" fill="url(#g)"/>
  <g fill="none" stroke="rgba(255,255,255,.35)" stroke-width="6">
    <rect x="380" y="250" width="440" height="320" rx="18"/><circle cx="600" cy="410" r="95"/><rect x="520" y="215" width="160" height="40" rx="8"/>
  </g>
  <text x="600" y="690" text-anchor="middle" font-family="Segoe UI, Arial" font-size="54" fill="#fff" font-weight="600">${label || 'Photo'} - Job ${job}</text>
  <text x="600" y="750" text-anchor="middle" font-family="Segoe UI, Arial" font-size="30" fill="rgba(255,255,255,.8)">Demo photo ${index + 1}</text>
</svg>`;
}

function minimalPdf(text) {
  const stream = `BT /F1 20 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}
