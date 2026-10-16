---
version: 1
slug: "public-app-html"
primary_target: "public/app.html"
related_targets: ["public/admin.html","public/login.html"]
---

# Client portal (client job view + control panel + sign-in)

Mode: Operate. Scope: public/app.html (client jobs and job record), public/admin.html (control panel), public/login.html.

Audience and job: client office staff at desks confirm a job was done, collect evidence (notes, photos) for their reports, and review recent work. Admins (TTS office staff) manage logins, visibility and sync.

Constraints: only completed/archived jobs, only notes and photos; no statuses, costs or internal fields. Same-origin assets only (strict CSP), vanilla JS, no build step. Desktop first, works on phones.

Pinned by user: familiar to AroFlo/Simpro users (field-service job software) but cleaner and more straightforward; TTS Built brand; one-page job record (no tabs); Print / Save PDF completion record.

## Direction contract

THESIS: The job record is the product: a client opens a job and sees the proof, notes beside photos, on one page that prints as a report. Refuses the category default of status-heavy job screens split across tabs and menus.

OWN-WORLD: TTS Built's own identity applied to a field-service work surface: near-black charcoal shell (#1F1E1E/#2B2D2B) carrying the real white-and-orange logo, a warm light-grey workspace (#f3f2ef), white panels with warm hairlines, TTS orange (deep #c8380c for text/actions, #ff4616 for the 3px active rule) for selection and the primary action, TTS blue (#2a6f94) for links and job numbers. One workhorse system sans (Segoe UI first), tabular numerals for dates and job numbers. Consistent Lucide line icons.

STORY: Client signs in, sees "Completed jobs" for their organisation grouped by month with note/photo counts, searches or narrows by period, opens a job, reads the notes and views photos in one screen, then prints or downloads the evidence.

FIRST VIEWPORT: Charcoal top bar (logo left, "Client Portal", Jobs nav, user menu right). Page header: H1 "Completed jobs", organisation name, one summary line. Toolbar: search field and period select. Table: month group rows, columns Completed / Job / Task and site / Notes / Photos, newest first. Job page: back link, H1 task name with job number, facts row (site, completed), primary "Print / Save PDF"; below, two columns: Notes (left) and photo grid (right).

FORM: canon of the category (field-service job management, AroFlo/Simpro) played straight at full fidelity, chosen by the user. Signature move: the completion record, the job page laid out as a report that prints to a clean A4 record with TTS header, job facts, notes and photos. seed: none (pinned direction, no roll)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
