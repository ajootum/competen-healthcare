# CPR-AUDIT-001 — what was built without reading the specifications

**Date:** 2026-08-03 · **Scope:** the eleven modules built in this session (CPR-130, 140, 150, 300, 310,
320, 330, 340, 350, 360, 370).

## 1. What happened

Every one of the thirty-seven v1.0 specifications exists as a `.docx` in `~/Downloads`, and **each ships
with a `.png` design comp**. Eleven modules were built without opening any of them. The brief used
instead was §2 of `CPR-BUILD-001-v1-respecification.md` — a summary listing thirty-seven *titles* — plus
reasoning from first principles.

`CPR-BUILD-000`'s own memory note records the method that was skipped:

> Specs live in `~/Downloads/*.docx`; extract with `unzip -p <f> word/document.xml` and strip tags.

**The engines are largely sound.** What was built is real, tested, harnessed and appears in the specs.
The problem is coverage and shape, not correctness. Nothing below requires deleting.

**Two modules are the wrong thing.** CPR-330 and CPR-360 were built to a guess at their titles rather
than their content, and the guess was wrong in both cases.

## 2. Where the "honesty" rule was applied correctly, and where it overreached

The comps lean heavily on figures this product cannot produce. Refusing those was right and stays right:

| Refused | Why it stays refused |
|---|---|
| Revenue, collection rate, patient satisfaction (CPR-300) | No billing module, no survey capability |
| Every "↑25% vs yesterday" / "vs last month" trend | Needs a baseline nothing has recorded |
| Composite scores — Security 94%, Focus 87%, Delegation Health 92%, Time Saved 12.4 hrs | Invented indices with no defined formula |
| "HIPAA Compliant" / "GDPR Compliant" badges (CPR-370 comp) | Certifications, not design elements — respec §4 |
| AI assistant panels on every comp | CPR-210 is unbuilt; the panels imply a capability that does not exist |

**Where it overreached:** refusing four tiles justified omitting four tiles. It did not justify replacing
the whole layout. The respec itself says the comps are *"fine as illustrations of a layout"* — the layout
was never in dispute. Widget grids, quick-action panels, agenda timelines, KPI strips, location and date
switchers are all buildable from data that already exists.

**Decision taken:** unavailable figures render **in their designed position with an explicit empty state**
("no billing module yet") rather than being omitted. The layout matches the comp; the claims stay honest.

## 3. Per-module register

### CPR-330 Reports, Documents & Correspondence — **WRONG MODULE → CORRECTED**

> **Closed.** Rebuilt on migration 204: template designer with a merge body, merge-field resolver
> (unresolved renders as a visible marker, never blank), generation, batch generation with truthful
> counts, practice letterhead composed at print time, print/PDF view, schedule definitions that say they
> do not fire, and the dashboard built to the comp with its two unavailable tiles rendered in place.
> 52 harness assertions, four proven able to fail. The analytics engine was kept and re-labelled as an
> early slice of CPR-270 at `/practice/reports/analytics`. See respec §18.

The spec is **document generation**: clinical reports, referral letters, discharge summaries, medical
certificates, template designer, dynamic field merging, PDF/Word export, batch generation, scheduled
reports, approval workflow, digital signatures, version control, archive, practice branding.

What was built is **practice analytics** — activity counts, diagnosis frequency, aged backlog. That is
CPR-270 Analytics & Reporting's territory.

- **Keep:** the analytics engine, re-labelled as an early slice of CPR-270. The no-rates doctrine holds.
- **Build:** the actual CPR-330 — template library, merge fields, generation, export, approvals. Note
  the heavy overlap with CPR-130's document object and CPR-320's template library; these three need one
  document model between them, not three.

### CPR-360 Configuration & Personalisation — **WRONG EMPHASIS → CORRECTED**

> **Closed.** The personalisation half built on migration 205: dark theme (with a static scan that fails
> when a colour utility has no dark mapping), accent, text/interface size, density, reduce-visual-noise,
> dashboard widget visibility and order, notification categories wired to what CPR-340 actually raises,
> specialty profile that reorders the template library, real keyboard shortcuts, personal-over-practice
> overrides with `locked_preferences`, and import/export/reset. Appearance is deliberately not lockable.
> 48 harness assertions, five proven able to fail. The workspace configuration is kept in full. The
> comp's quiet hours, device register and auto-save interval render in place saying why they are not
> built. See respec §19.

