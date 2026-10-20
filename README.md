# Client Portal (AroFlo)

Clients sign in and see only their **completed** AroFlo jobs, newest first, and for each job only its
**notes and photos**. Nothing else from AroFlo (status, substatus, order numbers, descriptions, documents,
pricing) is sent to the browser.

Admins use the **Control Panel** to create client logins and link each one to one or more AroFlo clients.

## Run locally

```
npm install
npm start          # http://localhost:3000
```

On first run, open `/login` to create the admin account and set up two-factor sign-in with an authenticator app.
Then go to **Control Panel → Users → New User**, pick the AroFlo client(s) the user belongs to, and send them
the generated password.

## Configuration (`.env`)

See `.env.example`. The AroFlo values come from AroFlo **Site Admin → Settings → General → AroFlo API**.
`DEMO_MODE=true` uses built-in sample data instead of AroFlo. Locally, `.env` overrides any values already
set in the terminal; on Azure, App Settings are used instead.

## What clients see

- **Jobs:** AroFlo tasks for their client that have a **completed date** (from the sync-from date, default 1 Jan 2026), in any
  status or substatus: Completed, Ready for Invoicing, To Be Reviewed, Archived (archived can be turned off in Portal Settings). Sorted by completed date, newest first.
  The list shows completed date, job #, task name and location.
- **Per job:** a Notes tab (newest first) and a Photos tab (oldest first, so before → after).
- **Visibility:** by default only notes/photos AroFlo marks *Show Client* or *Show All*. Change in
  **Control Panel → Portal Settings**. Non-photo documents (PDFs etc.) are never shown.
- **Access control:** every job, note and photo request is checked on the server against the user's linked
  clients. Photos are served through the portal, so AroFlo's links are never exposed.

## Security

- **Read-only AroFlo access.** The portal only ever *reads* from AroFlo. Every API request is a GET with no
  body, and `checkQuery()` in `server/aroflo.js` refuses anything except the few read queries the sync uses
  (zones `tasks`, `clients`, `lastupdate`; simple `and|field|op|value` filters on known fields) before it is
  signed or sent. Browsers never choose what is sent to AroFlo, and never see the AroFlo keys.
  **Also set this up in AroFlo:** make the API keys belong to an AroFlo user whose permission group can only
  *view* Tasks, Clients and Documents/Photos. Then even stolen keys can't change anything.
- **No ids in URLs.** Jobs, photos, clients and users are referred to by encrypted, tamper-proof tokens
  (`server/tokens.js`, AES-256-GCM). An edited or forged token simply returns "not found".
- **Nothing points clients at AroFlo, even in the browser's developer tools ("Inspect").** Client-facing errors
  are generic; API responses carry only display fields; scripts and styles are served minified with comments
  stripped (`server/assets.js`; `/*! … */` licence lines kept); photos are named after the job
  (`CustON-1234-photo-x7Kq2a.jpg`), never the upload's name; and the Control Panel script and admin API look
  non-existent (404) to anyone but an admin. The only cookie is the http-only session cookie.
- **No hidden photo metadata.** Every stored or downloaded photo is re-encoded (`server/images.js`), which
  drops EXIF/XMP data such as GPS location, phone model and the app that saved it, at full resolution.
  Photos cached before this change are cleaned once in the background after start-up.
- **Admin two-factor sign-in.** Admins enter a code from an authenticator app (Microsoft, Google, etc.) after
  their password; they set it up at their first sign-in. Admin sessions last 12 hours, client sessions 14 days.
  - *Lost phone:* another admin opens the user in **Control Panel → Users** and clicks *Reset two-factor*.
  - *Only admin, lost phone:* add the App Setting `RESET_2FA_EMAIL=<their email>`, let the app restart, sign
    in and set up 2FA again, then **remove the setting** (it resets again on every restart while set).
- **`APP_SECRET`** (App Setting, 32+ random characters) is the key for the encrypted tokens and the stored 2FA
  keys. If it isn't set, one is generated and kept in the database (that key keeps working if `APP_SECRET` is
  added later). Once set, never change it: changing it breaks saved job links and every admin's 2FA (use
  `RESET_2FA_EMAIL` to recover). `azure-provision.ps1` creates it when missing.
- **Abuse protection:** sign-in lockouts per 15 minutes (8 failures per email+IP, 30 per IP, 20 per email
  across all IPs; an IPv6 /64 counts as one IP); wrong 2FA codes capped at 5 per 15 minutes and 20 per day
  per admin; 600 API requests per minute per IP; and a per-user limit on opening photos that have to come
  from AroFlo first (20 per 10 minutes for clients, 100 for admins). *Full resync* can run once per 10 minutes
  and *Refresh list* once a minute. AroFlo calls pause for an hour when fewer than `AROFLO_DAILY_RESERVE`
  (default 200) of today's calls remain, to protect TTS's other integrations.
- **Sessions:** changing a password signs that user out everywhere (your own change keeps only your current
  sign-in); disabling a user or changing their role signs them out immediately.
- **Security log:** lockouts, wrong 2FA codes and 2FA set-ups are written to the app log with the address
  they came from, prefixed `[security]` (Azure: `az webapp log tail …`).
