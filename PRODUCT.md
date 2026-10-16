# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Client users (primary):** office staff at TTS Built's clients (facility and property managers at organisations such as Ventia and SA Housing Trust), working at a desk on desktop browsers. They log in to:
  1. confirm a specific job was done, by seeing its notes and photos;
  2. collect evidence (photos, notes) for their own reports, compliance or invoice checks;
  3. review recently completed work across their sites.
- **Admins (TTS staff):** create client logins, link each login to one or more AroFlo clients, choose what clients can see, preview the client view, and monitor the AroFlo sync.

## Product Purpose

A client portal for TTS Built (Territory Trade Services Pty Ltd) that shows each client only their own **completed** AroFlo jobs, newest first, and for each job only its **notes and photos**. Success: a client can find a job and see proof the work was done in seconds, without calling TTS, and without seeing anything internal.

## Positioning

Clients get straight to the proof of work: no field-service-software complexity (AroFlo/Simpro-style menus, statuses, costs), just their finished jobs with notes and photos, kept in TTS's own copy so it is always fast.

## Operating Context

- Data source is AroFlo (TTS's job-management system). The portal keeps a local copy synced via AroFlo's `lastupdate` zone, webhooks (Event Messages) and periodic checks; page views never call AroFlo.
- Clients receive login details from TTS; there is no self sign-up.
- Admin users are TTS office staff who also work in AroFlo daily, so AroFlo terminology (job number, task, client, location, "Show Client" note visibility) is familiar to them.
- Hosted on Azure App Service (Linux, Node 24), alongside TTS's other AroFlo integrations.

## Capabilities and Constraints

- Client view: completed jobs list (completed date, job #, task, location), keyword and completed-date filters, job page with Notes and Photos, photo viewer with download.
- Clients must never see statuses, substatuses, order numbers, descriptions, costs, documents other than photos, or other clients' jobs. Archived jobs count as completed (configurable).
- Notes/photos shown are controlled by AroFlo visibility ("Show Client"/"Show All" by default, or all).
- Admin: users (create, edit, link clients, reset password, disable, delete), portal settings, AroFlo sync status and webhook URL, preview as any client.
- Stack: Node/Express server, vanilla JS front end with no build step, SQLite. Strict CSP: scripts/styles must be same-origin files (no inline styles/scripts, no third-party CDNs unless CSP is changed).

## Brand Commitments

- Company: **TTS Built** (legal name Territory Trade Services Pty Ltd), ttsbuilt.com.au. Taglines on the website: "Building Future Foundations", "Professional Staff. Successful Outcomes."
- Logo: `public/img/tts-logo.svg` (from ttsbuilt.com.au; orange "TTS" with white "Built", designed for dark backgrounds).
- Website palette: orange `#ff4616` (logo `#ff4713`), blue `#2f7ba3`, charcoal `#2B2D2B`, near-black `#1F1E1E`, cream `#dcd6cc`, border `#F0EDED`.
- Website typeface: Neusa Next (Adobe Fonts kit licensed to ttsbuilt.com.au; not usable on the portal domain without adding that domain to the kit).
- Tone: confident, professional, reliable ("on time, every time", "your trusted partner in progress").
- The user asked for a look familiar to AroFlo and Simpro users (job-management software) but cleaner, more readable and more straightforward.

## Evidence on Hand

- Live AroFlo data: 14 clients, ~193 completed/archived jobs; real job photos (site photos, JPEG ~2-3 MB each).
- No client testimonials, case studies or marketing claims are in scope; do not invent any.

## Product Principles

1. Proof first: the job's notes and photos are the point; everything else is wayfinding.
2. Only what the client should see: nothing internal or unfinished leaks, by design rather than by hiding.
3. Straightforward over complete: the fewest screens, choices and words that let a client find a job.
4. Fast and dependable: served from TTS's own copy, never waiting on AroFlo.
5. Admins stay in control: every client-facing rule is visible and changeable in the Control Panel.

## Accessibility & Inclusion

Readability was explicitly requested: comfortable text sizes and strong contrast for office users, WCAG 2.2 AA as the baseline.