The spec and comp are ~80% **personalisation**: dashboard customisation with drag-and-drop widget
toggles, saved layouts, theme (light/dark/system), primary and accent colour, font size, density,
reduce-visual-noise, notification preferences with quiet hours, keyboard shortcuts, specialty profile,
workflow preferences, sync and devices, import/export settings, reset to defaults.

What was built is **workspace configuration** — practice name, timezone, locations, appointment length.
That appears in the comp only as two fields inside "Workflow Preferences".

- **Keep:** all of it. The timezone correction and its write-time validation are genuinely load-bearing.
- **Build:** the personalisation surface. The commit message asserting *"nothing in this product has a
  per-user preference worth storing"* was written without reading a specification that is mostly
  per-user preferences.
- **Note:** the comp's "Auto-save Interval: 2 minutes" corroborates CPR-130's autosave requirement,
  which was explicitly designed against (see below).

### CPR-140 Follow-up Management — **STRUCTURALLY DIFFERENT → CORRECTED**

> **Closed.** Migration 206 adds follow-up plans and templates, the patient-centric view with the comp's
> tabs, adherence as a count and its denominator, and the fixed outcome taxonomy alongside the required
> words. A plan is a *grouping* — every step stays an ordinary follow-up on the ordinary board.
> **The open product question was settled the honest way:** the spec's reminder engine (SMS/Email/App/
> Voice/WhatsApp) is not built because this product has no delivery channel; what replaces it is a
> recall queue derived at read time and grouped by the person to contact, which needs nothing to run.
> 44 harness assertions, five proven able to fail. See respec §20.

The spec is **patient-centric** with **follow-up plans** — a sequence (initial → 2 weeks → 1 month →
3 months), an adherence figure, a recall queue, long-term monitoring, and a fixed outcome taxonomy
(improved / no change / worsened / referred / other).

What was built is a **workspace-wide board of single obligations** with free-text outcomes.

- **Keep:** derived-overdue, the practice clock, the DB-enforced release on a dead booking, closing
  requiring words. All sound and none contradicted by the spec.
- **Build:** follow-up plans, the patient-centric view with its tabs, recall queue, adherence, the
  outcome taxonomy, follow-up templates, recurring reviews.
- **Conflict to surface:** the spec assumes a **reminder engine** with SMS / Email / App / Voice /
  WhatsApp channels. This product has no delivery channel and CPR-320/340 were built on that basis. That
  is a genuine product decision, not a rule to apply silently.

### CPR-310 Team & Delegated Access — **DIFFERENT DELEGATION MODEL → CORRECTED**

> **Closed.** Migration 208 adds delegation by AREA (six of them, materialising ordinary capability
> grants so the resolver stays the single source of truth), practice-defined role templates, an approval
> queue that is explicitly NOT a gate (`blocksWork: false`), and derived work queues. Nothing clinical is
> delegable, checked twice. The page lost its `practice.members.manage` guard, which had put the approval
> queue out of reach of the practitioners it exists for. 48 harness assertions, four proven able to fail
> -- and the harness caught two real bugs: a partial area being granted under the area's name, and the
> approval queue sorting urgent requests to the bottom. See respec s22.
The spec delegates by **area** (Scheduling & Appointments, Patient Registration, Documentation &
Letters, Communications, Billing & Payments, Reports & Data Entry), with **approval workflows**, **shared
work queues**, and a named role set: Personal Assistant, Secretary, Practice Manager, Medical
Receptionist, Data & Admin Support, Owner.

What was built delegates **per capability**, against migration 191's role set (owner / practitioner /
practice_assistant / billing_reporting / read_only_auditor).

- **Keep:** time-bounded delegation, the escalation rule, the last-owner guard, invitation codes. The
  resolver bug found here was real and its fix stands.
- **Build:** area-based delegation as a layer over capabilities, approval workflows, shared work queues,
  team dashboard, location-specific access.
- **Decide:** whether to adopt the spec's role taxonomy or map it onto 191's. Adding roles is a
  migration; mapping is a naming layer.

### CPR-130 Clinical Documentation — partial → LARGELY CORRECTED

> **Mostly closed.** Migration 207 adds autosave (as DRAFTS, which write no version history -- the
> objection that refused it was right about a different question), smart text, clinical calculators that
> carry their inputs into every inserted sentence, and attachments in a private bucket with 60-second
> signed URLs. Print/export arrived with CPR-330. 51 harness assertions, five proven able to fail --
> and the harness caught two defects of its own, both recorded rather than quietly fixed. **Still open:**
> clinical forms and checklists (a form builder, a module in itself) and offline drafts (CPR-410's
> subject). See respec s21.
- **Have:** SOAP + templates, versioning/history, sign-and-lock, dictation, template library.
- **Missing:** **autosave** (explicitly designed against — the comp shows "Auto-saved 10:55 AM"),
  attachments and media, clinical forms/checklists, smart text and auto-complete, clinical calculators,
  export PDF and print, "save as template", duplicate document, rich-text editing.