- **Headers:** strict Content-Security-Policy, HSTS (on HTTPS), no framing, no referrer, `no-store` on API
  responses; signing out clears cached photos from the browser.

## How data gets from AroFlo (server/sync.js)

The portal keeps its **own copy** of completed jobs, notes and photos (SQLite + `data/files`). Clients and admins
only read that copy, so viewing jobs makes **no AroFlo API calls**.

- **First run:** one paged download of each active client's tasks with a completed date with notes and photos (~10 calls for ~200 jobs).
- **Active clients only:** in **Control Panel → Clients**, switch on the AroFlo clients that use the portal
  (linking a client to a user switches it on automatically). Only active clients are read from AroFlo:
  activating one downloads just its completed jobs; deactivating removes them. Webhooks for inactive clients
  are ignored without any API call (the payload carries the client name).
- **2026 onwards:** only jobs completed on or after the *Sync jobs completed on or after* date in Portal settings
  (default 1 Jan 2026) are requested from AroFlo or kept. Moving it later removes older jobs (no API calls);
  moving it earlier downloads the extra jobs for active clients.
- **Webhooks (main trigger):** AroFlo Event Messages (Task Status – Completed / Archived, Task – Add Task Note →
  Webhook) pointing at the URL in **Control Panel → AroFlo sync**. AroFlo's payload includes the task id
  (`payload.api_related_ids.taskid`), so just that task is fetched, by id (separate 20,000/day allowance, not the
  2,000/day limit).
- **Change check:** on every webhook and as a backup (hourly by default; Portal settings, 15 min to once a day),
  AroFlo's `lastupdate` zone (free under the daily limit) lists changed tasks. Only jobs the portal already holds
  are re-fetched, so edits, reopened jobs and deletions are picked up while busy in-progress work elsewhere in
  AroFlo costs nothing.
- **Daily:** client list (1 call) and a re-check of jobs completed in the last 7 days (a few calls), which catches
  any completion whose webhook was missed and photos added just after completion.
- **Restarts** don't re-download anything; a full download happens only on first run or *Full resync*.
- **Photos** download on demand, the first time someone opens a job (1 single-job lookup), then stay cached in
  `data/files`. Photos of jobs completed more than 30 days ago are stored shrunk (max 1600px, JPEG ~72%, typically
  ~10x smaller, EXIF rotation applied); a daily background pass shrinks cached photos as their jobs age. *Download*
  of a shrunk photo fetches the full-resolution original from AroFlo. The cache is capped (least recently viewed
  photos are evicted first). Settings: `PHOTO_CACHE_MB` (default 2000), `PHOTO_COMPRESS_AFTER_DAYS` (default 30).
- **Control Panel → AroFlo Sync** shows status, counts and API usage, with *Sync now* and *Full resync* buttons.

## Deploy to Azure App Service

Prerequisites: Azure CLI (`az login` done) and a working AroFlo key in `.env`. Run from PowerShell in this folder:

```powershell
# One-time: creates resource group, Linux B1 plan and web app (Node 24, Australia East),
# copies the AroFlo credentials from .env into App Settings, enforces HTTPS, prints a setup code.
.\deploy\azure-provision.ps1 -AppName tts-client-portal

# Every code change: zips server/ + public/ (never .env or data/), deploys, waits for /healthz.
.\deploy\azure-deploy.ps1 -AppName tts-client-portal
```

Then open `https://<AppName>.azurewebsites.net/login` and create the admin account using the **setup code** the
provision script printed (it's also the `SETUP_TOKEN` App Setting). On Azure the first-admin page is locked
without it, so nobody else can claim the portal.

Notes:
- **Data** (users, settings, synced jobs and photos) lives in `/home/data` on the app, which survives restarts and
  deploys. Back it up via App Service backups, or download it with Kudu.
- **Keep one instance.** Sessions, settings and the synced jobs are in SQLite and the sync runs in-process, so do
  not scale out beyond 1 instance (scaling *up* to a bigger plan is fine).
- **Changing the AroFlo key:** update `.env`, re-run `azure-provision.ps1` (safe to re-run), or edit the
  App Settings in the Azure portal. The app restarts automatically.
- **Custom domain** (e.g. `portal.ttsbuilt.com.au`): add it under the web app's *Custom domains* and use a
  free App Service managed certificate.
- Logs: `az webapp log tail -g rg-client-portal -n <AppName>`.
- Local dev and Azure share AroFlo's 2,000 calls/day limit, since they use the same key.
- **After the first deploy:** copy the webhook URL from **Control Panel → AroFlo Sync** into AroFlo
  (Site Admin → Settings → Event Messages → Task Completed → Webhook).

### Current production deployment

- App: `app-aroflo-client-portal-tts-prod` → https://app-aroflo-client-portal-tts-prod.azurewebsites.net
- Resource group `rg-tts-integrations`, on the existing Linux B1 plan `plan-aroflo-dashboards-prod`
  (shared with `app-aroflo-dashboards-tts-prod`; the plan itself was not changed).
- Redeploy after code changes:
  `.\deploy\azure-deploy.ps1 -AppName app-aroflo-client-portal-tts-prod -ResourceGroup rg-tts-integrations`
