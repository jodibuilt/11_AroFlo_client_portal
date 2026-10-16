---
name: TTS Built Client Portal
description: Field-service job records in TTS Built's own identity, charcoal shell over a compact, cool-grey workspace.
colors:
  shell: "#1f1e1e"
  shell-raised: "#2b2d2b"
  shell-line: "#3a3b39"
  shell-text: "#f3f4f6"
  shell-muted: "#b6bcc3"
  brand-orange: "#ff4616"
  accent: "#c8380c"
  accent-hover: "#a82f0a"
  accent-soft: "#fdf0ea"
  accent-line: "#f3c9b8"
  link: "#2a6f94"
  link-hover: "#1f5675"
  link-soft: "#eaf3f8"
  ground: "#f2f3f5"
  panel: "#ffffff"
  panel-2: "#f7f8fa"
  grid-head: "#eef0f3"
  row-alt: "#fafbfc"
  row-hover: "#f1f5f9"
  line: "#e1e4e8"
  line-strong: "#c8cdd3"
  ink: "#1b1f24"
  ink-2: "#3d444c"
  ink-3: "#5c636b"
  ok: "#2c7a3a"
  ok-soft: "#ebf6ed"
  danger: "#b42318"
  danger-soft: "#fdeeec"
  warn: "#8a5300"
  warn-soft: "#fff5e1"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.4286rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title-lg:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.2857rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0714rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  body-strong:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9286rem"
    fontWeight: 600
    lineHeight: 1.3
  data:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "\"tnum\" 1"
  mono:
    fontFamily: "Consolas, Cascadia Mono, monospace"
    fontSize: "0.9286rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "4px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  section: "20px"
  page: "24px"
  page-bottom: "48px"
  empty: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.panel}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
  button-small:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-shell:
    backgroundColor: "transparent"
    textColor: "{colors.shell-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "36px"
  topbar:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-text}"
    padding: "0 24px"
    height: "56px"
  page-bar:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    padding: "12px 24px"
    height: "60px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  panel-head:
    backgroundColor: "{colors.panel-2}"
    typography: "{typography.title}"
    padding: "10px 16px"
    height: "44px"
  grid-head:
    backgroundColor: "{colors.grid-head}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    padding: "8px 14px"
  grid-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    padding: "8px 14px"
  grid-row-alt:
    backgroundColor: "{colors.row-alt}"
  grid-row-hover:
    backgroundColor: "{colors.row-hover}"
  count:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
  detail-cell:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "12px 16px"
  tag:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-2}"
    rounded: "12px"
    padding: "0 9px"
    height: "24px"
  tag-on:
    backgroundColor: "{colors.ok-soft}"
    textColor: "#1f5c2a"
  tag-off:
    backgroundColor: "{colors.danger-soft}"
    textColor: "#8f1d14"
  tag-admin:
    backgroundColor: "{colors.link-soft}"
    textColor: "#1d4f6b"
  chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "#8c2a08"
    typography: "{typography.label}"
    rounded: "14px"
    padding: "0 4px 0 11px"
    height: "28px"
  sidenav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  sidenav-item-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.accent}"
  photo-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  drawer:
    backgroundColor: "{colors.panel}"
    padding: "24px"
    width: "580px"
---

# Design System: TTS Built Client Portal

## Overview

**Creative North Star: "The Site Record"**

The portal is a field-service work surface wearing TTS Built's own clothes. A near-black charcoal shell carries the real white-and-orange logo and the company block; under it a slim white page bar names the page, and below that sits a neutral, slightly cool grey workspace of white panels with tinted heads and cool hairlines. Everything a client needs to confirm work was done (dates, job numbers, notes, photos) is set in one workhorse system sans with tabular numerals, so the record reads like a dependable trade document rather than a dashboard.

