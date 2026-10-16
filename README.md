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

On first run, open `/login` to create the admin account. Then go to **Control Panel → Users → New User**,
pick the AroFlo client(s) the user belongs to, and send them the generated password.

## Configuration (`.env`)

See `.env.example`. The AroFlo values come from AroFlo **Site Admin → Settings → General → AroFlo API**.
`DEMO_MODE=true` uses built-in sample data instead of AroFlo. Locally, `.env` overrides any values already
set in the terminal; on Azure, App Settings are used instead.

## What clients see

- **Jobs:** AroFlo tasks for their client with status *Completed* or *Archived* (AroFlo moves jobs to Archived
  after invoicing; can be turned off in Portal Settings), sorted by completed date, newest first.
  The list shows completed date, job #, task name and location.
- **Per job:** a Notes tab (newest first) and a Photos tab (oldest first, so before → after).
- **Visibility:** by default only notes/photos AroFlo marks *Show Client* or *Show All*. Change in
  **Control Panel → Portal Settings**. Non-photo documents (PDFs etc.) are never shown.
- **Access control:** every job, note and photo request is checked on the server against the user's linked
  clients. Photos are served through the portal, so AroFlo's links are never exposed.

## How data gets from AroFlo (server/sync.js)

The portal keeps its **own copy** of completed jobs, notes and photos (SQLite + `data/files`). Clients and admins
only read that copy, so viewing jobs makes **no AroFlo API calls**.

- **First run:** one paged download of every Completed/Archived task with notes and photos (~10 calls for ~200 jobs).
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
- **Photos** are downloaded once, for clients linked to a portal user, and kept on disk.
  Linking a client to a user downloads its photos within a few minutes.
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