- **Note:** the explicit-save decision was reasoned but was made against a requirement nobody had read.
  Worth re-deciding on the merits now that the requirement is visible.

### CPR-150 Procedure & Clinical Activity — partial → COMPLETED

> **Closed.** Migration 209 adds the "Activity" half the title names -- clinical activity logging with
> no patient_id, credited to whoever did it -- plus procedure teams (an agency nurse can be named),
> instruments as a child table with implant batch numbers REQUIRED, procedure templates that seed team
> and kit but never findings or implants, attachments reaching procedures, and a portfolio of counts and
> denominators. 38 harness assertions, four proven able to fail. Refused: complication/success RATES, and
> the competency link -- `competencyLinked: false` is in the payload. Batch recording, barcode readiness
> and offline drafts remain. See respec s23.
- **Have:** procedure recording, custom catalogue, consent tracking, outcomes, complications, laterality
  enforcement (not in the spec, and worth keeping).
- **Missing:** procedure templates, **clinical activity logging** (ward rounds, teaching, meetings — the
  "Activity" half of the module's title), team members on a procedure, instruments and consumables,
  attachments, portfolio/CPD evidence generation, batch recording.

### CPR-320 Communication & Document Management — partial → COMPLETED

> **Closed, and mostly by checking.** Six of the nine gaps listed below had since been built by later
> modules -- templates and PDF by CPR-330, files and signatures and versioning by CPR-130, the approvals
> queue by CPR-310 -- so building them again would have been the mistake. Migration 210 adds what was
> genuinely missing: a shared document library with folders and a recycle bin for documents that belong
> to the PRACTICE rather than a patient. A clinical document can never enter that bin, and the refusal
> says which it is. The patient correspondence register is COMPOSED from documents issued, copies
> released, documents received and calls recorded -- no fourth table. 38 harness assertions, four proven
> able to fail. Refused: the storage quota bar (there is no quota, `quotaBytes: null`). See respec s24.
- **Have:** internal threads with derived unread, contact log, incoming-document register.
- **Missing:** patient correspondence, templates library, shared document library, folder organisation,
  document storage and files, signatures and approvals queue, recycle bin, bulk actions, PDF generation.
- **Note:** the incoming-document register is not in the spec at all. It is defensible and useful, but it
  was invented — it should be recorded as an addition rather than assumed to be required.

### CPR-340 Tasks, Reminders & Notifications — partial to COMPLETED

> **Closed.** Notification preferences had already arrived with CPR-360. Migration 211 adds the rest:
> recurring tasks that do NOT pre-generate (the next is made when the current closes, counted from the
> DUE date so a late completion does not drag the series), task templates that make several tasks with
> offsets from the start, escalation rules whose breaches are DERIVED at read time (no `escalated`
> column, no job), bulk close that refuses anything needing a reason, and a composed daily agenda.
> 36 harness assertions, four proven able to fail. Refused: "Focus Score 87%" and the donut percentages.
> See respec s25.
- **Have:** tasks, assignment and hand-over, priorities, due dates, reminder dates, in-app notifications,
  derived orphaning.
- **Missing:** **recurring tasks**, **escalation rules** (overdue high-priority escalates), task
  templates, today's agenda, calendar view, bulk actions, notification preferences.

### CPR-350 Search & Global Retrieval — partial to COMPLETED

> **Closed.** Migration 212 adds saved searches, private search history, advanced date filters, the
> per-module count strip and quick searches. THE RULE, which is a security rule first: a saved search is
> a QUERY, not a snapshot -- nothing stored holds a result, a count or an identifier, and running one
> applies the CALLER's gate, which is what makes sharing safe. No count is shown beside a saved search
> anywhere. History is private to the searcher; the audit trail records the name, never the query.
> 30 harness assertions, four proven able to fail. Semantic AI search stays refused -- CPR-210.
> See respec s26.
- **Have:** cross-domain search, capability-scoped, per-domain grouping, prefix matching.
- **Missing:** saved searches, recent searches, quick-search chips, advanced filters (module/date/type/
  assigned-to/include-inactive), the per-module result-count strip, keyboard shortcuts, search history.
- **Refused:** semantic AI search — needs CPR-210.

### CPR-370 Security, Privacy & Practitioner Control — one of eight to COMPLETED

> **Closed, and the register with it.** Migration 213 adds the five that had never been started: a device
> register whose revocation resolvePracticeShell ENFORCES on every request (and which says, in the
> payload, that it does not end the platform session), an idle limit, MFA as a practice policy checked at
> the shell, standing patient consent where withdrawal never deletes and expiry is derived, and
> break-glass -- self-granted by design, reason-required, time-boxed, read-only, and impossible to take
> quietly. 53 harness assertions, four proven able to fail. Refused: the security score, the coverage and
> readiness percentages, the compliance badges, and the encryption and residency claims. In their place
> the page carries what it CANNOT know from here. See respec s27.
- **Have:** audit logging (the access log), RBAC (pre-existing), export.
- **Missing:** **MFA**, **session management**, **device management**, **consent management**,
  **break-glass access** (emergency access, logged and reviewed — a real clinical concept), password
  policy, data-protection settings, security alerts, data-retention controls.
- **Kept correctly:** retention named as an unanswered legal question rather than invented; compliance
  badges refused.

### CPR-300 Practice Operations Workspace — layout replaced to CORRECTED

> **Closed first, before this register was written up.** /practice/home was rebuilt to the comp: the
> six-tile KPI strip, today's schedule, operational alerts, tasks, messages, quick actions, the location
> switcher and the notification count. The ordering doctrine and the derived counts live INSIDE that
> layout, as this entry said they could. Revenue, patient satisfaction and collection render in their
> designed positions carrying the reason they are empty. Configurable widgets arrived with CPR-360.
> See respec s10.
- **Have:** an ordered attention list, real counts, capability-aware blind spots.
- **Missing:** KPI strip (appointments / new patients / procedures / follow-ups / messages / tasks),
  Today's Schedule timeline with clinic sessions, Operational Alerts panel, Tasks and Messages panels,
  **Quick Actions grid**, date picker, **location switcher**, notification bell, configurable role-based
  widgets, keyboard shortcuts.
- **Keep:** the ordering doctrine and the derived counts. They can live *inside* the specified layout.

## 4. The standing rule this produces

**Before building any CPR module: read `~/Downloads/CPR-<n>_*.docx` AND view the matching `.png` comp.**
The summary in `CPR-BUILD-001-v1-respecification.md` §2 is an index, not a brief. A module built from its
title will be plausible, coherent, well-tested and wrong.

Where a comp asks for something that cannot be built honestly, the rule stays what §4 says — refuse the
*claim*, keep the *layout*, and render an explicit empty state in the position the comp specifies.

## 5. Where this register stands

**All eleven are closed.** CPR-130, 140, 150, 300, 310, 320, 330, 340, 350, 360 and 370 were each
re-read against their specification and comp, corrected or completed, harnessed, and recorded in
`CPR-BUILD-001-v1-respecification.md` §§10, 18–27. Migrations 204–213.

**CPR-370 was the only one that was not a correction** — its access log existed, but MFA, session
management, device management, consent management and break-glass had never been started. It is also the
module where the honesty rule mattered most, because a security control that claims more than it
enforces is worse than an absent one: somebody stops worrying on the strength of it. Two limits are
therefore stated in the payload rather than on the page — `revocationEndsPlatformSession: false` and
`mfaEnrolmentIsPlatformLevel: true` — so no client can render them as more than they are.

### What the corrections had in common

Three patterns recurred often enough to be worth stating:

1. **Check what has already been built before building it.** CPR-320 listed nine gaps and six had been
   filled by later modules; CPR-340's notification preferences arrived with CPR-360. Building them twice
   would have been the mistake, not the fix.
2. **The refusals were usually right; the omissions were not.** Rates, composite scores, invented
   baselines and unbuilt AI panels all stayed refused — but refusing four tiles never justified replacing
   a whole layout. Unavailable figures now render in their designed position with an explicit reason.
3. **A rule stated in the payload beats a rule stated on the page.** `blocksWork: false`,
   `sentByThisProduct: false`, `quotaBytes: null`, `competencyLinked: false`, `fires: false` — each stops
   a client rendering something as more than it is, which a comment in the UI cannot.

### What the harnesses caught

Worth recording, because it is the argument for writing them this way: the harnesses found **a partial
delegation being granted under an area's name**, **an approval queue sorting urgent requests to the
bottom**, **`listTasks` not carrying recurrence**, **two fabricated eGFR reference values**, **an
assertion passing against `undefined`**, and **a dark-theme rule that existed but did not apply**. Four
of those were in shipped-looking code; two were in the harnesses themselves.