Density is deliberately that of the category software users already know (AroFlo, Simpro), which the user chose over an earlier, roomier, warmer version: a 14px root, 36px controls, 44px panel heads, 16px panel padding, flat zebra-striped data grids with sortable column headings, and a 1400px page. It is played straight and kept tidy rather than restyled. Orange is the brand's voice but is spent sparingly: the 3px active rule under the current nav item, the one primary action, selection, sort direction and focus. Blue means "go to": links, breadcrumbs and job numbers.

The record must survive paper. The job page prints as an A4 completion record: chrome and page bar removed, dark logo, a 2px brand-orange rule, the job details as a two-column list, notes, then photos two-up.

**Key Characteristics:**
- Charcoal shell, white page bar, cool grey ground, white panels with tinted heads.
- Compact, AroFlo-style density: 14px root, 36px controls, 44px panel heads.
- Two oranges with separate jobs: bright for marks, deep for text and actions.
- Blue reserved for links, breadcrumbs and job numbers.
- One system sans, tabular numerals for every date, count and job number.
- Lucide line icons at 2px stroke, 14 to 18px, coloured in ink-3 beside text.
- Flat surfaces with one subtle shadow; heavy shadow only on overlays.
- Prints to a clean A4 report.

## Colors

A neutral, slightly cool workspace under a charcoal bar, with TTS orange and TTS blue each holding a single, distinct job.

### Primary
- **TTS Signal Orange** (brand-orange): the logo's orange. Used only as a mark: the 3px active-nav underline in the shell and the 2px rule under the print header. Never as text on white.
- **Deep Site Orange** (accent): every orange that has to be read or pressed. Primary button fill, active side-nav text and icon, the active sort direction marker, selected radio card border, the focus ring (at 28% alpha), caret and native form `accent-color`. Hover deepens to accent-hover. Its soft tint (accent-soft) with accent-line border fills selected radio cards and client chips.

### Secondary
- **Harbour Blue** (link): TTS blue darkened for AA text. Links, breadcrumb links in the page bar, job numbers in the grid, user names in the admin table. Hover to link-hover. Its tint (link-soft) backs the admin tag and the preview notice.

### Neutral
- **Charcoal Shell** (shell) and **Raised Charcoal** (shell-raised): the top bar and controls inside it (company switcher, shell button hover). Shell-line divides the logo from the company block; shell-text and shell-muted are the bar's two text levels, both neutral cool greys.
- **Cool Ground** (ground): the page behind panels.
- **Panel White** (panel) and **Panel Tint** (panel-2): panel and page-bar surfaces; the tint fills every panel head, admin table heads, stats tiles, drawer footers, button hover and list hover rows.
- **Grid Head** (grid-head): the jobs grid header row, one step darker than the panel tint so the column headings read as a band; it is also the pressed state of secondary buttons.
- **Row Stripe** (row-alt) and **Row Hover** (row-hover): every other grid row, and the hovered row (a faint blue-grey).
- **Cool Hairline** (line) and **Strong Hairline** (line-strong): panel borders, row dividers and detail-cell dividers; line-strong for control borders, the grid header rule and the print section rule.
- **Ink** (ink), **Ink Two** (ink-2), **Ink Three** (ink-3): primary text; labels, column heads, dates and location/company columns; meta text, detail labels, counts, hints and icons beside text. Ink-3 holds 6.1:1 on white and 5.6:1 on ground, so it is the lowest text tone allowed.

### States
- **Done Green** (ok / ok-soft), **Fault Red** (danger / danger-soft), **Caution Amber** (warn / warn-soft): alerts, status tags and notices, always as soft fill + tinted 1px border + darkened text from the same hue.

### Named Rules
**The Two Oranges Rule.** Bright TTS orange is a mark (rules, underlines, logo); deep orange is for anything read or pressed. If it is text, a fill behind text, or a focus ring, it is the deep orange.

**The Blue Means Go-To Rule.** Blue appears only on things that navigate: links, breadcrumbs and job numbers. Orange never marks a link, blue never marks an action.

**The Shell Stays Up Top Rule.** Charcoal belongs to the top bar (and the dark photo viewer). The workspace stays cool and light; no dark cards or dark sections inside it.

**The Cool Neutral Rule.** Workspace greys are neutral to slightly cool (blue-grey undertone). Warm beiges and taupes are retired; the only warmth on the page comes from the two oranges.

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, Roboto, Helvetica Neue, Arial)
**Mono Font:** Consolas (with Cascadia Mono), only for secrets and webhook URLs

**Character:** One workhorse sans doing everything at compact product-UI scale; weight 600 and ink level carry hierarchy rather than size jumps. The root is 14px on desktop, 15px under 720px, 11pt in print.

### Hierarchy
- **Headline** (600, 20px, 1.25, -0.01em): the page title in the page bar ("Completed Jobs", "Control Panel", the job's task name) and the sign-in heading. Balanced wrapping.
- **Title Large** (600, 18px, 1.25): drawer headings only.
- **Title** (600, 15px, 1.25): panel heads ("Search", "Jobs", "Job details", "Notes", "Photos", "Users"), empty-state titles. The company name in the shell and stat values use this size at 650.
- **Body** (400, 14px, 1.55): grid cells, note text (capped at 70ch), detail values (at 500), lead lines.
- **Body Strong** (600, 14px): buttons, nav items, note authors. Job numbers step up to 650 in blue.
- **Label** (600, 13px): field labels, grid column headings, tags, chips, shell captions. Meta, hints, breadcrumbs, detail labels and counts use the same size at 400 to 500 in ink-3.

### Named Rules
**The Tabular Truth Rule.** Every date, time, count and job number is set with tabular numerals, so columns of records align and compare at a glance.

**The Weight Not Size Rule.** The ramp tops out at 20px. New screens add emphasis with 600 weight and ink level, not with larger type.

## Layout

A sticky 56px shell, then a full-width white page bar (min 60px, 12px by 24px padding, 1px hairline below) whose inner row is aligned to the page column: an optional breadcrumb line ("Completed Jobs > Job 1213", 13px ink-3 with a blue link and 14px chevron), the 20px page title, and actions aligned right (Print / Save PDF on the job page). The page bar replaces in-page H1s and back links. Below it, a centred page column (max 1400px, 20px top, 24px sides, 48px bottom). Content lives in panels separated by 20px (16px on the job page); panel heads are 44px minimum with 10px by 16px padding on the panel tint, panel bodies 16px.

The jobs page is two blocks: a Search panel (Keyword with inset icon, Completed period select with an optional From/To range, Clear button; fields bottom-aligned in a 12px-gap row) and a Jobs panel holding the grid and a pager. Grid cells are 8px by 14px with fixed column widths (Completed 132px, Job # 96px, Location 30%, Company 18%, counts 86px right-aligned; Task takes the rest).

The job page is a "Job details" panel over a body of Notes (5fr, min 300px) beside Photos (7fr), 16px gap; empty sections are not rendered, a lone section takes the full width, and if neither exists a single muted panel says so. Job details is a definition grid of label/value cells (120px for Job #, then Task, Location, Completed, plus Company only for users linked to several companies), each cell 12px by 16px divided by vertical hairlines. Photos fill an auto grid of 180px minimum tiles at 14px gaps, 4:3 crops. The control panel is a 230px sticky side nav beside a fluid column at 24px gap. Drawers slide in from the right at up to 580px.

Responsive: at 960px the record and admin layouts go to one column, the detail grid becomes two columns with horizontal dividers, and the side nav becomes a horizontal scrolling row. At 720px the root grows to 15px, the shell hides the "Client Portal" caption, user details and nav labels (icons remain), page padding tightens to 20px by 16px, the page bar's actions stretch full width, search fields go full width, photos go two-up, zebra striping drops and the grid restacks into cards (job number left, date right, task, location and company below, counts spelled out, empty counts hidden).

Print: A4 with 16mm by 14mm margins, shell and page bar removed, panels lose borders, shadow and radius, the detail grid goes two-column without dividers, the record goes single-column with notes then photos two-up, each note and photo kept unbroken.

## Elevation & Depth

Flat and tonal. Depth comes from the cool ground behind white panels, the tinted panel head, a 1px cool hairline, and one subtle shadow barely above the border. Real elevation is reserved for things that sit over the page: the user drawer and the photo viewer image.

### Shadow Vocabulary
- **Subtle** (`box-shadow: 0 1px 2px rgba(27,31,36,.05)`): panels, the active side-nav item, photo tiles on hover.
- **Overlay** (`box-shadow: 0 12px 32px rgba(31,30,30,.18), 0 2px 6px rgba(31,30,30,.08)`): the user drawer, over a 45% charcoal scrim.
- **Focus** (`box-shadow: 0 0 0 3px rgba(200,56,12,.28)`): the focus ring on every focusable element, inset on top-nav links and grid sort headings.

### Named Rules
**The Hairline First Rule.** A surface is separated by a 1px cool line before it is lifted by a shadow. Shadows stronger than Subtle appear only on overlays.

## Shapes

Tight and consistent: panels at 6px; controls, inner tiles (photos, stats, radio cards), alerts, side-nav items and focus outlines at 4px. Panel heads take the panel's top corners. Tags and chips are full pills (radius at half their 24 and 28px heights); the viewer's previous and next buttons are circles. Borders are always 1px; the only thicker lines are the 3px active nav rule and the 2px print header rule, both bright orange. Print squares panel corners off.

## Components

### Buttons
Plain, sturdy and familiar.
- **Shape:** slightly rounded (4px), 36px tall, 14px side padding, 600 weight, 18px icon with 8px gap.
- **Primary:** deep orange fill, white text; hover to accent-hover. One per view: Print / Save PDF, New user, Sign in (40px, full width on the sign-in card).
- **Secondary:** white with a strong hairline, ink text; hover to panel tint with a darker border, pressed to grid-head grey.
- **Small / Quiet:** 30px at 13px; quiet drops border and fill until hover. Used for row actions like Preview, pager buttons and Clear search.
- **Danger:** secondary shape with red text, red tint on hover.
- **Shell:** transparent with a shell-line border inside the top bar, 36px, 13px; hover to raised charcoal.
- **Focus:** the 3px deep-orange focus ring. Disabled is 50% opacity.

### Counts, Tags and Chips
- **Count:** the number beside a panel title as plain muted text in parentheses, "Jobs (49)" or "Jobs (12 of 49)", 13px 500 ink-3, tabular. No pill, no fill.
- **Tags:** 24px pills for role and status; neutral by default, green for active, red for disabled, blue for admin.
- **Chips:** 28px orange-tint pills for selected clients in the picker, with a 22px circular remove button.

### Cards / Containers
- **Corner Style:** 6px panels; 4px inner tiles (photos, stats, radio cards).
- **Background:** white panels on cool ground; every panel head on the panel tint with a hairline below.
- **Shadow Strategy:** Subtle only (see Elevation).
- **Border:** 1px cool hairline.
- **Internal Padding:** 16px; note rows and the photo grid 20px; sign-in card 32px.

### Inputs / Fields
- **Style:** 36px, white, 1px strong hairline, 4px radius, 10px side padding; search inputs carry a 16px ink-3 icon inset at 12px with 34px left padding. Labels sit above in 13px 600 ink-2 with a 6px gap.
- **Focus:** border turns deep orange plus the focus ring.
- **Radio cards:** each option is a bordered 4px row; the checked one takes the deep-orange border on accent-soft.

### Navigation
- **Top bar:** charcoal, logo (22px tall) then a divided company block (13px shell-muted caption over the 15px white company name; clients only ever see their company as text; the switcher select appears for admins previewing a client). Clients have a single page and get no nav. Admins get two nav links, "Client view" and "Control Panel", in 600 shell-muted with an 18px icon; hover to shell-text; current page goes white with a 3px bright-orange underline flush to the bar's bottom edge. User name and sign-out sit right.
- **Page bar:** see Layout. The breadcrumb is a real navigation path (blue link, chevron, current item in ink-3), shown only on pages below another page.
- **Side nav (control panel):** 600 ink-2 items with ink-3 icons; hover to a cool grey tint; current item becomes a white raised tile with deep-orange text and icon.

### Jobs Grid
The category's core view: a flat, sortable data grid in its own "Jobs" panel, below a separate "Search" panel. Columns: Completed, Job #, Task, Location, Company (only for clients linked to several companies). No note or photo count columns; counts live on the job record. Fixed table layout; long text is cut with an ellipsis, full text in the title. Header row on grid-head grey with a 1px line-strong rule; every heading is a full-width sort button (13px 600 ink-2, darker grey on hover), the active one in ink with a deep-orange direction marker. Rows are 8px by 14px, zebra-striped with row-alt, row-hover on hover, the whole row clickable; job numbers in blue 650. A pager ("1–50 of 312", Previous / Next small buttons) appears only when there is more than one page. On phones the rows stack into cards.

### Job Completion Record
The signature component. The page bar carries the breadcrumb, the task as the title and Print / Save PDF as the primary action. A "Job details" panel lays out label/value cells (13px ink-3 label over a 500-weight ink value, job number and completion time tabular). Notes list author, right-aligned time and pre-wrapped text; Photos is a grid of 4:3 tiles with optional comment captions, and when every photo shares one upload time it is shown once in the Photos head as a hint rather than under each tile. Tiles open a dark full-screen viewer (96% charcoal, circular 48px prev/next, tabular counter, Download and Close). In print it becomes an A4 report headed by the dark logo, a "Job completion record" meta block and a 2px brand-orange rule.

### Alerts, Notices and Empty States
Alerts are 4px soft-fill boxes with a tinted border and a leading icon. Notices span the page under the shell (amber for demo mode, blue for admin preview). Empty states centre a 32px muted icon, a 15px title and a short paragraph capped at 46ch. Loading uses shimmering 14px skeleton bars in cool greys.

## Do's and Don'ts

### Do:
- **Do** keep bright TTS orange to marks (3px nav underline, 2px print rule, logo) and use deep orange for every orange text, fill and focus ring.
- **Do** set dates, times, counts and job numbers in tabular numerals, and job numbers in blue at 650.
- **Do** keep the compact density: 36px controls (30px small), 44px panel heads on the panel tint, 16px panel bodies, 8px by 14px grid cells.
- **Do** put the page title, breadcrumb and page actions in the page bar, not inside the page column.
- **Do** separate surfaces with a 1px cool hairline and the Subtle shadow; reserve the Overlay shadow for drawers.
- **Do** use Lucide line icons at 2px stroke (18px default, 16px in inputs and tallies, 14px in breadcrumbs), coloured ink-3 beside text.
- **Do** keep one primary orange button per view and make it the job's main outcome.
- **Do** hide sections and cells that have nothing in them rather than showing dashes or "none".
- **Do** check every new record layout in print: chrome and page bar hidden, notes and photos unbroken, logo and brand rule on top.
- **Do** keep text at ink-3 or darker; zero and meta states use ink-3, not a lighter grey.

### Don't:
- **Don't** set the bright #ff4616 orange as text or as a fill behind text on white.
- **Don't** colour links orange or actions blue.
- **Don't** introduce a second display or text typeface; mono is only for secrets and URLs to copy.
- **Don't** raise the type ramp above 20px to add emphasis.
- **Don't** reintroduce warm beige or taupe greys into the workspace.
- **Don't** bring charcoal into the workspace as dark cards or dark sections.
- **Don't** put counts in pills or badges; they are muted parenthesised text.
- **Don't** mix icon sets, filled icons or text glyphs in place of icons.
- **Don't** use heavy or hard offset shadows on resting panels.
- **Don't** add small caption labels above page or panel headings; the "Client Portal" caption is part of the shell's company block only, and the page-bar breadcrumb is navigation, not a label.
